import test from 'node:test';
import assert from 'node:assert/strict';
import {createSidebarModel} from '../extension/sidebar/model.js';
import {createSession} from '../extension/content/session.js';

const pause = () => new Promise(resolve => setTimeout(resolve,5));
async function until(predicate) {
  for (let attempt=0;attempt<200;attempt++) {if (predicate()) return; await pause();}
  assert.fail('Workflow did not reach its expected state');
}
function listeners() {
  const callbacks = new Set();
  return {addListener:fn=>callbacks.add(fn),removeListener:fn=>callbacks.delete(fn),
    emit(value) {for (const fn of [...callbacks]) fn(value);},get size() {return callbacks.size;}};
}

// Ports clone and deliver asynchronously like Firefox messaging. Both disconnect
// notifications share a connection lifetime. Only transport, window and adapter
// are fakes; validation, sidebar transitions, protocol and controller are real.
function workflow(adapterOverrides={}) {
  const onConnect=listeners(), lifecycle=new Map(),connections=[],transcript=[],values=new Map(),operations=[];
  const runtime={id:'workflow-extension',onConnect,getURL:path=>`moz-extension://workflow/${path}`};
  const window={document:{},location:{href:'https://evisa.gov.vn/e-visa/foreigners'},setInterval,clearInterval,
    addEventListener(type,fn) {if (!lifecycle.has(type)) lifecycle.set(type,new Set()); lifecycle.get(type).add(fn);},
    removeEventListener(type,fn) {lifecycle.get(type)?.delete(fn);}};
  const adapter={
    probe(ctx) {ctx.assertCurrent(); operations.push({type:'probe',runId:ctx.runId}); return {supported:true};},
    readField(path,ctx) {ctx.assertCurrent(); operations.push({type:'read',path,runId:ctx.runId}); return {available:true,value:values.get(path)??''};},
    writeField(path,value,ctx) {ctx.assertCurrent(); operations.push({type:'write',path,runId:ctx.runId}); values.set(path,value); return {ok:true};},
    replaceList(path,value,ctx) {ctx.assertCurrent(); operations.push({type:'list',path,runId:ctx.runId}); values.set(path,structuredClone(value)); return {ok:true};},
    observeImages(ctx) {ctx.assertCurrent(); return {processing:false};},
    observeDialog:()=>false,
    dispose({runId}) {operations.push({type:'dispose',runId});},
    ...adapterOverrides
  };
  let documentSerial=0,runSerial=0,activeTab=7;
  const session=createSession({runtime,adapter,window,uuid:()=>`document-${++documentSerial}`,
    routePollMs:2,settings:{fieldTimeoutMs:500,imageTimeoutMs:500,pollIntervalMs:2}});
  const browser={tabs:{query:async()=>[{id:activeTab,url:window.location.href}],connect(tabId,options) {
    assert.deepEqual(options,{name:'evisa-filler',frameId:0});
    let closed=false;
    const sidebar={onMessage:listeners(),onDisconnect:listeners()};
    const content={name:options.name,sender:{id:runtime.id,url:runtime.getURL('sidebar/sidebar.html')},onMessage:listeners(),onDisconnect:listeners()};
    function post(source,destination,direction,message) {
      if (closed) throw Error('Port disconnected');
      const cloned=structuredClone(message); transcript.push({direction,message:cloned,tabId});
      queueMicrotask(()=>{if (!closed) destination.onMessage.emit(cloned);});
    }
    sidebar.postMessage=message=>post(sidebar,content,'command',message);
    content.postMessage=message=>post(content,sidebar,'event',message);
    sidebar.disconnect=content.disconnect=()=>{
      if (closed) return; closed=true;
      queueMicrotask(()=>{sidebar.onDisconnect.emit();content.onDisconnect.emit();});
    };
    const link={sidebar,content,tabId,get closed() {return closed;}};
    connections.push(link); onConnect.emit(content); return sidebar;
  }}};
  const model=createSidebarModel({browser,uuid:()=>`run-${++runSerial}`,probeTimeoutMs:800});
  const select=data=>model.selectFile('json',{name:'application.json',text:async()=>JSON.stringify(data)});
  const fire=(type,event={})=>{for(const fn of lifecycle.get(type)??[]) fn(event);};
  return {model,session,values,operations,connections,transcript,select,fire,
    setActiveTab(id) {activeTab=id;},dispose() {model.dispose();session.dispose();}};
}

test('selected JSON travels through probe and start to verified readback and final sidebar report',async t=>{
  const f=workflow(); t.after(()=>f.dispose());
  await f.select({schemaVersion:1,contact:{phone:'  PRIVATE PHONE  '},expenses:{estimatedAmount:0,hasInsurance:false}});
  assert.equal(f.model.snapshot().state,'ready'); assert.equal(await f.model.start(),true);
  // Changing the browser's active tab cannot redirect an existing connection.
  f.setActiveTab(99);
  await until(()=>f.model.snapshot().state==='completed');
  assert.equal(f.values.get('contact.phone'),'PRIVATE PHONE'); assert.equal(f.values.get('expenses.estimatedAmount'),0);
  assert.equal(f.values.get('expenses.hasInsurance'),false);
  const commands=f.transcript.filter(item=>item.direction==='command');
  assert.deepEqual(commands.map(item=>item.message.type),['probe','start']);
  assert.ok(commands.every(item=>item.tabId===7)); assert.equal(commands[1].message.documentId,'document-1');
  const report=f.model.snapshot().results.find(item=>item.path==='contact.phone');
  assert.equal(report.status,'filled'); assert.ok(!JSON.stringify(f.model.snapshot()).includes('PRIVATE PHONE'));
  const phone=f.operations.filter(item=>item.path==='contact.phone');
  assert.deepEqual(phone.map(item=>item.type),['read','write','read','read']);
  await until(()=>f.connections[0].closed&&f.session.state==='ready');
  assert.equal(f.operations.filter(item=>item.type==='dispose').length,1);
});

test('a write that fails readback reaches the real sidebar as an error while independent fields complete',async t=>{
  let f;
  f=workflow({writeField(path,value,ctx) {
    ctx.assertCurrent(); f.operations.push({type:'write',path,runId:ctx.runId});
    if(path!=='contact.phone') f.values.set(path,value); return {ok:true};
  }}); t.after(()=>f.dispose());
  await f.select({schemaVersion:1,contact:{phone:'PRIVATE'},expenses:{estimatedAmount:0}}); await f.model.start();
  await until(()=>f.model.snapshot().state==='completed');
  const results=f.model.snapshot().results;
  assert.equal(results.find(item=>item.path==='contact.phone').status,'error');
  assert.equal(results.find(item=>item.path==='expenses.estimatedAmount').status,'filled');
  assert.equal(f.values.get('expenses.estimatedAmount'),0); assert.ok(!JSON.stringify(results).includes('PRIVATE'));
});

test('private adapter error codes never reach real sidebar results or content events',async t=>{
  let f;
  f=workflow({writeField(path,value,ctx){
    ctx.assertCurrent();
    if(path==='contact.mailingAddress')throw Object.assign(new Error('PRIVATE MESSAGE'),{code:'PRIVATE PASSPORT'});
    f.values.set(path,value);return {ok:true};
  }});t.after(()=>f.dispose());
  await f.select({schemaVersion:1,contact:{mailingAddress:'X',phone:'123'}});await f.model.start();
  await until(()=>f.model.snapshot().state==='completed');
  const snapshot=f.model.snapshot();
  assert.equal(snapshot.results.find(item=>item.path==='contact.phone').status,'filled');
  assert.equal(snapshot.results.find(item=>item.path==='contact.mailingAddress').reason,'Action not confirmed: adapter_error.');
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
  assert.ok(!JSON.stringify(f.transcript.filter(item=>item.direction==='event')).includes('PRIVATE'));
});

for (const action of ['clear','dispose']) test(`sidebar ${action} during an adapter wait blocks a late write and all subsequent fields`,async t=>{
  let release,scope,lateBlocked=false,f;
  f=workflow({writeField(path,value,ctx) {
    if (path==='contact.phone') {scope=ctx; return new Promise(resolve=>{release=()=>{
      try {ctx.assertCurrent(); f.values.set(path,value);} catch {lateBlocked=true;} resolve({ok:true});
    };});}
    ctx.assertCurrent(); f.values.set(path,value); return {ok:true};
  }}); t.after(()=>f.dispose());
  await f.select({schemaVersion:1,contact:{phone:'PRIVATE'},expenses:{estimatedAmount:125}}); await f.model.start();
  await until(()=>scope); f.model[action]();
  await until(()=>f.session.state==='ready'); assert.equal(scope.signal.aborted,true);
  release(); await pause();
  assert.equal(lateBlocked,true); assert.equal(f.values.size,0);
  assert.equal(f.model.snapshot().state,'empty'); assert.equal(f.model.snapshot().files.json.name,'');
  assert.deepEqual(f.model.snapshot().results,[]); assert.ok(f.connections[0].closed);
  assert.equal(f.connections[0].sidebar.onMessage.size,0); assert.equal(f.connections[0].content.onMessage.size,0);
});

test('restored document requires a fresh probe; old port and old run events cannot affect the new run',async t=>{
  let processing=true;
  const f=workflow({observeImages:()=>({processing})}); t.after(()=>f.dispose());
  await f.select({schemaVersion:1,contact:{phone:'OLD'}}); await f.model.start();
  await until(()=>f.transcript.some(item=>item.message.type==='start'));
  f.fire('pagehide'); await until(()=>f.model.snapshot().state==='cancelled');
  const old=f.connections[0]; f.fire('pageshow',{persisted:true}); assert.equal(f.session.documentId,'document-2');
  await f.select({schemaVersion:1,contact:{phone:'NEW'}}); await f.model.start();
  await until(()=>f.transcript.some(item=>item.message.type==='start'&&item.message.runId==='run-2'));
  const fresh=f.connections[1];
  const newStart=f.transcript.find(item=>item.direction==='command'&&item.message.type==='start'&&item.message.runId==='run-2');
  assert.equal(newStart.message.documentId,'document-2');
  // Deliver an already queued old event and an old run event on the current port.
  old.sidebar.onMessage.emit({type:'completed',runId:'run-1',report:{results:[{path:'obsolete',status:'filled'}]}});
  fresh.sidebar.onMessage.emit({type:'paused',runId:'run-1'});
  fresh.sidebar.onMessage.emit({type:'completed',runId:'run-1',report:{results:[{path:'obsolete',status:'filled'}]}});
  assert.equal(f.model.snapshot().state,'running'); assert.ok(!f.model.snapshot().results.some(item=>item.path==='obsolete'));
  processing=false; await until(()=>f.model.snapshot().state==='completed');
  assert.equal(f.values.get('contact.phone'),'NEW'); assert.equal(f.model.snapshot().runId,'run-2');
  assert.ok(!f.model.snapshot().results.some(item=>item.path==='obsolete'));
});
