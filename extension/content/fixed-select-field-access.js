import {readSingleSelect,selectSingleOption} from './single-select.js';

// Supported native search/combobox bindings. Conditional payment fields must
// pass the same DOM guards. Expected captions are checked for Sex, Occupation
// and Purpose of entry.
const bindings=Object.freeze({
  'personal.sex':{id:'basic_ttcnGioiTinh',label:'Sex',domain:['Male','Female']},
  'occupation.category':{id:'basic_nnNgheNghiep',label:'Occupation',domain:['Businessman','Student','Employee','Official','Retired','Unemployed','Others']},
  'trip.purpose':{id:'basic_ttcdMucDich',label:'Purpose of entry',domain:['Tourist','Visiting relatives','Working','Business','Other']},
  'expenses.payer':{id:'basic_kpbhNguoiDamBao',label:null,domain:['Personal','Company']},
  'expenses.hasInsurance':{id:'basic_kpbhMuaBaoHiem',label:null,domain:['Yes','No']},
  'expenses.paymentMethod':{id:'basic_kpbhHinhThuc',label:null,domain:['Cash','Credit card',"Traveller's cheques"]}
});
const issued=new WeakSet();
const fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const sanitize=error=>issued.has(error)?error:fail('fixed_select_dom_unavailable');
const helperCodes=new Set(['cancelled','document_lost','invalid_select_context','invalid_select_input','select_target_lost','selected_display_ambiguous','select_dom_unavailable','popup_ambiguous','options_truncated','option_ambiguous','option_disabled','invalid_select_caption','select_event_unavailable','selected_display_changed','select_open_failed','option_not_rendered','option_changed','select_click_failed','select_result_timeout']);
const normalize=value=>value.trim().replace(/\s+/g,' ').toLowerCase();
function specFor(path) {
  if(typeof path!=='string'||!Object.hasOwn(bindings,path))throw fail('unsupported_fixed_select_path');
  return bindings[path];
}
function canonical(spec,value) {
  if(typeof value!=='string')throw fail('invalid_fixed_select_value');
  const found=spec.domain.find(item=>normalize(item)===normalize(value));
  if(!found)throw fail('unknown_fixed_select_choice');
  return found;
}
function desired(path,value) {
  const spec=specFor(path);
  if(path==='expenses.hasInsurance') {
    if(typeof value!=='boolean')throw fail('invalid_fixed_select_value');
    return value?'Yes':'No';
  }
  return canonical(spec,value);
}
function helper(fn) {
  try{return fn();}catch(error){if(issued.has(error))throw error;let code;try{code=error?.code;}catch{}throw fail(helperCodes.has(code)?code:'fixed_select_dom_unavailable');}
}

/** ctx={document?,signal?,assertCurrent,timeoutMs?,pollMs?}, synchronous freshness.
 * Only fixed, fully known English option domains are supported. Read returns
 * canonical English string or insurance boolean. A genuinely empty display is
 * {available:true,value:null,restorable:false,label}; there is no proven clear.
 * Unknown input values/captions, enum values and legal checkboxes are never read.
 * All mutations and waits use the real single-select helper with an identity guard
 * for native input, associated label, form item, Ant root and selector. Payment
 * also guards an unchanged, explicitly selected current payer. No parent writes,
 * searching, scrolling, synthetic option values or server-acceptance claim.
 */
function operation(path,ctx) {
  const spec=specFor(path);
  if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_fixed_select_context');
  function current() {
    if(ctx.signal?.aborted)throw fail('cancelled');
    try{const result=ctx.assertCurrent();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}if(result===false)throw null;}
    catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}
    if(ctx.signal?.aborted)throw fail('cancelled');
  }
  current(); const doc=ctx.document??globalThis.document,realm=doc?.defaultView;
  if(!realm||['Element','HTMLElement','HTMLInputElement','HTMLLabelElement'].some(key=>typeof realm[key]!=='function'))throw fail('fixed_select_native_unavailable');
  const getter=(proto,key)=>Object.getOwnPropertyDescriptor(proto,key)?.get;
  const ip=realm.HTMLInputElement.prototype,lp=realm.HTMLLabelElement.prototype;
  const id=getter(realm.Element.prototype,'id'),type=getter(ip,'type'),disabled=getter(ip,'disabled'),readOnly=getter(ip,'readOnly'),labels=getter(ip,'labels'),control=getter(lp,'control'),htmlFor=getter(lp,'htmlFor'),text=spec.label?getter(realm.Node?.prototype,'textContent'):null;
  if([id,type,disabled,readOnly,labels,control,htmlFor,...(spec.label?[text]:[])].some(fn=>typeof fn!=='function'))throw fail('fixed_select_native_unavailable');
  const visible=node=>node?.isConnected===true&&node.ownerDocument===doc&&node.getClientRects().length>0&&realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
  let initial;
  function guard() {
    current();const nodes=[...doc.querySelectorAll('[id]')];if(nodes.length>1000)throw fail('fixed_select_collection_truncated');
    const candidates=nodes.filter(node=>id.call(node)===spec.id);
    if(candidates.length!==1)throw fail('fixed_select_binding_ambiguous');
    const input=candidates[0];
    if(!(input instanceof realm.HTMLInputElement)||!visible(input)||type.call(input)!=='search'||typeof readOnly.call(input)!=='boolean'||disabled.call(input)||input.matches(':disabled')||input.getAttribute('aria-disabled')==='true'||input.getAttribute('role')!=='combobox')throw fail('fixed_select_target_unavailable');
    const form=input.closest('.ant-form-item'),root=input.closest('.ant-select');
    if(!(form instanceof realm.HTMLElement)||!visible(form)||form.parentElement?.closest('.ant-form-item')||form.querySelectorAll('.ant-form-item').length)throw fail('fixed_select_form_ambiguous');
    const associated=[...labels.call(input)],formLabels=[...form.querySelectorAll('.ant-form-item-label label')];
    if(associated.length!==1||formLabels.length!==1||associated[0]!==formLabels[0])throw fail('fixed_select_label_ambiguous');
    const label=associated[0];
    if(!(label instanceof realm.HTMLLabelElement)||!visible(label)||control.call(label)!==input||htmlFor.call(label)!==spec.id||label.closest('.ant-form-item')!==form||!form.contains(label)||label.querySelectorAll('input,textarea,select').length)throw fail('fixed_select_label_ambiguous');
    if(spec.label&&text.call(label).trim().replace(/\s+/g,' ').replace(/\s*\*$/,'').trim()!==spec.label)throw fail('fixed_select_caption_mismatch');
    const selectors=root?.querySelectorAll('.ant-select-selector');
    if(!(root instanceof realm.HTMLElement)||!visible(root)||root.closest('.ant-form-item')!==form||root.matches('.ant-select-disabled,.ant-select-multiple')||selectors?.length!==1||!visible(selectors[0])||!selectors[0].contains(input))throw fail('fixed_select_target_unavailable');
    const refs=[input,label,form,root,selectors[0]];
    if(initial&&refs.some((node,index)=>node!==initial[index]))throw fail('fixed_select_structure_changed');
    current();initial??=refs;return input;
  }
  const input=guard();
  return {input,guard,spec,ctx:{...ctx,document:doc,assertCurrent:guard}};
}
function selection(op) {
  const value=helper(()=>readSingleSelect(op.input,op.ctx));
  op.guard();return value===null?null:canonical(op.spec,value);
}
function access(path,ctx) {
  let parent,payer;
  if(path==='expenses.paymentMethod') {
    parent=operation('expenses.payer',ctx);payer=selection(parent);
    if(payer===null)throw fail('fixed_select_dependency_unavailable');
  }
  const op=operation(path,ctx);
  if(parent) {
    const targetGuard=op.guard;
    op.guard=()=>{targetGuard();parent.guard();if(selection(parent)!==payer)throw fail('fixed_select_dependency_changed');targetGuard();};
    op.ctx={...op.ctx,assertCurrent:op.guard};
    op.guard();
  }
  return {op,payer};
}
function domainCheck(path,caption,payer) {
  if(path==='expenses.paymentMethod'&&payer==='Company'&&caption==="Traveller's cheques")throw fail('unknown_fixed_select_choice');
}
export function readFixedSelect(path,ctx) {
  try{const {op,payer}=access(path,ctx),caption=selection(op);domainCheck(path,caption,payer);
    return {available:true,value:caption===null?null:path==='expenses.hasInsurance'?caption==='Yes':caption,...(caption===null?{restorable:false}:{}),label:op.spec.label};
  }catch(error){throw sanitize(error);}
}
export async function writeFixedSelect(path,value,ctx) {
  try{const caption=desired(path,value),{op,payer}=access(path,ctx);domainCheck(path,caption,payer);
    let result;try{result=await selectSingleOption(op.input,caption,op.ctx);}catch(error){helper(()=>{throw error;});}
    op.guard();if(result?.assigned!==true||selection(op)!==caption)throw fail('fixed_select_readback_mismatch');
    return {ok:true,label:op.spec.label};
  }catch(error){throw sanitize(error);}
}
