import {setTextField} from './text-transfer.js';

// Two supported native type=text/maxLength20 bindings; see docs/architecture.md.
// Both bindings use native identity rather than an expected caption.
const bindings=Object.freeze({'trip.durationDays':Object.freeze({id:'basic_ttcdSoNgayTamTru',maxLength:20,label:null}),'expenses.estimatedAmount':Object.freeze({id:'basic_kpbhDuTinh',maxLength:20,label:null})});
export const NUMERIC_BINDINGS=bindings;
const issued=new WeakSet();
const fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const sanitize=error=>issued.has(error)?error:fail('numeric_field_dom_unavailable');
const helperCodes=new Set(['cancelled','document_lost','invalid_text_input','native_text_accessor_unavailable','text_input_unavailable',
  'text_assignment_failed','text_event_creation_failed','text_event_dispatch_failed','text_readback_mismatch']);

/** Canonical numeric access for the two observed native text inputs.
 * ctx={document?,signal?,assertCurrent,stableMs?}; freshness is
 * synchronous, caller-owned route/language/dependencies. Missing/unsafe bindings
 * throw static errors; the adapter decides availability/report translation.
 * Unknown labels are never read. Values remain in caller/controller RAM.
 * Writes expand Number's shortest representation into exact plain decimals,
 * including -0 and internal empty restoration, and use
 * only text-transfer's native setter + input/change, with delayed DOM readback.
 * No focus/blur, rollback or field-validation/server-acceptance claim.
 * Duration has no codec maximum90 or safe-integer restriction. Native assignment
 * of91 does not establish acceptance by the site's separate validation rules.
 */
function operation(path,ctx) {
  if(typeof path!=='string'||!Object.hasOwn(bindings,path))throw fail('unsupported_numeric_field_path');
  if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_numeric_field_context');
  const spec=bindings[path];
  function current(){
    if(ctx.signal?.aborted)throw fail('cancelled');
    try{const result=ctx.assertCurrent();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}if(result===false)throw null;}
    catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}
    if(ctx.signal?.aborted)throw fail('cancelled');
  }
  current();const doc=ctx.document??globalThis.document,realm=doc?.defaultView;
  if(!realm||['Element','HTMLElement','HTMLInputElement','HTMLLabelElement'].some(key=>typeof realm[key]!=='function'))throw fail('numeric_field_native_unavailable');
  const inputProto=realm.HTMLInputElement.prototype,labelProto=realm.HTMLLabelElement.prototype;
  const get=(proto,key)=>proto?Object.getOwnPropertyDescriptor(proto,key)?.get:undefined;
  const id=get(realm.Element.prototype,'id'),type=get(inputProto,'type'),maxLength=get(inputProto,'maxLength'),disabled=get(inputProto,'disabled'),readOnly=get(inputProto,'readOnly'),
    labels=get(inputProto,'labels'),value=get(inputProto,'value'),control=get(labelProto,'control'),htmlFor=get(labelProto,'htmlFor'),text=spec.label?get(realm.Node?.prototype,'textContent'):null;
  if([id,type,maxLength,disabled,readOnly,labels,value,control,htmlFor,...(spec.label?[text]:[])].some(fn=>typeof fn!=='function'))throw fail('numeric_field_native_unavailable');
  const visible=node=>node.isConnected===true&&node.ownerDocument===doc&&node.getClientRects().length>0&&realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
  let initial=null;
  function resolve(){
    current();const identified=[...doc.querySelectorAll('[id]')];if(identified.length>1000)throw fail('numeric_field_collection_truncated');
    const candidates=identified.filter(node=>id.call(node)===spec.id);
    if(candidates.length!==1)throw fail('numeric_field_binding_ambiguous');const input=candidates[0];
    if(!(input instanceof realm.HTMLInputElement)||!visible(input)||type.call(input)!=='text'||maxLength.call(input)!==spec.maxLength||disabled.call(input)||readOnly.call(input)||
      input.matches(':disabled')||input.getAttribute('aria-disabled')==='true'||input.getAttribute('role')==='combobox'||input.closest('.ant-picker,.ant-select,.table-custom'))throw fail('numeric_field_target_unavailable');
    const formItem=input.closest('.ant-form-item');
    if(!(formItem instanceof realm.HTMLElement)||!visible(formItem)||formItem.parentElement?.closest('.ant-form-item')||formItem.querySelectorAll('.ant-form-item').length)throw fail('numeric_field_form_ambiguous');
    const associated=[...labels.call(input)],formLabels=[...formItem.querySelectorAll('.ant-form-item-label label')];
    if(associated.length!==1||formLabels.length!==1||associated[0]!==formLabels[0])throw fail('numeric_field_label_ambiguous');
    const label=associated[0];
    if(!(label instanceof realm.HTMLLabelElement)||!visible(label)||control.call(label)!==input||htmlFor.call(label)!==spec.id||
      label.closest('.ant-form-item')!==formItem||!formItem.contains(label)||label.querySelectorAll('input,textarea,select').length)throw fail('numeric_field_label_ambiguous');
    if(spec.label&&text.call(label).trim().replace(/\s+/g,' ').replace(/\s*\*$/,'').trim()!==spec.label)throw fail('numeric_field_caption_mismatch');
    if(initial&&[input,label,formItem].some((node,index)=>node!==initial[index]))throw fail('numeric_field_structure_changed');
    current();if(!initial)initial=[input,label,formItem];return input;
  }
  const input=resolve();
  const read=()=>{const target=resolve(),result=value.call(target);current();if(typeof result!=='string')throw fail('numeric_field_read_unconfirmed');resolve();return result;};
  return {input,read,guard:resolve,doc,spec,current};
}

function encode(path,value) {
  if(!Object.hasOwn(bindings,path))throw fail('unsupported_numeric_field_path');
  if(value==='')return '';
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||path==='trip.durationDays'&&(!Number.isInteger(value)||value<=0))throw fail('invalid_numeric_value');
  let result=Object.is(value,-0)?'-0':String(value);
  if(result.includes('e')) {
    const [mantissa,exponent]=result.split('e');
    const [whole,fraction='']=mantissa.split('.');
    const digits=whole+fraction,point=whole.length+Number(exponent);
    result=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
  }
  if(result.length>20||!Object.is(Number(result),value))throw fail('numeric_value_unrepresentable');
  return result;
}
// Leading zeros and trailing fractional zeros are formatting only. Every other
// digit must roundtrip exactly through Number's canonical decimal representation.
function normalizedDecimal(text) {
  if(text==='-0')return text;
  const [whole,fraction='']=text.split('.');
  const integral=whole.replace(/^0+(?=\d)/,'');
  const tail=fraction.replace(/0+$/,'');
  return integral+(tail?'.'+tail:'');
}
function decode(path,text) {
  if(text==='')return '';
  if(typeof text!=='string'||!(path==='trip.durationDays'?/^\d+$/:/^(?:\d+(?:\.\d+)?|-0)$/).test(text))throw fail('numeric_read_unconfirmed');
  const value=Number(text);
  let encoded;
  try {encoded=encode(path,value);}catch{throw fail('numeric_read_unconfirmed');}
  if(text.length>20||normalizedDecimal(text)!==normalizedDecimal(encoded))throw fail('numeric_read_unconfirmed');
  return value;
}

export function readNumericField(path,ctx){
  try{const op=operation(path,ctx);return {available:true,value:decode(path,op.read()),label:op.spec.label};}catch(error){throw sanitize(error);}
}

export async function writeNumericField(path,value,ctx){
  try{
    const encoded=encode(path,value);
    const op=operation(path,ctx);
    // One bounded stability wait; the controller owns the operation deadline.
    const stableMs=ctx.stableMs??60;
    if(!Number.isFinite(stableMs)||stableMs<=0||stableMs>3000)throw fail('invalid_numeric_field_context');
    try{setTextField(op.input,encoded,{document:op.doc,signal:ctx.signal,assertCurrent:op.guard});}
    catch(error){if(issued.has(error))throw error;let code;try{code=error?.code;}catch{}throw fail(helperCodes.has(code)?code:'numeric_field_write_failed');}
    if(!Object.is(decode(path,op.read()),value))throw fail('numeric_field_readback_mismatch');
    await new Promise((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);reject(fail('cancelled'));};
      const timer=setTimeout(()=>{ctx.signal?.removeEventListener('abort',abort);resolve();},stableMs);
      ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)abort();
    });
    if(!Object.is(decode(path,op.read()),value))throw fail('numeric_field_readback_mismatch');return {ok:true,label:op.spec.label};
  }catch(error){throw sanitize(error);}
}
