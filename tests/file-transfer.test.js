import test from 'node:test';
import assert from 'node:assert/strict';
import {assignImageFile} from '../extension/content/file-transfer.js';

const privateName = 'private-passport-name.jpg';
function image(size = 10240, type = 'image/jpeg') {
  const bytes = Uint8Array.from({length:size}, (_, index) => index % 251).buffer;
  return {name:privateName,type,bytes};
}
function fixture(options = {}) {
  const document = {}, trace = [], parts = [];
  let files = [], guards = 0;
  const abort = new AbortController();
  class FileCtor {
    constructor(chunks,name,{type}) {
      if (options.fileError) throw Error(privateName);
      parts.push(chunks[0]); this.name=name; this.type=type; this.size=chunks[0].byteLength;
      this.bytes=chunks[0].slice(0);
    }
  }
  class DataTransferCtor {
    constructor() {
      if (options.transferError) throw Error(privateName);
      this.files=[]; this.items={add:file => {
        if (options.addNull) return null;
        this.files.push(file); return {};
      }};
    }
  }
  class EventCtor {constructor(type,options) {this.type=type;this.bubbles=options.bubbles;}}
  const input = {tagName:'INPUT',type:'file',ownerDocument:document,isConnected:true,
    get accept(){throw Error('must not inspect accept');},
    get value(){throw Error('must not read selected file path');},
    get files(){return options.readback ? options.readback(files) : files;},
    set files(value){trace.push('assign');if(options.assignmentError)throw Error(privateName);files=value;options.afterAssign?.({abort,input});},
    dispatchEvent(event){trace.push(event.type);assert.equal(event.bubbles,true);options.onEvent?.(event,{abort,input});}
  };
  const ctx = {document,signal:abort.signal,FileCtor,DataTransferCtor,EventCtor,assertCurrent() {
    trace.push('guard');guards++;
    if (options.guardError) throw Error(privateName);
    options.onGuard?.(guards,{abort,input});
  }};
  return {input,ctx,abort,trace,parts,get files(){return files;}};
}
function errorCode(fn, code) {
  assert.throws(fn, error => error.code === code && error.message === code && !JSON.stringify(error).includes(privateName));
}

test('assigns original ArrayBuffer as one File and dispatches bubbling input/change behind guards', () => {
  const f=fixture(), payload=image(), before=new Uint8Array(payload.bytes).slice();
  const result=assignImageFile(f.input,payload,f.ctx);
  assert.deepEqual(result,{assigned:true});assert.equal(Object.hasOwn(result,'ok'),false);
  assert.equal(f.parts[0],payload.bytes);
  assert.deepEqual(new Uint8Array(payload.bytes),before);
  assert.deepEqual(new Uint8Array(f.files[0].bytes),before);
  assert.equal(f.files.length,1);assert.equal(f.files[0].name,payload.name);assert.equal(f.files[0].type,payload.type);
  assert.deepEqual(f.trace,['guard','assign','guard','input','guard','change','guard']);
});

test('hidden native input is supported and repeat assignments dispatch both events again', () => {
  const f=fixture(), payload=image();f.input.hidden=true;
  assignImageFile(f.input,payload,f.ctx);const first=f.files[0];
  assignImageFile(f.input,payload,f.ctx);
  assert.notEqual(first,f.files[0]);assert.equal(f.parts.length,2);
  assert.deepEqual(f.trace.filter(item=>item!=='guard'),['assign','input','change','assign','input','change']);
});

test('cancellation before assignment prevents all DOM actions', () => {
  const f=fixture();f.abort.abort(privateName);
  errorCode(()=>assignImageFile(f.input,image(),f.ctx),'cancelled');assert.deepEqual(f.trace,[]);
});

test('cancellation by FileList setter prevents either event without rollback', () => {
  const f=fixture({afterAssign:({abort})=>abort.abort(privateName)});
  errorCode(()=>assignImageFile(f.input,image(),f.ctx),'cancelled');
  assert.deepEqual(f.trace.filter(item=>item!=='guard'),['assign']);assert.equal(f.files.length,1);
});

test('cancellation between input/change stops further events', () => {
  const f=fixture({onEvent:(event,{abort})=>{if(event.type==='input')abort.abort(privateName);}});
  errorCode(()=>assignImageFile(f.input,image(),f.ctx),'cancelled');
  assert.deepEqual(f.trace.filter(item=>item!=='guard'),['assign','input']);
});

test('stale document guard and cross-document/detached input cannot receive files', () => {
  const stale=fixture({guardError:true});errorCode(()=>assignImageFile(stale.input,image(),stale.ctx),'document_lost');
  assert.deepEqual(stale.trace,['guard']);
  for (const patch of [{ownerDocument:{}},{isConnected:false},{type:'text'},{tagName:'TEXTAREA'}]) {
    const f=fixture();Object.assign(f.input,patch);
    errorCode(()=>assignImageFile(f.input,image(),f.ctx),'invalid_file_input');assert.deepEqual(f.trace,[]);
  }
  const f=fixture();errorCode(()=>assignImageFile(null,image(),f.ctx),'invalid_file_input');
});

test('document loss or abort within assertCurrent prevents the following mutation', () => {
  for (const mutation of ['abort','detach']) {
    const f=fixture({onGuard:(count,{abort,input})=>{if(count===2){if(mutation==='abort')abort.abort();else input.isConnected=false;}}});
    errorCode(()=>assignImageFile(f.input,image(),f.ctx),mutation==='abort'?'cancelled':'document_lost');
    assert.deepEqual(f.trace.filter(item=>item!=='guard'),['assign']);
  }
});

test('local readback mismatches reject assignment without dispatching events', () => {
  for (const readback of [()=>[],files=>[files[0],files[0]],files=>[{...files[0],size:1}],files=>[{...files[0],name:'other'}],files=>[{...files[0],type:'text/plain'}],()=>{throw Error(privateName);}]) {
    const f=fixture({readback});errorCode(()=>assignImageFile(f.input,image(),f.ctx),'file_readback_mismatch');
    assert.deepEqual(f.trace.filter(item=>item!=='guard'),['assign']);
  }
});

test('defensive payload boundaries accept JPEG/PNG at 10 KiB and 2 MiB only', () => {
  for (const type of ['image/jpeg','image/png']) for (const size of [10240,2097152]) {
    const f=fixture();assert.deepEqual(assignImageFile(f.input,image(size,type),f.ctx),{assigned:true});
  }
  for (const payload of [null,[],image(10239),image(2097153),image(10240,'text/plain'),{...image(),name:''},{...image(),name:' '},{...image(),bytes:new Uint8Array(10240)},{...image(),role:'passport'}]) {
    const f=fixture();errorCode(()=>assignImageFile(f.input,payload,f.ctx),'invalid_image');assert.deepEqual(f.trace,[]);
  }
});

test('platform exceptions become static codes without private metadata', () => {
  for (const [options,code] of [[{fileError:true},'file_creation_failed'],[{transferError:true},'file_transfer_unavailable'],[{addNull:true},'file_transfer_unavailable'],[{assignmentError:true},'file_assignment_failed']]) {
    const f=fixture(options);errorCode(()=>assignImageFile(f.input,image(),f.ctx),code);
  }
  const f=fixture({onEvent:()=>{throw Error(privateName);}});
  errorCode(()=>assignImageFile(f.input,image(),f.ctx),'file_event_dispatch_failed');
  assert.deepEqual(f.trace.filter(item=>item!=='guard'),['assign','input']);
});

test('context must provide a synchronous freshness guard', () => {
  const f=fixture();errorCode(()=>assignImageFile(f.input,image(),{}),'invalid_file_context');
  assert.deepEqual(f.trace,[]);
  for (const assertCurrent of [()=>false,()=>Promise.resolve(true),()=>Promise.reject(Error(privateName))]) {
    const f=fixture();f.ctx.assertCurrent=assertCurrent;
    errorCode(()=>assignImageFile(f.input,image(),f.ctx),'document_lost');assert.deepEqual(f.trace,[]);
  }
});
