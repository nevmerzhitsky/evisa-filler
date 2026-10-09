const issued = new WeakSet();
const fail = code => {const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const sanitized = error => issued.has(error) ? error : fail('select_dom_unavailable');
const normalize = text => text.trim().replace(/\s+/g,' ');

/** Concrete Ant single-select primitive, without field IDs, routing or framework access.
 * ctx = {assertCurrent, signal?, document?, timeoutMs?, pollMs?}. assertCurrent is
 * synchronous and owns session/route validity. Constructors come from that document.
 * Reads only dedicated leaf captions, never input.value, titles or option values.
 * Cancellation leaves any completed action in place; there is no rollback or focus.
 * {assigned:true} confirms stable local selected display and a closed popup only.
 * It does not prove server acceptance. Errors contain static codes, never captions.
 */
function operation(input,ctx) {
  if (!ctx || typeof ctx.assertCurrent !== 'function') throw fail('invalid_select_context');
  const doc=ctx.document ?? globalThis.document, realm=doc?.defaultView;
  let root,selector;
  try {
    if (!realm || typeof realm.HTMLInputElement !== 'function' || !(input instanceof realm.HTMLInputElement)) throw null;
    root=input.closest('.ant-select');
    const selectors=root?.querySelectorAll('.ant-select-selector');
    if (selectors?.length !== 1) throw null;
    selector=selectors[0];
  } catch {throw fail('invalid_select_input');}
  const visible=node=>Boolean(node?.isConnected && node.getClientRects().length &&
    realm.getComputedStyle(node).display !== 'none' && !['hidden','collapse'].includes(realm.getComputedStyle(node).visibility));
  function guard() {
    if (ctx.signal?.aborted) throw fail('cancelled');
    try {
      const result=ctx.assertCurrent();
      if (result && typeof result.then === 'function') {Promise.resolve(result).catch(()=>{});throw null;}
      if (result === false) throw null;
    } catch {throw fail(ctx.signal?.aborted ? 'cancelled' : 'document_lost');}
    if (ctx.signal?.aborted) throw fail('cancelled');
    try {
      const selectors=root.querySelectorAll('.ant-select-selector');
      const inputs=root.querySelectorAll('input[role="combobox"]');
      if (input.ownerDocument !== doc || !input.isConnected || input.disabled || input.matches(':disabled') ||
        input.getAttribute('role') !== 'combobox' || input.closest('.ant-select') !== root ||
        root.matches('.ant-select-disabled,.ant-select-multiple') || !visible(root) || !visible(selector) ||
        selectors.length !== 1 || selectors[0] !== selector || inputs.length !== 1 || inputs[0] !== input || !selector.contains(input)) throw null;
    } catch {throw fail('select_target_lost');}
    if (ctx.signal?.aborted) throw fail('cancelled');
  }
  function display() {
    guard();
    const items=[...root.querySelectorAll('.ant-select-selection-item')];
    if (!items.length) return null;
    if (items.length !== 1 || items[0].childElementCount !== 0 || !visible(items[0]) ||
      !selector.contains(items[0]) || items[0].closest('.ant-select') !== root) throw fail('selected_display_ambiguous');
    const caption=normalize(items[0].textContent);return caption || null;
  }
  const refs=node=>[...new Set(['aria-controls','aria-owns'].flatMap(key=>(node.getAttribute(key)||'').split(/\s+/).filter(Boolean)))];
  function popup() {
    guard();
    const ids=refs(input),nodes=[...doc.querySelectorAll('[id]')],owners=[...doc.querySelectorAll('[role="combobox"]')];
    if (ids.length !== 1 || ids[0].length > 1000 || nodes.length > 1000 || owners.length > 1000) throw fail('popup_ambiguous');
    const targets=nodes.filter(node=>node.id === ids[0]);
    if (targets.length > 1) throw fail('popup_ambiguous');
    if (!targets.length) return null;
    const list=targets[0],dropdown=list.closest('.ant-select-dropdown');
    if (list.getAttribute('role') !== 'listbox' || !dropdown || dropdown.parentElement?.closest('.ant-select-dropdown') ||
      dropdown.querySelectorAll('[role="listbox"]').length !== 1 || dropdown.querySelectorAll('[role="listbox"]')[0] !== list) throw fail('popup_ambiguous');
    for (const owner of owners) if (owner !== input) {
      const aliases=refs(owner);if (aliases.length > 20 || aliases.some(id=>id.length > 1000)) throw fail('popup_ambiguous');
      for (const id of aliases) {
        const matches=nodes.filter(node=>node.id === id);if(matches.length > 1) throw fail('popup_ambiguous');
        const candidate=matches[0];
        if (candidate && (candidate === list || candidate === dropdown || candidate.closest('.ant-select-dropdown') === dropdown ||
          [...candidate.querySelectorAll('[role="listbox"]')].includes(list))) throw fail('popup_ambiguous');
      }
    }
    return visible(dropdown) ? dropdown : null;
  }
  function row(wanted) {
    const dropdown=popup();if (!dropdown) return null;
    const rows=[...dropdown.querySelectorAll('.ant-select-item-option')];
    if (rows.length > 500) throw fail('options_truncated');
    const matches=[];
    for (const row of rows) {
      if (!visible(row) || row.closest('.ant-select-dropdown') !== dropdown) continue;
      const leaves=row.querySelectorAll('.ant-select-item-option-content');
      if (leaves.length !== 1 || leaves[0].childElementCount !== 0 || !visible(leaves[0]) || leaves[0].closest('.ant-select-item-option') !== row) continue;
      if (normalize(leaves[0].textContent) === wanted) matches.push(row);
    }
    if (matches.length > 1) throw fail('option_ambiguous');
    const selected=matches[0];
    if (selected && (selected.matches('.ant-select-item-option-disabled') || selected.getAttribute('aria-disabled') === 'true')) throw fail('option_disabled');
    return selected ?? null;
  }
  function delay(ms) {
    guard();return new Promise((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);reject(fail('cancelled'));};
      const timer=setTimeout(()=>{ctx.signal?.removeEventListener('abort',abort);try{guard();resolve();}catch(error){reject(error);}},ms);
      ctx.signal?.addEventListener('abort',abort,{once:true});
      if(ctx.signal?.aborted) abort();
    });
  }
  const timeout=Number.isFinite(ctx.timeoutMs) ? Math.max(1,Math.min(ctx.timeoutMs,3000)) : 3000;
  const poll=Number.isFinite(ctx.pollMs) ? Math.max(1,Math.min(ctx.pollMs,100)) : 20;
  async function until(predicate,code) {
    const deadline=Date.now()+timeout;
    while(true) {guard();const value=predicate();guard();if(value)return value;if(Date.now()>=deadline)throw fail(code);await delay(poll);}
  }
  guard();return {guard,display,popup,row,delay,until,selector,realm};
}

export function readSingleSelect(input,ctx) {
  try{return operation(input,ctx).display();}catch(error){throw sanitized(error);}
}

async function select(input,wanted,ctx) {
  if(typeof wanted !== 'string' || !normalize(wanted)) throw fail('invalid_select_caption');
  wanted=normalize(wanted);
  const op=operation(input,ctx),original=op.display();
  if(original === wanted) {
    await op.until(()=>op.display() === wanted && !op.popup() && input.getAttribute('aria-expanded') !== 'true','select_result_timeout');
    await op.delay(50);op.guard();
    if(op.display() !== wanted || op.popup() || input.getAttribute('aria-expanded') === 'true')throw fail('selected_display_changed');
    op.guard();return {assigned:true};
  }
  if(!op.popup()) {
    let event;try{event=new op.realm.MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,buttons:1});}catch{throw fail('select_event_unavailable');}
    op.guard();if(op.display() !== original)throw fail('selected_display_changed');
    op.guard();try{op.realm.EventTarget.prototype.dispatchEvent.call(op.selector,event);}catch{throw fail('select_open_failed');}
  }
  await op.until(()=>op.row(wanted),'option_not_rendered');
  op.guard();if(op.display() !== original)throw fail('selected_display_changed');
  const row=op.row(wanted);if(!row)throw fail('option_not_rendered');
  op.guard();if(op.row(wanted) !== row)throw fail('option_changed');
  const click=op.realm.HTMLElement.prototype.click;
  op.guard();
  try{click.call(row);}catch{throw fail('select_click_failed');}
  await op.until(()=>op.display() === wanted && !op.popup() && input.getAttribute('aria-expanded') !== 'true','select_result_timeout');
  await op.delay(50);op.guard();
  if(op.display() !== wanted || op.popup() || input.getAttribute('aria-expanded') === 'true')throw fail('selected_display_changed');
  op.guard();
  return {assigned:true};
}

export async function selectSingleOption(input,wanted,ctx) {
  try{return await select(input,wanted,ctx);}catch(error){throw sanitized(error);}
}
