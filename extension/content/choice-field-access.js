import {readSingleSelect,selectSingleOption} from './single-select.js';
const IDs=Object.freeze({'personal.nationality':'basic_ttcnMaQt','passport.type':'basic_hcLoai',
 'trip.entryCheckpoint':'basic_ttcdNcCuaKhau','trip.exitCheckpoint':'basic_ttcdXcCuaKhau','trip.province':'basic_ttcdTinhTp','trip.ward':'basic_ttcdPhuongXa'});
const issued=new WeakSet(),fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const fold=text=>text.trim().replace(/\s+/g,' ').toLowerCase();
const safe=error=>{if(issued.has(error))return error;let code;try{code=error?.code;}catch{}return fail(['cancelled','document_lost'].includes(code)?code:'choice_field_unavailable');};

// Concrete observed Ant single-select fields. Captions and temporary search text
// remain in RAM. No option values, APIs, framework state, rollback or submission.
function operation(path,ctx){
 if(typeof path!=='string'||!Object.hasOwn(IDs,path))throw fail('unsupported_choice_field_path');
 if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_choice_field_context');
 const deadline=Date.now()+(Number.isFinite(ctx.timeoutMs)?Math.max(1,Math.min(ctx.timeoutMs,10000)):10000);
 function current(){if(ctx.signal?.aborted)throw fail('cancelled');
  try{const result=ctx.assertCurrent();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}if(result===false)throw null;}catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}
  if(ctx.signal?.aborted)throw fail('cancelled');if(Date.now()>=deadline)throw fail('choice_field_timeout');
 }
 current();const doc=ctx.document??globalThis.document,realm=doc?.defaultView;
 if(!realm||typeof realm.HTMLInputElement!=='function')throw fail('choice_field_unavailable');
 const id=Object.getOwnPropertyDescriptor(realm.Element.prototype,'id')?.get;
 let initial=null;
 const visible=node=>node?.ownerDocument===doc&&node.isConnected&&node.getClientRects().length&&realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
 function guard(){current();const nodes=[...doc.querySelectorAll('[id]')];if(nodes.length>1000)throw fail('choice_field_unavailable');
  const matches=nodes.filter(node=>id.call(node)===IDs[path]);if(matches.length!==1)throw fail('choice_field_unavailable');const input=matches[0],root=input.closest('.ant-select'),selectors=root?.querySelectorAll('.ant-select-selector');
  if(!(input instanceof realm.HTMLInputElement)||input.type!=='search'||input.getAttribute('role')!=='combobox'||input.disabled||input.matches(':disabled')||!visible(input)||!visible(root)||root.matches('.ant-select-disabled,.ant-select-multiple')||selectors?.length!==1||!visible(selectors[0])||!selectors[0].contains(input)||root.querySelectorAll('input[role="combobox"]').length!==1)throw fail('choice_field_unavailable');
  const refs=[input,root,selectors[0]];if(initial&&refs.some((node,index)=>node!==initial[index]))throw fail('document_lost');current();initial??=refs;return refs;
 }
 const [input,root,selector]=guard(),wrapped={...ctx,document:doc,assertCurrent:guard};
 const refs=node=>[...new Set(['aria-controls','aria-owns'].flatMap(key=>(node.getAttribute(key)||'').split(/\s+/).filter(Boolean)))];
 function popup(){guard();const identifiers=refs(input),nodes=[...doc.querySelectorAll('[id]')],owners=[...doc.querySelectorAll('[role="combobox"]')];
  if(identifiers.length!==1||identifiers[0].length>1000||nodes.length>1000||owners.length>1000)throw fail('choice_popup_ambiguous');
  const targets=nodes.filter(node=>id.call(node)===identifiers[0]);if(targets.length>1)throw fail('choice_popup_ambiguous');if(!targets.length)return null;
  const list=targets[0],dropdown=list.closest('.ant-select-dropdown');if(list.getAttribute('role')!=='listbox'||!dropdown||dropdown.parentElement?.closest('.ant-select-dropdown')||dropdown.querySelectorAll('[role="listbox"]').length!==1)throw fail('choice_popup_ambiguous');
  for(const owner of owners)if(owner!==input){const aliases=refs(owner);if(aliases.length>20)throw fail('choice_popup_ambiguous');for(const alias of aliases){const linked=nodes.filter(node=>id.call(node)===alias);if(linked.length>1)throw fail('choice_popup_ambiguous');const candidate=linked[0];if(candidate&&(candidate===list||candidate===dropdown||candidate.closest('.ant-select-dropdown')===dropdown||candidate.contains(list)))throw fail('choice_popup_ambiguous');}}
  guard();return visible(dropdown)?dropdown:null;
 }
 function match(wanted){const dropdown=popup();if(!dropdown)return null;const rows=[...dropdown.querySelectorAll('.ant-select-item-option')];if(rows.length>500)throw fail('choice_options_truncated');const found=[];
  for(const row of rows){if(!visible(row)||row.closest('.ant-select-dropdown')!==dropdown)continue;const leaves=row.querySelectorAll('.ant-select-item-option-content');if(leaves.length!==1||leaves[0].childElementCount||!visible(leaves[0])||leaves[0].closest('.ant-select-item-option')!==row)continue;
   const caption=leaves[0].textContent.trim().replace(/\s+/g,' ');if(fold(caption)===wanted){if(row.matches('.ant-select-item-option-disabled')||row.getAttribute('aria-disabled')==='true')throw fail('choice_option_unavailable');found.push(caption);}}
  if(found.length>1)throw fail('choice_option_ambiguous');guard();return found[0]??null;
 }
 function delay(ms){guard();return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);reject(fail('cancelled'));};const timer=setTimeout(()=>{ctx.signal?.removeEventListener('abort',abort);try{guard();resolve();}catch(error){reject(error);}},Math.min(ms,Math.max(1,deadline-Date.now())));ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)abort();});}
 function dispatch(node,event){guard();realm.EventTarget.prototype.dispatchEvent.call(node,event);guard();}
 return {input,selector,realm,wrapped,guard,popup,match,delay,dispatch,read(){guard();const value=readSingleSelect(input,wrapped);guard();return value;}};
}
export function readChoiceField(path,ctx){try{const op=operation(path,ctx),value=op.read();return {available:true,value,label:null,...(value===null?{restorable:false}:{})};}catch(error){throw safe(error);}}
export async function writeChoiceField(path,wanted,ctx){
 try{if(typeof wanted!=='string'||!fold(wanted))throw fail('invalid_choice_field_value');wanted=wanted.trim().replace(/\s+/g,' ');const op=operation(path,ctx),normalized=fold(wanted),original=op.read();
  if(original!==null&&fold(original)===normalized){await selectSingleOption(op.input,original,op.wrapped);return {ok:true,label:null};}
  if(!op.popup()){const event=new op.realm.MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,buttons:1});op.dispatch(op.selector,event);}
  while(!op.popup())await op.delay(20);
  let caption=op.match(normalized);
  if(!caption&&!op.input.readOnly){const descriptor=Object.getOwnPropertyDescriptor(op.realm.HTMLInputElement.prototype,'value'),event=new op.realm.Event('input',{bubbles:true});
   op.guard();if(op.input.readOnly||op.input.disabled||typeof descriptor?.set!=='function')throw fail('choice_field_unavailable');descriptor.set.call(op.input,wanted);op.dispatch(op.input,event);await op.delay(250);caption=op.match(normalized);
  }
  if(!caption){const dropdown=op.popup(),holders=dropdown?.querySelectorAll('.rc-virtual-list-holder');
   if(holders?.length!==1||holders[0].closest('.ant-select-dropdown')!==dropdown)throw fail('choice_option_not_found');const holder=holders[0],proto=op.realm.Element.prototype;
   const setter=Object.getOwnPropertyDescriptor(proto,'scrollTop')?.set,getter=Object.getOwnPropertyDescriptor(proto,'scrollTop')?.get,height=Object.getOwnPropertyDescriptor(proto,'clientHeight')?.get,total=Object.getOwnPropertyDescriptor(proto,'scrollHeight')?.get;
   if([setter,getter,height,total].some(fn=>typeof fn!=='function'))throw fail('choice_option_not_found');
   function owned(){op.guard();if(op.popup()!==dropdown||!holder.isConnected||dropdown.querySelectorAll('.rc-virtual-list-holder').length!==1||dropdown.querySelectorAll('.rc-virtual-list-holder')[0]!==holder)throw fail('document_lost');}
   owned();setter.call(holder,0);await op.delay(20);
   for(let step=0;step<100;step++){owned();caption=op.match(normalized);if(caption)break;const position=getter.call(holder),viewport=height.call(holder),max=Math.max(0,total.call(holder)-viewport);if(viewport<=0||position>=max)break;const next=Math.min(max,position+Math.max(1,viewport*0.8));owned();setter.call(holder,next);await op.delay(20);}
  }
  if(!caption)throw fail('choice_option_not_found');op.guard();if(op.read()!==original)throw fail('choice_field_changed');await selectSingleOption(op.input,caption,op.wrapped);
  op.guard();const selected=op.read();if(selected===null||fold(selected)!==normalized)throw fail('choice_field_mismatch');return {ok:true,label:null};
 }catch(error){throw safe(error);}
}
