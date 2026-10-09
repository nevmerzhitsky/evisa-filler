import test from 'node:test';
import assert from 'node:assert/strict';
import {readCalendarDate,writeCalendarDate} from '../extension/content/calendar-field-access.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await wait(1);}assert.fail('Expected calendar phase missing');}

// Real date-transfer functions run against a small concrete picker DOM. This
// fixture models the public closed/open candidate and Enter-commit interaction,
// not an alternative date implementation or a stubbed helper return value.
function fixture({path='passport.dateOfExpiry',id='basic_hcGiaTriDenStr',caption=null,initial='',duplicate=false}={}){
  const document={},abort=new AbortController(),listeners=new Set(),actions=[];let captionReads=0,identified,reads=0,stale=false,opened=false,committed=initial,candidate=initial,onEvent,onBlur,onSet;
  class Element{
    get id(){return this.nativeId??'';}
    get textContent(){captionReads++;if(caption===null)throw {code:'PRIVATE CAPTION'};return caption;}
    constructor(classes=''){this.classes=new Set(classes.split(' ').filter(Boolean));this.ownerDocument=document;this.isConnected=true;this.parentElement=null;this.children=[];}
    append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}return this;}
    matches(selector){return selector.split(',').some(part=>part===':disabled'?this.disabled===true:part==='label'?this instanceof Label:part.startsWith('.')&&this.classes.has(part.slice(1)));}
    closest(selector){reads++;for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
    contains(node){for(;node;node=node.parentElement)if(node===this)return true;return false;}
    querySelectorAll(selector){reads++;const result=[];function walk(node){for(const child of node.children){if(selector==='.ant-form-item-label label'?child instanceof Label&&Boolean(child.parentElement?.closest('.ant-form-item-label')):selector==='input,textarea,select'?child instanceof Input:selector==='input'?child instanceof Input:selector.includes('ant-picker-clear')?child.classes.has('ant-picker-clear'):child.matches(selector))result.push(child);walk(child);}}walk(this);return result;}
    getClientRects(){return this.hidden?[]:[{}];}getAttribute(){return null;}
    focus(){actions.push('focus');document.activeElement=this;this.writable=true;}
    blur(){actions.push('blur');document.activeElement=null;stored=committed;onBlur?.();}
  }
  let stored=initial;
  class Input extends Element{
    constructor(){super();this.kind='text';this.nativePlaceholder='DD/MM/YYYY';this.nativeId=id;this.nativeDisabled=false;this.writable=false;}
    get labels(){return this.nativeLabels;}
    get type(){return this.kind;}get placeholder(){return this.nativePlaceholder;}get disabled(){return this.nativeDisabled;}get readOnly(){return !this.writable;}
    get value(){return stored;}set value(value){actions.push('set');stored=value;onSet?.();}
    getAttribute(key){return key==='placeholder'?this.nativePlaceholder:null;}
    dispatchEvent(event){actions.push(event.type);if(event.type==='mousedown')opened=true;
      if(event.type==='input'){if(opened)candidate=stored;else stored=committed;}
      if(event.type==='keydown'){assert.equal(event.which,13);committed=candidate;stored=committed;}
      onEvent?.(event);return true;
    }
  }
  class Label extends Element{get control(){return this.nativeControl;}get htmlFor(){return this.nativeFor;}}
  const input=new Input(),picker=new Element('ant-picker'),wrapper=new Element('ant-picker-input'),clear=new Element('ant-picker-clear');picker.append(wrapper.append(input),clear);
  const form=new Element('ant-form-item'),labelBox=new Element('ant-form-item-label'),label=new Label();form.append(labelBox.append(label),picker);label.nativeControl=input;label.nativeFor=id;input.nativeLabels=[label];identified=[input];
  if(duplicate)wrapper.append(new Input());
  clear.getAttribute=key=>key==='role'?'button':null;clear.dispatchEvent=event=>{actions.push('clear-'+event.type);if(event.type==='mouseup'){stored='';committed='';candidate='';picker.children=picker.children.filter(node=>node!==clear);clear.isConnected=false;}};
  const Event=class{constructor(type,props){this.type=type;Object.assign(this,props);}};
  document.defaultView={Element,Node:Element,HTMLElement:Element,HTMLLabelElement:Label,HTMLInputElement:Input,Event,MouseEvent:Event,KeyboardEvent:Event,getComputedStyle:()=>({display:'block',visibility:'visible'})};
  document.querySelectorAll=selector=>{assert.equal(selector,'[id]');reads++;return identified;};
  const signal={get aborted(){return abort.signal.aborted;},addEventListener(type,fn,opts){listeners.add(fn);abort.signal.addEventListener(type,fn,opts);},removeEventListener(type,fn){listeners.delete(fn);abort.signal.removeEventListener(type,fn);}};
  const ctx={document,signal,timeoutMs:100,pollMs:1,stableMs:5,assertCurrent(){if(stale)throw {code:'PRIVATE document'};}};
  return {input,picker,wrapper,clear,form,label,labelBox,Label,identify:nodes=>{identified=nodes;},get captionReads(){return captionReads;},document,ctx,actions,listeners,Element,Input,
    read:()=>readCalendarDate(path,ctx),write:value=>writeCalendarDate(path,value,ctx),onEvent:fn=>{onEvent=fn;},onBlur:fn=>{onBlur=fn;},onSet:fn=>{onSet=fn;},
    raw:value=>{stored=value;},stale:()=>{stale=true;},abort:()=>abort.abort(),get reads(){return reads;},get stored(){return stored;}};
}
const throws=(fn,code)=>assert.throws(fn,error=>error.code===code&&!JSON.stringify(error).includes('PRIVATE'));
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code&&!JSON.stringify(error).includes('PRIVATE'));

test('all five fixed bindings read canonical values, known captions only, initial readonly allowed',()=>{
  for(const [path,id,caption] of [['passport.dateOfIssue','basic_hcNgayCapStr','Date of issue'],['passport.dateOfExpiry','basic_hcGiaTriDenStr',null],
    ['visa.validFrom','basic_nddnTtdtTuNgayStr',null],['visa.validTo','basic_nddnTtdtDenNgayStr',null],['trip.intendedEntryDate','basic_ttcdThoiGianNcStr','Intended date of entry']]){
    const f=fixture({path,id,caption,initial:'29/02/2024'});assert.equal(f.input.readOnly,true);
    Object.defineProperty(f.input,'value',{get(){throw {code:'PRIVATE value'};},set(){throw {code:'PRIVATE value'};}});
    Object.defineProperty(f.input,'labels',{get(){throw {code:'PRIVATE labels'};}});Object.defineProperty(f.label,'control',{get(){throw {code:'PRIVATE control'};}});
    Object.defineProperty(f.input,'id',{get(){throw {code:'PRIVATE id'};}});Object.defineProperty(f.input,'placeholder',{get(){throw {code:'PRIVATE placeholder'};}});
    Object.defineProperty(f.label,'htmlFor',{get(){throw {code:'PRIVATE for'};}});
    assert.deepEqual(f.read(),{available:true,value:'2024-02-29',label:caption});assert.equal(f.captionReads>0,caption!==null);
  }
});
test('real date helper opens readonly picker and commits ISO, then clears through control only',async()=>{
  const f=fixture();assert.deepEqual(await f.write('2024-02-29'),{ok:true,label:null});assert.equal(f.read().value,'2024-02-29');
  assert.deepEqual(f.actions,['mousedown','focus','set','input','keydown','blur']);
  f.actions.length=0;assert.deepEqual(await f.write(''),{ok:true,label:null});assert.equal(f.read().value,'');
  assert.deepEqual(f.actions,['clear-mousedown','clear-mouseup','mousedown','focus','blur']);assert.equal(f.captionReads,0);assert.equal(f.listeners.size,0);
});
test('DOB and nonobserved paths, duplicate noninput IDs, bounded ID scans and wrong realm refuse',async()=>{
  const unsupported=fixture();await rejects(writeCalendarDate('personal.dateOfBirth','2024-02-29',unsupported.ctx),'unsupported_calendar_date_path');assert.equal(unsupported.reads,0);
  const duplicate=fixture(),other=new duplicate.Element();other.nativeId=duplicate.input.nativeId;duplicate.identify([duplicate.input,other]);throws(duplicate.read,'calendar_date_binding_ambiguous');
  const bounded=fixture();bounded.identify(Array.from({length:1001},()=>new bounded.Element()));throws(bounded.read,'calendar_date_collection_truncated');
  const foreign=fixture();Object.setPrototypeOf(foreign.input,foreign.Element.prototype);throws(foreign.read,'calendar_date_target_unavailable');
});
test('native placeholder/type/label/control/form ownership gates fail before actions',async()=>{
  for(const [patch,code] of [[f=>f.input.nativePlaceholder='YYYY','calendar_date_target_unavailable'],[f=>f.input.kind='date','calendar_date_target_unavailable'],
    [f=>f.input.nativeDisabled=true,'calendar_date_target_unavailable'],[f=>f.input.nativeLabels=[],'calendar_date_label_ambiguous'],
    [f=>f.label.nativeControl=new f.Input(),'calendar_date_label_ambiguous'],[f=>f.label.nativeFor='other','calendar_date_label_ambiguous'],
    [f=>f.form.append(new f.Element('ant-form-item')),'calendar_date_form_ambiguous']]){
    const f=fixture();patch(f);await rejects(f.write('2024-02-29'),code);assert.deepEqual(f.actions,[]);
  }
  const wrongCaption=fixture({path:'passport.dateOfIssue',id:'basic_hcNgayCapStr',caption:'PRIVATE'});throws(wrongCaption.read,'calendar_date_caption_mismatch');
  const normalized=fixture({path:'passport.dateOfIssue',id:'basic_hcNgayCapStr',caption:'  Date   of issue *  '});assert.equal(normalized.read().label,'Date of issue');
});
test('input/label/form replacement during delegated input stops Enter and never rolls back',async()=>{
  for(const change of ['input','label','form']){
    const f=fixture();f.onEvent(event=>{if(event.type!=='input')return;
      if(change==='input'){const replacement=new f.Input();f.identify([replacement]);}
      if(change==='label'){const replacement=new f.Label();replacement.nativeControl=f.input;replacement.nativeFor=f.input.nativeId;f.labelBox.children=[];f.labelBox.append(replacement);f.input.nativeLabels=[replacement];}
      if(change==='form'){const replacement=new f.Element('ant-form-item');replacement.append(f.labelBox,f.picker);}
    });await rejects(f.write('2024-02-29'),'document_lost');assert.equal(f.actions.includes('keydown'),false);assert.equal(f.actions.includes('blur'),false);assert.equal(f.actions.filter(x=>x==='set').length,1);assert.equal(f.listeners.size,0);
  }
});
test('cancelled/stale context before DOM and cancellation during input stop later events',async()=>{
  const aborted=fixture();aborted.abort();throws(aborted.read,'cancelled');assert.equal(aborted.reads,0);
  const stale=fixture();stale.stale();throws(stale.read,'document_lost');assert.equal(stale.reads,0);
  const f=fixture();f.onEvent(event=>{if(event.type==='input')f.abort();});await rejects(f.write('2024-02-29'),'cancelled');assert.equal(f.actions.includes('keydown'),false);assert.equal(f.actions.includes('blur'),false);assert.equal(f.listeners.size,0);
});
test('late site overwrite and foreign private exceptions remain static without retry',async()=>{
  const f=fixture();f.onBlur(()=>f.raw('PRIVATE VALUE'));await rejects(f.write('2024-02-29'),'date_timeout');assert.equal(f.actions.filter(x=>x==='set').length,1);assert.equal(f.listeners.size,0);
  const foreign=fixture();foreign.document.querySelectorAll=()=>{throw Object.defineProperty({},'code',{get(){throw Error('PRIVATE');}});};throws(foreign.read,'calendar_date_dom_unavailable');
  const invalid=fixture();await rejects(invalid.write('2023-02-29'),'invalid_canonical_date');assert.deepEqual(invalid.actions,[]);
});
