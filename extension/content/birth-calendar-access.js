import {readCalendarField,writeCalendarField} from './calendar-access.js';
import {chooseRadioOption} from './radio-transfer.js';
const DOB_ID='basic_ttcnNgayThangNamSinhStr',GROUP='.ant-radio-group,[role="radiogroup"]';
const captions={date:'Full',year:'Only year is known'};
const issued=new WeakSet();
const fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const sanitize=error=>issued.has(error)?error:fail('birth_calendar_dom_unavailable');
const helpers=new Set(['cancelled','document_lost','calendar_value_unconfirmed','calendar_target_lost','calendar_structure_changed','calendar_dom_unavailable',
  'invalid_canonical_date','invalid_canonical_year','year_clear_unsupported','calendar_readback_mismatch','calendar_write_failed',
  'date_target_lost','date_input_not_editable','date_timeout','unsupported_enter','date_event_creation_failed','date_event_dispatch_failed','date_focus_failed','date_blur_failed',
  'date_assignment_failed','date_readback_mismatch','date_clear_unavailable','date_dom_unavailable','radio_target_lost','radio_timeout','radio_group_ambiguous',
  'radio_label_ambiguous','radio_caption_ambiguous','radio_selection_ambiguous','radio_options_changed','radio_click_failed','radio_before_click_failed','radio_selection_changed','radio_dom_unavailable']);
function delegated(error){if(issued.has(error))return error;let code;try{code=error?.code;}catch{}return fail(helpers.has(code)?code:'birth_calendar_access_failed');}
const modeFor=path=>{if(path==='personal.dateOfBirth')return 'date';if(path==='personal.yearOfBirth')return 'year';throw fail('unsupported_birth_calendar_path');};
const normalize=text=>text.trim().replace(/\s+/g,' ');

/** DOB's observed sibling birth header/group and keyed input. Caller owns route,
 * language, manual cancellation and dependencies through synchronous freshness.
 * Reading/writing never switches modes or infers a hidden value. Preparation
 * owns only a guarded radio selection and acceptance of its replacement picker;
 * no value reads, rollback, framework callbacks or store acceptance claims.
 * Native label/leaf checks are runtime safety gates, not passive probe exports.
 */
function operation(path,ctx){
  const wanted=modeFor(path);if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_birth_calendar_context');
  const timeout=ctx.timeoutMs??3000,poll=ctx.pollMs??20,stable=ctx.stableMs??60;
  if(![timeout,poll,stable].every(ms=>Number.isFinite(ms)&&ms>0)||timeout>60000||poll>timeout||stable>timeout)throw fail('invalid_birth_calendar_context');
  const deadline=Date.now()+timeout;
  function current(){
    if(ctx.signal?.aborted)throw fail('cancelled');
    try{const result=ctx.assertCurrent();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}if(result===false)throw null;}
    catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}
    if(ctx.signal?.aborted)throw fail('cancelled');if(Date.now()>=deadline)throw fail('birth_calendar_timeout');
  }
  current();const doc=ctx.document??globalThis.document,realm=doc?.defaultView;
  if(!realm||['Element','HTMLElement','HTMLInputElement','HTMLLabelElement','Node'].some(key=>typeof realm[key]!=='function'))throw fail('birth_calendar_native_unavailable');
  const get=(proto,key)=>Object.getOwnPropertyDescriptor(proto,key)?.get,ip=realm.HTMLInputElement.prototype;
  const id=get(realm.Element.prototype,'id'),type=get(ip,'type'),disabled=get(ip,'disabled'),labels=get(ip,'labels'),checked=get(ip,'checked'),placeholder=get(ip,'placeholder'),
    control=get(realm.HTMLLabelElement.prototype,'control'),text=get(realm.Node.prototype,'textContent');
  if([id,type,disabled,labels,checked,placeholder,control,text].some(fn=>typeof fn!=='function'))throw fail('birth_calendar_native_unavailable');
  const visible=node=>node instanceof realm.HTMLElement&&node.ownerDocument===doc&&node.isConnected===true&&node.getClientRects().length>0&&realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
  let initial=null,allowTransition=false,ownClickStarted=false,transitionSeen=false,candidateBinding=null;
  function structure(){
    current();const all=[...doc.querySelectorAll('[id]')];if(all.length>1000)throw fail('birth_calendar_collection_truncated');
    const matches=all.filter(node=>id.call(node)===DOB_ID);
    if(matches.length!==1&&!(matches.length===0&&allowTransition&&ownClickStarted))throw fail('birth_calendar_binding_ambiguous');
    const input=matches[0]??null;
    if(input&&(!(input instanceof realm.HTMLInputElement)||type.call(input)!=='text'||disabled.call(input)||!visible(input)||input.matches(':disabled')||input.getAttribute('aria-disabled')==='true'||input.getAttribute('role')==='combobox'))throw fail('birth_calendar_target_lost');
    const birth=input?input.closest('.date-of-birth'):initial.birth,picker=input?.closest('.ant-picker')??null,wrapper=input?.closest('.ant-picker-input')??null;
    if(!visible(birth)||birth.parentElement?.closest('.date-of-birth')||input&&(!visible(picker)||!visible(wrapper)||picker.closest('.date-of-birth')!==birth||wrapper.closest('.ant-picker')!==picker||picker.parentElement?.closest('.ant-picker')||wrapper.parentElement?.closest('.ant-picker-input')||picker.matches('.ant-picker-range,.ant-picker-disabled')||
      picker.querySelectorAll('input').length!==1||picker.querySelectorAll('input')[0]!==input||picker.querySelectorAll('.ant-picker-input').length!==1||picker.querySelectorAll('.ant-picker-input')[0]!==wrapper))throw fail('birth_calendar_target_lost');
    const groups=[...doc.querySelectorAll(GROUP)];if(groups.length>1000)throw fail('birth_calendar_collection_truncated');
    const associated=[];
    for(const group of groups){let header=group.parentElement;
      for(let depth=0;header&&depth<6;depth++,header=header.parentElement){
        if(!header.matches('.flex.justify-between'))continue;
        const parent=header.parentElement;
        // Ownership first: never read captions of unrelated question headers.
        if(!parent?.contains(birth)||input&&!parent.contains(input)||header.contains(birth)||input&&header.contains(input))continue;
        const ownedGroups=[...parent.querySelectorAll(GROUP)],ownedBirths=[...parent.querySelectorAll('.date-of-birth')];
        if(ownedGroups.length!==1||ownedGroups[0]!==group||ownedBirths.length!==1||ownedBirths[0]!==birth)continue;
        const leaves=[...header.children].filter(node=>{
          if(!['DIV','SPAN'].includes(node.tagName)||!visible(node)||node.contains(group))return false;
          const leaf=node.childElementCount===0,star=node.tagName==='SPAN'&&node.children.length===1&&node.children[0].tagName==='SPAN'&&node.children[0].childElementCount===0&&normalize(text.call(node.children[0]))==='*';
          return (leaf||star)&&normalize(text.call(node)).replace(/\s*\*$/,'').trim()==='Date of birth';
        });
        if(leaves.length!==1)throw fail('birth_calendar_header_ambiguous');
        if(header.querySelectorAll(GROUP).length!==1)throw fail('birth_calendar_group_ambiguous');
        associated.push({group,header,parent,caption:leaves[0]});break;
      }
    }
    if(associated.length!==1)throw fail('birth_calendar_group_ambiguous');
    const {group,header,parent,caption}=associated[0];
    if(!visible(group)||!visible(header)||!visible(parent)||group.matches(':disabled')||group.getAttribute('aria-disabled')==='true'||group.querySelectorAll(GROUP).length||group.parentElement?.closest(GROUP))throw fail('birth_calendar_group_ambiguous');
    const radios=[...group.querySelectorAll('input')];if(radios.length!==2)throw fail('birth_calendar_radio_ambiguous');
    const entries=radios.map(radio=>{
      if(!(radio instanceof realm.HTMLInputElement)||!visible(radio)||type.call(radio)!=='radio'||disabled.call(radio)||radio.matches(':disabled')||radio.closest(GROUP)!==group)throw fail('birth_calendar_radio_ambiguous');
      const associatedLabels=[...labels.call(radio)];if(associatedLabels.length!==1)throw fail('birth_calendar_label_ambiguous');
      const label=associatedLabels[0];if(!(label instanceof realm.HTMLLabelElement)||!visible(label)||control.call(label)!==radio||!group.contains(label)||label.closest(GROUP)!==group)throw fail('birth_calendar_label_ambiguous');
      const spans=[...label.querySelectorAll('span')];if(spans.length>100)throw fail('birth_calendar_label_ambiguous');
      const leaves=label.childElementCount===0?[label]:spans.filter(node=>node.childElementCount===0&&visible(node)&&node.closest('label')===label&&!node.closest('.ant-radio')&&!node.contains(radio));
      if(leaves.length!==1)throw fail('birth_calendar_label_ambiguous');
      return {radio,label,leaf:leaves[0],caption:normalize(text.call(leaves[0])),checked:checked.call(radio)===true};
    });
    if(entries.filter(e=>e.caption===captions.date).length!==1||entries.filter(e=>e.caption===captions.year).length!==1||entries.filter(e=>e.checked).length!==1)throw fail('birth_calendar_mode_ambiguous');
    const mode=entries.find(e=>e.checked).caption===captions.date?'date':'year';
    const state={input,birth,picker,wrapper,group,header,parent,caption,entries,mode};
    if(initial){
      if(birth!==initial.birth)throw fail('birth_calendar_structure_changed');
      for(const key of ['group','header','parent','caption'])if(state[key]!==initial[key])throw fail('birth_calendar_structure_changed');
      if(entries.some((entry,index)=>['radio','label','leaf','caption'].some(key=>entry[key]!==initial.entries[index][key])))throw fail('birth_calendar_structure_changed');
      if(allowTransition&&ownClickStarted&&mode===wanted)transitionSeen=true;
      if(transitionSeen&&mode!==wanted)throw fail('birth_calendar_mode_changed');
      if(!allowTransition||!ownClickStarted){for(const key of ['input','birth','picker','wrapper'])if(state[key]!==initial[key])throw fail('birth_calendar_structure_changed');if(mode!==initial.mode)throw fail('birth_calendar_mode_changed');}
      if(candidateBinding&&['input','birth','picker','wrapper'].some(key=>state[key]!==candidateBinding[key]))throw fail('birth_calendar_structure_changed');
    }
    const expected=mode==='date'?'DD/MM/YYYY':'YYYY';
    // During the keyed transition the checked radio may precede replacement DOM.
    const placeholderMatched=input&&placeholder.call(input)===expected;
    if(input&&!placeholderMatched&&!(allowTransition&&ownClickStarted&&mode===wanted&&!candidateBinding))throw fail('birth_calendar_placeholder_mismatch');
    // Pin the entire first confirmed replacement, including during the delegated
    // radio helper's stable wait. Preparation cannot reset a changed baseline.
    if(initial&&allowTransition&&ownClickStarted&&mode===wanted&&input!==initial.input&&placeholderMatched&&!candidateBinding)candidateBinding={input,birth,picker,wrapper};
    current();if(!initial)initial=state;return state;
  }
  const state=structure();
  function guard(){const result=structure();if(result.mode!==wanted)throw fail('birth_calendar_inactive');return result;}
  function delay(){current();return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);reject(fail('cancelled'));};
    const timer=setTimeout(()=>{ctx.signal?.removeEventListener('abort',abort);resolve();},Math.min(poll,Math.max(1,deadline-Date.now())));
    ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)abort();
  });}
  return {state,wanted,doc,guard,structure,current,delay,stable,placeholder,transition(){allowTransition=true;},markClick(){structure();ownClickStarted=true;},lock(){initial=structure();allowTransition=false;}};
}
export function readBirthCalendar(path,ctx){
  try{const op=operation(path,ctx);if(op.state.mode!==op.wanted)return {available:false,label:'Date of birth'};
    let result;try{result=readCalendarField(op.state.input,op.wanted,{...ctx,document:op.doc,assertCurrent:op.guard});}catch(error){throw delegated(error);}
    op.guard();return {...result,label:'Date of birth'};
  }catch(error){throw sanitize(error);}
}
export async function writeBirthCalendar(path,value,ctx){
  try{const op=operation(path,ctx);op.guard();
    try{await writeCalendarField(op.state.input,op.wanted,value,{...ctx,document:op.doc,assertCurrent:op.guard});}catch(error){throw delegated(error);}
    op.guard();return {ok:true,label:'Date of birth'};
  }catch(error){throw sanitize(error);}
}
export async function prepareBirthCalendar(path,ctx){
  try{const op=operation(path,ctx);if(op.state.mode===op.wanted){op.guard();return {ok:true};}
    op.transition();try{await chooseRadioOption(op.state.group,captions[op.wanted],{...ctx,document:op.doc,assertCurrent:op.structure,beforeClick:op.markClick});}catch(error){throw delegated(error);}
    let candidate=null,since=0;
    for(;;){const state=op.structure();if(state.mode!==op.wanted)throw fail('birth_calendar_mode_changed');
      if(state.input&&state.input!==op.state.input&&op.placeholder.call(state.input)===(op.wanted==='date'?'DD/MM/YYYY':'YYYY')){
        if(candidate!==state.input){candidate=state.input;since=Date.now();}
        if(Date.now()-since>=op.stable){op.lock();op.guard();return {ok:true};}
      }else {candidate=null;since=0;}
      await op.delay();
    }
  }catch(error){throw sanitize(error);}
}
