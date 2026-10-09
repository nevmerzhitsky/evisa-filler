import test from 'node:test';
import assert from 'node:assert/strict';
import {createSidebarModel} from '../extension/sidebar/model.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function listener(){const callbacks=new Set();return {addListener(fn){callbacks.add(fn);},removeListener(fn){callbacks.delete(fn);},emit(value){for(const fn of [...callbacks])fn(value);},get size(){return callbacks.size;}};}
function fixture(options={}){
  const port={onMessage:listener(),onDisconnect:listener(),sent:[],postMessage(value){this.sent.push(value);},disconnect(){this.closed=true;this.onDisconnect.emit();}};
  let tab={id:7,url:'https://evisa.gov.vn/e-visa/foreigners'},queries=0;const connections=[];let timer;
  const browser={tabs:{query:async criteria=>{queries++;assert.deepEqual(criteria,{active:true,currentWindow:true});return [tab];},connect:(id,settings)=>{connections.push({id,settings});return port;}}};
  let identity=0;
  const model=createSidebarModel({browser,uuid:()=>`run-${++identity}`,setTimer:callback=>{timer=callback;return 1;},clearTimer:()=>{timer=null;},...options});
  const text=(data={schemaVersion:1,personal:{surname:'EXAMPLE'}})=>({name:'test.json',text:async()=>JSON.stringify(data)});
  return {model,port,connections,text,setTab(value){tab=value;},get queries(){return queries;},timeout(){timer?.();},probe(){port.onMessage.emit({type:'probe',runId:model.snapshot().runId,documentId:'document-1',supported:true});}};
}
const imageValidation=async source=>({ok:true,image:{name:source.name,type:'image/png',bytes:new ArrayBuffer(10240)},errors:[]});
test('saved form URL starts the existing topframe probe and omits query from target metadata',async()=>{
  const f=fixture();f.setTab({id:7,url:'https://evisa.gov.vn/e-visa/foreigners/fake_saved-123?email=example%40example.invalid#section'});
  await f.model.selectFile('json',f.text());assert.equal(await f.model.start(),true);
  assert.deepEqual(f.connections,[{id:7,settings:{name:'evisa-filler',frameId:0}}]);
  assert.equal(f.port.sent.at(-1).type,'probe');f.probe();assert.equal(f.port.sent.at(-1).type,'start');
  assert.equal(f.model.snapshot().target.url,'https://evisa.gov.vn/e-visa/foreigners/fake_saved-123');
});
test('photos-only accepted, invalid JSON still blocks images, bad image permits valid text',async()=>{
  const f=fixture({validateImage:imageValidation});
  await f.model.selectFile('portrait',{name:'photo.png'});assert.equal(f.model.snapshot().canStart,true);
  await f.model.selectFile('json',{name:'invalid.json',text:async()=>'{'});assert.equal(f.model.snapshot().state,'invalid');assert.equal(await f.model.start(),false);assert.equal(f.queries,0);
  await f.model.selectFile('json',null);await f.model.start();f.probe();assert.deepEqual(f.port.sent.at(-1).data,{schemaVersion:1});assert.ok(f.port.sent.at(-1).images.portrait);
  const bad=fixture({validateImage:async()=>({ok:false,image:null,errors:[{path:'portrait',reason:'Bad image'}]})});
  await bad.model.selectFile('portrait',{name:'bad.png'});await bad.model.selectFile('json',bad.text());assert.equal(bad.model.snapshot().canStart,true);
  await bad.model.start();bad.probe();assert.deepEqual(bad.port.sent.at(-1).images,{});assert.equal(bad.model.snapshot().files.portrait.errors.length,1);
});
test('no data refuses start, including blank partial JSON',async()=>{
  const f=fixture();assert.equal(await f.model.start(),false);assert.equal(f.model.snapshot().notice,'Нет данных для заполнения');
  await f.model.selectFile('json',f.text({schemaVersion:1,personal:{surname:'  '}}));assert.equal(await f.model.start(),false);assert.equal(f.queries,0);
});
test('clear suppresses pending file reads and validation results',async()=>{
  const f=fixture();
  const imageGate=deferred();let signal;
  const images=fixture({validateImage:(_file,_role,options)=>{signal=options.signal;return imageGate.promise;}});
  const validating=images.model.selectFile('portrait',{name:'old.png'});images.model.clear();assert.equal(signal.aborted,true);imageGate.resolve(await imageValidation({name:'old.png'}));await validating;
  assert.equal(images.model.snapshot().canStart,false);assert.equal(images.model.snapshot().files.portrait,undefined);
  const textGate=deferred();const reading=f.model.selectFile('json',{name:'late.json',text:()=>textGate.promise});f.model.clear();textGate.resolve(JSON.stringify({schemaVersion:1,personal:{surname:'late'}}));await reading;assert.equal(f.model.snapshot().state,'empty');
});
test('target captured once, probe binds document and stale run events ignored',async()=>{
  const f=fixture();await f.model.selectFile('json',f.text());await f.model.start();
  assert.deepEqual(f.connections,[{id:7,settings:{name:'evisa-filler',frameId:0}}]);assert.equal(f.model.snapshot().inputsDisabled,true);assert.equal(await f.model.start(),false);
  f.setTab({id:9,url:'https://example.invalid'});f.port.onMessage.emit({type:'probe',runId:'stale',supported:true,documentId:'bad'});assert.equal(f.port.sent.length,1);
  f.probe();assert.equal(f.port.sent.at(-1).documentId,'document-1');assert.equal(f.port.sent.at(-1).runId,'run-1');assert.equal(f.model.snapshot().target.tabId,7);assert.equal(f.queries,1);
  await f.model.selectFile('json',null);assert.equal(f.model.snapshot().files.json.name,'test.json');
  f.port.onMessage.emit({type:'paused',runId:'stale'});assert.equal(f.model.snapshot().state,'running');
  f.port.onMessage.emit({type:'completed',runId:'run-1',report:{results:[{path:'personal.surname',label:'Surname',status:'error',reason:'Unavailable'}]}});assert.equal(f.model.snapshot().state,'completed');assert.equal(f.model.snapshot().results[0].status,'error');assert.equal(f.port.closed,true);
});
test('pause/resume and stop wait for terminal event, clear immediately disconnects and frees files',async()=>{
  const f=fixture();await f.model.selectFile('json',f.text());await f.model.start();f.probe();f.port.onMessage.emit({type:'paused',runId:'run-1'});f.model.resume();assert.equal(f.port.sent.at(-1).type,'resume');
  f.port.onMessage.emit({type:'paused',runId:'run-1'});assert.equal(f.model.snapshot().state,'paused');f.port.onMessage.emit({type:'progress',runId:'run-1',state:'running'});assert.equal(f.model.snapshot().state,'running');
  f.model.stop();assert.equal(f.port.sent.at(-1).type,'stop');assert.equal(f.model.snapshot().state,'running');assert.equal(f.model.snapshot().canStop,false);
  f.port.onMessage.emit({type:'cancelled',runId:'run-1'});assert.equal(f.model.snapshot().state,'cancelled');
  const active=fixture();await active.model.selectFile('json',active.text());await active.model.start();active.model.clear();assert.equal(active.port.closed,true);assert.equal(active.port.onMessage.size,0);assert.equal(active.model.snapshot().runId,null);assert.equal(active.model.snapshot().files.json.name,'');active.probe();assert.equal(active.model.snapshot().state,'empty');
});
test('disconnect cancels active run and releases file data',async()=>{
  const f=fixture();await f.model.selectFile('json',f.text());await f.model.start();f.probe();f.port.onDisconnect.emit();assert.equal(f.model.snapshot().state,'cancelled');assert.equal(f.model.snapshot().canStart,false);assert.equal(f.model.snapshot().files.json.name,'');assert.equal(f.port.onMessage.size,0);
});
test('unsupported URL, unsupported probe and probe timeout fail without sending start',async()=>{
  for(const url of ['https://example.invalid/e-visa/foreigners','https://evisa.gov.vn/','https://evisa.gov.vn/e-visa/foreigners/invalid/nested']){
    const f=fixture();f.setTab({id:7,url});await f.model.selectFile('json',f.text());await f.model.start();assert.equal(f.model.snapshot().state,'failed');assert.equal(f.connections.length,0);assert.equal(f.model.snapshot().target,null);
  }
  const f=fixture();await f.model.selectFile('json',f.text());await f.model.start();f.timeout();assert.equal(f.model.snapshot().state,'failed');assert.equal(f.port.sent.length,1);assert.equal(f.port.closed,true);
  const unsupported=fixture();await unsupported.model.selectFile('json',unsupported.text());await unsupported.model.start();unsupported.port.onMessage.emit({type:'probe',runId:'run-1',supported:false});assert.equal(unsupported.model.snapshot().state,'failed');assert.equal(unsupported.port.sent.length,1);
});
test('clear while tab query pending prevents connection',async()=>{
  const gate=deferred();let connected=0;
  const f=fixture({browser:{tabs:{query:()=>gate.promise,connect(){connected++;}}}});await f.model.selectFile('json',f.text());const starting=f.model.start();f.model.clear();gate.resolve([{id:7,url:'https://evisa.gov.vn/e-visa/foreigners'}]);await starting;assert.equal(connected,0);assert.equal(f.model.snapshot().state,'empty');
});
test('site dialog pause explains the required action',async()=>{
  const f=fixture();await f.model.selectFile('json',f.text());await f.model.start();f.probe();
  f.port.onMessage.emit({type:'paused',runId:'run-1',pauseKind:'site_dialog'});
  assert.equal(f.model.snapshot().notice,'На сайте открыт диалог. Завершите действие в нём и нажмите «Продолжить».');
});
test('repeated resume sends one request and paused response allows retry',async()=>{
  const f=fixture();await f.model.selectFile('json',f.text());await f.model.start();f.probe();
  f.port.onMessage.emit({type:'paused',runId:'run-1'});assert.equal(f.model.snapshot().canResume,true);
  f.model.resume();f.model.resume();assert.equal(f.model.snapshot().canResume,false);
  assert.equal(f.port.sent.filter(item=>item.type==='resume').length,1);
  f.port.onMessage.emit({type:'paused',runId:'run-1'});assert.equal(f.model.snapshot().canResume,true);
  f.model.resume();assert.equal(f.port.sent.filter(item=>item.type==='resume').length,2);
  f.port.onMessage.emit({type:'progress',runId:'run-1',state:'running'});assert.equal(f.model.snapshot().state,'running');assert.equal(f.model.snapshot().canResume,false);
});
test('later field progress replaces its earlier result',async()=>{
  const f=fixture();await f.model.selectFile('json',f.text());await f.model.start();f.probe();
  for(const status of ['filled','error'])f.port.onMessage.emit({type:'progress',runId:'run-1',result:{path:'personal.surname',label:'Surname',status}});
  assert.deepEqual(f.model.snapshot().results,[{path:'personal.surname',label:'Surname',status:'error'}]);
  f.port.onMessage.emit({type:'progress',runId:'run-1',result:{path:'personal.givenNames',label:'Given names',status:'filled'}});
  assert.equal(f.model.snapshot().results.length,2);
});
