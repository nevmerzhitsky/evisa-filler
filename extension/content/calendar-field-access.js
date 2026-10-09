import {readCalendarField,writeCalendarField} from './calendar-access.js';

// Five supported full-date bindings; see docs/architecture.md.
// Native label/for identities and exact placeholders are runtime safety gates.
// Unknown captions are never read. DOB/mode switching is caller-owned elsewhere.
const bindings=Object.freeze(Object.fromEntries([
  ['passport.dateOfIssue','basic_hcNgayCapStr','Date of issue'],
  ['passport.dateOfExpiry','basic_hcGiaTriDenStr'],
  ['visa.validFrom','basic_nddnTtdtTuNgayStr'],['visa.validTo','basic_nddnTtdtDenNgayStr'],
  ['trip.intendedEntryDate','basic_ttcdThoiGianNcStr','Intended date of entry']
].map(([path,id,label=null])=>[path,Object.freeze({id,label})])));
export const CALENDAR_BINDINGS=bindings;
const issued=new WeakSet();
const fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const sanitize=error=>issued.has(error)?error:fail('calendar_date_dom_unavailable');
const helperCodes=new Set(['cancelled','document_lost','invalid_calendar_context','invalid_calendar_input',
  'calendar_native_unavailable','calendar_target_lost','calendar_structure_changed','calendar_value_unconfirmed',
  'invalid_canonical_date','calendar_dom_unavailable','calendar_write_failed','calendar_readback_mismatch',
  'invalid_date_context','invalid_date_input','native_date_accessor_unavailable','date_target_lost',
  'date_input_not_editable','date_timeout','unsupported_enter','date_event_creation_failed','date_event_dispatch_failed',
  'date_focus_failed','date_blur_failed','date_assignment_failed','date_readback_mismatch','date_clear_unavailable','date_dom_unavailable']);

/** Only five confirmed Full-date fields. Caller owns route/language/dependencies
 * through synchronous ctx.assertCurrent. Native ID/label/form identities remain
 * fixed throughout calendar-access's real date-transfer actions and waits.
 * Canonical ISO values or internal empty restoration; no DOB or mode switch,
 * framework access or rollback. Unknown captions are not read. Local DOM proof.
 */
function operation(path,ctx) {
  if(typeof path!=='string'||!Object.hasOwn(bindings,path))throw fail('unsupported_calendar_date_path');
  if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_calendar_date_context');
  const spec=bindings[path];
  function current(){
    if(ctx.signal?.aborted)throw fail('cancelled');
    try{const result=ctx.assertCurrent();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}if(result===false)throw null;}
    catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}
    if(ctx.signal?.aborted)throw fail('cancelled');
  }
  current();const doc=ctx.document??globalThis.document,realm=doc?.defaultView;
  if(!realm||['Element','HTMLElement','HTMLInputElement','HTMLLabelElement'].some(key=>typeof realm[key]!=='function'))throw fail('calendar_date_native_unavailable');
  const inputProto=realm.HTMLInputElement.prototype,labelProto=realm.HTMLLabelElement.prototype;
  const get=(proto,key)=>proto?Object.getOwnPropertyDescriptor(proto,key)?.get:undefined;
  const id=get(realm.Element.prototype,'id'),type=get(inputProto,'type'),placeholder=get(inputProto,'placeholder'),disabled=get(inputProto,'disabled'),
    labels=get(inputProto,'labels'),control=get(labelProto,'control'),htmlFor=get(labelProto,'htmlFor'),text=spec.label?get(realm.Node?.prototype,'textContent'):null;
  if([id,type,placeholder,disabled,labels,control,htmlFor,...(spec.label?[text]:[])].some(fn=>typeof fn!=='function'))throw fail('calendar_date_native_unavailable');
  const visible=node=>node.isConnected===true&&node.ownerDocument===doc&&node.getClientRects().length>0&&realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
  let initial=null;
  function resolve(){
    current();const identified=[...doc.querySelectorAll('[id]')];if(identified.length>1000)throw fail('calendar_date_collection_truncated');
    const candidates=identified.filter(node=>id.call(node)===spec.id);
    if(candidates.length!==1)throw fail('calendar_date_binding_ambiguous');const input=candidates[0];
    if(!(input instanceof realm.HTMLInputElement)||!visible(input)||type.call(input)!=='text'||placeholder.call(input)!=='DD/MM/YYYY'||disabled.call(input)||
      input.matches(':disabled')||input.getAttribute('aria-disabled')==='true'||input.getAttribute('role')==='combobox'||input.closest('.ant-select,.table-custom'))throw fail('calendar_date_target_unavailable');
    const formItem=input.closest('.ant-form-item');
    if(!(formItem instanceof realm.HTMLElement)||!visible(formItem)||formItem.parentElement?.closest('.ant-form-item')||formItem.querySelectorAll('.ant-form-item').length)throw fail('calendar_date_form_ambiguous');
    const associated=[...labels.call(input)],formLabels=[...formItem.querySelectorAll('.ant-form-item-label label')];
    if(associated.length!==1||formLabels.length!==1||associated[0]!==formLabels[0])throw fail('calendar_date_label_ambiguous');
    const label=associated[0];
    if(!(label instanceof realm.HTMLLabelElement)||!visible(label)||control.call(label)!==input||htmlFor.call(label)!==spec.id||
      label.closest('.ant-form-item')!==formItem||!formItem.contains(label)||label.querySelectorAll('input,textarea,select').length)throw fail('calendar_date_label_ambiguous');
    if(spec.label&&text.call(label).trim().replace(/\s+/g,' ').replace(/\s*\*$/,'').trim()!==spec.label)throw fail('calendar_date_caption_mismatch');
    if(initial&&[input,label,formItem].some((node,index)=>node!==initial[index]))throw fail('calendar_date_structure_changed');
    current();if(!initial)initial=[input,label,formItem];return input;
  }
  const input=resolve();
  return {input,guard:resolve,doc,spec};
}
function delegated(error){if(issued.has(error))return error;let code;try{code=error?.code;}catch{}return fail(helperCodes.has(code)?code:'calendar_date_access_failed');}
export function readCalendarDate(path,ctx){
  try{const op=operation(path,ctx);let result;
    try{result=readCalendarField(op.input,'date',{...ctx,document:op.doc,assertCurrent:op.guard});}catch(error){throw delegated(error);}
    op.guard();return {...result,label:op.spec.label};
  }catch(error){throw sanitize(error);}
}
export async function writeCalendarDate(path,value,ctx){
  try{const op=operation(path,ctx);
    try{await writeCalendarField(op.input,'date',value,{...ctx,document:op.doc,assertCurrent:op.guard});}catch(error){throw delegated(error);}
    op.guard();return {ok:true,label:op.spec.label};
  }catch(error){throw sanitize(error);}
}
