import test from 'node:test';
import assert from 'node:assert/strict';
import {readRadioSelection,chooseRadioOption} from '../extension/content/radio-transfer.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await wait(1);}assert.fail('Radio stage not reached');}
function fixture({captions=['Single entry','Multiple entries'],initial=0}={}) {
  let stale=false,onClick,radios,domReads=0,nested=false;
  const calls=[],abort=new AbortController(),listeners=new Set();
  class Element {
    constructor(){this.isConnected=true;this.childElementCount=0;this.disabled=false;}
    getClientRects(){return [{}];}
    getAttribute(){return null;}
    matches(selector){return this===group?selector!==':disabled':this.disabled&&selector===':disabled';}
    get textContent(){throw Error('PRIVATE container prose');}
    get value(){throw Error('PRIVATE raw value');}
    get name(){throw Error('PRIVATE raw name');}
    click(){calls.push(radios.indexOf(this));if(onClick)onClick(this);else radios.forEach(input=>{input.selected=input===this;});}
  }
  class Input extends Element {
    constructor(){super();this.type='radio';this.selected=false;}
    get checked(){return this.selected;}
    get labels(){return [this.associated];}
    closest(selector){return selector==='label'?this.associated:group;}
  }
  class Label extends Element {get control(){return this.input;}closest(){return group;}}
  const group=new Element(),document={};group.ownerDocument=document;group.parentElement=null;
  radios=captions.map((caption,index)=>{
    const input=new Input(),label=new Label(),leaf=new Element(),indicator=new Element(),radioWrapper=new Element();
    input.ownerDocument=label.ownerDocument=leaf.ownerDocument=indicator.ownerDocument=document;
    input.associated=label;input.selected=index===initial;label.input=input;label.childElementCount=2;
    Object.defineProperty(leaf,'textContent',{get:()=>caption});
    leaf.closest=selector=>selector==='label'?label:null;leaf.contains=()=>false;
    indicator.closest=selector=>selector==='label'?label:selector==='.ant-radio'?radioWrapper:null;indicator.contains=()=>false;
    label.querySelectorAll=()=>[radioWrapper,indicator,leaf];radioWrapper.childElementCount=2;
    radioWrapper.closest=()=>label;
    input.click=()=>{throw Error('PRIVATE own click');};Object.defineProperty(input,'checked',{get(){throw Error('PRIVATE own checked');}});
    return input;
  });
  group.contains=node=>radios.some(input=>input===node||input.associated===node);
  group.querySelectorAll=selector=>{domReads++;return selector.startsWith('input')?radios:nested?[{}]:[];};
  const realm={HTMLElement:Element,HTMLInputElement:Input,HTMLLabelElement:Label,getComputedStyle:()=>({display:'block',visibility:'visible'})};document.defaultView=realm;
  const signal={get aborted(){return abort.signal.aborted;},addEventListener(type,fn,opts){listeners.add(fn);abort.signal.addEventListener(type,fn,opts);},removeEventListener(type,fn){listeners.delete(fn);abort.signal.removeEventListener(type,fn);}};
  const ctx={document,signal,timeoutMs:500,pollMs:1,stableMs:5,assertCurrent(){if(stale)throw {code:'PRIVATE stale'};}};
  return {group,document,ctx,calls,listeners,get radios(){return radios;},setRadios:value=>{radios=value;},setNested:value=>{nested=value;},get domReads(){return domReads;},
    onClick:fn=>{onClick=fn;},stale:()=>{stale=true;},abort:()=>abort.abort(),read:()=>readRadioSelection(group,ctx),choose:caption=>chooseRadioOption(group,caption,ctx)};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code&&!error.message.includes('PRIVATE'));

test('native checked reader and click use Ant caption leaf, excluding indicator and bypassing own overrides',async()=>{
  const f=fixture();assert.equal(f.read(),'Single entry');assert.deepEqual(await f.choose(' Multiple   entries '),{assigned:true});
  assert.equal(f.read(),'Multiple entries');assert.deepEqual(f.calls,[1]);assert.equal(f.listeners.size,0);
});

test('no checked initial state can be selected; already wanted performs stable noop without click',async()=>{
  const empty=fixture({initial:-1});assert.equal(empty.read(),null);await empty.choose('Single entry');assert.equal(empty.read(),'Single entry');
  const existing=fixture();await existing.choose('Single entry');assert.deepEqual(existing.calls,[]);assert.equal(existing.listeners.size,0);
});

test('duplicate normalized captions, multiple checked, nested group and disabled control reject before click',async()=>{
  const duplicate=fixture({captions:['Single entry','Single  entry']});await rejects(duplicate.choose('Single entry'),'radio_caption_ambiguous');assert.deepEqual(duplicate.calls,[]);
  const multiple=fixture();multiple.radios[1].selected=true;assert.throws(()=>multiple.read(),error=>error.code==='radio_selection_ambiguous');
  const nested=fixture();nested.setNested(true);await rejects(nested.choose('Single entry'),'radio_target_lost');assert.deepEqual(nested.calls,[]);
  const disabled=fixture();disabled.radios[1].disabled=true;await rejects(disabled.choose('Multiple entries'),'radio_target_lost');assert.deepEqual(disabled.calls,[]);
});

test('missing, external or ambiguous labels and absent caption reject without reading group prose',async()=>{
  const external=fixture();external.radios[1].associated.ownerDocument={};await rejects(external.choose('Multiple entries'),'radio_label_ambiguous');
  const leaves=fixture();const label=leaves.radios[1].associated,one=label.querySelectorAll()[2];label.querySelectorAll=()=>[one,one];
  await rejects(leaves.choose('Multiple entries'),'radio_label_ambiguous');assert.deepEqual(leaves.calls,[]);
  const missing=fixture();await rejects(missing.choose('Unknown'),'radio_option_missing');assert.deepEqual(missing.calls,[]);
});

test('stale or cancelled context and async freshness reject before DOM; errors retain no arbitrary codes',async()=>{
  for(const action of ['stale','abort']){const f=fixture();f[action]();await rejects(f.choose('Multiple entries'),action==='stale'?'document_lost':'cancelled');assert.equal(f.domReads,0);}
  const asyncContext=fixture();asyncContext.ctx.assertCurrent=async()=>true;await rejects(asyncContext.choose('Multiple entries'),'document_lost');assert.equal(asyncContext.domReads,0);
  const raw=fixture();raw.group.querySelectorAll=()=>{throw {code:'PRIVATE CODE'};};assert.throws(()=>raw.read(),error=>error.code==='radio_dom_unavailable');
});

test('async native activation is waited for and subsequent stable read observes exactly the requested radio',async()=>{
  const f=fixture();f.onClick(target=>{setTimeout(()=>{f.radios.forEach(input=>{input.selected=input===target;});},5);});
  await f.choose('Multiple entries');assert.equal(f.read(),'Multiple entries');assert.equal(f.listeners.size,0);
});

test('abort or stale context while awaiting activation blocks further reads/actions and frees abort listeners',async()=>{
  for(const action of ['abort','stale']) {
    const f=fixture();f.onClick(()=>{});const result=f.choose('Multiple entries');await until(()=>f.calls.length);f[action]();
    await rejects(result,action==='abort'?'cancelled':'document_lost');assert.deepEqual(f.calls,[1]);assert.equal(f.listeners.size,0);
  }
});

test('input replacement or label rerender after activation is refused during readback',async()=>{
  const input=fixture();input.onClick(()=>{input.setRadios([...input.radios].reverse());});await rejects(input.choose('Multiple entries'),'radio_options_changed');assert.deepEqual(input.calls,[1]);
  const caption=fixture();caption.onClick(()=>{caption.radios[1].associated.querySelectorAll=()=>[];});await rejects(caption.choose('Multiple entries'),'radio_label_ambiguous');assert.equal(caption.listeners.size,0);
});

test('site selection changing during stability interval fails rather than silently clicking again',async()=>{
  const f=fixture();f.onClick(target=>{
    f.radios.forEach(input=>{input.selected=input===target;});setTimeout(()=>{f.radios.forEach((input,index)=>{input.selected=index===0;});},2);
  });await rejects(f.choose('Multiple entries'),'radio_selection_changed');assert.deepEqual(f.calls,[1]);assert.equal(f.listeners.size,0);
});

test('bounded timeout and group size limit reject without private contents',async()=>{
  const timeout=fixture();timeout.ctx.timeoutMs=15;timeout.onClick(()=>{});await rejects(timeout.choose('Multiple entries'),'radio_timeout');assert.equal(timeout.listeners.size,0);
  const many=fixture({captions:Array.from({length:51},(_,index)=>`Choice ${index}`)});await rejects(many.choose('Choice 0'),'radio_group_ambiguous');assert.deepEqual(many.calls,[]);
});

test('live disabled state before click and raw native click exception are refused without private error data',async()=>{
  const disabled=fixture(),query=disabled.group.querySelectorAll;let reads=0;
  disabled.group.querySelectorAll=selector=>{if(++reads===3)disabled.radios[1].disabled=true;return query(selector);};
  await rejects(disabled.choose('Multiple entries'),'radio_target_lost');assert.deepEqual(disabled.calls,[]);
  const raw=fixture();raw.document.defaultView.HTMLElement.prototype.click=()=>{throw {code:'PRIVATE PAGE ERROR'};};
  await rejects(raw.choose('Multiple entries'),'radio_click_failed');assert.equal(raw.listeners.size,0);
});

test('native association accessors bypass instance labels and label.control overrides',async()=>{
  const f=fixture();for(const input of f.radios){
    Object.defineProperty(input,'labels',{get(){throw Error('PRIVATE own labels');}});
    Object.defineProperty(input.associated,'control',{get(){throw Error('PRIVATE own control');}});
  }
  assert.equal(f.read(),'Single entry');await f.choose('Multiple entries');assert.equal(f.read(),'Multiple entries');
});

test('beforeClick marks actual native activation once, precedes click and is absent on noop',async()=>{
  const f=fixture(),order=[];f.ctx.beforeClick=()=>{order.push('marker');assert.equal(f.calls.length,0);};f.onClick(target=>{order.push('click');f.radios.forEach(input=>input.selected=input===target);});
  await f.choose('Multiple entries');assert.deepEqual(order,['marker','click']);await f.choose('Multiple entries');assert.deepEqual(order,['marker','click']);
});
test('beforeClick failure, thenable, invalid type or cancellation prevents native activation',async()=>{
  for(const how of ['throw','async','cancel','stale','invalid']){
    const f=fixture();f.ctx.beforeClick=how==='invalid'?42:()=>{if(how==='throw')throw {code:'PRIVATE marker'};if(how==='async')return Promise.reject(Error('PRIVATE async'));if(how==='cancel')f.abort();if(how==='stale')f.stale();};
    await rejects(f.choose('Multiple entries'),how==='invalid'?'invalid_radio_context':['cancel','stale'].includes(how)?how==='cancel'?'cancelled':'document_lost':'radio_before_click_failed');assert.deepEqual(f.calls,[]);assert.equal(f.listeners.size,0);
  }
});

test('beforeClick target readiness and identity are revalidated before native activation',async()=>{
  for(const how of ['disable','replace','label']){
    const f=fixture();f.ctx.beforeClick=()=>{if(how==='disable')f.radios[1].disabled=true;if(how==='replace')f.setRadios([...f.radios].reverse());if(how==='label')f.radios[1].associated.querySelectorAll=()=>[];};
    await assert.rejects(f.choose('Multiple entries'));assert.deepEqual(f.calls,[]);assert.equal(f.listeners.size,0);
  }
});
