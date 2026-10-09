const fail = code => Object.assign(new Error(code), {code});
const textTypes = new Set(['text','tel','email','number']);

/** Set a supplied native text control using its own document realm's value setter.
 * value is an already-normalized string, including '' when restoring an empty field.
 * ctx = {signal?, assertCurrent, document?, EventCtor?}; document defaults to the
 * content-script document, and events default to that document realm's Event.
 * assertCurrent must synchronously reject a stale document/session/route.
 * Eligible controls are connected, enabled, writable input text/tel/email/number
 * and textarea. Native date types, search/combobox controls and other input types
 * are excluded. The adapter must choose a specialized operation for datepickers
 * whose native input is text; this helper does not inspect widget ancestors.
 * Native prototype accessors bypass an instance's framework value property without
 * modifying it. No selectors, framework internals, focus, click or blur are used.
 * Each setter/event has its own cancellation and freshness guard. input and change
 * bubble on this target only. Cancellation does not undo a completed assignment.
 * Static Error.code contains no field contents. Exact native readback is required
 * before events and after their synchronous handlers. Number/text sanitization
 * that changes the requested string is a mismatch, not automatic normalization.
 * {assigned:true} proves only the local DOM result; it does not prove that Vue or
 * the site accepted synthetic events. Future verified adapters handle acceptance.
 */
export function setTextField(input, value, ctx) {
  if (!ctx || typeof ctx.assertCurrent !== 'function') throw fail('invalid_text_context');
  if (typeof value !== 'string') throw fail('invalid_text_value');
  const document = ctx.document ?? globalThis.document;
  let realm, prototype, kind;
  try {
    if (!document || !input || input.ownerDocument !== document || input.isConnected !== true || input.disabled || input.readOnly) throw null;
    realm = document.defaultView;
    if (typeof realm?.HTMLInputElement === 'function' && input instanceof realm.HTMLInputElement && textTypes.has(input.type) && input.getAttribute('role') !== 'combobox') {
      kind = 'input'; prototype = realm.HTMLInputElement.prototype;
    } else if (typeof realm?.HTMLTextAreaElement === 'function' && input instanceof realm.HTMLTextAreaElement) {
      kind = 'textarea'; prototype = realm.HTMLTextAreaElement.prototype;
    } else throw null;
  } catch {throw fail('invalid_text_input');}
  let setter, getter;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(prototype,'value');
    setter = descriptor?.set; getter = descriptor?.get;
    if (typeof setter !== 'function' || typeof getter !== 'function') throw null;
  } catch {throw fail('native_text_accessor_unavailable');}

  function guard() {
    if (ctx.signal?.aborted) throw fail('cancelled');
    try {
      const current = ctx.assertCurrent();
      if (current && typeof current.then === 'function') {Promise.resolve(current).catch(() => {}); throw null;}
      if (current === false) throw null;
    } catch {throw fail(ctx.signal?.aborted ? 'cancelled' : 'document_lost');}
    if (ctx.signal?.aborted) throw fail('cancelled');
    try {if (input.ownerDocument !== document || input.isConnected !== true) throw null;}
    catch {throw fail('document_lost');}
    try {
      if (input.disabled || input.readOnly || kind === 'input' && (!textTypes.has(input.type) || input.getAttribute('role') === 'combobox')) throw null;
    } catch {throw fail('text_input_unavailable');}
  }
  function readback() {
    try {if (getter.call(input) !== value) throw null;}
    catch {throw fail('text_readback_mismatch');}
  }

  guard();
  try {setter.call(input,value);}
  catch {throw fail('text_assignment_failed');}
  readback();
  const EventCtor = ctx.EventCtor ?? realm.Event;
  for (const type of ['input','change']) {
    let event;
    try {event = new EventCtor(type,{bubbles:true});}
    catch {throw fail('text_event_creation_failed');}
    guard();
    try {input.dispatchEvent(event);}
    catch {throw fail('text_event_dispatch_failed');}
  }
  guard(); readback();
  return {assigned:true};
}
