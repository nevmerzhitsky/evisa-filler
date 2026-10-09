import test from 'node:test';
import assert from 'node:assert/strict';
import {setTextField} from '../extension/content/text-transfer.js';

const privateText='PRIVATE-person@example.test';
function fixture(options={}) {
  const trace=[],values=new WeakMap();const abort=new AbortController();let guards=0;
  const document={defaultView:null};
  class NativeInput {
    constructor(type='text'){this.type=type;this.ownerDocument=document;this.isConnected=true;this.disabled=false;this.readOnly=false;values.set(this,'old');}
    get value(){if(options.getterError)throw Error(privateText);return values.get(this);}
    set value(value){trace.push('setter');if(options.setterError)throw Error(privateText);if(!options.silentSetter)values.set(this,options.normalize?options.normalize(value):value);options.afterSetter?.({abort,input:this});}
    getAttribute(name){return name==='role'?options.role??null:null;}
    dispatchEvent(event){assert.equal(event.bubbles,true);assert.equal(event.isTrusted,false);trace.push(event.type);options.onEvent?.(event,{abort,input:this,setRaw:value=>values.set(this,value)});}
    focus(){throw Error('must not focus');} click(){throw Error('must not click');} blur(){throw Error('must not blur');}
  }
  class NativeTextarea {
    constructor(){this.ownerDocument=document;this.isConnected=true;this.disabled=false;this.readOnly=false;values.set(this,'old');}
    get value(){return values.get(this);}set value(value){trace.push('setter');values.set(this,value);}
    dispatchEvent(event){assert.equal(event.bubbles,true);assert.equal(event.isTrusted,false);trace.push(event.type);}
  }
  class RealmEvent {constructor(type,settings){if(options.eventError)throw Error(privateText);this.type=type;this.bubbles=settings.bubbles;this.isTrusted=false;options.onEventConstructor?.({abort});}}
  document.defaultView={HTMLInputElement:NativeInput,HTMLTextAreaElement:NativeTextarea,Event:RealmEvent};
  const input=options.textarea?new NativeTextarea():new NativeInput(options.type??'text');
  const unrelated=new NativeInput();
  const ctx={document,signal:abort.signal,assertCurrent(){trace.push('guard');guards++;if(options.guardError)throw Error(privateText);options.onGuard?.(guards,{abort,input});}};
  return {input,unrelated,ctx,abort,trace,document,values,NativeInput};
}
function errorCode(fn,code){assert.throws(fn,error=>error.code===code&&error.message===code&&!JSON.stringify(error).includes(privateText));}

test('native realm setter/readback bypass framework instance accessors without changing their descriptor',()=>{
  const f=fixture();const frameworkGet=()=>{throw Error('own getter must not be used');},frameworkSet=()=>{throw Error('own setter must not be used');};
  Object.defineProperty(f.input,'value',{get:frameworkGet,set:frameworkSet,configurable:true});
  const result=setTextField(f.input,privateText,f.ctx);
  assert.deepEqual(result,{assigned:true});assert.equal(Object.hasOwn(result,'ok'),false);
  assert.equal(f.values.get(f.input),privateText);assert.equal(f.values.get(f.unrelated),'old');
  assert.equal(Object.getOwnPropertyDescriptor(f.input,'value').get,frameworkGet);assert.equal(Object.getOwnPropertyDescriptor(f.input,'value').set,frameworkSet);
  assert.deepEqual(f.trace,['guard','setter','guard','input','guard','change','guard']);
});

test('supported textlike inputs, multiline textarea and empty restoration preserve supplied strings',()=>{
  for(const type of ['text','tel','email','number']){
    const f=fixture({type});assert.deepEqual(setTextField(f.input,type==='number'?'12.5':' '+privateText+' ',f.ctx),{assigned:true});
  }
  const f=fixture({textarea:true});setTextField(f.input,'first\nsecond',f.ctx);assert.equal(f.input.value,'first\nsecond');
  setTextField(f.input,'',f.ctx);assert.equal(f.input.value,'');assert.equal(f.trace.filter(item=>item==='change').length,2);
});

test('dates, search, choices, files, hidden/password and role combobox are rejected without actions',()=>{
  for(const type of ['date','datetime-local','month','search','radio','checkbox','file','hidden','password','range','color']){
    const f=fixture({type});errorCode(()=>setTextField(f.input,privateText,f.ctx),'invalid_text_input');assert.deepEqual(f.trace,[]);
  }
  const f=fixture({role:'combobox'});errorCode(()=>setTextField(f.input,privateText,f.ctx),'invalid_text_input');assert.deepEqual(f.trace,[]);
});

test('concrete native instance, same connected document and writable state are required',()=>{
  for(const patch of [{ownerDocument:{}},{isConnected:false},{disabled:true},{readOnly:true}]){
    const f=fixture();Object.assign(f.input,patch);errorCode(()=>setTextField(f.input,privateText,f.ctx),'invalid_text_input');assert.deepEqual(f.trace,[]);
  }
  const f=fixture();for(const input of [null,{type:'text',ownerDocument:f.document,isConnected:true}])errorCode(()=>setTextField(input,privateText,f.ctx),'invalid_text_input');
});

test('cancellation before setter, immediately after setter and between input/change prevents later mutations',()=>{
  const before=fixture();before.abort.abort(privateText);errorCode(()=>setTextField(before.input,privateText,before.ctx),'cancelled');assert.deepEqual(before.trace,[]);
  const after=fixture({afterSetter:({abort})=>abort.abort(privateText)});errorCode(()=>setTextField(after.input,privateText,after.ctx),'cancelled');assert.deepEqual(after.trace.filter(item=>item!=='guard'),['setter']);assert.equal(after.values.get(after.input),privateText);
  const between=fixture({onEvent:(event,{abort})=>{if(event.type==='input')abort.abort(privateText);}});errorCode(()=>setTextField(between.input,privateText,between.ctx),'cancelled');assert.deepEqual(between.trace.filter(item=>item!=='guard'),['setter','input']);
});

test('freshness guard rejects stale document, false or promise result without writing',()=>{
  const f=fixture({guardError:true});errorCode(()=>setTextField(f.input,privateText,f.ctx),'document_lost');assert.deepEqual(f.trace,['guard']);
  for(const guard of [()=>false,()=>Promise.resolve(true),()=>Promise.reject(Error(privateText))]){
    const f=fixture();f.ctx.assertCurrent=guard;errorCode(()=>setTextField(f.input,privateText,f.ctx),'document_lost');assert.equal(f.values.get(f.input),'old');
  }
});

test('document or readonly state changes during guard/event prevent the next event',()=>{
  for(const patch of [{ownerDocument:{}},{isConnected:false},{readOnly:true},{disabled:true},{type:'search'}]){
    const f=fixture({onGuard:(count,{input})=>{if(count===2)Object.assign(input,patch);}});
    errorCode(()=>setTextField(f.input,privateText,f.ctx),patch.ownerDocument||patch.isConnected===false?'document_lost':'text_input_unavailable');
    assert.deepEqual(f.trace.filter(item=>item!=='guard'),['setter']);
  }
});

test('silent failed setter and browser number/string sanitization reject exact readback before events',()=>{
  for(const options of [{silentSetter:true},{type:'number',normalize:()=>''},{type:'number',normalize:()=> '12'},{normalize:value=>value.trim()}]){
    const f=fixture(options);errorCode(()=>setTextField(f.input,' 12.0 ',f.ctx),'text_readback_mismatch');assert.deepEqual(f.trace.filter(item=>item!=='guard'),['setter']);
  }
});

test('synchronous site handler clearing the DOM value fails final local readback',()=>{
  const f=fixture({onEvent:(event,{setRaw})=>{if(event.type==='input')setRaw('');}});
  errorCode(()=>setTextField(f.input,privateText,f.ctx),'text_readback_mismatch');assert.equal(f.values.get(f.unrelated),'old');
});

test('realm accessor, constructor, setter and dispatch failures expose only static codes',()=>{
  for(const [options,code] of [[{setterError:true},'text_assignment_failed'],[{getterError:true},'text_readback_mismatch'],[{eventError:true},'text_event_creation_failed'],[{onEvent:()=>{throw Error(privateText);}},'text_event_dispatch_failed']]){
    const f=fixture(options);errorCode(()=>setTextField(f.input,privateText,f.ctx),code);
  }
  const f=fixture();Object.defineProperty(f.NativeInput.prototype,'value',{value:'not an accessor'});errorCode(()=>setTextField(f.input,privateText,f.ctx),'native_text_accessor_unavailable');
  const cancelled=fixture({onEventConstructor:({abort})=>abort.abort(privateText)});errorCode(()=>setTextField(cancelled.input,privateText,cancelled.ctx),'cancelled');assert.deepEqual(cancelled.trace.filter(item=>item!=='guard'),['setter']);
});

test('invalid context and nonstring values fail without coercing personal objects',()=>{
  const f=fixture();errorCode(()=>setTextField(f.input,privateText,{}),'invalid_text_context');
  for(const value of [null,12,false,{toString(){throw Error(privateText);}}])errorCode(()=>setTextField(f.input,value,f.ctx),'invalid_text_value');
  assert.deepEqual(f.trace,[]);
});
