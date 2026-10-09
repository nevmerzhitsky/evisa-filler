import test from 'node:test';
import assert from 'node:assert/strict';
import {readNumericField,writeNumericField} from '../extension/content/numeric-field-access.js';
const PRIVATE='PRIVATE@example.test';
function fixture({id='basic_kpbhDuTinh',maxLength=20,caption=null}={}){
  const doc={},meta=new WeakMap(),trace=[],abort=new AbortController(),listeners=new Set();let afterSet,onEvent,reads=0,captionReads=0;
  class Element{
    constructor(classes=''){meta.set(this,{id:'',classes:new Set(classes.split(' ').filter(Boolean)),text:'',hidden:false});this.children=[];this.parentElement=null;this.ownerDocument=doc;this.isConnected=true;}
    get id(){return meta.get(this).id;}
    append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}return this;}
    matches(selector){return selector.split(',').some(part=>{if(part===':disabled')return meta.get(this).disabled===true;
      if(part==='label')return this instanceof Label;if(['input','textarea','select'].includes(part))return part==='input'&&this instanceof Input;
      return [...part.matchAll(/\.([\w-]+)/g)].every(match=>meta.get(this).classes.has(match[1]));});}
    closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
    querySelectorAll(selector){reads++;const result=[];function walk(node){for(const child of node.children){let match=child.matches(selector);
      if(selector==='.ant-form-item-label label')match=child instanceof Label&&Boolean(child.parentElement?.closest('.ant-form-item-label'));
      if(match)result.push(child);walk(child);}}walk(this);return result;}
    contains(node){for(;node;node=node.parentElement)if(node===this)return true;return false;}
    getClientRects(){return meta.get(this).hidden?[]:[{}];}
    getAttribute(key){if(['value','name','title'].includes(key))throw {code:PRIVATE};return meta.get(this)[key]??null;}
    get textContent(){if(this instanceof Label){captionReads++;if(caption===null)throw {code:PRIVATE};}
      return meta.get(this).text+this.children.map(child=>child.textContent).join('');}
    get childElementCount(){return this.children.length;}
    focus(){throw Error('No focus');}blur(){throw Error('No blur');}click(){throw Error('No click');}
  }
  class Input extends Element{
    get type(){return meta.get(this).type;}get maxLength(){return meta.get(this).maxLength;}
    get disabled(){return meta.get(this).disabled;}get readOnly(){return meta.get(this).readOnly;}
    get labels(){return meta.get(this).labels;}
    get value(){return meta.get(this).value;}
    set value(value){trace.push('setter');meta.get(this).value=value;afterSet?.();}
    dispatchEvent(event){trace.push(event.type);onEvent?.(event);}
  }
  class Label extends Element{get control(){return meta.get(this).control;}get htmlFor(){return meta.get(this).htmlFor;}}
  doc.defaultView={Element,HTMLElement:Element,HTMLInputElement:Input,HTMLLabelElement:Label,Node:Element,
    getComputedStyle:()=>({display:'block',visibility:'visible'}),Event:class{constructor(type,props){this.type=type;Object.assign(this,props);}}};
  const form=new Element('ant-form-item'),labelBox=new Element('ant-form-item-label'),label=new Label(),input=new Input();
  form.append(labelBox.append(label),input);Object.assign(meta.get(input),{id,type:'text',maxLength,disabled:false,readOnly:false,labels:[label],value:'old'});
  Object.assign(meta.get(label),{control:input,htmlFor:id,text:caption??'UNREAD PRIVATE LABEL'});
  let identified=[input],stale=false;
  doc.querySelectorAll=selector=>{assert.equal(selector,'[id]');reads++;return identified;};
  const signal={get aborted(){return abort.signal.aborted;},addEventListener(type,fn,opts){listeners.add(fn);abort.signal.addEventListener(type,fn,opts);},removeEventListener(type,fn){listeners.delete(fn);abort.signal.removeEventListener(type,fn);}};
  const ctx={document:doc,signal,stableMs:5,assertCurrent(){if(stale)throw {code:PRIVATE};}};
  return {doc,ctx,input,label,labelBox,form,meta,Element,Input,Label,trace,listeners,abort,
    identify:nodes=>{identified=nodes;},afterSet:fn=>{afterSet=fn;},onEvent:fn=>{onEvent=fn;},stale:()=>{stale=true;},get reads(){return reads;},get captionReads(){return captionReads;}};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code&&!error.message.includes(PRIVATE)&&!JSON.stringify(error).includes(PRIVATE));
const throws=(fn,code)=>assert.throws(fn,error=>error.code===code&&!error.message.includes(PRIVATE));

const expense='expenses.estimatedAmount',duration='trip.durationDays';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('finite expenses including zero, negative zero, fractions and expanded exponents roundtrip',async()=>{
  for(const [value,text] of [[0,'0'],[-0,'-0'],[12.345,'12.345'],[1e-7,'0.0000001'],[1e-18,'0.000000000000000001'],[1e19,'10000000000000000000'],[9007199254740992,'9007199254740992']]) {
    const f=fixture(); assert.deepEqual(await writeNumericField(expense,value,f.ctx),{ok:true,label:null});
    assert.equal(f.meta.get(f.input).value,text); assert.ok(Object.is(readNumericField(expense,f.ctx).value,value));
    assert.deepEqual(f.trace,['setter','input','change']); assert.equal(f.captionReads,0); assert.equal(f.listeners.size,0);
  }
});
test('duration accepts positive integers including91 and unsafe integers without imposing site maximum',async()=>{
  for(const value of [1,91,9007199254740992,1e19]) {
    const f=fixture({id:'basic_ttcdSoNgayTamTru'}); await writeNumericField(duration,value,f.ctx);
    assert.ok(Object.is(readNumericField(duration,f.ctx).value,value));
  }
});
test('empty restoration is literal empty, distinct from numeric zero',async()=>{
  for(const [path,id] of [[expense,'basic_kpbhDuTinh'],[duration,'basic_ttcdSoNgayTamTru']]) {
    const f=fixture({id}); await writeNumericField(path,'',f.ctx);
    assert.equal(f.meta.get(f.input).value,''); assert.equal(readNumericField(path,f.ctx).value,'');
  }
});
test('unrepresentable plain decimal lengths fail before any DOM access or mutation',async()=>{
  for(const value of [1e20,1e21,1e-19,Number.MIN_VALUE,Number.MAX_VALUE,0.00000000000000000123]) {
    const f=fixture(); await rejects(writeNumericField(expense,value,f.ctx),'numeric_value_unrepresentable');
    assert.equal(f.reads,0); assert.deepEqual(f.trace,[]);
  }
});
test('invalid numeric domain is rejected without setters or conversion guesses',async()=>{
  for(const value of [null,undefined,'1',false,NaN,Infinity,-Infinity,-1,{},new Number(1)]) {
    const f=fixture(); await rejects(writeNumericField(expense,value,f.ctx),'invalid_numeric_value'); assert.deepEqual(f.trace,[]);
  }
  for(const value of [0,-0,1.5,-1]) {
    const f=fixture({id:'basic_ttcdSoNgayTamTru'}); await rejects(writeNumericField(duration,value,f.ctx),'invalid_numeric_value'); assert.deepEqual(f.trace,[]);
  }
});
test('read explicitly normalizes decimal leading and trailing zeros without altering numeric digits',()=>{
  for(const [text,value] of [['0001.2300',1.23],['0000.000',0],['-0',-0],['9007199254740992',9007199254740992],['10000000000000000000',1e19]]) {
    const f=fixture(); f.meta.get(f.input).value=text; assert.ok(Object.is(readNumericField(expense,f.ctx).value,value));
  }
  const f=fixture({id:'basic_ttcdSoNgayTamTru'}); f.meta.get(f.input).value='00091'; assert.equal(readNumericField(duration,f.ctx).value,91);
});
test('read rejects separators, exponents, spaces, signs, unsupported decimals and rounded precision',()=>{
  for(const text of [' 1','1 ','1,000','1 000','1e3','+1','.5','1.','-0.0','-1','9007199254740993','0.10000000000000001','1'.repeat(21),PRIVATE]) {
    const f=fixture(); f.meta.get(f.input).value=text; throws(()=>readNumericField(expense,f.ctx),'numeric_read_unconfirmed');
  }
  for(const text of ['0','-0','1.5','1.0']) {
    const f=fixture({id:'basic_ttcdSoNgayTamTru'}); f.meta.get(f.input).value=text; throws(()=>readNumericField(duration,f.ctx),'numeric_read_unconfirmed');
  }
});
test('native getters bypass instance aliases and never read unknown caption or valueAsNumber',async()=>{
  const f=fixture();
  for(const key of ['value','labels','valueAsNumber','name','title']) Object.defineProperty(f.input,key,{get(){throw {code:PRIVATE};},set(){throw {code:PRIVATE};}});
  Object.defineProperty(f.label,'control',{get(){throw {code:PRIVATE};}});
  f.meta.get(f.input).value='12.5'; assert.equal(readNumericField(expense,f.ctx).value,12.5);
  await writeNumericField(expense,0,f.ctx); assert.equal(f.captionReads,0); assert.deepEqual(f.trace,['setter','input','change']);
});
test('unique ID and known label-control-for identity are mandatory',()=>{
  const f=fixture(),duplicate=new f.Element(); f.meta.get(duplicate).id=f.input.id; f.identify([f.input,duplicate]);
  throws(()=>readNumericField(expense,f.ctx),'numeric_field_binding_ambiguous');
  for(const patch of [{control:null},{htmlFor:'OTHER'}]) {
    const g=fixture(); Object.assign(g.meta.get(g.label),patch); throws(()=>readNumericField(expense,g.ctx),'numeric_field_label_ambiguous'); assert.equal(g.captionReads,0);
  }
  const g=fixture(); g.meta.get(g.input).labels=[g.label,g.label]; throws(()=>readNumericField(expense,g.ctx),'numeric_field_label_ambiguous');
});
test('native text maxLength20, availability and widget exclusion are checked',()=>{
  for(const patch of [{type:'number'},{maxLength:21},{disabled:true},{readOnly:true},{hidden:true},{role:'combobox'}]) {
    const f=fixture(); Object.assign(f.meta.get(f.input),patch); throws(()=>readNumericField(expense,f.ctx),'numeric_field_target_unavailable');
  }
  const f=fixture(); f.meta.get(f.form).classes.add('ant-picker'); throws(()=>readNumericField(expense,f.ctx),'numeric_field_target_unavailable');
});
test('label and input node replacement stop subsequent native helper events',async()=>{
  const f=fixture(); f.afterSet(()=>{const label=new f.Label(); Object.assign(f.meta.get(label),f.meta.get(f.label)); label.parentElement=f.labelBox; f.labelBox.children=[label]; f.meta.get(f.input).labels=[label];});
  await rejects(writeNumericField(expense,12,f.ctx),'document_lost'); assert.deepEqual(f.trace,['setter']);
  const g=fixture(); g.onEvent(event=>{if(event.type==='input'){const fresh=new g.Input(); Object.assign(g.meta.get(fresh),g.meta.get(g.input)); fresh.parentElement=g.form; g.identify([fresh]);}});
  await rejects(writeNumericField(expense,12,g.ctx),'document_lost'); assert.deepEqual(g.trace,['setter','input']);
});
test('delayed numeric drift is rejected once, no retries; semantic formatting is accepted',async()=>{
  const f=fixture(); f.onEvent(event=>{if(event.type==='change')setTimeout(()=>{f.meta.get(f.input).value='2.5';},1);});
  await rejects(writeNumericField(expense,1.5,f.ctx),'numeric_field_readback_mismatch'); assert.deepEqual(f.trace,['setter','input','change']);
  const g=fixture(); g.onEvent(event=>{if(event.type==='change')setTimeout(()=>{g.meta.get(g.input).value='001.500';},1);});
  await writeNumericField(expense,1.5,g.ctx); assert.equal(readNumericField(expense,g.ctx).value,1.5);
});
test('delayed unreadable precision cannot be reported as successful rounded readback',async()=>{
  const f=fixture(); f.onEvent(event=>{if(event.type==='change')setTimeout(()=>{f.meta.get(f.input).value='9007199254740993';},1);});
  await rejects(writeNumericField(expense,9007199254740992,f.ctx),'numeric_read_unconfirmed'); assert.deepEqual(f.trace,['setter','input','change']);
});
test('cancel frees stability wait and prevents writes or events after the cancellation boundary',async()=>{
  const f=fixture(); f.abort.abort(); await rejects(writeNumericField(expense,1,f.ctx),'cancelled'); assert.deepEqual(f.trace,[]);
  const g=fixture(); g.afterSet(()=>g.abort.abort()); await rejects(writeNumericField(expense,1,g.ctx),'cancelled'); assert.deepEqual(g.trace,['setter']);
  const h=fixture(); h.ctx.stableMs=30; const pending=writeNumericField(expense,1,h.ctx); h.abort.abort();
  await rejects(pending,'cancelled'); assert.equal(h.listeners.size,0); await delay(35); assert.deepEqual(h.trace,['setter','input','change']);
});
test('stale asynchronous and foreign getters return static sanitized errors',async()=>{
  for(const asynchronous of [false,true]) {const f=fixture(); if(asynchronous)f.ctx.assertCurrent=async()=>true; else f.stale(); await rejects(writeNumericField(expense,1,f.ctx),'document_lost'); assert.equal(f.reads,0);}
  const f=fixture(); f.doc.querySelectorAll=()=>{throw {get code(){throw Error(PRIVATE);}};}; throws(()=>readNumericField(expense,f.ctx),'numeric_field_dom_unavailable');
  const g=fixture(); g.onEvent(()=>{throw {code:PRIVATE};}); await rejects(writeNumericField(expense,1,g.ctx),'text_event_dispatch_failed'); assert.equal(g.captionReads,0);
});
test('unsupported paths and invalid stability limits never mutate the target',async()=>{
  for(const path of ['contact.phone','personal.yearOfBirth','trip.durationDays.child']) {const f=fixture(); await rejects(writeNumericField(path,1,f.ctx),'unsupported_numeric_field_path'); assert.equal(f.reads,0);}
  for(const stableMs of [0,-1,3001,NaN,Infinity]) {const f=fixture(); f.ctx.stableMs=stableMs; await rejects(writeNumericField(expense,1,f.ctx),'invalid_numeric_field_context'); assert.deepEqual(f.trace,[]);}
});
