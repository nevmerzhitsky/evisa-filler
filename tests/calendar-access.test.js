import test from 'node:test';
import assert from 'node:assert/strict';
import {readCalendarField,writeCalendarField} from '../extension/content/calendar-access.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await wait(1);}assert.fail('Expected calendar phase missing');}

// Real date-transfer functions run against a small concrete picker DOM. This
// fixture models the public closed/open candidate and Enter-commit interaction,
// not an alternative date implementation or a stubbed helper return value.
function fixture({mode='date',initial='',duplicate=false}={}){
  const document={},abort=new AbortController(),listeners=new Set(),actions=[];let reads=0,stale=false,opened=false,committed=initial,candidate=initial,onEvent,onBlur,onSet;
  class Element{
    constructor(classes=''){this.classes=new Set(classes.split(' ').filter(Boolean));this.ownerDocument=document;this.isConnected=true;this.parentElement=null;this.children=[];}
    append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}return this;}
    matches(selector){return selector.split(',').some(part=>part===':disabled'?this.disabled===true:part.startsWith('.')&&this.classes.has(part.slice(1)));}
    closest(selector){reads++;for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
    contains(node){for(;node;node=node.parentElement)if(node===this)return true;return false;}
    querySelectorAll(selector){reads++;const result=[];function walk(node){for(const child of node.children){if(selector==='input'?child instanceof Input:selector.includes('ant-picker-clear')?child.classes.has('ant-picker-clear'):child.matches(selector))result.push(child);walk(child);}}walk(this);return result;}
    getClientRects(){return this.hidden?[]:[{}];}getAttribute(){return null;}
    focus(){actions.push('focus');document.activeElement=this;this.writable=true;}
    blur(){actions.push('blur');document.activeElement=null;stored=committed;onBlur?.();}
  }
  let stored=initial;
  class Input extends Element{
    constructor(){super();this.kind='text';this.nativePlaceholder=mode==='date'?'DD/MM/YYYY':'YYYY';this.nativeDisabled=false;this.writable=false;}
    get type(){return this.kind;}get placeholder(){return this.nativePlaceholder;}get disabled(){return this.nativeDisabled;}get readOnly(){return !this.writable;}
    get value(){return stored;}set value(value){actions.push('set');stored=value;onSet?.();}
    getAttribute(key){return key==='placeholder'?this.nativePlaceholder:null;}
    dispatchEvent(event){actions.push(event.type);if(event.type==='mousedown')opened=true;
      if(event.type==='input'){if(opened)candidate=stored;else stored=committed;}
      if(event.type==='keydown'){assert.equal(event.which,13);committed=candidate;stored=committed;}
      onEvent?.(event);return true;
    }
  }
  const input=new Input(),picker=new Element('ant-picker'),wrapper=new Element('ant-picker-input'),clear=new Element('ant-picker-clear');picker.append(wrapper.append(input),clear);
  if(duplicate)wrapper.append(new Input());
  clear.getAttribute=key=>key==='role'?'button':null;clear.dispatchEvent=event=>{actions.push('clear-'+event.type);if(event.type==='mouseup'){stored='';committed='';candidate='';picker.children=picker.children.filter(node=>node!==clear);clear.isConnected=false;}};
  const Event=class{constructor(type,props){this.type=type;Object.assign(this,props);}};
  document.defaultView={HTMLElement:Element,HTMLInputElement:Input,Event,MouseEvent:Event,KeyboardEvent:Event,getComputedStyle:()=>({display:'block',visibility:'visible'})};
  const signal={get aborted(){return abort.signal.aborted;},addEventListener(type,fn,opts){listeners.add(fn);abort.signal.addEventListener(type,fn,opts);},removeEventListener(type,fn){listeners.delete(fn);abort.signal.removeEventListener(type,fn);}};
  const ctx={document,signal,timeoutMs:100,pollMs:1,stableMs:5,assertCurrent(){if(stale)throw {code:'PRIVATE document'};}};
  return {input,picker,wrapper,clear,document,ctx,actions,listeners,Element,Input,
    read:()=>readCalendarField(input,mode,ctx),write:value=>writeCalendarField(input,mode,value,ctx),onEvent:fn=>{onEvent=fn;},onBlur:fn=>{onBlur=fn;},onSet:fn=>{onSet=fn;},
    raw:value=>{stored=value;},stale:()=>{stale=true;},abort:()=>abort.abort(),get reads(){return reads;},get stored(){return stored;}};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code&&!error.message.includes('PRIVATE')&&!JSON.stringify(error).includes('PRIVATE'));
const throws=(fn,code)=>assert.throws(fn,error=>error.code===code&&!error.message.includes('PRIVATE'));

test('Full bridge uses real commit path and converts exact DOM/ISO dates with native own-value bypass',async()=>{
  const f=fixture();Object.defineProperty(f.input,'value',{get(){throw {code:'PRIVATE value'};},set(){throw {code:'PRIVATE value'};}});
  assert.deepEqual(f.read(),{available:true,value:''});assert.deepEqual(await f.write('2024-02-29'),{ok:true});
  assert.deepEqual(f.read(),{available:true,value:'2024-02-29'});assert.equal(f.stored,'29/02/2024');
  assert.deepEqual(f.actions,['mousedown','focus','set','input','keydown','blur']);assert.equal(f.listeners.size,0);
  assert.deepEqual(await f.write('0001-01-02'),{ok:true});assert.equal(f.stored,'02/01/0001');assert.equal(f.read().value,'0001-01-02');
});

test('empty Full restoration delegates clear control without empty setter/input/Enter; already empty is no-op',async()=>{
  const f=fixture({initial:'15/06/1990'});assert.deepEqual(await f.write(''),{ok:true});assert.equal(f.read().value,'');
  assert.deepEqual(f.actions,['clear-mousedown','clear-mouseup','mousedown','focus','blur']);assert.equal(f.listeners.size,0);
  const empty=fixture();empty.picker.children=[empty.wrapper];assert.deepEqual(await empty.write(''),{ok:true});assert.deepEqual(empty.actions,[]);
});

test('Year JSON domain matches schema 1000..9999; empty read allowed but empty Year mutation unsupported',async()=>{
  const f=fixture({mode:'year'});assert.deepEqual(f.read(),{available:true,value:'',restorable:false});
  for(const year of [1000,9999]){assert.deepEqual(await f.write(year),{ok:true});assert.equal(f.read().value,year);assert.equal(f.stored,String(year));}
  for(const value of [999,1,0,10000,1990.5,'1990',null,NaN]){const invalid=fixture({mode:'year'});await rejects(invalid.write(value),'invalid_canonical_year');assert.equal(invalid.reads,0);assert.deepEqual(invalid.actions,[]);}
  const empty=fixture({mode:'year'});await rejects(empty.write(''),'year_clear_unsupported');assert.equal(empty.reads,0);assert.deepEqual(empty.actions,[]);
  for(const display of ['0001','0999','199',' 1990','0000','PRIVATE YEAR']){f.raw(display);throws(f.read,'calendar_value_unconfirmed');}
});

test('strict canonical and displayed invalid dates fail with no value-bearing errors or incoming DOM reads',async()=>{
  for(const value of ['29/02/2024','2023-02-29','2024-04-31','0000-01-01','2024-2-01',' 2024-02-29',null,123]){
    const f=fixture();await rejects(f.write(value),'invalid_canonical_date');assert.equal(f.reads,0);assert.deepEqual(f.actions,[]);}
  const f=fixture();for(const display of ['29/02/2023','31/04/2024','1/01/2024','2024-02-29','PRIVATE DATE']){f.raw(display);throws(f.read,'calendar_value_unconfirmed');}
  f.raw('29/02/2000');assert.equal(f.read().value,'2000-02-29');f.raw('29/02/1900');throws(f.read,'calendar_value_unconfirmed');
});

test('wrong mode, exact native placeholder, duplicate/range picker and foreign realm cannot mutate',async()=>{
  const mode=fixture();await rejects(writeCalendarField(mode.input,'other','2024-02-29',mode.ctx),'invalid_calendar_mode');assert.equal(mode.reads,0);
  for(const patch of [f=>{f.input.nativePlaceholder='YYYY';},f=>{f.input.nativePlaceholder='';},f=>{f.picker.classes.add('ant-picker-range');},f=>{f.input.kind='date';},f=>{f.input.nativeDisabled=true;}]){
    const f=fixture();patch(f);await rejects(f.write('2024-02-29'),'calendar_target_lost');assert.deepEqual(f.actions,[]);}
  const duplicate=fixture({duplicate:true});await rejects(duplicate.write('2024-02-29'),'calendar_target_lost');assert.deepEqual(duplicate.actions,[]);
  const realm=fixture();Object.setPrototypeOf(realm.input,realm.Element.prototype);throws(realm.read,'invalid_calendar_input');
});

test('placeholder and picker/wrapper replacement during input prevent Enter with no rollback',async()=>{
  for(const change of ['placeholder','picker','wrapper']){
    const f=fixture();f.onEvent(event=>{if(event.type!=='input')return;
      if(change==='placeholder')f.input.nativePlaceholder='YYYY';
      else if(change==='picker'){const picker=new f.Element('ant-picker');picker.append(f.wrapper);}
      else{const wrapper=new f.Element('ant-picker-input');f.picker.children=[wrapper];wrapper.parentElement=f.picker;wrapper.append(f.input);}
    });
    await rejects(f.write('2024-02-29'),'document_lost');assert.deepEqual(f.actions,['mousedown','focus','set','input']);assert.equal(f.stored,'29/02/2024');assert.equal(f.listeners.size,0);
  }
});

test('caller cancellation/staleness/async context guards before DOM and abort during focus stops later actions',async()=>{
  for(const mode of ['cancelled','stale','async']){const f=fixture();if(mode==='cancelled')f.abort();else if(mode==='stale')f.stale();else f.ctx.assertCurrent=async()=>true;
    throws(f.read,mode==='cancelled'?'cancelled':'document_lost');assert.equal(f.reads,0);}
  const f=fixture();f.onEvent(event=>{if(event.type==='mousedown')f.abort();});await rejects(f.write('2024-02-29'),'cancelled');assert.deepEqual(f.actions,['mousedown']);assert.equal(f.listeners.size,0);
});

test('private native/DOM exceptions are static; late blur overwrite fails canonical readback without retry',async()=>{
  const getter=fixture();Object.defineProperty(getter.document.defaultView.HTMLInputElement.prototype,'value',{get(){throw {get code(){throw Error('PRIVATE');}};},set(){}});
  throws(getter.read,'calendar_dom_unavailable');
  const f=fixture();f.onBlur(()=>setTimeout(()=>f.raw('PRIVATE SITE DATE'),1));await rejects(f.write('2024-02-29'),'date_readback_mismatch');
  assert.deepEqual(f.actions,['mousedown','focus','set','input','keydown','blur']);assert.equal(f.listeners.size,0);
});
