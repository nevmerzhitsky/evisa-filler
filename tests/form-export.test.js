import test from 'node:test';
import assert from 'node:assert/strict';
import {captureForm,readExportInput} from '../extension/content/form-export.js';
import {FIELDS,LIST_CONTROLS} from '../extension/shared/contract.js';
import {validateApplication} from '../extension/shared/validator.js';
import {exportFilename,readCurrentForm,saveFormJSON} from '../extension/sidebar/form-export.js';

const ctx={assertCurrent(){}};
const get=(data,path)=>path.split('.').reduce((value,key)=>value?.[key],data);
test('snapshot includes every schema field, empty values, false, zero and complete rows without normalization',async()=>{
  const values={'personal.email':'example@example.invalid','personal.confirmEmail':'example@example.invalid','personal.surname':'  Example  ',
    'expenses.estimatedAmount':0,'expenses.hasInsurance':false,'trip.hasVietnamContacts':true,
    'trip.vietnamContacts':[{name:'Person',phone:'001',address:'Address',purpose:'Visit'}]};
  const adapter={readField:path=>Object.hasOwn(values,path)?{available:true,value:values[path]}:{available:false}};
  const {data}=await captureForm(adapter,ctx);
  for(const path of Object.keys(FIELDS))assert.notEqual(get(data,path),undefined,path);
  assert.equal(data.personal.surname,'  Example  ');assert.equal(data.contact.phone,'');assert.equal(data.personal.sex,null);
  assert.deepEqual(data.personal.previousPassports,[]);assert.equal(data.expenses.estimatedAmount,0);assert.equal(data.expenses.hasInsurance,false);
  assert.deepEqual(data.trip.vietnamContacts,values['trip.vietnamContacts']);assert.equal(Object.hasOwn(data.personal,'confirmEmail'),false);
  assert.equal(validateApplication(JSON.stringify(data)).ok,true);
});
test('invalid draft is preserved with warnings including email confirmation mismatch',async()=>{
  const adapter={readField:path=>({available:true,value:path==='personal.email'?'a@example.invalid':path==='personal.confirmEmail'?'b@example.invalid':path==='passport.dateOfIssue'?'invalid date':''})};
  const {data,warnings}=await captureForm(adapter,ctx);
  assert.equal(data.passport.dateOfIssue,'invalid date');assert.equal(data.personal.email,'a@example.invalid');
  assert.ok(warnings.some(item=>item.path==='passport.dateOfIssue'));assert.ok(warnings.some(item=>item.path==='personal.email'));
});
test('false list flags omit all seven inactive lists without reading them or generating warnings',async()=>{
  const reads=[];
  const flags=new Set(Object.values(LIST_CONTROLS));
  const adapter={readField(path){reads.push(path);return {available:true,value:flags.has(path)?false:''};}};
  const {data,warnings}=await captureForm(adapter,ctx);
  for(const [list,control] of Object.entries(LIST_CONTROLS)){
    assert.equal(get(data,control),false);assert.equal(get(data,list),undefined);assert.equal(reads.includes(list),false);
    assert.equal(warnings.some(item=>item.path===list),false);
  }
  assert.equal(validateApplication(JSON.stringify(data)).ok,true);
});
test('true and unselected flags preserve their empty lists',async()=>{
  for(const flag of [true,null]){
    const flags=new Set(Object.values(LIST_CONTROLS));
    const adapter={readField:path=>({available:true,value:flags.has(path)?flag:Object.hasOwn(LIST_CONTROLS,path)?[]:''})};
    const {data}=await captureForm(adapter,ctx);
    for(const list of Object.keys(LIST_CONTROLS))assert.deepEqual(get(data,list),[]);
  }
});
test('Personal payer omits the entire sponsor object; other payer values retain it',async()=>{
  for(const payer of ['Personal',' PERSONAL ','Company',null]){
    const reads=[];
    const adapter={readField(path){reads.push(path);return {available:true,value:path==='expenses.payer'?payer:''};}};
    const {data,warnings}=await captureForm(adapter,ctx);
    if(typeof payer==='string'&&payer.trim().toLowerCase()==='personal'){
      assert.equal(Object.hasOwn(data.expenses,'sponsor'),false);
      assert.equal(reads.some(path=>path.startsWith('expenses.sponsor.')),false);
      assert.equal(warnings.some(item=>item.path.startsWith('expenses.sponsor.')),false);
    }else assert.deepEqual(data.expenses.sponsor,{name:'',address:'',phone:''});
  }
});
test('native export preserves invalid text, converts valid dates and reads only the current birth mode',()=>{
  class Input {get value(){return this.raw;}}
  const input=new Input();input.id='basic_ttcnNgayThangNamSinhStr';input.isConnected=true;input.placeholder='YYYY';input.raw='1990';
  const document={defaultView:{HTMLInputElement:Input},querySelectorAll:()=>[input]};
  assert.deepEqual(readExportInput(document,'personal.yearOfBirth',ctx),{available:true,value:1990});
  assert.equal(readExportInput(document,'personal.dateOfBirth',ctx).value,null);
  input.placeholder='DD/MM/YYYY';input.raw='15/06/1990';assert.equal(readExportInput(document,'personal.dateOfBirth',ctx).value,'1990-06-15');
  input.raw='31/02/1990';assert.equal(readExportInput(document,'personal.dateOfBirth',ctx).value,'31/02/1990');
  input.id='basic_ttcnEmail';input.raw='  invalid draft  ';assert.equal(readExportInput(document,'personal.email',ctx).value,input.raw);
});
const event=()=>{const listeners=new Set();return {addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),emit:value=>{for(const fn of [...listeners])fn(value);},listeners};};
test('sidebar export probes the captured tab, requests read-only export and releases the port',async()=>{
  const port={onMessage:event(),onDisconnect:event(),sent:[],disconnect(){this.closed=true;},postMessage(message){this.sent.push(message);
    queueMicrotask(()=>this.onMessage.emit(message.type==='probe'?{type:'probe',runId:message.runId,supported:true,documentId:'doc'}:{type:'exported',runId:message.runId,data:{schemaVersion:1},warnings:[]}));}};
  const browser={tabs:{query:async()=>[{id:7,url:'https://evisa.gov.vn/e-visa/foreigners/fake'}],connect:(id,options)=>{assert.equal(id,7);assert.equal(options.frameId,0);return port;}}};
  assert.deepEqual(await readCurrentForm(browser,{requestId:'export'}),{data:{schemaVersion:1},warnings:[]});
  assert.deepEqual(port.sent.map(item=>item.type),['probe','export']);assert.equal(port.sent[1].documentId,'doc');assert.equal(port.closed,true);assert.equal(port.onMessage.listeners.size,0);
});
test('file uses local calendar date, opens Save As and revokes the blob only after completion',async()=>{
  const date=new Date(2026,0,2,0,5);assert.equal(exportFilename(date),'evisa-2026-01-02.json');
  const onChanged=event();let revoked=false,options,blob;
  const browser={downloads:{onChanged,download:async input=>{options=input;assert.equal(revoked,false);return 5;},search:async()=>[{id:5,state:'complete'}]}};
  const urlAPI={createObjectURL:value=>{blob=value;return 'blob:local';},revokeObjectURL:url=>{assert.equal(url,'blob:local');revoked=true;}};
  assert.equal(await saveFormJSON(browser,{schemaVersion:1,personal:{surname:''}},{date,urlAPI}),true);
  assert.equal(options.saveAs,true);assert.equal(options.filename,'evisa-2026-01-02.json');assert.equal(revoked,true);assert.equal(onChanged.listeners.size,0);
  assert.equal(JSON.parse(await blob.text()).personal.surname,'');
});
test('cancelled Save As releases temporary data without reporting an error',async()=>{
  const onChanged=event();let revoked=false;
  const browser={downloads:{onChanged,download:async()=>{throw new Error('Download canceled by the user');}}};
  assert.equal(await saveFormJSON(browser,{schemaVersion:1},{urlAPI:{createObjectURL:()=> 'blob:local',revokeObjectURL:()=>{revoked=true;}}}),false);
  assert.equal(revoked,true);assert.equal(onChanged.listeners.size,0);
});
test('cancellation after download creation is also a normal cancellation',async()=>{
  const onChanged=event();
  const browser={downloads:{onChanged,download:async()=>7,search:async()=>[{id:7,state:'interrupted',error:'USER_CANCELED'}]}};
  assert.equal(await saveFormJSON(browser,{schemaVersion:1},{urlAPI:{createObjectURL:()=> 'blob:local',revokeObjectURL(){}}}),false);
});
