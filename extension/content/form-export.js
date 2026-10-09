import {FIELDS,SCHEMA_VERSION,LIST_CONTROLS} from '../shared/contract.js';
import {validateApplication,isCalendarDate} from '../shared/validator.js';
import {SCALAR_BINDINGS} from './scalar-text-access.js';
import {CALENDAR_BINDINGS} from './calendar-field-access.js';
import {NUMERIC_BINDINGS} from './numeric-field-access.js';

const put=(data,path,value)=>{
  const keys=path.split('.');let parent=data;
  for(const key of keys.slice(0,-1))parent=parent[key]??= {};
  parent[keys.at(-1)]=value;
};
const get=(data,path)=>path.split('.').reduce((value,key)=>value?.[key],data);
// Read known native inputs directly so invalid drafts and whitespace survive.
// No clicks, mode changes, focus, or preparation are permitted during export.
export function readExportInput(document,path,ctx) {
  const birth=['personal.dateOfBirth','personal.yearOfBirth'].includes(path);
  const spec=SCALAR_BINDINGS[path]??CALENDAR_BINDINGS[path]??NUMERIC_BINDINGS[path];
  if(!spec&&!birth)return undefined;
  ctx.assertCurrent();
  const realm=document.defaultView;
  const nodes=[...document.querySelectorAll('[id]')].filter(node=>node.id===(birth?'basic_ttcnNgayThangNamSinhStr':spec.id));
  if(nodes.length!==1||!(nodes[0] instanceof realm.HTMLInputElement)||!nodes[0].isConnected)return {available:false};
  const input=nodes[0],getter=Object.getOwnPropertyDescriptor(realm.HTMLInputElement.prototype,'value')?.get;
  if(!getter)return {available:false};
  if(birth&&input.placeholder!==(path==='personal.yearOfBirth'?'YYYY':'DD/MM/YYYY'))return {available:true,value:null};
  let value=getter.call(input);ctx.assertCurrent();
  if(CALENDAR_BINDINGS[path]||path==='personal.dateOfBirth'){
    const parts=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if(parts){const canonical=`${parts[3]}-${parts[2]}-${parts[1]}`;if(isCalendarDate(canonical))value=canonical;}
  }else if(NUMERIC_BINDINGS[path]||path==='personal.yearOfBirth'){
    if(value.trim()!==''&&Number.isFinite(Number(value)))value=Number(value);
  }
  return {available:true,value};
}

export async function captureForm(adapter,ctx) {
  const data={schemaVersion:SCHEMA_VERSION},warnings=[];
  for(const [path,spec] of Object.entries(FIELDS)){
    ctx.assertCurrent();
    if(LIST_CONTROLS[path]&&get(data,LIST_CONTROLS[path])===false)continue;
    if(path.startsWith('expenses.sponsor.')&&typeof data.expenses?.payer==='string'&&data.expenses.payer.trim().toLowerCase()==='personal')continue;
    const empty=['records','choices'].includes(spec.type)?[]:['text','date'].includes(spec.type)?'':null;
    let value=empty;
    try {
      const result=await (adapter.readExportField??adapter.readField)(path,ctx);
      ctx.assertCurrent();
      if(result?.available===true&&Object.hasOwn(result,'value'))value=result.value;
      else warnings.push({path,reason:'Поле недоступно для чтения; сохранено пустое значение.'});
    }catch(error){
      ctx.assertCurrent();
      warnings.push({path,reason:'Не удалось прочитать поле; сохранено пустое значение.'});
    }
    put(data,path,value);
  }
  const validation=validateApplication(JSON.stringify(data));
  for(const error of validation.errors)warnings.push({path:error.path,reason:error.reason});
  // Confirmation is deliberately absent from the JSON schema, but its mismatch
  // remains useful as a warning about the current form.
  try {
    const confirmation=await (adapter.readExportField??adapter.readField)('personal.confirmEmail',ctx);
    if(confirmation?.available&&confirmation.value!==data.personal.email)warnings.push({path:'personal.email',reason:'Email и Re-enter Email различаются. При заполнении оба получат значение email.'});
  }catch {ctx.assertCurrent();}
  ctx.assertCurrent();return {data,warnings};
}
