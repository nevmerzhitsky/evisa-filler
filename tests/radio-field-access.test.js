import test from 'node:test';
import assert from 'node:assert/strict';
import {readRadioField,writeRadioField} from '../extension/content/radio-field-access.js';
import {createController} from '../extension/content/controller.js';
const pairs=[
 ['personal.hasUsedOtherPassports','Have you ever used any other passports to enter into Viet Nam?'],
 ['personal.hasOtherNationalities','Do you have multiple nationalities?'],
 ['personal.hasViolations','Violation of the Vietnamese laws/regulations (if any)'],
 ['passport.hasOtherValidPassports','Do you hold any other valid passports'],
 ['trip.hasVietnamContacts','Agency/Organization/Individual that the applicant plans to contact when enter into Viet Nam?'],
 ['trip.hasVisitedWithinLastYear','Have you been to Viet Nam in the last 01 year?'],
 ['trip.hasRelativesInVietnam','Do you have relatives who currently reside in Viet Nam?']
];
const GROUP='.ant-radio-group,[role="radiogroup"]';
function fixture({path=pairs[0][0],question=pairs[0][1],entry=false,selected=0}={}){
 const document={},meta=new WeakMap(),actions=[],abort=new AbortController(),listeners=new Set();let reads=0,onClick,stale=false,identified=[];
 class Element{
  constructor(classes='',tagName='DIV'){meta.set(this,{id:'',classes:new Set(classes.split(' ').filter(Boolean)),text:undefined});this.tagName=tagName;this.children=[];this.parentElement=null;this.ownerDocument=document;this.isConnected=true;}
  get id(){return meta.get(this).id;}get childElementCount(){return this.children.length;}
  get textContent(){const text=meta.get(this).text;if(text===undefined)throw {code:'PRIVATE prose'};return text;}
  get value(){throw {code:'PRIVATE raw value'};}get name(){throw {code:'PRIVATE name'};}
  getAttribute(key){if(['value','name','title'].includes(key))throw {code:'PRIVATE attribute'};return null;}
  append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}return this;}
  matches(selector){return selector.split(',').some(part=>part===':disabled'?this instanceof Input&&this.disabled:part==='[role="radiogroup"]'?false:part==='label'?this instanceof Label:part==='span'?this.tagName==='SPAN':part==='input'?this instanceof Input:part==='input[type="radio"]'?this instanceof Input&&this.type==='radio':part.startsWith('.')&&part.slice(1).split('.').every(cls=>meta.get(this).classes.has(cls)));}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
  contains(node){for(;node;node=node.parentElement)if(node===this)return true;return false;}
  querySelectorAll(selector){reads++;const result=[];function walk(node){for(const child of node.children){if(child.matches(selector))result.push(child);walk(child);}}walk(this);return result;}
  getClientRects(){return meta.get(this).hidden?[]:[{}];}
  click(){actions.push(radios.indexOf(this));if(onClick)onClick(this);else radios.forEach(input=>meta.get(input).checked=input===this);}
 }
 class Input extends Element{get type(){return meta.get(this).type;}get disabled(){return meta.get(this).disabled;}get labels(){return meta.get(this).labels;}get checked(){return meta.get(this).checked;}}
 class Label extends Element{get control(){return meta.get(this).control;}}
 const header=new Element('flex justify-between'),caption=new Element('',entry||path==='passport.hasOtherValidPassports'?'SPAN':'DIV'),group=new Element('ant-radio-group');meta.get(caption).text=question;
 header.append(caption,entry||path==='passport.hasOtherValidPassports'?group:new Element().append(group));
 let groups=[group],radios=[],labels=[],leaves=[];
 for(const [index,text]of (entry?['Single-entry','Multiple-entry']:['No','Yes']).entries()){
  const input=new Input(),label=new Label(),indicator=new Element('ant-radio','SPAN'),leaf=new Element('','SPAN');meta.get(leaf).text=text;
  indicator.append(input);label.append(indicator,leaf);group.append(label);Object.assign(meta.get(input),{type:'radio',disabled:false,checked:index===selected,labels:[label]});meta.get(label).control=input;
  radios.push(input);labels.push(label);leaves.push(leaf);
 }
 if(entry){meta.get(group).id='basic_nddnTtDeNghi';identified=[group];path='visa.entryType';}
 document.defaultView={Element,Node:Element,HTMLElement:Element,HTMLInputElement:Input,HTMLLabelElement:Label,getComputedStyle:()=>({display:'block',visibility:'visible'})};
 document.querySelectorAll=selector=>{reads++;if(selector===GROUP)return groups;if(selector==='[id]')return identified;throw Error('unexpected');};
 const signal={get aborted(){return abort.signal.aborted;},addEventListener(type,fn,opts){listeners.add(fn);abort.signal.addEventListener(type,fn,opts);},removeEventListener(type,fn){listeners.delete(fn);abort.signal.removeEventListener(type,fn);}};
 const ctx={document,signal,timeoutMs:150,pollMs:1,stableMs:5,assertCurrent(){if(stale)throw {code:'PRIVATE stale'};}};
 return {document,ctx,meta,Element,Input,Label,header,caption,group,radios,labels,leaves,actions,listeners,abort,get reads(){return reads;},
  groups:nodes=>{groups=nodes;},identify:nodes=>{identified=nodes;},onClick:fn=>{onClick=fn;},stale:()=>{stale=true;},
  read:()=>readRadioField(path,ctx),write:value=>writeRadioField(path,value,ctx)};
}
const throws=(fn,code)=>assert.throws(fn,error=>error.code===code&&!JSON.stringify(error).includes('PRIVATE'));
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code&&!JSON.stringify(error).includes('PRIVATE'));

test('all seven exact questions select canonical true/false via real native radio helper; false and noop preserved',async()=>{
 for(const [path,question]of pairs){const f=fixture({path,question});assert.deepEqual(f.read(),{available:true,value:false,label:question});
  await f.write(false);assert.deepEqual(f.actions,[]);await f.write(true);assert.equal(f.read().value,true);await f.write(false);assert.equal(f.read().value,false);assert.deepEqual(f.actions,[1,0]);assert.equal(f.listeners.size,0);}
});
test('entry ID and folded canonical domain; no selected state is null/restorable false and can be filled',async()=>{
 const entry=fixture({entry:true,selected:-1});assert.deepEqual(entry.read(),{available:true,value:null,label:null,restorable:false});await entry.write('  mUlTiPle-entry  ');assert.equal(entry.read().value,'Multiple-entry');await entry.write('Single-entry');assert.equal(entry.read().value,'Single-entry');
 const boolean=fixture({selected:-1});assert.equal(boolean.read().restorable,false);await boolean.write(false);assert.equal(boolean.read().value,false);
});
test('invalid values and insurance/legal paths have no DOM reads or activation; legal checkbox group excluded',async()=>{
 for(const value of ['',null,0,1,'false',undefined]){const f=fixture();await rejects(f.write(value),'invalid_radio_field_value');assert.equal(f.reads,0);assert.deepEqual(f.actions,[]);}
 for(const value of ['',null,true,'multiple','Single entry']){const f=fixture({entry:true});await rejects(f.write(value),'invalid_radio_field_value');assert.equal(f.reads,0);}
 for(const path of ['expenses.hasInsurance','legal.agrees']){const f=fixture();await rejects(writeRadioField(path,true,f.ctx),'unsupported_radio_field_path');assert.equal(f.reads,0);}
 const f=fixture(),legal=new f.Element('ant-radio-group'),checkbox=new f.Input();f.meta.get(checkbox).type='checkbox';legal.append(checkbox);f.groups([legal,f.group]);assert.equal(f.read().value,false);await f.write(true);assert.deepEqual(f.actions,[1]);
});
test('duplicate questions/groups and entry non-group duplicate IDs refuse; bounded collections enforced',()=>{
 const f=fixture(),otherHeader=new f.Element('flex justify-between'),otherCaption=new f.Element(),second=new f.Element('ant-radio-group');f.meta.get(otherCaption).text=pairs[0][1];otherHeader.append(otherCaption,second);
 for(const text of ['No','Yes']){const input=new f.Input(),label=new f.Label(),indicator=new f.Element('ant-radio','SPAN'),leaf=new f.Element('','SPAN');f.meta.get(leaf).text=text;Object.assign(f.meta.get(input),{type:'radio',disabled:false,checked:text==='No',labels:[label]});f.meta.get(label).control=input;label.append(indicator.append(input),leaf);second.append(label);}
 f.groups([f.group,second]);throws(f.read,'radio_field_binding_ambiguous');
 const leaves=fixture(),extra=new leaves.Element();leaves.meta.get(extra).text=pairs[0][1];leaves.header.append(extra);throws(leaves.read,'radio_field_binding_ambiguous');
 const entry=fixture({entry:true}),nonGroup=new entry.Element();entry.meta.get(nonGroup).id='basic_nddnTtDeNghi';entry.identify([entry.group,nonGroup]);throws(entry.read,'radio_field_binding_ambiguous');
 const bound=fixture();bound.groups(Array(1001).fill(bound.group));throws(bound.read,'radio_field_collection_truncated');
});
test('native getter checks bypass own metadata while malformed captions/labels/multiple selected fail closed',()=>{
 const f=fixture();for(const input of f.radios){Object.defineProperty(input,'checked',{get(){throw {code:'PRIVATE checked'};}});Object.defineProperty(input,'labels',{get(){throw {code:'PRIVATE labels'};}});}Object.defineProperty(f.labels[0],'control',{get(){throw {code:'PRIVATE control'};}});Object.defineProperty(f.leaves[0],'textContent',{get(){throw {code:'PRIVATE caption'};}});assert.equal(f.read().value,false);
 const multi=fixture();multi.meta.get(multi.radios[1]).checked=true;throws(multi.read,'radio_field_selection_ambiguous');
 const caption=fixture();caption.meta.get(caption.leaves[1]).text='PRIVATE UNKNOWN';throws(caption.read,'radio_field_binding_ambiguous');
 const label=fixture();label.meta.get(label.labels[1]).control=label.radios[0];throws(label.read,'radio_field_binding_ambiguous');
});
test('replaced question, label or option during click/wait refuses without retry or private output',async()=>{
 for(const how of ['question','label','option']){const f=fixture();f.onClick(target=>{f.radios.forEach(input=>f.meta.get(input).checked=input===target);
  if(how==='question'){const next=new f.Element();f.meta.get(next).text=pairs[0][1];f.header.children[0]=next;next.parentElement=f.header;}
  if(how==='label')f.meta.get(f.radios[1]).labels=[f.labels[0]];
  if(how==='option')f.meta.get(f.leaves[1]).text='PRIVATE';
 });await rejects(f.write(true),'document_lost');assert.deepEqual(f.actions,[1]);assert.equal(f.listeners.size,0);}
});
test('cancelled/stale/async context and private getters never leak or activate',async()=>{
 for(const how of ['abort','stale','async']){const f=fixture();if(how==='abort')f.abort.abort();if(how==='stale')f.stale();if(how==='async')f.ctx.assertCurrent=async()=>true;await rejects(f.write(true),how==='abort'?'cancelled':'document_lost');assert.equal(f.reads,0);assert.deepEqual(f.actions,[]);}
 const foreign=fixture();foreign.document.querySelectorAll=()=>{throw Object.defineProperty({},'code',{get(){throw Error('PRIVATE');}});};throws(foreign.read,'radio_field_dom_unavailable');
 const manual=fixture();manual.onClick(()=>manual.abort.abort());await rejects(manual.write(true),'cancelled');assert.deepEqual(manual.actions,[1]);assert.equal(manual.listeners.size,0);
});
test('controller composition treats explicit false as requested with an omitted dependent list and independent text',async()=>{
 const f=fixture({path:'personal.hasOtherNationalities',question:pairs[1][1],selected:1}),values=new Map(),lists=[];
 values.set('personal.otherNationalities',[]);
 const adapter={probe:()=>({supported:true}),observeImages:()=>({processing:false}),
  readField:(path,ctx)=>path==='personal.hasOtherNationalities'?readRadioField(path,{...f.ctx,...ctx,document:f.document}):{available:true,value:values.get(path)??''},
  writeField:(path,value,ctx)=>path==='personal.hasOtherNationalities'?writeRadioField(path,value,{...f.ctx,...ctx,document:f.document}):(values.set(path,value),{ok:true}),replaceList:(path,value)=>{lists.push(path);values.set(path,value);return {ok:true};}};
 const report=await createController(adapter,{fieldTimeoutMs:500}).start({runId:'radio',data:{personal:{hasOtherNationalities:false},contact:{phone:'123'}}});
 assert.equal(report.results.find(item=>item.path==='personal.hasOtherNationalities').status,'filled');assert.equal(f.read().value,false);assert.equal(values.get('contact.phone'),'123');assert.deepEqual(lists,[]);
});
