import test from 'node:test';
import assert from 'node:assert/strict';
import {validateImage,MIN_IMAGE_BYTES,MAX_IMAGE_BYTES} from '../extension/shared/images.js';
const signatures = {'image/png':[137,80,78,71,13,10,26,10],'image/jpeg':[255,216,255,224]};
function file(size=MIN_IMAGE_BYTES,type='image/png',signature=type) {
  const bytes = new Uint8Array(size);
  bytes.set(signatures[signature]??[1,2,3]);
  return {name:'private-name.png',type,size,arrayBuffer:async()=>bytes.buffer};
}
const decoded = async () => ({width:300,height:400});
const deferred = () => {let resolve; const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('inclusive limits and bytes remain identical, empty MIME inferred from signature',async()=>{
  for(const size of [MIN_IMAGE_BYTES,MAX_IMAGE_BYTES])for(const type of ['image/png','image/jpeg']){
    const source=file(size,type);const original=await source.arrayBuffer();let closed=0;
    const result=await validateImage(source,'portrait',{decode:async blob=>{
      assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),new Uint8Array(original));
      assert.equal(blob.type,type);return {width:300,height:400,close(){closed++;}};
    }});
    assert.equal(result.ok,true);assert.equal(result.image.bytes,original);assert.equal(closed,1);
  }
  const result=await validateImage(file(MIN_IMAGE_BYTES,'','image/jpeg'),'passport',{decode:decoded});
  assert.equal(result.image.type,'image/jpeg');
});
test('size, MIME, signature and actual byte length failures do not reach decoder or expose name',async()=>{
  let calls=0;const decode=async()=>{calls++;return {width:1,height:1};};
  const mismatch=file();mismatch.arrayBuffer=async()=>new ArrayBuffer(MIN_IMAGE_BYTES+1);
  for(const source of [file(MIN_IMAGE_BYTES-1),file(MAX_IMAGE_BYTES+1),file(MIN_IMAGE_BYTES,'image/gif'),file(MIN_IMAGE_BYTES,'image/png','image/jpeg'),file(MIN_IMAGE_BYTES,'','garbage'),mismatch]){
    const result=await validateImage(source,'portrait',{decode});assert.equal(result.ok,false);assert.equal(result.image,null);assert.equal(result.errors[0].path,'portrait');assert.ok(!JSON.stringify(result.errors).includes(source.name));
  }
  assert.equal(calls,0);
});
test('decoder exceptions and invalid dimensions reject, owned resources close',async()=>{
  assert.equal((await validateImage(file(),'portrait',{decode:async()=>{throw new Error('private details');}})).ok,false);
  let closed=0;
  assert.equal((await validateImage(file(),'portrait',{decode:async()=>({width:0,height:4,close(){closed++;}})})).ok,false);
  assert.equal(closed,1);
});
test('abort before read and during read prevents decoding',async()=>{
  const controller=new AbortController();controller.abort();let read=0;
  const source=file();source.arrayBuffer=async()=>{read++;return new ArrayBuffer(MIN_IMAGE_BYTES);};
  assert.equal((await validateImage(source,'portrait',{signal:controller.signal,decode:decoded})).errors[0].reason,'Image validation cancelled');assert.equal(read,0);
  const gate=deferred();const pendingController=new AbortController();let decodedCalls=0;
  source.arrayBuffer=()=>gate.promise;
  const pending=validateImage(source,'portrait',{signal:pendingController.signal,decode:async()=>{decodedCalls++;return {width:1,height:1};}});
  pendingController.abort();gate.resolve(await file().arrayBuffer());
  assert.equal((await pending).ok,false);assert.equal(decodedCalls,0);
});
test('abort during decoding rejects late result and closes late bitmap',async()=>{
  const gate=deferred();const started=deferred();const controller=new AbortController();let closed=0;
  const pending=validateImage(file(),'portrait',{signal:controller.signal,decode:()=>{started.resolve();return gate.promise;}});
  await started.promise;controller.abort();gate.resolve({width:1,height:1,close(){closed++;}});
  const result=await pending;assert.equal(result.ok,false);assert.equal(result.image,null);assert.equal(closed,1);
});
test('native bitmap decode closes resource',async()=>{
  const original=globalThis.createImageBitmap;let closed=0;
  try{globalThis.createImageBitmap=async()=>({width:1,height:2,close(){closed++;}});assert.equal((await validateImage(file(),'passport')).ok,true);assert.equal(closed,1);}
  finally{if(original===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=original;}
});
test('Image fallback releases URL and listeners on success, failure and cancellation',async()=>{
  const oldBitmap=globalThis.createImageBitmap,oldImage=globalThis.Image,oldURL=globalThis.URL;
  const live=new Set();let lastImage;
  try{
    delete globalThis.createImageBitmap;
    globalThis.URL={createObjectURL(){const url=`blob:${live.size}`;live.add(url);return url;},revokeObjectURL(url){live.delete(url);}};
    globalThis.Image=class {constructor(){lastImage=this;this.naturalWidth=1;this.naturalHeight=2;}set src(value){this.current=value;}};
    for(const outcome of ['load','error','abort']){
      const controller=new AbortController();let activeListeners=0;
      const add=controller.signal.addEventListener.bind(controller.signal),remove=controller.signal.removeEventListener.bind(controller.signal);
      controller.signal.addEventListener=(...args)=>{activeListeners++;return add(...args);};
      controller.signal.removeEventListener=(...args)=>{activeListeners--;return remove(...args);};
      const pending=validateImage(file(),'portrait',{signal:controller.signal});
      await new Promise(resolve=>setImmediate(resolve));
      if(outcome==='abort')controller.abort();else lastImage[`on${outcome}`]();
      const result=await pending;assert.equal(result.ok,outcome==='load');assert.equal(live.size,0);assert.equal(activeListeners,0);assert.equal(lastImage.onload,null);assert.equal(lastImage.onerror,null);
    }
  }finally{
    if(oldBitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=oldBitmap;
    if(oldImage===undefined)delete globalThis.Image;else globalThis.Image=oldImage;
    globalThis.URL=oldURL;
  }
});
