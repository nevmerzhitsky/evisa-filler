const issued=new WeakSet();
const fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const sanitize=error=>issued.has(error)?error:fail('radio_dom_unavailable');
const normalize=text=>text.trim().replace(/\s+/g,' ');
const groupSelector='.ant-radio-group,[role="radiogroup"]';

/** Select an option in a supplied native radio group. The adapter supplies the exact group,
 * confirms its field/question and caption domain, and owns dependencies/manual
 * cancellation. ctx = {assertCurrent, signal?, document?, timeoutMs?, pollMs?,
 * stableMs?}. Freshness is synchronous. No IDs, routes, raw values or names read.
 * Optional synchronous beforeClick() marks an actual pending native activation;
 * it is never called for a noop and freshness is checked again before clicking.
 * Supported groups are concrete Ant radio groups. Each input must have one
 * native label contained in its own group. Captions come
 * from a dedicated leaf label or one visible leaf span in a wrapping Ant label.
 * No group/container prose, setters, synthetic events or rollback are used.
 * {assigned:true} proves stable local native checked selection only.
 */
function operation(group,ctx) {
  if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_radio_context');
  if(ctx.beforeClick!==undefined&&typeof ctx.beforeClick!=='function')throw fail('invalid_radio_context');
  const timeout=ctx.timeoutMs??3000,poll=ctx.pollMs??20,stable=ctx.stableMs??60;
  if(![timeout,poll,stable].every(ms=>Number.isFinite(ms)&&ms>0)||timeout>60000||poll>timeout||stable>timeout)throw fail('invalid_radio_context');
  const deadline=Date.now()+timeout;
  function current() {
    if(ctx.signal?.aborted)throw fail('cancelled');
    try{const result=ctx.assertCurrent();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}if(result===false)throw null;}
    catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}
    if(ctx.signal?.aborted)throw fail('cancelled');if(Date.now()>=deadline)throw fail('radio_timeout');
  }
  current();const doc=ctx.document??globalThis.document,realm=doc?.defaultView;
  if(!realm||!(group instanceof realm.HTMLElement))throw fail('invalid_radio_group');
  const checked=Object.getOwnPropertyDescriptor(realm.HTMLInputElement.prototype,'checked')?.get;
  const labels=Object.getOwnPropertyDescriptor(realm.HTMLInputElement.prototype,'labels')?.get;
  const control=Object.getOwnPropertyDescriptor(realm.HTMLLabelElement.prototype,'control')?.get;
  const click=realm.HTMLElement.prototype.click;
  if([checked,labels,control,click].some(fn=>typeof fn!=='function'))throw fail('native_radio_accessor_unavailable');
  const visible=node=>node?.isConnected&&node.getClientRects().length>0&&realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
  let initial=null;
  function entries() {
    current();
    if(group.ownerDocument!==doc||!visible(group)||!group.matches(groupSelector)||group.matches(':disabled')||
      group.getAttribute('aria-disabled')==='true'||group.querySelectorAll(groupSelector).length||group.parentElement?.closest(groupSelector))throw fail('radio_target_lost');
    const inputs=[...group.querySelectorAll('input[type="radio"]')];
    if(inputs.length<2||inputs.length>50)throw fail('radio_group_ambiguous');
    const result=inputs.map(input=>{
      if(!(input instanceof realm.HTMLInputElement)||input.ownerDocument!==doc||input.type!=='radio'||input.disabled||input.matches(':disabled')||
        !visible(input)||input.closest(groupSelector)!==group||!group.contains(input))throw fail('radio_target_lost');
      const associated=[...labels.call(input)];
      if(associated.length!==1)throw fail('radio_label_ambiguous');
      const label=associated[0];
      if(!(label instanceof realm.HTMLLabelElement)||label.ownerDocument!==doc||!group.contains(label)||!visible(label)||
        control.call(label)!==input||label.closest(groupSelector)!==group)throw fail('radio_label_ambiguous');
      const spans=[...label.querySelectorAll('span')];if(spans.length>100)throw fail('radio_label_ambiguous');
      const leaves=label.childElementCount===0?[label]:spans.filter(node=>node.childElementCount===0&&visible(node)&&node.closest('label')===label&&!node.closest('.ant-radio')&&!node.contains(input));
      if(leaves.length!==1)throw fail('radio_label_ambiguous');
      const caption=normalize(leaves[0].textContent);if(!caption)throw fail('radio_label_ambiguous');
      return {input,label,leaf:leaves[0],caption,checked:checked.call(input)===true};
    });
    if(new Set(result.map(item=>item.caption)).size!==result.length)throw fail('radio_caption_ambiguous');
    if(result.filter(item=>item.checked).length>1)throw fail('radio_selection_ambiguous');
    if(initial&&(initial.length!==result.length||result.some((item,index)=>['input','label','leaf','caption'].some(key=>item[key]!==initial[index][key]))))throw fail('radio_options_changed');
    current();if(!initial)initial=result;return result;
  }
  const selected=()=>entries().find(item=>item.checked)?.caption??null;
  function delay(ms) {
    entries();return new Promise((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);reject(fail('cancelled'));};
      const timer=setTimeout(()=>{ctx.signal?.removeEventListener('abort',abort);resolve();},Math.min(ms,Math.max(1,deadline-Date.now())));
      ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)abort();
    });
  }
  entries();return {entries,selected,current,delay,click,poll,stable,beforeClick:ctx.beforeClick};
}

export function readRadioSelection(group,ctx) {
  try{return operation(group,ctx).selected();}catch(error){throw sanitize(error);}
}

export async function chooseRadioOption(group,wanted,ctx) {
  try {
    if(typeof wanted!=='string'||!normalize(wanted))throw fail('invalid_radio_caption');wanted=normalize(wanted);
    const op=operation(group,ctx),options=op.entries(),target=options.find(item=>item.caption===wanted);
    if(!target)throw fail('radio_option_missing');
    if(op.selected()!==wanted) {
      if(op.entries().find(item=>item.caption===wanted)?.input!==target.input)throw fail('radio_options_changed');
      op.current();
      if(op.beforeClick){try{const result=op.beforeClick();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}}catch{throw fail('radio_before_click_failed');}}
      if(op.entries().find(item=>item.caption===wanted)?.input!==target.input)throw fail('radio_options_changed');
      op.current();try{op.click.call(target.input);}catch{throw fail('radio_click_failed');}
    }
    while(op.selected()!==wanted)await op.delay(op.poll);
    await op.delay(op.stable);
    if(op.selected()!==wanted)throw fail('radio_selection_changed');op.current();return {assigned:true};
  }catch(error){throw sanitize(error);}
}
