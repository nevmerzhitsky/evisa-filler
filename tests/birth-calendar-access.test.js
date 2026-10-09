import test from 'node:test';
import assert from 'node:assert/strict';
import {readBirthCalendar,writeBirthCalendar,prepareBirthCalendar} from '../extension/content/birth-calendar-access.js';
import {createController} from '../extension/content/controller.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await wait(1);}assert.fail('Expected calendar phase missing');}

// Real date-transfer functions run against a small concrete picker DOM. This
// fixture models the public closed/open candidate and Enter-commit interaction,
// not an alternative date implementation or a stubbed helper return value.
function fixture({mode='date',initial='15/06/1990',star=false}={}){
  const document={},abort=new AbortController(),listeners=new Set(),actions=[];const id='basic_ttcnNgayThangNamSinhStr';let extraGroups=[],keyed,clickHook,valueReads=0,captionReads=0,identified,reads=0,stale=false,opened=false,committed=initial,candidate=initial,onEvent,onBlur,onSet;
  class Element{
    get id(){return this.nativeId??'';}
    get textContent(){captionReads++;if(this.prose===undefined)throw {code:'PRIVATE container'};return this.prose+this.children.filter(x=>!(x instanceof Input)).map(x=>x.textContent).join('');}
    get childElementCount(){return this.children.length;}
    click(){actions.push('radio-click');if(clickHook){clickHook(this);return;}selectMode(this===full?'date':'year');}
    constructor(classes=''){this.classes=new Set(classes.split(' ').filter(Boolean));this.ownerDocument=document;this.isConnected=true;this.parentElement=null;this.children=[];}
    append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}return this;}
    matches(selector){return selector.split(',').some(part=>part===':disabled'?this.disabled===true:part==='span'?this.tagName==='SPAN':part==='label'?this instanceof Label:part==='[role="radiogroup"]'?false:part==='input[type="radio"]'?this instanceof Input&&this.kind==='radio':part.startsWith('.')&&part.slice(1).split('.').every(cls=>this.classes.has(cls)));}
    closest(selector){reads++;for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
    contains(node){for(;node;node=node.parentElement)if(node===this)return true;return false;}
    querySelectorAll(selector){reads++;const result=[];function walk(node){for(const child of node.children){if(selector==='.ant-form-item-label label'?child instanceof Label&&Boolean(child.parentElement?.closest('.ant-form-item-label')):selector==='input,textarea,select'?child instanceof Input:selector==='input'?child instanceof Input:selector.includes('ant-picker-clear')?child.classes.has('ant-picker-clear'):child.matches(selector))result.push(child);walk(child);}}walk(this);return result;}
    getClientRects(){return this.hidden?[]:[{}];}getAttribute(){return null;}
    focus(){actions.push('focus');document.activeElement=this;this.writable=true;}
    blur(){actions.push('blur');document.activeElement=null;stored=committed;onBlur?.();}
  }
  let stored=initial;
  class Input extends Element{
    constructor(){super();this.kind='text';this.nativePlaceholder=mode==='date'?'DD/MM/YYYY':'YYYY';this.selected=false;this.nativeId=id;this.nativeDisabled=false;this.writable=false;}
    get checked(){return this.selected;}
    get labels(){return this.nativeLabels;}
    get type(){return this.kind;}get placeholder(){return this.nativePlaceholder;}get disabled(){return this.nativeDisabled;}get readOnly(){return !this.writable;}
    get value(){valueReads++;return stored;}set value(value){actions.push('set');stored=value;onSet?.();}
    getAttribute(key){return key==='placeholder'?this.nativePlaceholder:null;}
    dispatchEvent(event){actions.push(event.type);if(event.type==='mousedown')opened=true;
      if(event.type==='input'){if(opened)candidate=stored;else stored=committed;}
      if(event.type==='keydown'){assert.equal(event.which,13);committed=candidate;stored=committed;}
      onEvent?.(event);return true;
    }
  }
  class Label extends Element{get control(){return this.nativeControl;}get htmlFor(){return this.nativeFor;}}
  let input=new Input();const picker=new Element('ant-picker'),wrapper=new Element('ant-picker-input'),clear=new Element('ant-picker-clear');picker.append(wrapper.append(input),clear);
  const birth=new Element('date-of-birth ant-form-item'),parent=new Element(),header=new Element('flex justify-between'),caption=new Element(),group=new Element('ant-radio-group');caption.tagName=star?'SPAN':'DIV';caption.prose='Date of birth';
  if(star){const marker=new Element();marker.tagName='SPAN';marker.prose='*';caption.append(marker);}
  header.append(caption,group);parent.append(header,birth.append(picker));identified=[input];
  const full=new Input(),year=new Input();full.kind=year.kind='radio';full.nativeId=year.nativeId='';full.selected=mode==='date';year.selected=mode==='year';
  const radioLabels=[full,year].map((radio,index)=>{const label=new Label(),indicator=new Element('ant-radio'),leaf=new Element();leaf.tagName='SPAN';indicator.tagName='SPAN';leaf.prose=index===0?'Full':'Only year is known';label.prose='';indicator.prose='';indicator.append(radio);label.append(indicator,leaf);radio.nativeLabels=[label];label.nativeControl=radio;group.append(label);return label;});
  function selectMode(next){full.selected=next==='date';year.selected=next==='year';const replacement=new Input();replacement.nativePlaceholder=next==='date'?'DD/MM/YYYY':'YYYY';wrapper.children=[];wrapper.append(replacement);input.isConnected=false;input=replacement;identified=[input];stored='';committed='';candidate='';keyed?.(input);}
  clear.getAttribute=key=>key==='role'?'button':null;clear.dispatchEvent=event=>{actions.push('clear-'+event.type);if(event.type==='mouseup'){stored='';committed='';candidate='';picker.children=picker.children.filter(node=>node!==clear);clear.isConnected=false;}};
  const Event=class{constructor(type,props){this.type=type;Object.assign(this,props);}};
  document.defaultView={Element,Node:Element,HTMLElement:Element,HTMLLabelElement:Label,HTMLInputElement:Input,Event,MouseEvent:Event,KeyboardEvent:Event,getComputedStyle:()=>({display:'block',visibility:'visible'})};
  document.querySelectorAll=selector=>{reads++;if(selector==='[id]')return identified;if(selector==='.ant-radio-group,[role="radiogroup"]')return [group,...extraGroups];throw Error('Unexpected selector');};
  const signal={get aborted(){return abort.signal.aborted;},addEventListener(type,fn,opts){listeners.add(fn);abort.signal.addEventListener(type,fn,opts);},removeEventListener(type,fn){listeners.delete(fn);abort.signal.removeEventListener(type,fn);}};
  const ctx={document,signal,timeoutMs:100,pollMs:1,stableMs:5,assertCurrent(){if(stale)throw {code:'PRIVATE document'};}};
  return {get input(){return input;},picker,wrapper,clear,birth,parent,header,caption,group,full,year,radioLabels,Label,Element,Input,document,ctx,actions,listeners,
    extraGroups:nodes=>{extraGroups=nodes;},identify:nodes=>{identified=nodes;},onClick:fn=>{clickHook=fn;},selectMode,onKeyed:fn=>{keyed=fn;},get valueReads(){return valueReads;},get reads(){return reads;},
    read:path=>readBirthCalendar(path,ctx),write:(path,value)=>writeBirthCalendar(path,value,ctx),prepare:path=>prepareBirthCalendar(path,ctx),
    onEvent:fn=>{onEvent=fn;},onBlur:fn=>{onBlur=fn;},raw:value=>{stored=value;},stale:()=>{stale=true;},abort:()=>abort.abort(),get stored(){return stored;}};

}
const DATE='personal.dateOfBirth',YEAR='personal.yearOfBirth';
const throws=(fn,code)=>assert.throws(fn,error=>error.code===code&&!JSON.stringify(error).includes('PRIVATE'));
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code&&!JSON.stringify(error).includes('PRIVATE'));

test('active canonical reads and inactive path never reads a value or fabricates hidden data',()=>{
  const full=fixture();assert.deepEqual(full.read(DATE),{available:true,value:'1990-06-15',label:'Date of birth'});const count=full.valueReads;
  assert.deepEqual(full.read(YEAR),{available:false,label:'Date of birth'});assert.equal(full.valueReads,count);
  const year=fixture({mode:'year',initial:'1990'});assert.equal(year.read(YEAR).value,1990);const before=year.valueReads;assert.equal(year.read(DATE).available,false);assert.equal(year.valueReads,before);
  year.raw('');assert.deepEqual(year.read(YEAR),{available:true,value:'',restorable:false,label:'Date of birth'});
});
test('real radio preparation accepts keyed input in both directions; subsequent writes use new node only',async()=>{
  for(const [initial,path,value] of [['date',YEAR,1991],['year',DATE,'1991-08-17']]){
    const f=fixture({mode:initial,initial:initial==='date'?'15/06/1990':'1990'}),old=f.input;
    assert.deepEqual(await f.prepare(path),{ok:true});assert.notEqual(f.input,old);assert.equal(f.valueReads,0);assert.equal(old.isConnected,false);
    assert.deepEqual(await f.write(path,value),{ok:true,label:'Date of birth'});assert.equal(f.read(path).value,value);assert.equal(f.actions[0],'radio-click');assert.equal(f.listeners.size,0);
  }
});
test('already correct prepare has no radio or date actions; Full clear works and Year clear is refused',async()=>{
  const full=fixture();await full.prepare(DATE);assert.deepEqual(full.actions,[]);assert.equal(full.valueReads,0);await full.write(DATE,'');assert.equal(full.read(DATE).value,'');
  const year=fixture({mode:'year',initial:'1990'});await year.prepare(YEAR);await rejects(year.write(YEAR,''),'year_clear_unsupported');assert.deepEqual(year.actions,[]);
  const inactive=fixture();await rejects(inactive.write(YEAR,1990),'birth_calendar_inactive');assert.deepEqual(inactive.actions,[]);
});
test('observed sibling header supports dedicated required marker but rejects duplicate IDs or ambiguous header/domain/selection',()=>{
  assert.equal(fixture({star:true}).read(DATE).available,true);
  const duplicate=fixture(),node=new duplicate.Element();node.nativeId='basic_ttcnNgayThangNamSinhStr';duplicate.identify([duplicate.input,node]);throws(()=>duplicate.read(DATE),'birth_calendar_binding_ambiguous');
  const caption=fixture(),extra=new caption.Element();extra.tagName='SPAN';extra.prose='Date of birth';caption.header.append(extra);throws(()=>caption.read(DATE),'birth_calendar_header_ambiguous');
  for(const how of ['none','both','caption','placeholder']){const f=fixture();if(how==='none')f.full.selected=false;if(how==='both')f.year.selected=true;if(how==='caption')f.radioLabels[1].children[1].prose='PRIVATE';if(how==='placeholder')f.input.nativePlaceholder='YYYY';throws(()=>f.read(DATE),how==='placeholder'?'birth_calendar_placeholder_mismatch':'birth_calendar_mode_ambiguous');}
});
test('replacement before target mode transition and after preparation is rejected; no late write',async()=>{
  const before=fixture();before.onClick(()=>{const next=new before.Input();before.wrapper.children=[];before.wrapper.append(next);before.identify([next]);});await rejects(before.prepare(YEAR),'document_lost');assert.deepEqual(before.actions,['radio-click']);
  const f=fixture();await f.prepare(YEAR);f.onEvent(event=>{if(event.type==='input'){const next=new f.Input();next.nativePlaceholder='YYYY';f.wrapper.children=[];f.wrapper.append(next);f.identify([next]);}});await rejects(f.write(YEAR,1990),'document_lost');assert.equal(f.actions.includes('keydown'),false);assert.equal(f.listeners.size,0);
});
test('cancellation between own radio click and keyed replacement stops waits with no rollback',async()=>{
  const f=fixture();f.onClick(()=>{f.year.selected=true;f.full.selected=false;f.abort();});await rejects(f.prepare(YEAR),'cancelled');assert.deepEqual(f.actions,['radio-click']);assert.equal(f.valueReads,0);assert.equal(f.listeners.size,0);
});
test('mode reversal or identity loss during preparation is refused and private exceptions stay static',async()=>{
  for(const change of ['reverse','header']){const f=fixture();f.onKeyed(()=>setTimeout(()=>{if(change==='reverse'){f.full.selected=true;f.year.selected=false;}else f.header.isConnected=false;},2));await rejects(f.prepare(YEAR),'document_lost');assert.deepEqual(f.actions,['radio-click']);assert.equal(f.listeners.size,0);}
  const f=fixture();f.document.querySelectorAll=()=>{throw Object.defineProperty({},'code',{get(){throw Error('PRIVATE');}});};throws(()=>f.read(DATE),'birth_calendar_dom_unavailable');
  const aborted=fixture();aborted.abort();throws(()=>aborted.read(DATE),'cancelled');assert.equal(aborted.reads,0);
});
test('controller prepares inactive requested Year before strict read/write and skips the omitted date mode',async()=>{
  const f=fixture(),values=new Map();const adapter={probe:()=>({supported:true}),observeImages:()=>({processing:false}),
    prepareField:(path,ctx)=>[DATE,YEAR].includes(path)?prepareBirthCalendar(path,{...f.ctx,...ctx,document:f.document}):{ok:true},
    readField:(path,ctx)=>[DATE,YEAR].includes(path)?readBirthCalendar(path,{...f.ctx,...ctx,document:f.document}):{available:true,value:values.get(path)??''},
    writeField:(path,value,ctx)=>[DATE,YEAR].includes(path)?writeBirthCalendar(path,value,{...f.ctx,...ctx,document:f.document}):(values.set(path,value),{ok:true})};
  const controller=createController(adapter,{fieldTimeoutMs:500,pollIntervalMs:1});const report=await controller.start({runId:'birth',data:{personal:{yearOfBirth:1991},contact:{phone:'123'}}});
  assert.equal(report.results.find(item=>item.path===YEAR).status,'filled');assert.equal(report.results.find(item=>item.path===DATE).status,'skipped_empty');assert.equal(values.get('contact.phone'),'123');assert.equal(f.read(YEAR).value,1991);
});

test('unrelated broad header with private prose is skipped before any caption read',()=>{
  const f=fixture(),outer=new f.Element(),broadHeader=new f.Element('flex justify-between'),privateLeaf=new f.Element(),other=new f.Element('ant-radio-group');
  privateLeaf.tagName='DIV';broadHeader.append(privateLeaf,other);outer.append(broadHeader,f.parent);f.extraGroups([other]);
  assert.equal(f.read(DATE).value,'1990-06-15');assert.equal(privateLeaf.prose,undefined);
  const duplicate=fixture(),second=new duplicate.Element('ant-radio-group');duplicate.header.append(second);duplicate.extraGroups([second]);throws(()=>duplicate.read(DATE),'birth_calendar_group_ambiguous');
});
test('keyed transition may briefly remove old input but accepts only fresh desired placeholder',async()=>{
  const f=fixture();f.onClick(()=>{f.full.selected=false;f.year.selected=true;f.identify([]);f.wrapper.children=[];setTimeout(()=>f.selectMode('year'),2);});
  await f.prepare(YEAR);assert.equal(f.input.nativePlaceholder,'YYYY');assert.equal(f.read(YEAR).value,'');assert.equal(f.listeners.size,0);assert.deepEqual(f.actions,['radio-click']);
});
test('mode/input changes in freshness before actual click are refused without native activation',async()=>{
  const f=fixture(),original=f.ctx.assertCurrent;let checks=0;
  f.ctx.assertCurrent=()=>{original();if(++checks===7)f.selectMode('year');};
  await rejects(f.prepare(YEAR),'document_lost');assert.deepEqual(f.actions,[]);
});

test('native DOB metadata bypasses own ID/placeholder/checked/labels/control and ignores value in preparation',async()=>{
  const f=fixture();Object.defineProperty(f.input,'id',{get(){throw {code:'PRIVATE ID'};}});Object.defineProperty(f.input,'placeholder',{get(){throw {code:'PRIVATE placeholder'};}});
  Object.defineProperty(f.full,'checked',{get(){throw {code:'PRIVATE checked'};}});Object.defineProperty(f.year,'checked',{get(){throw {code:'PRIVATE checked'};}});
  Object.defineProperty(f.full,'labels',{get(){throw {code:'PRIVATE labels'};}});Object.defineProperty(f.radioLabels[0],'control',{get(){throw {code:'PRIVATE control'};}});
  assert.equal(f.read(DATE).value,'1990-06-15');const before=f.valueReads;await f.prepare(YEAR);assert.equal(f.valueReads,before);assert.equal(f.read(YEAR).value,'');
});
test('preparation replacement wait is bounded and aborted transient removal cannot lead to write',async()=>{
  const timeout=fixture();timeout.ctx.timeoutMs=20;timeout.onClick(()=>{timeout.full.selected=false;timeout.year.selected=true;timeout.identify([]);timeout.wrapper.children=[];});
  await assert.rejects(timeout.prepare(YEAR),error=>['document_lost','birth_calendar_timeout'].includes(error.code));assert.deepEqual(timeout.actions,['radio-click']);assert.equal(timeout.listeners.size,0);
  const aborted=fixture();aborted.onClick(()=>{aborted.full.selected=false;aborted.year.selected=true;aborted.identify([]);aborted.wrapper.children=[];setTimeout(()=>aborted.abort(),2);});
  await rejects(aborted.prepare(YEAR),'cancelled');assert.deepEqual(aborted.actions,['radio-click']);assert.equal(aborted.listeners.size,0);
});

test('first desired keyed candidate pins its picker/wrapper during radio wait and preparation settle',async()=>{
  for(const driftMs of [2,30]){
    const f=fixture();f.ctx.stableMs=20;f.ctx.timeoutMs=300;
    f.onKeyed(()=>setTimeout(()=>{const nextPicker=new f.Element('ant-picker'),nextWrapper=new f.Element('ant-picker-input');f.birth.children=[];f.birth.append(nextPicker.append(nextWrapper.append(f.input)));},driftMs));
    await assert.rejects(f.prepare(YEAR),error=>['document_lost','birth_calendar_structure_changed'].includes(error.code));
    assert.deepEqual(f.actions,['radio-click']);assert.equal(f.valueReads,0);assert.equal(f.listeners.size,0);
  }
});
