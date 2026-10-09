const fail=code=>Object.assign(new Error(code),{code});
const ID='basic_ttcdCqTcCamDoan';

// The user explicitly requested this declaration. Activate the native checkbox
// so the site's normal change handler runs; never toggle an existing check off.
export async function checkResidenceCommitment(document,ctx) {
  const realm=document.defaultView;
  function current(){
    if(ctx.signal?.aborted)throw fail('cancelled');
    ctx.assertCurrent();
  }
  function target(){
    current();
    const nodes=document.querySelectorAll(`[id="${ID}"]`);
    const input=nodes[0];
    if(nodes.length!==1 || !(input instanceof realm.HTMLInputElement) ||
      input.type!=='checkbox' || !input.isConnected || input.disabled ||
      input.matches(':disabled') || !input.getClientRects().length)throw fail('unavailable');
    return input;
  }
  const checked=Object.getOwnPropertyDescriptor(realm.HTMLInputElement.prototype,'checked')?.get;
  if(!checked)throw fail('unavailable');
  const input=target(),alreadyChecked=checked.call(input);
  if(!alreadyChecked){current();realm.HTMLElement.prototype.click.call(input);}
  await new Promise(resolve=>setTimeout(resolve,60));
  if(target()!==input || !checked.call(input))throw fail('readback_mismatch');
  return {ok:true,status:alreadyChecked?'unchanged':'filled',label:'Committed to declare temporary residence'};
}
