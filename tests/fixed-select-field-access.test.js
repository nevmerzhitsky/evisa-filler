import test from 'node:test';
import assert from 'node:assert/strict';
import {readFixedSelect,writeFixedSelect} from '../extension/content/fixed-select-field-access.js';
import {createController} from '../extension/content/controller.js';
const PRIVATE='PRIVATE@example.test';
const specs={
  'personal.sex':['basic_ttcnGioiTinh','Sex',['Male','Female'],true],
  'occupation.category':['basic_nnNgheNghiep','Occupation',['Businessman','Student','Employee','Official','Retired','Unemployed','Others'],true],
  'trip.purpose':['basic_ttcdMucDich','Purpose of entry',['Tourist','Visiting relatives','Working','Business','Other'],false],
  'expenses.payer':['basic_kpbhNguoiDamBao',null,['Personal','Company'],false],
  'expenses.hasInsurance':['basic_kpbhMuaBaoHiem',null,['Yes','No'],false],
  'expenses.paymentMethod':['basic_kpbhHinhThuc',null,['Cash','Credit card',"Traveller's cheques"],false]
};
function fixture(paths=['personal.sex']) {
  const doc={},meta=new WeakMap(),trace=[],controls=new Map(),abort=new AbortController(),listeners=new Set();let onMouse,onClick,reads=0,unknownReads=0;
  class EventTarget {
    dispatchEvent(event){trace.push(event.type);onMouse?.(event);const control=meta.get(this).controlOwner;if(control)setTimeout(()=>{control.open=true;},1);return true;}
  }
  class Element extends EventTarget {
    constructor(classes=''){super();meta.set(this,{id:'',classes:new Set(classes.split(' ').filter(Boolean)),text:'',attrs:{},hidden:false});this.children=[];this.parentElement=null;this.ownerDocument=doc;this.isConnected=true;}
    get id(){return meta.get(this).id;}
    get textContent(){if(this instanceof Label&&meta.get(this).unknown){unknownReads++;throw {code:PRIVATE};}return meta.get(this).text+this.children.map(node=>node.textContent).join('');}
    get childElementCount(){return this.children.length;}
    append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}return this;}
    matches(selector){return selector.split(',').some(part=>{
      if(part===':disabled')return meta.get(this).disabled===true;
      if(part==='[id]')return this.id!=='';
      if(part==='.ant-form-item-label label')return this instanceof Label&&Boolean(this.parentElement?.closest('.ant-form-item-label'));
      const attr=part.match(/\[([\w-]+)="([^"]+)"\]/);if(attr&&this.getAttribute(attr[1])!==attr[2])return false;
      const tag=part.match(/^(input|label|textarea|select)/)?.[1];if(tag&&!(tag==='input'&&this instanceof Input||tag==='label'&&this instanceof Label))return false;
      if(!tag&&!attr&&!part.startsWith('.'))return false;
      return [...part.matchAll(/\.([\w-]+)/g)].every(match=>meta.get(this).classes.has(match[1]));
    });}
    closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
    querySelectorAll(selector){reads++;const result=[];function walk(node){for(const child of node.children){if(child.matches(selector))result.push(child);walk(child);}}walk(this);return result;}
    contains(node){for(;node;node=node.parentElement)if(node===this)return true;return false;}
    getAttribute(key){if(['value','title','name'].includes(key))throw {code:PRIVATE};return meta.get(this).attrs[key]??null;}
    getClientRects(){return meta.get(this).hidden?[]:[{}];}
    click(){trace.push('native-click');onClick?.();const state=meta.get(this).optionOwner,caption=meta.get(this).text;if(state)setTimeout(()=>{state.selected=caption;state.open=false;},1);}
  }
  class Input extends Element {
    get type(){return meta.get(this).type;}get disabled(){return meta.get(this).disabled;}get readOnly(){return meta.get(this).readOnly;}get labels(){return meta.get(this).labels;}
    get value(){throw {code:PRIVATE};}
  }
  class Label extends Element {get control(){return meta.get(this).control;}get htmlFor(){return meta.get(this).htmlFor;}}
  doc.defaultView={Element,HTMLElement:Element,HTMLInputElement:Input,HTMLLabelElement:Label,Node:Element,EventTarget,
    MouseEvent:class {constructor(type,options){this.type=type;Object.assign(this,options);}},
    getComputedStyle(node){const state=meta.get(node).dropdownOwner;return {display:meta.get(node).hidden||state&&!state.open?'none':'block',visibility:'visible'};}};
  const page=new Element(); doc.querySelectorAll=selector=>page.querySelectorAll(selector);
  for(const path of paths) {
    const [id,caption,domain,readOnly]=specs[path];
    const state={selected:null,open:false};
    const form=new Element('ant-form-item'),box=new Element('ant-form-item-label'),label=new Label(),root=new Element('ant-select'),selector=new Element('ant-select-selector'),input=new Input(),display=new Element('ant-select-selection-item');
    const popupId=id+'_popup',dropdown=new Element('ant-select-dropdown'),list=new Element();
    const rows=domain.map(caption=>{const row=new Element('ant-select-item-option'),leaf=new Element('ant-select-item-option-content');meta.get(row).optionOwner=state;meta.get(row).text=caption;meta.get(leaf).text=caption;row.append(leaf);Object.defineProperty(row,'click',{value(){throw {code:PRIVATE};}});return row;});
    Object.assign(meta.get(input),{id,type:'search',disabled:false,readOnly,labels:[label],attrs:{role:'combobox','aria-controls':popupId,'aria-owns':popupId}});
    Object.assign(meta.get(label),{control:input,htmlFor:id,text:caption??PRIVATE,unknown:caption===null});
    Object.assign(meta.get(list),{id:popupId,attrs:{role:'listbox'}});meta.get(dropdown).dropdownOwner=state;meta.get(selector).controlOwner=state;
    Object.defineProperty(display,'textContent',{get(){return state.selected??'';}});
    form.append(box.append(label),root.append(selector.append(input,display))); dropdown.append(list,...rows);page.append(form,dropdown);
    controls.set(path,{state,input,label,box,form,root,selector,display,dropdown,list,rows});
  }
  const signal={get aborted(){return abort.signal.aborted;},addEventListener(type,fn,options){listeners.add(fn);abort.signal.addEventListener(type,fn,options);},removeEventListener(type,fn){listeners.delete(fn);abort.signal.removeEventListener(type,fn);}};
  const ctx={document:doc,signal,timeoutMs:35,pollMs:2,assertCurrent:()=>true};
  return {doc,ctx,page,controls,meta,trace,abort,listeners,Element,Input,Label,onMouse:fn=>{onMouse=fn;},onClick:fn=>{onClick=fn;},get reads(){return reads;},get unknownReads(){return unknownReads;}};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code&&error.message===code&&!JSON.stringify(error).includes(PRIVATE));
const throws=(fn,code)=>assert.throws(fn,error=>error.code===code&&error.message===code);

test('all observed fixed domains use real helper canonical displays including insurance false',async()=>{
  for(const path of Object.keys(specs).filter(path=>path!=='expenses.paymentMethod')) {
    for(const caption of specs[path][2]) {
      const f=fixture([path]),value=path==='expenses.hasInsurance'?caption==='Yes':caption.toUpperCase().replaceAll(' ','  ');
      assert.deepEqual(await writeFixedSelect(path,value,f.ctx),{ok:true,label:specs[path][1]});
      assert.equal(readFixedSelect(path,f.ctx).value,path==='expenses.hasInsurance'?caption==='Yes':caption);
      assert.deepEqual(f.trace,['mousedown','native-click']);assert.equal(f.unknownReads,0);assert.equal(f.listeners.size,0);
    }
  }
});
test('genuinely empty display is null and unrestorable without any clear action',async()=>{
  const f=fixture(['expenses.hasInsurance']);
  assert.deepEqual(readFixedSelect('expenses.hasInsurance',f.ctx),{available:true,value:null,restorable:false,label:null});
  for(const value of ['',null,0,'No'])await rejects(writeFixedSelect('expenses.hasInsurance',value,f.ctx),'invalid_fixed_select_value');
  assert.deepEqual(f.trace,[]);
  const g=fixture();await rejects(writeFixedSelect('personal.sex','',g.ctx),'unknown_fixed_select_choice');assert.equal(g.reads,0);
});
test('unknown dedicated selected caption is refused, numeric internal enum values are never guessed',async()=>{
  const f=fixture(['expenses.hasInsurance']);f.controls.get('expenses.hasInsurance').state.selected='2';
  throws(()=>readFixedSelect('expenses.hasInsurance',f.ctx),'unknown_fixed_select_choice');
  const g=fixture();g.controls.get('personal.sex').state.selected=PRIVATE;throws(()=>readFixedSelect('personal.sex',g.ctx),'unknown_fixed_select_choice');
  await rejects(writeFixedSelect('personal.sex',PRIVATE,g.ctx),'unknown_fixed_select_choice');assert.deepEqual(g.trace,[]);
});
test('payment domain comes only from the actual selected unchanged payer',async()=>{
  for(const payer of ['Personal','Company'])for(const value of payer==='Personal'?specs['expenses.paymentMethod'][2]:['Cash','Credit card']) {
    const f=fixture(['expenses.payer','expenses.paymentMethod']);f.controls.get('expenses.payer').state.selected=payer;
    await writeFixedSelect('expenses.paymentMethod',value.toUpperCase(),f.ctx);assert.equal(readFixedSelect('expenses.paymentMethod',f.ctx).value,value);
    assert.equal(f.controls.get('expenses.payer').state.selected,payer);assert.equal(f.unknownReads,0);
  }
  const f=fixture(['expenses.payer','expenses.paymentMethod']);f.controls.get('expenses.payer').state.selected='Company';
  await rejects(writeFixedSelect('expenses.paymentMethod',"Traveller's cheques",f.ctx),'unknown_fixed_select_choice');assert.deepEqual(f.trace,[]);
  f.controls.get('expenses.paymentMethod').state.selected="Traveller's cheques";throws(()=>readFixedSelect('expenses.paymentMethod',f.ctx),'unknown_fixed_select_choice');
});
test('unselected payer and missing conditional payment binding refuse without guessing or changing parent',async()=>{
  const f=fixture(['expenses.payer','expenses.paymentMethod']);await rejects(writeFixedSelect('expenses.paymentMethod','Cash',f.ctx),'fixed_select_dependency_unavailable');assert.deepEqual(f.trace,[]);
  const g=fixture(['expenses.payer']);g.controls.get('expenses.payer').state.selected='Personal';await rejects(writeFixedSelect('expenses.paymentMethod','Cash',g.ctx),'fixed_select_binding_ambiguous');assert.deepEqual(g.trace,[]);
});
test('native metadata aliases bypass instance getters and readonly comboboxes remain eligible',async()=>{
  const f=fixture(),c=f.controls.get('personal.sex');c.state.selected='Female';
  for(const key of ['type','readOnly','labels','value','name','title'])Object.defineProperty(c.input,key,{get(){throw {code:PRIVATE};}});
  for(const key of ['control','htmlFor'])Object.defineProperty(c.label,key,{get(){throw {code:PRIVATE};}});
  assert.equal(readFixedSelect('personal.sex',f.ctx).value,'Female');await writeFixedSelect('personal.sex','Male',f.ctx);assert.equal(readFixedSelect('personal.sex',f.ctx).value,'Male');
});
test('unique IDs include non-input aliases, strict native search and label identity',async()=>{
  const f=fixture(),c=f.controls.get('personal.sex'),alias=new f.Element();f.meta.get(alias).id=f.meta.get(c.input).id;f.page.append(alias);
  throws(()=>readFixedSelect('personal.sex',f.ctx),'fixed_select_binding_ambiguous');
  for(const patch of [{type:'text'},{disabled:true},{hidden:true}]) {const g=fixture();Object.assign(g.meta.get(g.controls.get('personal.sex').input),patch);await rejects(writeFixedSelect('personal.sex','Female',g.ctx),'fixed_select_target_unavailable');assert.deepEqual(g.trace,[]);}
  for(const patch of [{htmlFor:'wrong'},{control:null}]) {const g=fixture();Object.assign(g.meta.get(g.controls.get('personal.sex').label),patch);throws(()=>readFixedSelect('personal.sex',g.ctx),'fixed_select_label_ambiguous');}
});
test('known captions must match; unknown captions remain unread',()=>{
  const f=fixture();f.meta.get(f.controls.get('personal.sex').label).text='Other';throws(()=>readFixedSelect('personal.sex',f.ctx),'fixed_select_caption_mismatch');
  for(const path of ['expenses.payer','expenses.hasInsurance']) {const g=fixture([path]);g.controls.get(path).state.selected=specs[path][2][0];readFixedSelect(path,g.ctx);assert.equal(g.unknownReads,0);}
});
test('label and root replacement during mousedown or click prevents stale post-actions',async()=>{
  const f=fixture(),c=f.controls.get('personal.sex');f.onMouse(()=>{const fresh=new f.Label();Object.assign(f.meta.get(fresh),f.meta.get(c.label));fresh.parentElement=c.box;c.box.children=[fresh];f.meta.get(c.input).labels=[fresh];});
  await rejects(writeFixedSelect('personal.sex','Female',f.ctx),'document_lost');assert.deepEqual(f.trace,['mousedown']);
  const g=fixture(),d=g.controls.get('personal.sex');g.onClick(()=>{const fresh=new g.Element('ant-select-selector');fresh.append(d.input,d.display);d.root.children=[fresh];fresh.parentElement=d.root;});
  await rejects(writeFixedSelect('personal.sex','Female',g.ctx),'document_lost');assert.deepEqual(g.trace,['mousedown','native-click']);
});
test('payer rewrite while child popup opens blocks selecting a now invalid domain',async()=>{
  const f=fixture(['expenses.payer','expenses.paymentMethod']);f.controls.get('expenses.payer').state.selected='Personal';
  f.onMouse(()=>{f.controls.get('expenses.payer').state.selected='Company';});
  await rejects(writeFixedSelect('expenses.paymentMethod',"Traveller's cheques",f.ctx),'document_lost');assert.deepEqual(f.trace,['mousedown']);
});
test('cancellation during opening and delayed stability leaves no further click or retry',async()=>{
  const f=fixture();f.onMouse(()=>f.abort.abort());await rejects(writeFixedSelect('personal.sex','Female',f.ctx),'cancelled');assert.deepEqual(f.trace,['mousedown']);
  const g=fixture();g.onClick(()=>setTimeout(()=>g.abort.abort(),5));await rejects(writeFixedSelect('personal.sex','Female',g.ctx),'cancelled');assert.deepEqual(g.trace,['mousedown','native-click']);assert.equal(g.listeners.size,0);
});
test('delayed selected-caption drift is visible and private getter errors are sanitized',async()=>{
  const f=fixture();f.onClick(()=>setTimeout(()=>{f.controls.get('personal.sex').state.selected='Male';},15));await rejects(writeFixedSelect('personal.sex','Female',f.ctx),'selected_display_changed');
  const g=fixture();g.doc.querySelectorAll=()=>{throw {get code(){throw Error(PRIVATE);}};};throws(()=>readFixedSelect('personal.sex',g.ctx),'fixed_select_dom_unavailable');
});
test('unsupported dynamic selects and legal checkboxes cannot receive fixed writes',async()=>{
  const f=fixture();for(const path of ['personal.nationality','trip.province','legal.confirmation'])await rejects(writeFixedSelect(path,'Yes',f.ctx),'unsupported_fixed_select_path');assert.equal(f.reads,0);assert.deepEqual(f.trace,[]);
});
test('controller composition preserves insurance false and never clears an absent empty select',async()=>{
  const f=fixture(['expenses.hasInsurance','expenses.payer','expenses.paymentMethod']);
  const adapter={probe:()=>({supported:true}),observeImages:()=>({processing:false}),observeDialog:()=>false,dispose(){},
    readField(path,ctx){if(Object.hasOwn(specs,path))return readFixedSelect(path,{...f.ctx,...ctx,document:f.doc});return {available:false};},
    writeField(path,value,ctx){return writeFixedSelect(path,value,{...f.ctx,...ctx,document:f.doc});}}
  const controller=createController(adapter,{fieldTimeoutMs:2000});
  const report=await controller.start({runId:'one',data:{expenses:{hasInsurance:false}}});
  assert.equal(report.results.find(item=>item.path==='expenses.hasInsurance').status,'filled');assert.equal(f.controls.get('expenses.hasInsurance').state.selected,'No');
  assert.equal(f.controls.get('expenses.payer').state.selected,null);assert.equal(f.controls.get('expenses.paymentMethod').state.selected,null);
  const second=await controller.start({runId:'two',data:{expenses:{payer:'Personal'}}});
  assert.equal(second.results.find(item=>item.path==='expenses.paymentMethod').status,'skipped_empty');
  assert.equal(f.controls.get('expenses.paymentMethod').state.selected,null);assert.deepEqual(f.trace,['mousedown','native-click','mousedown','native-click']);
});
