import {isCalendarDate} from '../shared/validator.js';
import {setDateField,setYearField,clearDateField} from './date-transfer.js';

const issued=new WeakSet();
const fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const sanitize=error=>issued.has(error)?error:fail('calendar_dom_unavailable');
const helperCodes=new Set(['cancelled','document_lost','invalid_date_context','invalid_date_input','native_date_accessor_unavailable',
  'date_target_lost','date_input_not_editable','date_timeout','unsupported_enter','date_event_creation_failed','date_event_dispatch_failed',
  'date_focus_failed','date_blur_failed','date_assignment_failed','date_readback_mismatch','date_clear_unavailable','date_dom_unavailable']);
function modeCheck(mode){if(mode!=='date'&&mode!=='year')throw fail('invalid_calendar_mode');}
function fromDOM(value,mode){
  if(value==='')return '';
  if(typeof value!=='string')throw fail('calendar_value_unconfirmed');
  if(mode==='year'){if(!/^\d{4}$/.test(value)||Number(value)<1000)throw fail('calendar_value_unconfirmed');return Number(value);}
  if(!/^\d{2}\/\d{2}\/\d{4}$/.test(value))throw fail('calendar_value_unconfirmed');
  const [day,month,year]=value.split('/'),canonical=`${year}-${month}-${day}`;
  if(!isCalendarDate(canonical))throw fail('calendar_value_unconfirmed');return canonical;
}
function toDOM(value,mode){
  if(value===''){if(mode==='year')throw fail('year_clear_unsupported');return '';}
  if(mode==='year'){
    if(!Number.isInteger(value)||value<1000||value>9999)throw fail('invalid_canonical_year');return String(value).padStart(4,'0');
  }
  if(typeof value!=='string'||!isCalendarDate(value))throw fail('invalid_canonical_date');
  const [year,month,day]=value.split('-');return `${day}/${month}/${year}`;
}

/** Bridge for a supplied, caller-attributed Ant single picker, explicit date/year
 * mode and synchronous ctx.assertCurrent. No field IDs, route policy or DOB mode
 * switching. ctx.document/signal/timeoutMs/pollMs/stableMs pass to date-transfer.
 * Date DOM is strict DD/MM/YYYY, JSON is ISO YYYY-MM-DD; year DOM is YYYY and JSON
 * is integer 1000..9999, matching the application schema. Empty DOM is internal
 * ''. Empty Full restoration uses the
 * proven clear-control path; Year clearing is deliberately unsupported.
 * Reads use native getters in RAM. Writes delegate all UI actions to existing
 * guarded helpers and confirm canonical native readback, without rollback or
 * extra waits. {ok:true} proves local DOM only, not site-store acceptance.
 */
function operation(input,mode,ctx){
  modeCheck(mode);if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_calendar_context');
  function current(){
    if(ctx.signal?.aborted)throw fail('cancelled');
    try{const result=ctx.assertCurrent();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}if(result===false)throw null;}
    catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}
    if(ctx.signal?.aborted)throw fail('cancelled');
  }
  current();const doc=ctx.document??globalThis.document,realm=doc?.defaultView;
  if(!realm||typeof realm.HTMLInputElement!=='function'||typeof realm.HTMLElement!=='function'||!(input instanceof realm.HTMLInputElement))throw fail('invalid_calendar_input');
  const proto=realm.HTMLInputElement.prototype,get=key=>Object.getOwnPropertyDescriptor(proto,key)?.get;
  const value=get('value'),placeholder=get('placeholder'),type=get('type'),disabled=get('disabled');
  if([value,placeholder,type,disabled].some(fn=>typeof fn!=='function'))throw fail('calendar_native_unavailable');
  const expected=mode==='date'?'DD/MM/YYYY':'YYYY';let picker=null,wrapper=null;
  const visible=node=>node?.ownerDocument===doc&&node.isConnected===true&&node.getClientRects().length>0&&realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
  function guard(){
    current();const ownPicker=input.closest('.ant-picker'),ownWrapper=input.closest('.ant-picker-input');
    if(input.ownerDocument!==doc||!visible(input)||type.call(input)!=='text'||disabled.call(input)||input.matches(':disabled')||input.getAttribute('aria-disabled')==='true'||
      input.getAttribute('role')==='combobox'||placeholder.call(input)!==expected||!(ownPicker instanceof realm.HTMLElement)||!(ownWrapper instanceof realm.HTMLElement)||
      !visible(ownPicker)||!visible(ownWrapper)||ownPicker.matches('.ant-picker-range,.ant-picker-disabled')||ownPicker.parentElement?.closest('.ant-picker')||
      ownWrapper.closest('.ant-picker')!==ownPicker||ownWrapper.parentElement?.closest('.ant-picker-input')||!ownWrapper.contains(input)||
      ownPicker.querySelectorAll('input').length!==1||ownPicker.querySelectorAll('input')[0]!==input||
      ownPicker.querySelectorAll('.ant-picker-input').length!==1||ownPicker.querySelectorAll('.ant-picker-input')[0]!==ownWrapper||
      ownWrapper.querySelectorAll('input').length!==1||ownWrapper.querySelectorAll('input')[0]!==input)throw fail('calendar_target_lost');
    if(picker&&(ownPicker!==picker||ownWrapper!==wrapper))throw fail('calendar_structure_changed');
    current();picker=ownPicker;wrapper=ownWrapper;
  }
  guard();
  const read=()=>{guard();const raw=value.call(input);guard();return fromDOM(raw,mode);};
  return {read,guard,doc};
}

export function readCalendarField(input,mode,ctx){
  try{const op=operation(input,mode,ctx),value=op.read();return {available:true,value,...(mode==='year'&&value===''?{restorable:false}:{})};}catch(error){throw sanitize(error);}
}

export async function writeCalendarField(input,mode,canonicalValue,ctx){
  try{
    modeCheck(mode);const nativeValue=toDOM(canonicalValue,mode),op=operation(input,mode,ctx);
    const wrapped={...ctx,document:op.doc,assertCurrent:op.guard};
    try{
      if(nativeValue==='')await clearDateField(input,wrapped);
      else if(mode==='year')await setYearField(input,nativeValue,wrapped);
      else await setDateField(input,nativeValue,wrapped);
    }catch(error){if(issued.has(error))throw error;let code;try{code=error?.code;}catch{}throw fail(helperCodes.has(code)?code:'calendar_write_failed');}
    if(op.read()!==canonicalValue)throw fail('calendar_readback_mismatch');return {ok:true};
  }catch(error){throw sanitize(error);}
}
