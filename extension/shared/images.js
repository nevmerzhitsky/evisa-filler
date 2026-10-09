export const MIN_IMAGE_BYTES = 10 * 1024;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const abort = signal => {
  if (signal?.aborted) throw new DOMException('Image validation cancelled', 'AbortError');
};
function detectedType(bytes) {
  const header = new Uint8Array(bytes);
  if (header.length >= 8 && [137,80,78,71,13,10,26,10].every((byte,index) => header[index] === byte)) return 'image/png';
  if (header.length >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255) return 'image/jpeg';
  return null;
}

// createImageBitmap returns an owned bitmap. Its caller must close it.
async function decodeInBrowser(blob, {signal}) {
  abort(signal);
  if (typeof globalThis.createImageBitmap === 'function') return globalThis.createImageBitmap(blob);
  if (typeof globalThis.Image !== 'function' || typeof globalThis.URL?.createObjectURL !== 'function') throw new Error('Image decoder unavailable');
  return new Promise((resolve,reject) => {
    const image = new globalThis.Image();
    const url = globalThis.URL.createObjectURL(blob);
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', onAbort);
      globalThis.URL.revokeObjectURL(url);
    };
    const onAbort = () => {
      cleanup();
      image.src = '';
      reject(new DOMException('Image validation cancelled', 'AbortError'));
    };
    image.onload = () => {
      const dimensions = {width:image.naturalWidth,height:image.naturalHeight};
      cleanup();
      resolve(dimensions);
    };
    image.onerror = () => {cleanup();reject(new Error('Image decoding failed'));};
    signal?.addEventListener('abort',onAbort,{once:true});
    if (signal?.aborted) {onAbort();return;}
    image.src = url;
  });
}

export async function validateImage(file, role, {signal, decode = decodeInBrowser} = {}) {
  const failure = reason => ({ok:false,image:null,errors:[{path:role,reason}]});
  let decoded;
  try {
    abort(signal);
    if (!file || typeof file.arrayBuffer !== 'function' || !Number.isInteger(file.size)) return failure('Expected an image file');
    if (file.size < MIN_IMAGE_BYTES || file.size > MAX_IMAGE_BYTES) return failure('Image must be between 10 KiB and 2 MiB inclusive');
    const declared = typeof file.type === 'string' ? file.type.toLowerCase() : '';
    if (declared && declared !== 'image/png' && declared !== 'image/jpeg') return failure('Only JPEG and PNG images are supported');
    const bytes = await file.arrayBuffer();
    abort(signal);
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size) return failure('Image byte length does not match file size');
    const type = detectedType(bytes);
    if (!type || (declared && declared !== type)) return failure('Image format does not match a supported declared type');
    decoded = await decode(new Blob([bytes],{type}),{signal});
    abort(signal);
    if (!decoded || !Number.isFinite(decoded.width) || !Number.isFinite(decoded.height) || decoded.width <= 0 || decoded.height <= 0) return failure('Image could not be decoded');
    return {ok:true,image:{name:typeof file.name === 'string' ? file.name : '',type,bytes},errors:[]};
  } catch (error) {
    return failure(signal?.aborted || error?.name === 'AbortError' ? 'Image validation cancelled' : 'Image could not be read or decoded');
  } finally {
    decoded?.close?.();
  }
}
