const fail=code=>Object.assign(new Error(code),{code});
// This autocomplete accepts a text buffer. Confirmation is native readback after
// input/change/blur and a stability wait, not a claim about a hidden site store.
function operation(ctx) {
  const doc=ctx?.document??globalThis.document,realm=doc?.defaultView;
  function current(){
    if(ctx?.signal?.aborted)throw fail('cancelled');
    try{if(typeof ctx?.assertCurrent!=='function'||ctx.assertCurrent()===false)throw null;}
    catch{throw fail(ctx?.signal?.aborted?'cancelled':'document_lost');}
  }
  current();
  const descriptor=Object.getOwnPropertyDescriptor(realm?.HTMLInputElement?.prototype??{},'value');
  const getter=(proto,name)=>Object.getOwnPropertyDescriptor(proto??{},name)?.get;
  const id=getter(realm?.Element?.prototype,'id'),type=getter(realm?.HTMLInputElement?.prototype,'type'),
    disabled=getter(realm?.HTMLInputElement?.prototype,'disabled'),readOnly=getter(realm?.HTMLInputElement?.prototype,'readOnly'),
    labels=getter(realm?.HTMLInputElement?.prototype,'labels'),control=getter(realm?.HTMLLabelElement?.prototype,'control'),
    htmlFor=getter(realm?.HTMLLabelElement?.prototype,'htmlFor');
  if([descriptor?.get,descriptor?.set,id,type,disabled,readOnly,labels,control,htmlFor].some(fn=>typeof fn!=='function'))throw fail('unavailable');
  let initial;
  function guard(){
    current();const nodes=[...doc.querySelectorAll('[id]')];if(nodes.length>1000)throw fail('unavailable');
    const matches=nodes.filter(node=>id.call(node)==='basic_ttcdDcTamTru');if(matches.length!==1)throw fail('unavailable');
    const input=matches[0];
    if(!(input instanceof realm.HTMLInputElement)||input.ownerDocument!==doc||!input.isConnected||!input.getClientRects().length||
      type.call(input)!=='search'||input.getAttribute('role')!=='combobox'||disabled.call(input)||readOnly.call(input)||
      input.matches(':disabled')||input.getAttribute('aria-disabled')==='true')throw fail('unavailable');
    const select=input.closest('.ant-select'),form=input.closest('.ant-form-item');
    if(!select||!form||!form.contains(select)||select.querySelectorAll('input').length!==1)throw fail('unavailable');
    const associated=[...labels.call(input)],formLabels=[...form.querySelectorAll('.ant-form-item-label label')];
    if(associated.length!==1||formLabels.length!==1||associated[0]!==formLabels[0])throw fail('unavailable');
    const label=associated[0];
    if(!(label instanceof realm.HTMLLabelElement)||label.ownerDocument!==doc||control.call(label)!==input||htmlFor.call(label)!=='basic_ttcdDcTamTru')throw fail('unavailable');
    if(initial&&[input,select,form,label].some((node,index)=>node!==initial[index]))throw fail('unavailable');
    initial??=[input,select,form,label];current();return input;
  }
  guard();return {guard,realm,descriptor};
}
function safe(error){let code;try{code=error?.code;}catch{}return fail(['cancelled','document_lost'].includes(code)?code:'unavailable');}
export function readAddressField(path,ctx){
  try{if(path!=='trip.address')throw fail('unavailable');const op=operation(ctx),input=op.guard(),value=op.descriptor.get.call(input);op.guard();
    if(typeof value!=='string')throw fail('unavailable');return {available:true,value,label:null};
  }catch(error){throw safe(error);}
}
export async function writeAddressField(path,value,ctx){
  try{
    if(path!=='trip.address'||typeof value!=='string')throw fail('unavailable');
    const op=operation(ctx),input=op.guard();op.descriptor.set.call(input,value);
    for(const type of ['input','change']){op.guard();input.dispatchEvent(new op.realm.Event(type,{bubbles:true}));}
    op.guard();const blur=op.realm.HTMLElement.prototype.blur;if(typeof blur!=='function')throw fail('unavailable');blur.call(input);
    const stableMs=ctx.stableMs??100;if(!Number.isFinite(stableMs)||stableMs<1||stableMs>3000)throw fail('unavailable');
    await new Promise((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);reject(fail('cancelled'));};
      const timer=setTimeout(()=>{ctx.signal?.removeEventListener('abort',abort);resolve();},stableMs);
      ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)abort();
    });
    op.guard();if(op.descriptor.get.call(input)!==value)throw fail('unavailable');op.guard();return {ok:true,label:null};
  }catch(error){throw safe(error);}
}
