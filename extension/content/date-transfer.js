import {isCalendarDate} from '../shared/validator.js';

const issued=new WeakSet();
const fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};

/** Transfer an already normalized, nonempty full date in DD/MM/YYYY to a supplied
 * concrete Ant date input. No IDs, routes, birth modes or field selection live here.
 * ctx = {assertCurrent, signal?, document?, timeoutMs?, pollMs?, stableMs?}.
 * assertCurrent is synchronous and owns route, document and session validity.
 * The adapter must confirm full-date mode and handle dependencies and readback.
 * Native realm mousedown, focus, setter/input, Enter and blur act on this input
 * only. No readonly override, calendar action, clearing, rollback or focus restore.
 * Abort leaves completed actions in place. Static errors never include date values.
 * {assigned:true} proves stable local DOM readback, not Vue or server acceptance.
 */
export function setDateField(input,value,ctx) {return transfer(input,value,ctx,'date');}

/** Transfer an already normalized four-digit year, 0001 through 9999, to an
 * explicitly supplied Ant year input. The native placeholder must remain YYYY.
 * The adapter confirms year mode; this never changes mode or infers hidden dates.
 * Uses the same guarded commit path and DOM-only result as setDateField.
 * Empty restoration and clearing are unsupported for both operations.
 */
export function setYearField(input,value,ctx) {return transfer(input,value,ctx,'year');}

/** Clear a supplied full-date Ant picker using its unique native clear control.
 * Never sets an empty value or sends input/Enter. Reopening, native focus/blur and
 * stable empty readback check for revival of the site's previous input buffer.
 * Initial value is compared in memory to avoid clearing a concurrently changed
 * value; it is never returned, restored or included in errors. Year mode excluded.
 * The adapter still owns full-mode validation and any manual cancellation policy.
 */
export function clearDateField(input,ctx) {return transfer(input,undefined,ctx,'clear');}

async function transfer(input,value,ctx,mode) {
  try {
    if(mode==='year') {
      if(typeof value!=='string'||!/^\d{4}$/.test(value)||Number(value)<1)throw fail('invalid_year_value');
    }else if(mode==='date') {
      if(typeof value!=='string'||!/^\d{2}\/\d{2}\/\d{4}$/.test(value))throw fail('invalid_date_value');
      const [day,month,year]=value.split('/');
      if(!isCalendarDate(`${year}-${month}-${day}`))throw fail('invalid_date_value');
    }
    if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_date_context');
    const timeoutMs=ctx.timeoutMs??10000,pollMs=ctx.pollMs??20,stableMs=ctx.stableMs??60;
    if(![timeoutMs,pollMs,stableMs].every(ms=>Number.isFinite(ms)&&ms>0)||timeoutMs>60000||pollMs>timeoutMs||stableMs>timeoutMs)throw fail('invalid_date_context');
    const deadline=Date.now()+timeoutMs;
    function current() {
      if(ctx.signal?.aborted)throw fail('cancelled');
      try {
        const result=ctx.assertCurrent();
        if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}
        if(result===false)throw null;
      }catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}
      if(ctx.signal?.aborted)throw fail('cancelled');
      if(Date.now()>=deadline)throw fail('date_timeout');
    }
    current();
    const doc=ctx.document??globalThis.document,realm=doc?.defaultView;
    if(!realm||typeof realm.HTMLInputElement!=='function'||!(input instanceof realm.HTMLInputElement))throw fail('invalid_date_input');
    const picker=input.closest('.ant-picker');
    const descriptor=Object.getOwnPropertyDescriptor(realm.HTMLInputElement.prototype,'value');
    const placeholderGet=mode==='year'?Object.getOwnPropertyDescriptor(realm.HTMLInputElement.prototype,'placeholder')?.get:null;
    const get=descriptor?.get,set=descriptor?.set,focus=realm.HTMLElement?.prototype.focus,blur=realm.HTMLElement?.prototype.blur;
    if((mode==='clear'?[get,focus,blur]:[get,set,focus,blur]).some(fn=>typeof fn!=='function'))throw fail('native_date_accessor_unavailable');
    if(mode==='year'&&typeof placeholderGet!=='function')throw fail('native_date_accessor_unavailable');
    const visible=node=>node?.isConnected&&node.getClientRects().length>0&&realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
    function guard(editable=false) {
      current();
      const inputs=picker?.querySelectorAll('input'),placeholder=mode==='year'?placeholderGet.call(input):input.getAttribute('placeholder');
      if(input.ownerDocument!==doc||!input.isConnected||input.type!=='text'||input.disabled||input.matches(':disabled')||
        !picker||input.closest('.ant-picker')!==picker||picker.matches('.ant-picker-range,.ant-picker-disabled')||
        !visible(input)||!visible(picker)||inputs.length!==1||inputs[0]!==input||
        (mode==='year'?placeholder!=='YYYY':placeholder!==null&&placeholder!==''&&placeholder!=='DD/MM/YYYY'))throw fail('date_target_lost');
      if(editable&&(doc.activeElement!==input||input.readOnly))throw fail('date_input_not_editable');
      current();
    }
    function event(kind) {
      try {
        if(kind==='mousedown'||kind==='mouseup')return new realm.MouseEvent(kind,{bubbles:true,cancelable:true,button:0,buttons:kind==='mousedown'?1:0});
        if(kind==='input')return new realm.Event(kind,{bubbles:true});
        const enter=new realm.KeyboardEvent('keydown',{key:'Enter',code:'Enter',which:13,keyCode:13,bubbles:true,cancelable:true});
        if(enter.which!==13)throw fail('unsupported_enter');return enter;
      }catch(error){if(issued.has(error))throw error;throw fail('date_event_creation_failed');}
    }
    function act(fn,code,editable=false) {guard(editable);try{fn();}catch{throw fail(code);}}
    function readback() {guard();if(get.call(input)!==value)throw fail('date_readback_mismatch');}
    function delay(ms=pollMs) {
      guard();
      return new Promise((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);reject(fail('cancelled'));};
        const timer=setTimeout(()=>{ctx.signal?.removeEventListener('abort',abort);resolve();},Math.min(ms,Math.max(1,deadline-Date.now())));
        ctx.signal?.addEventListener('abort',abort,{once:true});
        if(ctx.signal?.aborted)abort();
      });
    }
    async function until(predicate) {while(true){guard();const matched=predicate();guard();if(matched)return;await delay();}}
    if(mode==='clear') {
      guard();
      const original=get.call(input);
      const empty=()=>{guard();if(get.call(input)!=='')throw fail('date_readback_mismatch');};
      if(original==='') {await delay(stableMs);empty();return {assigned:true};}
      const controls=picker.querySelectorAll('.ant-picker-clear[role="button"]');
      if(controls.length!==1)throw fail('date_clear_unavailable');
      const control=controls[0];
      function clearGuard() {
        guard();
        const currentControls=picker.querySelectorAll('.ant-picker-clear[role="button"]');
        if(!(control instanceof realm.HTMLElement)||control.ownerDocument!==doc||!visible(control)||control.disabled||
          control.getAttribute('aria-disabled')==='true'||control.matches(':disabled')||control.getAttribute('role')!=='button'||
          control.closest('.ant-picker')!==picker||currentControls.length!==1||currentControls[0]!==control)throw fail('date_clear_unavailable');
        guard();
      }
      clearGuard();event('mousedown');event('mouseup');guard();
      for(const kind of ['mousedown','mouseup']) {
        const mouse=event(kind);clearGuard();
        if(get.call(input)!==original)throw fail('date_readback_mismatch');clearGuard();
        act(()=>control.dispatchEvent(mouse),'date_event_dispatch_failed');
      }
      // The clear control may disappear immediately after mouseup.
      await until(()=>{
        const currentValue=get.call(input);
        if(currentValue!==''&&currentValue!==original)throw fail('date_readback_mismatch');
        return currentValue==='';
      });
      const reopen=event('mousedown');empty();act(()=>input.dispatchEvent(reopen),'date_event_dispatch_failed');
      await delay();empty();act(()=>focus.call(input,{preventScroll:true}),'date_focus_failed');
      await until(()=>doc.activeElement===input&&!input.readOnly);empty();
      act(()=>blur.call(input),'date_blur_failed');
      await until(()=>{if(get.call(input)!=='')throw fail('date_readback_mismatch');return doc.activeElement!==input;});
      await delay(stableMs);empty();return {assigned:true};
    }
    // Verify native constructors before any UI action, then construct fresh events.
    guard();event('mousedown');event('input');event('keydown');guard();
    const mouse=event('mousedown');act(()=>input.dispatchEvent(mouse),'date_event_dispatch_failed');
    await delay();act(()=>focus.call(input,{preventScroll:true}),'date_focus_failed');
    await until(()=>doc.activeElement===input&&!input.readOnly);
    act(()=>set.call(input,value),'date_assignment_failed',true);readback();
    const typing=event('input');act(()=>input.dispatchEvent(typing),'date_event_dispatch_failed',true);
    await delay();readback();
    const enter=event('keydown');readback();act(()=>input.dispatchEvent(enter),'date_event_dispatch_failed',true);
    await delay();readback();act(()=>blur.call(input),'date_blur_failed');
    await until(()=>doc.activeElement!==input&&get.call(input)===value);
    await delay(stableMs);readback();
    return {assigned:true};
  }catch(error){throw issued.has(error)?error:fail('date_dom_unavailable');}
}
