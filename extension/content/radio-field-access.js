import {chooseRadioOption} from './radio-transfer.js';
const GROUP='.ant-radio-group,[role="radiogroup"]';
// Observed question association: site-question-research.md and
// site-radio-binding-research.md. No field order, generated ID or name fallback.
const questions=Object.freeze({
  'personal.hasUsedOtherPassports':'Have you ever used any other passports to enter into Viet Nam?',
  'personal.hasOtherNationalities':'Do you have multiple nationalities?',
  'personal.hasViolations':'Violation of the Vietnamese laws/regulations (if any)',
  'passport.hasOtherValidPassports':'Do you hold any other valid passports',
  'trip.hasVietnamContacts':'Agency/Organization/Individual that the applicant plans to contact when enter into Viet Nam?',
  'trip.hasVisitedWithinLastYear':'Have you been to Viet Nam in the last 01 year?',
  'trip.hasRelativesInVietnam':'Do you have relatives who currently reside in Viet Nam?'
});
const issued=new WeakSet(),fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const sanitize=error=>issued.has(error)?error:fail('radio_field_dom_unavailable');
const helperCodes=new Set(['cancelled','document_lost','invalid_radio_context','invalid_radio_group','native_radio_accessor_unavailable','radio_target_lost',
  'radio_timeout','radio_group_ambiguous','radio_label_ambiguous','radio_caption_ambiguous','radio_selection_ambiguous','radio_options_changed',
  'radio_option_missing','radio_click_failed','radio_before_click_failed','radio_selection_changed','radio_dom_unavailable']);
const normalize=text=>text.trim().replace(/\s+/g,' ');
function pathCheck(path){if(path!=='visa.entryType'&&!Object.hasOwn(questions,path))throw fail('unsupported_radio_field_path');}
function desired(path,value){
  pathCheck(path);if(path!=='visa.entryType'){if(typeof value!=='boolean')throw fail('invalid_radio_field_value');return value?'Yes':'No';}
  if(typeof value!=='string')throw fail('invalid_radio_field_value');
  const caption=normalize(value).toLowerCase();if(caption==='single-entry')return 'Single-entry';if(caption==='multiple-entry')return 'Multiple-entry';throw fail('invalid_radio_field_value');
}

/** Eight confirmed radio bindings. ctx owns document/route/language/dependencies
 * and manual cancellation via synchronous assertCurrent/signal. Only dedicated
 * question and option leaves are read; no values, names, titles or wrapper prose.
 * No selection returns null/restorable:false rather than guessing No. Empty
 * restoration is unsupported. Writes use native activation in radio-transfer,
 * guard all cached ownership/option identities, and prove only local checked DOM.
 */
function operation(path,ctx){
  pathCheck(path);if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_radio_field_context');
  function current(){
    if(ctx.signal?.aborted)throw fail('cancelled');
    try{const result=ctx.assertCurrent();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}if(result===false)throw null;}
    catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}
    if(ctx.signal?.aborted)throw fail('cancelled');
  }
  current();const doc=ctx.document??globalThis.document,realm=doc?.defaultView;
  if(!realm||['Element','HTMLElement','HTMLInputElement','HTMLLabelElement','Node'].some(key=>typeof realm[key]!=='function'))throw fail('radio_field_native_unavailable');
  const get=(proto,key)=>Object.getOwnPropertyDescriptor(proto,key)?.get,ip=realm.HTMLInputElement.prototype;
  const id=get(realm.Element.prototype,'id'),type=get(ip,'type'),disabled=get(ip,'disabled'),checked=get(ip,'checked'),labels=get(ip,'labels'),
    control=get(realm.HTMLLabelElement.prototype,'control'),text=get(realm.Node.prototype,'textContent');
  if([id,type,disabled,checked,labels,control,text].some(fn=>typeof fn!=='function'))throw fail('radio_field_native_unavailable');
  const visible=node=>node instanceof realm.HTMLElement&&node.ownerDocument===doc&&node.isConnected===true&&node.getClientRects().length>0&&realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
  const expected=path==='visa.entryType'?['Single-entry','Multiple-entry']:['No','Yes'];let initial=null;
  function entries(group){
    if(!visible(group)||!group.matches(GROUP)||group.matches(':disabled')||group.getAttribute('aria-disabled')==='true'||group.querySelectorAll(GROUP).length||group.parentElement?.closest(GROUP))return null;
    const inputs=[...group.querySelectorAll('input')];if(inputs.length!==2)return null;
    const result=[];
    for(const input of inputs){
      if(!(input instanceof realm.HTMLInputElement)||type.call(input)!=='radio'||disabled.call(input)||input.matches(':disabled')||!visible(input)||input.closest(GROUP)!==group)return null;
      const associated=[...labels.call(input)];if(associated.length!==1)return null;const label=associated[0];
      if(!(label instanceof realm.HTMLLabelElement)||!visible(label)||control.call(label)!==input||!group.contains(label)||label.closest(GROUP)!==group)return null;
      const spans=[...label.querySelectorAll('span')];if(spans.length>100)return null;
      const leaves=label.childElementCount===0?[label]:spans.filter(node=>node.childElementCount===0&&visible(node)&&node.closest('label')===label&&!node.closest('.ant-radio')&&!node.contains(input));
      if(leaves.length!==1)return null;
      result.push({input,label,leaf:leaves[0],caption:normalize(text.call(leaves[0])),checked:checked.call(input)===true});
    }
    return expected.every(caption=>result.filter(item=>item.caption===caption).length===1)?result:null;
  }
  function resolve(){
    current();let found=[];
    if(path==='visa.entryType'){
      const all=[...doc.querySelectorAll('[id]')];if(all.length>1000)throw fail('radio_field_collection_truncated');
      const matches=all.filter(node=>id.call(node)==='basic_nddnTtDeNghi');if(matches.length!==1)throw fail('radio_field_binding_ambiguous');
      const group=matches[0],options=entries(group);if(!options)throw fail('radio_field_domain_unconfirmed');found=[{group,header:null,question:null,options}];
    }else{
      const groups=[...doc.querySelectorAll(GROUP)];if(groups.length>1000)throw fail('radio_field_collection_truncated');
      for(const group of groups){const options=entries(group);if(!options)continue;
        let header=group.parentElement;
        for(let depth=0;header&&depth<6;depth++,header=header.parentElement){
          if(!header.matches('.flex.justify-between'))continue;
          const owned=[...header.querySelectorAll(GROUP)];if(owned.length!==1||owned[0]!==group)continue;
          if(header.children.length>10)throw fail('radio_field_collection_truncated');
          const leaves=[...header.children].filter(node=>['DIV','SPAN'].includes(node.tagName)&&visible(node)&&node.childElementCount===0&&!node.contains(group)&&normalize(text.call(node))===questions[path]);
          if(leaves.length>1)throw fail('radio_field_binding_ambiguous');if(leaves.length===1){found.push({group,header,question:leaves[0],options});break;}
        }
      }
    }
    if(found.length!==1)throw fail('radio_field_binding_ambiguous');const state=found[0];
    if(state.options.filter(item=>item.checked).length>1)throw fail('radio_field_selection_ambiguous');
    if(initial&&(['group','header','question'].some(key=>state[key]!==initial[key])||state.options.some((item,index)=>['input','label','leaf','caption'].some(key=>item[key]!==initial.options[index][key]))))throw fail('radio_field_structure_changed');
    current();if(!initial)initial=state;return state;
  }
  const state=resolve();return {state,guard:resolve,current,doc,label:questions[path]??null,read(){const fresh=resolve(),selected=fresh.options.find(item=>item.checked);return selected?path==='visa.entryType'?selected.caption:selected.caption==='Yes':null;}};
}
export function readRadioField(path,ctx){
  try{const op=operation(path,ctx),value=op.read();return {available:true,value,label:op.label,...(value===null?{restorable:false}:{})};}catch(error){throw sanitize(error);}
}
export async function writeRadioField(path,value,ctx){
  try{const wanted=desired(path,value),op=operation(path,ctx);
    try{await chooseRadioOption(op.state.group,wanted,{...ctx,document:op.doc,assertCurrent:op.guard});}
    catch(error){if(issued.has(error))throw error;let code;try{code=error?.code;}catch{}throw fail(helperCodes.has(code)?code:'radio_field_write_failed');}
    const actual=op.read();if(actual!==(path==='visa.entryType'?wanted:wanted==='Yes'))throw fail('radio_field_readback_mismatch');return {ok:true,label:op.label};
  }catch(error){throw sanitize(error);}
}
