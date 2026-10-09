const fail = code => Object.assign(new Error(code), {code});
const minBytes = 10 * 1024;
const maxBytes = 2 * 1024 * 1024;

/** Assign one already-validated image to a supplied native file input.
 * image = {name, type: 'image/jpeg'|'image/png', bytes: ArrayBuffer}.
 * ctx = {signal?, assertCurrent, document?, FileCtor?, DataTransferCtor?, EventCtor?}.
 * The current document and constructors default to the content-script globals.
 * Constructor overrides and document make the platform boundary testable in Node.
 * assertCurrent is synchronous and must reject a stale session or route.
 * This helper chooses no selectors, reads no accept/visibility state, and never
 * decodes or transforms bytes. The sidebar/session validate image content.
 * Every files assignment and event dispatch has its own cancellation/document guard.
 * Failure throws an Error with a static code; assignment is not rolled back.
 * {assigned:true} means only local FileList assignment and metadata readback.
 * It says nothing about site upload, OCR, or the website accepting synthetic events.
 */
export function assignImageFile(input, image, ctx) {
  if (!ctx || typeof ctx.assertCurrent !== 'function') throw fail('invalid_file_context');
  const document = ctx.document ?? globalThis.document;
  try {
    if (!document || !input || input.tagName !== 'INPUT' || input.type !== 'file' || input.ownerDocument !== document || input.isConnected === false) throw null;
  } catch {throw fail('invalid_file_input');}

  let name, type, bytes;
  try {
    if (!image || typeof image !== 'object' || Array.isArray(image) || Object.keys(image).some(key => !['name','type','bytes'].includes(key))) throw null;
    ({name, type, bytes} = image);
    if (typeof name !== 'string' || !name.trim() || !['image/png','image/jpeg'].includes(type) || !(bytes instanceof ArrayBuffer) || bytes.byteLength < minBytes || bytes.byteLength > maxBytes) throw null;
  } catch {throw fail('invalid_image');}

  function guard() {
    if (ctx.signal?.aborted) throw fail('cancelled');
    try {
      const current = ctx.assertCurrent();
      if (current && typeof current.then === 'function') {
        Promise.resolve(current).catch(() => {});
        throw null;
      }
      if (current === false) throw null;
    }
    catch {throw fail(ctx.signal?.aborted ? 'cancelled' : 'document_lost');}
    if (ctx.signal?.aborted) throw fail('cancelled');
    try {if (input.ownerDocument !== document || input.isConnected === false || input.type !== 'file') throw null;}
    catch {throw fail('document_lost');}
  }

  const FileCtor = ctx.FileCtor ?? globalThis.File;
  const DataTransferCtor = ctx.DataTransferCtor ?? globalThis.DataTransfer;
  const EventCtor = ctx.EventCtor ?? globalThis.Event;
  let file, transfer, targetFiles;
  try {file = new FileCtor([bytes], name, {type});}
  catch {throw fail('file_creation_failed');}
  try {
    transfer = new DataTransferCtor();
    if (!transfer.items.add(file)) throw null;
    targetFiles = transfer.files;
  } catch {throw fail('file_transfer_unavailable');}

  guard();
  try {input.files = targetFiles;}
  catch {throw fail('file_assignment_failed');}

  let files;
  try {
    files = input.files;
    if (!files || files.length !== 1 || files[0].size !== bytes.byteLength || files[0].type !== type || files[0].name !== name) throw null;
  } catch {throw fail('file_readback_mismatch');}

  for (const eventType of ['input','change']) {
    let event;
    try {event = new EventCtor(eventType, {bubbles:true});}
    catch {throw fail('file_event_creation_failed');}
    guard();
    try {input.dispatchEvent(event);}
    catch {throw fail('file_event_dispatch_failed');}
  }
  guard();
  return {assigned:true};
}
