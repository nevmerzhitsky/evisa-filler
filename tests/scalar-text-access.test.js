import test from 'node:test';
import assert from 'node:assert/strict';
import {readScalarText,writeScalarText} from '../extension/content/scalar-text-access.js';
const PRIVATE='PRIVATE@example.test';
function fixture({id='basic_ttllSdt',maxLength=50,caption=null}={}){
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

test('unknown caption access uses native value/labels/control only; exact strings and empty restoration are preserved',async()=>{
  const f=fixture();Object.defineProperty(f.input,'value',{get(){throw {code:PRIVATE};},set(){throw {code:PRIVATE};}});
  Object.defineProperty(f.input,'labels',{get(){throw {code:PRIVATE};}});Object.defineProperty(f.label,'control',{get(){throw {code:PRIVATE};}});
  assert.deepEqual(readScalarText('contact.phone',f.ctx),{available:true,value:'old',label:null});
  assert.deepEqual(await writeScalarText('contact.phone',' '+PRIVATE+' ',f.ctx),{ok:true,label:null});
  assert.equal(readScalarText('contact.phone',f.ctx).value,' '+PRIVATE+' ');await writeScalarText('contact.phone','',f.ctx);
  assert.equal(readScalarText('contact.phone',f.ctx).value,'');assert.equal(f.captionReads,0);assert.deepEqual(f.trace,['setter','input','change','setter','input','change']);assert.equal(f.listeners.size,0);
});

test('five known dedicated labels normalize whitespace and explicit child required marker only',()=>{
  for(const [path,id,maxLength,caption]of [['personal.email','basic_ttcnEmail',100,'Email'],['personal.confirmEmail','basic_ttcnConfirmEmail',100,'Re-enter Email'],
    ['personal.religion','basic_ttcnTonGiao',50,'Religion'],['personal.placeOfBirth','basic_ttcnNoiSinh',255,'Place of birth'],['contact.mailingAddress','basic_ttllDcLienHe',255,'Contact address']]){
    const f=fixture({id,maxLength,caption:' '+caption.replaceAll(' ','  ')+' '});const marker=new f.Element();f.meta.get(marker).text='*';f.label.append(marker);
    assert.equal(readScalarText(path,f.ctx).label,caption);assert.ok(f.captionReads>0);
    f.meta.get(f.label).text='PRIVATE WRONG CAPTION';throws(()=>readScalarText(path,f.ctx),'scalar_text_caption_mismatch');
  }
});

test('all seventeen observed unknown captions remain unread with exact native binding',()=>{
  for(const [path,id,maxLength]of [['personal.surname','basic_ttcnHo',50],['personal.givenNames','basic_ttcnDemVaTen',50],
    ['personal.identityNumber','basic_ttcnCccd',20],['passport.number','basic_hcSo',20],['passport.placeOfIssue','basic_hcNoiCap',100],
    ['contact.permanentAddress','basic_ttllDcThuongTru',255],['contact.phone','basic_ttllSdt',50],['contact.emergency.name','basic_ttllLlHoTen',100],
    ['contact.emergency.address','basic_ttllLlNoiOHienTai',255],['contact.emergency.phone','basic_ttllLlSdt',50],['contact.emergency.relationship','basic_ttllLlQuanHe',50],
    ['occupation.description','basic_nnNgheNghiepHienTai',50],['occupation.organization','basic_nnTenCtyCq',100],['occupation.position','basic_nnChucVu',50],
    ['occupation.address','basic_nnDiaChi',255],['occupation.phone','basic_nnSdt',50],['trip.phone','basic_ttcdSdt',50]]){
    const f=fixture({id,maxLength});assert.deepEqual(readScalarText(path,f.ctx),{available:true,value:'old',label:null});assert.equal(f.captionReads,0);
  }
});

test('unsupported search/numeric paths and overlong/nonstring values cannot write',async()=>{
  for(const path of ['trip.address','trip.durationDays','expenses.estimatedAmount']){
    const f=fixture();await rejects(writeScalarText(path,'x',f.ctx),'unsupported_scalar_text_path');assert.equal(f.reads,0);assert.deepEqual(f.trace,[]);}
  const f=fixture();await rejects(writeScalarText('contact.phone','x'.repeat(51),f.ctx),'scalar_text_too_long');await rejects(writeScalarText('contact.phone',123,f.ctx),'invalid_scalar_text_value');assert.deepEqual(f.trace,[]);
});
test('six conditional source bindings confirm native IDs and lengths without reading unknown captions',async()=>{
  for(const [path,id,maxLength] of [['passport.typeDetails','basic_hcGhiCuThe',100],['trip.purposeDetails','basic_ttcdMucDichCuThe',255],
    ['expenses.insuranceDetails','basic_kpbhGhiCuThe',255],['expenses.sponsor.name','basic_kpbhCongTyTen',100],
    ['expenses.sponsor.address','basic_kpbhCongTyDiaChi',255],['expenses.sponsor.phone','basic_kpbhCongTySdt',50]]){
    const f=fixture({id,maxLength});await writeScalarText(path,'Example',f.ctx);
    assert.equal(readScalarText(path,f.ctx).value,'Example');assert.equal(f.captionReads,0);
  }
});

test('duplicate ID on a non-input, bounded collection and wrong realm refuse',()=>{
  const duplicate=fixture(),other=new duplicate.Element();duplicate.meta.get(other).id=duplicate.input.id;duplicate.identify([duplicate.input,other]);throws(()=>readScalarText('contact.phone',duplicate.ctx),'scalar_text_binding_ambiguous');
  const bounded=fixture();bounded.identify(Array.from({length:1001},()=>new bounded.Element()));throws(()=>readScalarText('contact.phone',bounded.ctx),'scalar_text_collection_truncated');
  const realm=fixture();Object.setPrototypeOf(realm.input,realm.Element.prototype);throws(()=>readScalarText('contact.phone',realm.ctx),'scalar_text_target_unavailable');
});

test('changed native type/maxlength, disabled/readonly, hidden, picker and combobox refuse',()=>{
  for(const patch of [{type:'email'},{maxLength:49},{disabled:true},{readOnly:true},{hidden:true},{role:'combobox'}]){
    const f=fixture();Object.assign(f.meta.get(f.input),patch);throws(()=>readScalarText('contact.phone',f.ctx),'scalar_text_target_unavailable');}
  const f=fixture();f.meta.get(f.form).classes.add('ant-picker');throws(()=>readScalarText('contact.phone',f.ctx),'scalar_text_target_unavailable');
});

test('native for/control and unique owned form label must agree, with no surrounding prose reads',()=>{
  for(const patch of [{htmlFor:'different'},{control:null}]){const f=fixture();Object.assign(f.meta.get(f.label),patch);throws(()=>readScalarText('contact.phone',f.ctx),'scalar_text_label_ambiguous');}
  const multiple=fixture();multiple.meta.get(multiple.input).labels=[multiple.label,multiple.label];throws(()=>readScalarText('contact.phone',multiple.ctx),'scalar_text_label_ambiguous');
  const nested=fixture();new nested.Element('ant-form-item').append(nested.form);throws(()=>readScalarText('contact.phone',nested.ctx),'scalar_text_form_ambiguous');
  const foreign=fixture();foreign.label.ownerDocument={};throws(()=>readScalarText('contact.phone',foreign.ctx),'scalar_text_label_ambiguous');
});

test('label or node replacement during native setter/input prevents subsequent events',async()=>{
  for(const stage of ['setter','input']){
    const f=fixture(),replace=()=>{const fresh=new f.Label();Object.assign(f.meta.get(fresh),f.meta.get(f.label));f.labelBox.children=[fresh];fresh.parentElement=f.labelBox;f.meta.get(f.input).labels=[fresh];};
    if(stage==='setter')f.afterSet(replace);else f.onEvent(event=>{if(event.type==='input')replace();});
    await rejects(writeScalarText('contact.phone',PRIVATE,f.ctx),'document_lost');assert.deepEqual(f.trace,stage==='setter'?['setter']:['setter','input']);
  }
  const node=fixture();node.onEvent(event=>{if(event.type==='input'){const fresh=new node.Input();Object.assign(node.meta.get(fresh),node.meta.get(node.input));fresh.parentElement=node.form;node.identify([fresh]);}});
  await rejects(writeScalarText('contact.phone',PRIVATE,node.ctx),'document_lost');assert.deepEqual(node.trace,['setter','input']);
});

test('delayed site overwrite is detected without retry/rollback; cancellation frees delayed wait',async()=>{
  const overwrite=fixture();overwrite.onEvent(event=>{if(event.type==='change')setTimeout(()=>{overwrite.meta.get(overwrite.input).value='PRIVATE SITE';},1);});
  await rejects(writeScalarText('contact.phone',PRIVATE,overwrite.ctx),'scalar_text_readback_mismatch');assert.deepEqual(overwrite.trace,['setter','input','change']);
  const cancel=fixture(),pending=writeScalarText('contact.phone',PRIVATE,cancel.ctx);cancel.abort.abort();await rejects(pending,'cancelled');assert.equal(cancel.listeners.size,0);assert.deepEqual(cancel.trace,['setter','input','change']);
  const during=fixture();during.afterSet(()=>during.abort.abort());await rejects(writeScalarText('contact.phone',PRIVATE,during.ctx),'cancelled');assert.deepEqual(during.trace,['setter']);
});

test('cancelled/stale/async guards run before DOM and foreign errors never expose code/message/label',async()=>{
  for(const mode of ['cancelled','stale','async']){const f=fixture();if(mode==='cancelled')f.abort.abort();else if(mode==='stale')f.stale();else f.ctx.assertCurrent=async()=>true;
    throws(()=>readScalarText('contact.phone',f.ctx),mode==='cancelled'?'cancelled':'document_lost');assert.equal(f.reads,0);}
  const foreign=fixture();foreign.doc.querySelectorAll=()=>{throw {get code(){throw Error(PRIVATE);}};};throws(()=>readScalarText('contact.phone',foreign.ctx),'scalar_text_dom_unavailable');
  const event=fixture();event.onEvent(()=>{throw {code:PRIVATE};});await rejects(writeScalarText('contact.phone',PRIVATE,event.ctx),'text_event_dispatch_failed');assert.equal(event.captionReads,0);
});
