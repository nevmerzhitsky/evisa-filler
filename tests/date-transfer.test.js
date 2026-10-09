import test from 'node:test';
import assert from 'node:assert/strict';
import {setDateField,setYearField,clearDateField} from '../extension/content/date-transfer.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await wait(1);}assert.fail('Expected transfer stage not reached');}
function fixture(options={}) {
  const actions=[],controller=new AbortController(),listeners=new Set();let stale=false,reads=0,onFocus,onInput,onEnter,onBlur,onClear;
  class Element {
    constructor(){this.isConnected=true;}
    getClientRects(){return options.hidden?[]:[{}];}
    matches(selector){return selector.includes('range')&&options.range||false;}
    focus(props){assert.equal(props.preventScroll,true);actions.push('focus');document.activeElement=this;this.readOnly=false;onFocus?.();}
    blur(){actions.push('blur');document.activeElement=null;onBlur?.();}
  }
  class Input extends Element {
    constructor(){super();this.type=options.type??'text';this.disabled=!!options.disabled;this.readOnly=true;this.stored=options.initial??'';this.nativePlaceholder=options.placeholder??'DD/MM/YYYY';}
    get placeholder(){return this.nativePlaceholder;}
    get value(){return this.stored;}
    set value(value){actions.push('set');this.stored=value;}
    getAttribute(name){return name==='placeholder'?options.placeholder??'DD/MM/YYYY':null;}
    closest(){reads++;return picker;}
    dispatchEvent(event){actions.push(event.type);
      if(event.type==='mousedown'){opened=true;assert.equal(event.button,0);assert.equal(event.buttons,1);assert.equal(event.cancelable,true);}
      if(event.type==='input')onInput?.();if(event.type==='keydown'){assert.equal(event.which,13);onEnter?.();}return true;
    }
  }
  const input=new Input(),picker=new Element(),clear=new Element();let opened=false,clearControls=options.noClear?[]:[clear];
  picker.querySelectorAll=selector=>selector.includes('ant-picker-clear')?clearControls:options.multiple?[input,new Input()]:[input];
  const document={activeElement:null};input.ownerDocument=document;
  clear.ownerDocument=document;clear.closest=()=>picker;clear.getAttribute=name=>name==='role'?'button':null;
  clear.dispatchEvent=event=>{
    actions.push(`clear-${event.type}`);assert.equal(event.button,0);assert.equal(event.buttons,event.type==='mousedown'?1:0);
    if(onClear)onClear(event);else if(event.type==='mouseup'){input.stored='';clearControls=[];clear.isConnected=false;}return true;
  };
  const realm={HTMLElement:Element,HTMLInputElement:Input,getComputedStyle:()=>({display:'block',visibility:'visible'}),
    Event:class {constructor(type,props){this.type=type;Object.assign(this,props);}},
    MouseEvent:class {constructor(type,props){this.type=type;Object.assign(this,props);}},
    KeyboardEvent:class {constructor(type,props){this.type=type;Object.assign(this,props);}}};document.defaultView=realm;
  if(options.own){Object.defineProperty(input,'value',{get(){throw Error('PRIVATE getter');},set(){throw Error('PRIVATE setter');}});input.focus=input.blur=()=>{throw Error('PRIVATE method');};}
  const signal={get aborted(){return controller.signal.aborted;},addEventListener(type,fn,opts){listeners.add(fn);controller.signal.addEventListener(type,fn,opts);},
    removeEventListener(type,fn){listeners.delete(fn);controller.signal.removeEventListener(type,fn);}};
  const ctx={document,signal,timeoutMs:500,pollMs:1,stableMs:5,assertCurrent(){if(stale)throw {code:'PRIVATE route'};}};
  return {input,picker,clear,document,realm,actions,listeners,ctx,
    run:value=>setDateField(input,value,ctx),runYear:value=>setYearField(input,value,ctx),clearDate:()=>clearDateField(input,ctx),abort:()=>controller.abort(),stale:()=>{stale=true;},get reads(){return reads;},get opened(){return opened;},
    onClear:fn=>{onClear=fn;},setClearControls:controls=>{clearControls=controls;},
    onFocus:fn=>{onFocus=fn;},onInput:fn=>{onInput=fn;},onEnter:fn=>{onEnter=fn;},onBlur:fn=>{onBlur=fn;}};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code&&!error.message.includes('PRIVATE'));

test('closed picker candidate survives mousedown/input/Enter and native realm methods bypass own overrides',async()=>{
  const f=fixture({own:true});let candidate='',committed='';
  f.onInput(()=>{if(f.opened)candidate=f.input.stored;else f.input.stored=committed;});
  f.onEnter(()=>{committed=candidate;f.input.stored=committed;});f.onBlur(()=>{f.input.stored=committed;});
  assert.deepEqual(await f.run('29/02/2024'),{assigned:true});assert.equal(committed,'29/02/2024');
  assert.deepEqual(f.actions,['mousedown','focus','set','input','keydown','blur']);assert.equal(f.listeners.size,0);
});

test('strict calendar value validation rejects empty restoration, year mode, ISO, whitespace and overflow before DOM',async()=>{
  for(const value of ['',null,'2024','2024-02-29',' 29/02/2024','29/02/2023','31/04/2024','00/01/2024','01/01/0000']) {
    const f=fixture();await rejects(f.run(value),'invalid_date_value');assert.equal(f.reads,0);assert.deepEqual(f.actions,[]);
  }
});

test('stale or aborted context rejects before DOM reads; range, year placeholder and disabled inputs have no actions',async()=>{
  for(const action of ['stale','abort']){const f=fixture();f[action]();await rejects(f.run('17/08/1991'),action==='stale'?'document_lost':'cancelled');assert.equal(f.reads,0);}
  for(const options of [{multiple:true},{range:true},{placeholder:'YYYY'},{disabled:true},{hidden:true},{type:'date'}]) {
    const f=fixture(options);await rejects(f.run('17/08/1991'),'date_target_lost');assert.deepEqual(f.actions,[]);
  }
});

test('async writable focus and blur parsing are observed before successful stable readback',async()=>{
  const f=fixture();f.onFocus(()=>{f.input.readOnly=true;setTimeout(()=>{f.input.readOnly=false;},5);});
  f.onBlur(()=>{f.input.stored='PENDING';setTimeout(()=>{f.input.stored='17/08/1991';},5);});
  assert.deepEqual(await f.run('17/08/1991'),{assigned:true});assert.equal(f.listeners.size,0);
});

test('abort during writable wait stops all later events and removes abort listeners',async()=>{
  const f=fixture();f.onFocus(()=>{f.input.readOnly=true;});const transfer=f.run('17/08/1991');await until(()=>f.actions.includes('focus'));f.abort();
  await rejects(transfer,'cancelled');f.input.readOnly=false;await wait(10);
  assert.deepEqual(f.actions,['mousedown','focus']);assert.equal(f.listeners.size,0);
});

test('stale document or disconnected target after input cannot dispatch Enter or roll back',async()=>{
  for(const action of ['stale','disconnected']) {
    const f=fixture();f.onInput(()=>{if(action==='stale')f.stale();else f.input.isConnected=false;});
    await rejects(f.run('17/08/1991'),action==='stale'?'document_lost':'date_target_lost');
    assert.deepEqual(f.actions,['mousedown','focus','set','input']);assert.equal(f.input.stored,'17/08/1991');assert.equal(f.listeners.size,0);
  }
});

test('readonly flips in input constructor or after input prevent action despite earlier writable focus',async()=>{
  const constructor=fixture(),Base=constructor.realm.Event;
  constructor.realm.Event=class extends Base {constructor(type,props){super(type,props);constructor.input.readOnly=true;}};
  await rejects(constructor.run('17/08/1991'),'date_input_not_editable');assert.deepEqual(constructor.actions,['mousedown','focus','set']);
  const after=fixture();after.onInput(()=>{after.input.readOnly=true;});await rejects(after.run('17/08/1991'),'date_input_not_editable');
  assert.deepEqual(after.actions,['mousedown','focus','set','input']);
});

test('unsupported Enter is detected before actions; constructor cancellation before Enter prevents late dispatch',async()=>{
  const unsupported=fixture();unsupported.realm.KeyboardEvent=class {constructor(){this.which=0;}};
  await rejects(unsupported.run('17/08/1991'),'unsupported_enter');assert.deepEqual(unsupported.actions,[]);
  const cancelled=fixture(),Base=cancelled.realm.KeyboardEvent;
  cancelled.realm.KeyboardEvent=class extends Base {constructor(type,props){super(type,props);if(cancelled.input.stored==='17/08/1991')cancelled.abort();}};
  await rejects(cancelled.run('17/08/1991'),'cancelled');assert.deepEqual(cancelled.actions,['mousedown','focus','set','input']);assert.equal(cancelled.listeners.size,0);
});

test('site rewrite after input or during stable readback fails without personal error data or rollback',async()=>{
  const input=fixture();input.onInput(()=>{input.input.stored='PRIVATE SITE DATE';});await rejects(input.run('17/08/1991'),'date_readback_mismatch');
  assert.deepEqual(input.actions,['mousedown','focus','set','input']);assert.equal(input.input.stored,'PRIVATE SITE DATE');
  const stable=fixture();stable.onBlur(()=>{setTimeout(()=>{stable.input.stored='PRIVATE SITE DATE';},2);});
  await rejects(stable.run('17/08/1991'),'date_readback_mismatch');assert.equal(stable.listeners.size,0);
});

test('never released readonly reaches overall deadline and raw DOM exception codes stay static',async()=>{
  const timeout=fixture();timeout.ctx.timeoutMs=15;timeout.onFocus(()=>{timeout.input.readOnly=true;});await rejects(timeout.run('17/08/1991'),'date_timeout');assert.equal(timeout.listeners.size,0);
  const error=fixture();error.input.closest=()=>{throw {code:'PRIVATE CODE'};};await rejects(error.run('17/08/1991'),'date_dom_unavailable');assert.deepEqual(error.actions,[]);
});

test('async freshness is rejected before DOM and picker replacement during focus blocks assignment',async()=>{
  const asyncContext=fixture();asyncContext.ctx.assertCurrent=async()=>true;
  await rejects(asyncContext.run('17/08/1991'),'document_lost');assert.equal(asyncContext.reads,0);assert.deepEqual(asyncContext.actions,[]);
  const replacement=fixture();replacement.onFocus(()=>{replacement.input.closest=()=>null;});
  await rejects(replacement.run('17/08/1991'),'date_target_lost');assert.deepEqual(replacement.actions,['mousedown','focus']);assert.equal(replacement.listeners.size,0);
});

test('year operation commits exact normalized year through shared native path and preserves value-only DOM scope',async()=>{
  const f=fixture({placeholder:'YYYY',own:true});let candidate='',committed='';
  Object.defineProperty(f.input,'placeholder',{get(){throw Error('PRIVATE own placeholder');}});
  f.input.getAttribute=()=>{throw Error('PRIVATE attribute accessor');};
  f.onInput(()=>{candidate=f.input.stored;});f.onEnter(()=>{committed=candidate;});f.onBlur(()=>{f.input.stored=committed;});
  assert.deepEqual(await f.runYear('1991'),{assigned:true});assert.equal(committed,'1991');
  assert.deepEqual(f.actions,['mousedown','focus','set','input','keydown','blur']);assert.equal(f.listeners.size,0);
});

test('invalid years and wrong native placeholder refuse before actions; full date API remains distinct',async()=>{
  for(const value of ['',null,1991,'0000','1','10000','1991 ','17/08/1991','PRIVATE YEAR']) {
    const f=fixture({placeholder:'YYYY'});await rejects(f.runYear(value),'invalid_year_value');assert.equal(f.reads,0);assert.deepEqual(f.actions,[]);
  }
  const wrong=fixture({placeholder:'DD/MM/YYYY'});await rejects(wrong.runYear('1991'),'date_target_lost');assert.deepEqual(wrong.actions,[]);
  const full=fixture({placeholder:'YYYY'});await rejects(full.run('17/08/1991'),'date_target_lost');assert.deepEqual(full.actions,[]);
  for(const value of ['0001','9999']){const f=fixture({placeholder:'YYYY'});assert.deepEqual(await f.runYear(value),{assigned:true});}
});

test('native year placeholder change after focus prevents writing even if own placeholder still claims YYYY',async()=>{
  const f=fixture({placeholder:'YYYY'});Object.defineProperty(f.input,'placeholder',{value:'YYYY'});
  f.onFocus(()=>{f.input.nativePlaceholder='DD/MM/YYYY';});await rejects(f.runYear('1991'),'date_target_lost');
  assert.deepEqual(f.actions,['mousedown','focus']);assert.equal(f.listeners.size,0);
});

test('year abort after input and changed readback stop Enter without rollback',async()=>{
  const aborted=fixture({placeholder:'YYYY'});aborted.onInput(()=>{aborted.abort();});await rejects(aborted.runYear('1991'),'cancelled');
  assert.deepEqual(aborted.actions,['mousedown','focus','set','input']);assert.equal(aborted.input.stored,'1991');assert.equal(aborted.listeners.size,0);
  const changed=fixture({placeholder:'YYYY'});changed.onInput(()=>{changed.input.stored='PRIVATE SITE YEAR';});await rejects(changed.runYear('1991'),'date_readback_mismatch');
  assert.deepEqual(changed.actions,['mousedown','focus','set','input']);assert.equal(changed.input.stored,'PRIVATE SITE YEAR');
});

test('full-date clear tolerates disappearing control and confirms empty after reopen focus and blur without empty setter',async()=>{
  const f=fixture({initial:'17/08/1991'});assert.deepEqual(await f.clearDate(),{assigned:true});
  assert.equal(f.input.stored,'');assert.deepEqual(f.actions,['clear-mousedown','clear-mouseup','mousedown','focus','blur']);
  assert.equal(f.listeners.size,0);assert.equal(f.clear.isConnected,false);
});

test('initially empty full date needs only stable check and no clear control or Enter constructor',async()=>{
  const f=fixture({noClear:true});f.realm.KeyboardEvent=undefined;f.realm.MouseEvent=undefined;
  assert.deepEqual(await f.clearDate(),{assigned:true});assert.deepEqual(f.actions,[]);assert.equal(f.listeners.size,0);
  const year=fixture({placeholder:'YYYY'});await rejects(year.clearDate(),'date_target_lost');assert.deepEqual(year.actions,[]);
});

test('missing, duplicate, disabled or replaced clear control refuses unsafe mouseup',async()=>{
  const missing=fixture({initial:'17/08/1991',noClear:true});await rejects(missing.clearDate(),'date_clear_unavailable');assert.deepEqual(missing.actions,[]);
  const duplicate=fixture({initial:'17/08/1991'});duplicate.setClearControls([duplicate.clear,duplicate.clear]);await rejects(duplicate.clearDate(),'date_clear_unavailable');assert.deepEqual(duplicate.actions,[]);
  const disabled=fixture({initial:'17/08/1991'});disabled.clear.disabled=true;await rejects(disabled.clearDate(),'date_clear_unavailable');assert.deepEqual(disabled.actions,[]);
  const replaced=fixture({initial:'17/08/1991'});replaced.onClear(()=>{replaced.setClearControls([]);});await rejects(replaced.clearDate(),'date_clear_unavailable');assert.deepEqual(replaced.actions,['clear-mousedown']);
});

test('clear abort or stale context after mousedown never dispatches mouseup or rollback',async()=>{
  for(const action of ['abort','stale']){
    const f=fixture({initial:'PRIVATE INITIAL DATE'});f.onClear(()=>{f[action]();});
    await rejects(f.clearDate(),action==='abort'?'cancelled':'document_lost');assert.deepEqual(f.actions,['clear-mousedown']);
    assert.equal(f.input.stored,'PRIVATE INITIAL DATE');assert.equal(f.listeners.size,0);
  }
});

test('changed initial date between clear events is not erased or echoed in error',async()=>{
  const f=fixture({initial:'17/08/1991'});f.onClear(()=>{f.input.stored='PRIVATE MANUAL DATE';});
  await rejects(f.clearDate(),'date_readback_mismatch');assert.deepEqual(f.actions,['clear-mousedown']);assert.equal(f.input.stored,'PRIVATE MANUAL DATE');
});

test('sticky buffer revival on reopening or during stable blur rejects local empty proof without clearing again',async()=>{
  const focus=fixture({initial:'17/08/1991'});focus.onFocus(()=>{focus.input.stored='PRIVATE BUFFER';});await rejects(focus.clearDate(),'date_readback_mismatch');
  assert.deepEqual(focus.actions,['clear-mousedown','clear-mouseup','mousedown','focus']);assert.equal(focus.input.stored,'PRIVATE BUFFER');
  const blur=fixture({initial:'17/08/1991'});blur.onBlur(()=>{setTimeout(()=>{blur.input.stored='PRIVATE BUFFER';},2);});
  await rejects(blur.clearDate(),'date_readback_mismatch');assert.equal(blur.listeners.size,0);assert.ok(!blur.actions.includes('set'));
});

test('clear empty transition and writable reopen wait are bounded and abort listeners are released',async()=>{
  const timeout=fixture({initial:'17/08/1991'});timeout.ctx.timeoutMs=15;timeout.onClear(()=>{});
  await rejects(timeout.clearDate(),'date_timeout');assert.equal(timeout.listeners.size,0);
  const abort=fixture({initial:'17/08/1991'});abort.onFocus(()=>{abort.input.readOnly=true;});const operation=abort.clearDate();
  await until(()=>abort.actions.includes('focus'));abort.abort();await rejects(operation,'cancelled');assert.equal(abort.listeners.size,0);
  assert.deepEqual(abort.actions,['clear-mousedown','clear-mouseup','mousedown','focus']);assert.equal(abort.input.stored,'');
});

test('immediate sticky buffer revival on native blur is rejected, and constructor control replacement cannot reach mouseup',async()=>{
  const blur=fixture({initial:'17/08/1991'});blur.onBlur(()=>{blur.input.stored='PRIVATE BUFFER';});
  await rejects(blur.clearDate(),'date_readback_mismatch');assert.equal(blur.listeners.size,0);assert.ok(!blur.actions.includes('set'));
  const replaced=fixture({initial:'17/08/1991'}),Base=replaced.realm.MouseEvent;let upConstructors=0;
  replaced.realm.MouseEvent=class extends Base {constructor(type,props){super(type,props);if(type==='mouseup'&&++upConstructors===2)replaced.setClearControls([]);}};
  await rejects(replaced.clearDate(),'date_clear_unavailable');assert.deepEqual(replaced.actions,['clear-mousedown']);
});
