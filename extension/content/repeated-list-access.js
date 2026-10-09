import {RECORDS,LIST_CONTROLS} from '../shared/contract.js';
import {setTextField} from './text-transfer.js';
import {readCalendarField,writeCalendarField} from './calendar-access.js';
import {readSingleSelect,selectSingleOption} from './single-select.js';
const definitions={
 'personal.previousPassports':['previousPassports','Have you ever used any other passports to enter into Viet Nam?'],
 'personal.otherNationalities':[null,'Do you have multiple nationalities?'],
 'personal.violations':['violations','Violation of the Vietnamese laws/regulations (if any)'],
 'passport.otherValidPassports':['otherValidPassports','Do you hold any other valid passports'],
 'trip.vietnamContacts':['vietnamContacts','Agency/Organization/Individual that the applicant plans to contact when enter into Viet Nam?'],
 'trip.previousVisits':['previousVisits','Have you been to Viet Nam in the last 01 year?'],
 'trip.relativesInVietnam':['relativesInVietnam','Do you have relatives who currently reside in Viet Nam?']
};
const aliases={number:['passport number','number','so','sohc','sohochieu'],fullName:['full name','name','hoten'],dateOfBirth:['date of birth','ngaysinh'],nationality:['nationality','quoctich'],
 act:['act','violation','hanhvi'],date:['date','ngayvipham'],sanction:['sanction','penalty','hinhthucxuly'],authority:['authority','coquanxuly'],type:['passport type','type','loai'],
 placeOfIssue:['place of issue','noicap'],dateOfIssue:['date of issue','ngaycap'],dateOfExpiry:['date of expiry','expiry date','giatriden'],typeDetails:['type details','loaicuthe'],
 name:['name','organization','ten'],phone:['phone','telephone','sdt'],address:['address','diachi'],purpose:['purpose','mucdich'],from:['from','from date','tungay'],to:['to','to date','denngay'],relationship:['relationship','quanhe']};
const GROUP='.ant-radio-group,[role="radiogroup"]',issued=new WeakSet();
const fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const fold=value=>value.trim().replace(/\s+/g,' ').toLowerCase();
const sanitized=error=>{if(issued.has(error))return error;let code;try{code=error?.code;}catch{}return fail(['cancelled','document_lost'].includes(code)?code:'repeated_list_unavailable');};
function operation(document,path,ctx){
 if(!Object.hasOwn(definitions,path)||!Object.hasOwn(LIST_CONTROLS,path))throw fail('unsupported_repeated_list');
 if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_repeated_list_context');
 const realm=document.defaultView,deadline=Date.now()+(ctx.timeoutMs??10000),[record,question]=definitions[path],fields=record?RECORDS[record]:{nationality:'choice'};
 function current(){if(ctx.signal?.aborted)throw fail('cancelled');try{const result=ctx.assertCurrent();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}if(result===false)throw null;}catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}if(ctx.signal?.aborted)throw fail('cancelled');if(Date.now()>=deadline)throw fail('repeated_list_timeout');}
 const visible=node=>node?.ownerDocument===document&&node.isConnected&&node.getClientRects().length&&realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
 let ownerInitial,groupInitial,headerInitial;
 function resolve(){current();const groups=[...document.querySelectorAll(GROUP)];if(groups.length>1000)throw fail('repeated_list_unavailable');const found=[];
  for(const group of groups){let header=group.parentElement;for(let depth=0;header&&depth<6;depth++,header=header.parentElement){if(!header.matches('.flex.justify-between')||header.querySelectorAll(GROUP).length!==1||header.children.length>10)continue;
   const captions=[...header.children].filter(node=>['DIV','SPAN'].includes(node.tagName)&&node.childElementCount===0&&!node.contains(group)&&fold(node.textContent)===fold(question));if(captions.length===1)found.push({group,header});else if(captions.length>1)throw fail('repeated_list_unavailable');if(captions.length)break;}}
  if(found.length!==1)throw fail('repeated_list_unavailable');const {group,header}=found[0];let owner=header.parentElement,wrapper=null;
  for(let depth=0;owner&&depth<6;depth++,owner=owner.parentElement){const tables=[...owner.querySelectorAll('.table-custom')];if(tables.length===1&&owner.querySelectorAll(GROUP).length===1){wrapper=tables[0];break;}if(tables.length>1)break;}
  if(!wrapper){current();return {rendered:false,rows:[]};}
  if(!visible(wrapper)||ownerInitial&&(owner!==ownerInitial||group!==groupInitial||header!==headerInitial))throw fail('document_lost');ownerInitial??=owner;groupInitial??=group;headerInitial??=header;
  const bodies=[...wrapper.querySelectorAll('tbody.ant-table-tbody')];if(bodies.length!==1)throw fail('repeated_list_unavailable');const body=bodies[0],rows=[...body.querySelectorAll('tr.ant-table-row')].filter(row=>row.parentElement===body&&visible(row));if(rows.length>100)throw fail('repeated_list_unavailable');
  const adds=[...wrapper.querySelectorAll('tfoot img[alt="PlusCircle"]')].filter(visible);if(adds.length!==1)throw fail('repeated_list_unavailable');current();return {rendered:true,owner,wrapper,body,rows,add:adds[0]};
 }
 async function delay(ms=20){current();return new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);reject(fail('cancelled'));};const timer=setTimeout(()=>{ctx.signal?.removeEventListener('abort',abort);try{current();resolve();}catch(error){reject(error);}},Math.min(ms,Math.max(1,deadline-Date.now())));ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)abort();});}
 async function until(predicate){for(;;){current();const result=predicate();if(result)return result;await delay();}}
 function controls(state,row){current();if(!state.rows.includes(row)||!row.isConnected)throw fail('document_lost');const cells=[...row.children].filter(node=>node.tagName==='TD');const inputs=[...row.querySelectorAll('input,textarea')].filter(node=>visible(node)&&node.closest('tr')===row&&!node.disabled);if(inputs.length>20)throw fail('repeated_list_unavailable');
  const kind=node=>node.getAttribute('role')==='combobox'&&node.closest('.ant-select')?'choice':node.closest('.ant-picker')?'date':['text','textarea'].includes(node.type)||node.tagName==='TEXTAREA'?'text':null;
  const mapped={},used=new Set(),headers=[...state.wrapper.querySelectorAll('thead th')];
  for(const [field,type]of Object.entries(fields)){const options=inputs.filter(input=>kind(input)===type&&!used.has(input));const semantic=options.filter(input=>{
    const cell=input.closest('td'),heading=headers[cells.indexOf(cell)],h=heading?fold(heading.textContent):'',nativeId=(input.id??'').toLowerCase();return (aliases[field]??[field.toLowerCase()]).some(alias=>h===alias||nativeId.endsWith('_'+alias.replace(/\s+/g,'')));
   });if(semantic.length===1){mapped[field]=semantic[0];used.add(semantic[0]);}}
  for(const [field,type]of Object.entries(fields))if(!mapped[field]&&field!=='typeDetails'){const same=inputs.filter(input=>kind(input)===type&&!used.has(input));if(same.length===1){mapped[field]=same[0];used.add(same[0]);}}
  if(fields.typeDetails&&mapped.type&&!mapped.typeDetails){const detail=inputs.filter(input=>!used.has(input)&&kind(input)==='text'&&input.closest('td')===mapped.type.closest('td'));if(detail.length===1){mapped.typeDetails=detail[0];used.add(detail[0]);}}
  // Public record schema's ordered native-control signature is accepted only
  // when the entire row matches; unrelated/action/measurement cells are excluded.
  const required=Object.entries(fields).filter(([field])=>field!=='typeDetails');const ordered=inputs.filter(input=>!used.has(input));let index=0;
  for(const [field,type]of required)if(!mapped[field]){const input=ordered[index++];if(!input||kind(input)!==type)throw fail('repeated_list_columns_unavailable');mapped[field]=input;used.add(input);}
  if(fields.typeDetails&&!mapped.typeDetails){const remaining=inputs.filter(input=>!used.has(input)&&kind(input)==='text');if(remaining.length===1)mapped.typeDetails=remaining[0];else if(remaining.length>1)throw fail('repeated_list_columns_unavailable');}
  return mapped;
 }
 function rowContext(index,row,field,input){return {...ctx,document,assertCurrent(){current();const state=resolve();if(state.rows[index]!==row||controls(state,row)[field]!==input)throw fail('document_lost');current();}};}
 function click(node){current();if(!visible(node)||node.matches(':disabled'))throw fail('repeated_list_action_unavailable');realm.HTMLElement.prototype.click.call(node);current();}
 return {realm,fields,record,current,visible,resolve,delay,until,controls,rowContext,click};
}
async function choose(input,wanted,ctx,op){
 if(typeof wanted!=='string'||!fold(wanted))throw fail('repeated_list_choice_unavailable');const normalize=fold(wanted),original=readSingleSelect(input,ctx);if(original&&fold(original)===normalize){await selectSingleOption(input,original,ctx);return;}
 const refs=node=>[...new Set(['aria-controls','aria-owns'].flatMap(key=>(node.getAttribute(key)||'').split(/\s+/).filter(Boolean)))];
 function popup(){ctx.assertCurrent();const ids=refs(input),nodes=[...ctx.document.querySelectorAll('[id]')];if(ids.length!==1||nodes.length>1000)throw fail('repeated_list_choice_unavailable');const matches=nodes.filter(node=>node.id===ids[0]);if(matches.length>1)throw fail('repeated_list_choice_unavailable');if(!matches.length)return null;const list=matches[0],dropdown=list.closest('.ant-select-dropdown');if(list.getAttribute('role')!=='listbox'||!dropdown||dropdown.parentElement?.closest('.ant-select-dropdown')||dropdown.querySelectorAll('[role="listbox"]').length!==1)throw fail('repeated_list_choice_unavailable');
  const owners=[...ctx.document.querySelectorAll('[role="combobox"]')];if(owners.length>1000)throw fail('repeated_list_choice_unavailable');for(const owner of owners)if(owner!==input)for(const ref of refs(owner)){const linked=nodes.filter(node=>node.id===ref);if(linked.length>1)throw fail('repeated_list_choice_unavailable');const target=linked[0];if(target&&(target===list||target===dropdown||target.closest('.ant-select-dropdown')===dropdown||target.contains(list)))throw fail('repeated_list_choice_unavailable');}return op.visible(dropdown)?dropdown:null;}
 function caption(){const dropdown=popup();if(!dropdown)return null;const matches=[];for(const row of dropdown.querySelectorAll('.ant-select-item-option')){if(!op.visible(row)||row.closest('.ant-select-dropdown')!==dropdown)continue;const leaves=row.querySelectorAll('.ant-select-item-option-content');if(leaves.length===1&&!leaves[0].childElementCount&&op.visible(leaves[0])&&fold(leaves[0].textContent)===normalize){if(row.matches('.ant-select-item-option-disabled')||row.getAttribute('aria-disabled')==='true')throw fail('repeated_list_choice_unavailable');matches.push(leaves[0].textContent.trim().replace(/\s+/g,' '));}}if(matches.length>1)throw fail('repeated_list_choice_unavailable');return matches[0]??null;}
 if(!popup()){const selector=input.closest('.ant-select').querySelector('.ant-select-selector'),event=new op.realm.MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,buttons:1});ctx.assertCurrent();op.realm.EventTarget.prototype.dispatchEvent.call(selector,event);}
 await op.until(()=>popup());let actual=caption();if(!actual){const dropdown=popup(),holders=dropdown.querySelectorAll('.rc-virtual-list-holder');if(holders.length!==1)throw fail('repeated_list_choice_unavailable');const holder=holders[0],proto=op.realm.Element.prototype,setter=Object.getOwnPropertyDescriptor(proto,'scrollTop')?.set,top=Object.getOwnPropertyDescriptor(proto,'scrollTop')?.get,height=Object.getOwnPropertyDescriptor(proto,'clientHeight')?.get,total=Object.getOwnPropertyDescriptor(proto,'scrollHeight')?.get;
  if([setter,top,height,total].some(fn=>typeof fn!=='function'))throw fail('repeated_list_choice_unavailable');const guard=()=>{ctx.assertCurrent();if(popup()!==dropdown||!holder.isConnected||holder.closest('.ant-select-dropdown')!==dropdown)throw fail('document_lost');};guard();setter.call(holder,0);await op.delay();
  for(let step=0;step<100;step++){guard();actual=caption();if(actual)break;const pos=top.call(holder),size=height.call(holder),max=total.call(holder)-size;if(size<=0||pos>=max)break;guard();setter.call(holder,Math.min(max,pos+Math.max(1,size*.8)));await op.delay();}
 }
 if(!actual)throw fail('repeated_list_choice_unavailable');ctx.assertCurrent();if(readSingleSelect(input,ctx)!==original)throw fail('document_lost');await selectSingleOption(input,actual,ctx);
}
function textValue(input,realm){const proto=input.tagName==='TEXTAREA'?realm.HTMLTextAreaElement.prototype:realm.HTMLInputElement.prototype;return Object.getOwnPropertyDescriptor(proto,'value').get.call(input);}
function writeText(input,value,ctx,realm){if(input.tagName!=='TEXTAREA'){setTextField(input,value,ctx);return;}const setter=Object.getOwnPropertyDescriptor(realm.HTMLTextAreaElement.prototype,'value').set;ctx.assertCurrent();setter.call(input,value);for(const type of ['input','change']){const event=new realm.Event(type,{bubbles:true});ctx.assertCurrent();realm.EventTarget.prototype.dispatchEvent.call(input,event);}}
export function readRepeatedList(document,path,ctx){
 try{const op=operation(document,path,ctx),state=op.resolve();if(!state.rendered)return {available:true,value:[]};let restorable=true;const value=state.rows.map((row,index)=>{const inputs=op.controls(state,row),record={};for(const [field,type]of Object.entries(op.fields)){const input=inputs[field];if(!input){record[field]='';continue;}const scoped=op.rowContext(index,row,field,input);scoped.assertCurrent();record[field]=type==='choice'?readSingleSelect(input,scoped):type==='date'?readCalendarField(input,'date',scoped).value:textValue(input,op.realm);scoped.assertCurrent();if(record[field]===null)restorable=false;}return op.record?record:record.nationality;});return {available:true,value,...(!restorable?{restorable:false}:{})};}catch(error){throw sanitized(error);}
}
export async function replaceRepeatedList(document,path,rows,ctx){
 try{if(!Array.isArray(rows)||rows.length>100)throw fail('invalid_repeated_list_rows');const op=operation(document,path,ctx);let state=await op.until(()=>{const s=op.resolve();return s.rendered?s:null;});
  while(state.rows.length<rows.length){const count=state.rows.length;op.click(state.add);state=await op.until(()=>{const s=op.resolve();return s.rows.length===count+1?s:null;});}
  for(let index=0;index<rows.length;index++){const desired=op.record?rows[index]:{nationality:rows[index]};for(const [field,type]of Object.entries(op.fields)){state=op.resolve();const row=state.rows[index],input=op.controls(state,row)[field],value=desired[field]??'';if(!input){if(value==='')continue;throw fail('repeated_list_columns_unavailable');}const scoped=op.rowContext(index,row,field,input);scoped.assertCurrent();if(type==='choice')await choose(input,value,scoped,op);else if(type==='date')await writeCalendarField(input,'date',value,scoped);else{writeText(input,value,scoped,op.realm);await op.delay(30);scoped.assertCurrent();if(textValue(input,op.realm)!==value)throw fail('repeated_list_readback_mismatch');}}}
  const comparable=values=>values.map(value=>op.record?Object.fromEntries(Object.entries(value).filter(([key,val])=>key!=='typeDetails'||val!==''&&val!==null).sort(([a],[b])=>a.localeCompare(b)).map(([key,val])=>[key,op.fields[key]==='choice'&&typeof val==='string'?fold(val):val])):typeof value==='string'?fold(value):value);
  if(JSON.stringify(comparable(readRepeatedList(document,path,ctx).value.slice(0,rows.length)))!==JSON.stringify(comparable(rows)))throw fail('repeated_list_readback_mismatch');
  state=op.resolve();while(state.rows.length>rows.length){const count=state.rows.length,row=state.rows[count-1],removes=[...row.querySelectorAll('img[alt="XCircle"]')].filter(op.visible);if(removes.length!==1)throw fail('repeated_list_remove_unavailable');const visiblePopups=()=>[...document.querySelectorAll('.ant-popover')].filter(op.visible),before=new Set(visiblePopups());op.click(removes[0]);let next=op.resolve();if(next.rows.length===count){const popup=await op.until(()=>{const fresh=visiblePopups().filter(node=>!before.has(node));if(fresh.length>1)throw fail('repeated_list_remove_unavailable');return fresh[0];});const buttons=[...popup.querySelectorAll('.ant-popover-buttons button')].filter(button=>op.visible(button)&&['yes','confirm','ok'].includes(fold(button.textContent)));if(buttons.length!==1)throw fail('repeated_list_remove_unavailable');op.click(buttons[0]);}state=await op.until(()=>{const s=op.resolve();return s.rows.length===count-1?s:null;});}
  const actual=readRepeatedList(document,path,ctx).value;
  if(JSON.stringify(comparable(actual))!==JSON.stringify(comparable(rows)))throw fail('repeated_list_readback_mismatch');return {ok:true};
 }catch(error){throw sanitized(error);}
}
