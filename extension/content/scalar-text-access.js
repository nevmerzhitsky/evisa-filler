import {setTextField} from './text-transfer.js';

// Supported IDs/type=text/maxLength and captions; see docs/architecture.md.
// Conditional fields are accepted only when their native binding is confirmed.
// Numeric/search fields use separate accessors. Native label/for checks are gates,
// not claims that those identities were exported by the passive probes.
const bindings=Object.freeze(Object.fromEntries([
  ['personal.surname','basic_ttcnHo',50],['personal.givenNames','basic_ttcnDemVaTen',50],
  ['personal.identityNumber','basic_ttcnCccd',20],['personal.email','basic_ttcnEmail',100,'Email'],
  ['personal.confirmEmail','basic_ttcnConfirmEmail',100,'Re-enter Email'],['personal.religion','basic_ttcnTonGiao',50,'Religion'],
  ['personal.placeOfBirth','basic_ttcnNoiSinh',255,'Place of birth'],['passport.number','basic_hcSo',20],
  ['passport.placeOfIssue','basic_hcNoiCap',100],['contact.permanentAddress','basic_ttllDcThuongTru',255],
  ['contact.mailingAddress','basic_ttllDcLienHe',255,'Contact address'],['contact.phone','basic_ttllSdt',50],
  ['contact.emergency.name','basic_ttllLlHoTen',100],['contact.emergency.address','basic_ttllLlNoiOHienTai',255],
  ['contact.emergency.phone','basic_ttllLlSdt',50],['contact.emergency.relationship','basic_ttllLlQuanHe',50],
  ['occupation.description','basic_nnNgheNghiepHienTai',50],['occupation.organization','basic_nnTenCtyCq',100],
  ['occupation.position','basic_nnChucVu',50],['occupation.address','basic_nnDiaChi',255],
  ['occupation.phone','basic_nnSdt',50],['trip.phone','basic_ttcdSdt',50],
  ['passport.typeDetails','basic_hcGhiCuThe',100],['trip.purposeDetails','basic_ttcdMucDichCuThe',255],
  ['expenses.insuranceDetails','basic_kpbhGhiCuThe',255],['expenses.sponsor.name','basic_kpbhCongTyTen',100],
  ['expenses.sponsor.address','basic_kpbhCongTyDiaChi',255],['expenses.sponsor.phone','basic_kpbhCongTySdt',50]
].map(([path,id,maxLength,label=null])=>[path,Object.freeze({id,maxLength,label})])));
export const SCALAR_BINDINGS=bindings;
const issued=new WeakSet();
const fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const sanitize=error=>issued.has(error)?error:fail('scalar_text_dom_unavailable');
const helperCodes=new Set(['cancelled','document_lost','invalid_text_input','native_text_accessor_unavailable','text_input_unavailable',
  'text_assignment_failed','text_event_creation_failed','text_event_dispatch_failed','text_readback_mismatch']);

/** Canonical scalar access for observed text inputs and six conditional bindings.
 * ctx={document?,signal?,assertCurrent,stableMs?}; freshness is
 * synchronous, caller-owned route/language/dependencies. Missing/unsafe bindings
 * throw static errors; the adapter decides availability/report translation.
 * Unknown labels are never read. Values remain in caller/controller RAM.
 * Writes preserve exact strings, including internal empty restoration, and use
 * only text-transfer's native setter + input/change, with delayed DOM readback.
 * No focus/blur, rollback, numeric conversion or site-store acceptance claim.
 */
function operation(path,ctx) {
  if(typeof path!=='string'||!Object.hasOwn(bindings,path))throw fail('unsupported_scalar_text_path');
  if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_scalar_text_context');
  const spec=bindings[path];
  function current(){
    if(ctx.signal?.aborted)throw fail('cancelled');
    try{const result=ctx.assertCurrent();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}if(result===false)throw null;}
    catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}
    if(ctx.signal?.aborted)throw fail('cancelled');
  }
  current();const doc=ctx.document??globalThis.document,realm=doc?.defaultView;
  if(!realm||['Element','HTMLElement','HTMLInputElement','HTMLLabelElement'].some(key=>typeof realm[key]!=='function'))throw fail('scalar_text_native_unavailable');
  const inputProto=realm.HTMLInputElement.prototype,labelProto=realm.HTMLLabelElement.prototype;
  const get=(proto,key)=>proto?Object.getOwnPropertyDescriptor(proto,key)?.get:undefined;
  const id=get(realm.Element.prototype,'id'),type=get(inputProto,'type'),maxLength=get(inputProto,'maxLength'),disabled=get(inputProto,'disabled'),readOnly=get(inputProto,'readOnly'),
    labels=get(inputProto,'labels'),value=get(inputProto,'value'),control=get(labelProto,'control'),htmlFor=get(labelProto,'htmlFor'),text=spec.label?get(realm.Node?.prototype,'textContent'):null;
  if([id,type,maxLength,disabled,readOnly,labels,value,control,htmlFor,...(spec.label?[text]:[])].some(fn=>typeof fn!=='function'))throw fail('scalar_text_native_unavailable');
  const visible=node=>node.isConnected===true&&node.ownerDocument===doc&&node.getClientRects().length>0&&realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
  let initial=null;
  function resolve(){
    current();const identified=[...doc.querySelectorAll('[id]')];if(identified.length>1000)throw fail('scalar_text_collection_truncated');
    const candidates=identified.filter(node=>id.call(node)===spec.id);
    if(candidates.length!==1)throw fail('scalar_text_binding_ambiguous');const input=candidates[0];
    if(!(input instanceof realm.HTMLInputElement)||!visible(input)||type.call(input)!=='text'||maxLength.call(input)!==spec.maxLength||disabled.call(input)||readOnly.call(input)||
      input.matches(':disabled')||input.getAttribute('aria-disabled')==='true'||input.getAttribute('role')==='combobox'||input.closest('.ant-picker,.ant-select,.table-custom'))throw fail('scalar_text_target_unavailable');
    const formItem=input.closest('.ant-form-item');
    if(!(formItem instanceof realm.HTMLElement)||!visible(formItem)||formItem.parentElement?.closest('.ant-form-item')||formItem.querySelectorAll('.ant-form-item').length)throw fail('scalar_text_form_ambiguous');
    const associated=[...labels.call(input)],formLabels=[...formItem.querySelectorAll('.ant-form-item-label label')];
    if(associated.length!==1||formLabels.length!==1||associated[0]!==formLabels[0])throw fail('scalar_text_label_ambiguous');
    const label=associated[0];
    if(!(label instanceof realm.HTMLLabelElement)||!visible(label)||control.call(label)!==input||htmlFor.call(label)!==spec.id||
      label.closest('.ant-form-item')!==formItem||!formItem.contains(label)||label.querySelectorAll('input,textarea,select').length)throw fail('scalar_text_label_ambiguous');
    if(spec.label&&text.call(label).trim().replace(/\s+/g,' ').replace(/\s*\*$/,'').trim()!==spec.label)throw fail('scalar_text_caption_mismatch');
    if(initial&&[input,label,formItem].some((node,index)=>node!==initial[index]))throw fail('scalar_text_structure_changed');
    current();if(!initial)initial=[input,label,formItem];return input;
  }
  const input=resolve();
  const read=()=>{const target=resolve(),result=value.call(target);current();if(typeof result!=='string')throw fail('scalar_text_read_unconfirmed');resolve();return result;};
  return {input,read,guard:resolve,doc,spec,current};
}

export function readScalarText(path,ctx){
  try{const op=operation(path,ctx);return {available:true,value:op.read(),label:op.spec.label};}catch(error){throw sanitize(error);}
}

export async function writeScalarText(path,value,ctx){
  try{
    if(typeof value!=='string')throw fail('invalid_scalar_text_value');
    const op=operation(path,ctx);if(value.length>op.spec.maxLength)throw fail('scalar_text_too_long');
    // One bounded stability wait; the controller owns the operation deadline.
    const stableMs=ctx.stableMs??60;
    if(!Number.isFinite(stableMs)||stableMs<=0||stableMs>3000)throw fail('invalid_scalar_text_context');
    try{setTextField(op.input,value,{document:op.doc,signal:ctx.signal,assertCurrent:op.guard});}
    catch(error){if(issued.has(error))throw error;let code;try{code=error?.code;}catch{}throw fail(helperCodes.has(code)?code:'scalar_text_write_failed');}
    if(op.read()!==value)throw fail('scalar_text_readback_mismatch');
    await new Promise((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);reject(fail('cancelled'));};
      const timer=setTimeout(()=>{ctx.signal?.removeEventListener('abort',abort);resolve();},stableMs);
      ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)abort();
    });
    if(op.read()!==value)throw fail('scalar_text_readback_mismatch');return {ok:true,label:op.spec.label};
  }catch(error){throw sanitize(error);}
}
