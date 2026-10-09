import test from 'node:test';
import assert from 'node:assert/strict';
import {createSession,SESSION_PORT} from '../extension/content/session.js';

const tick = () => new Promise(resolve => setTimeout(resolve,5));
async function until(predicate) {for(let i=0;i<100;i++) {if(predicate()) return; await tick();} assert.fail('Timed out');}
function event() {
  const listeners = new Set();
  return {listeners,addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),fire:value=>{for(const fn of [...listeners]) fn(value);}};
}
function fixture(overrides={},initialURL='https://evisa.gov.vn/e-visa/foreigners') {
  const onConnect=event(), lifecycle=new Map(), values=new Map(), writes=[];
  const runtime={id:'extension',onConnect,getURL:path=>`moz-extension://test/${path}`};
  const document={};
  const window={document,location:{href:initialURL},setInterval,clearInterval,
    addEventListener(type,fn){if(!lifecycle.has(type)) lifecycle.set(type,new Set()); lifecycle.get(type).add(fn);},
    removeEventListener(type,fn){lifecycle.get(type)?.delete(fn);}};
  const adapter={probe:()=>({supported:true}),readField:path=>({value:values.get(path)??'',available:true}),
    writeField(path,value,ctx){ctx.assertCurrent(); writes.push(path); values.set(path,value);},
    observeImages:()=>({processing:false}),observeDialog:()=>false,dispose(){},...overrides};
  let serial=0;
  const session=createSession({runtime,adapter,window,uuid:()=>`doc-${++serial}`,routePollMs:2,settings:{pollIntervalMs:2,fieldTimeoutMs:100,imageTimeoutMs:100}});
  function port(sender={id:runtime.id,url:runtime.getURL('sidebar/sidebar.html')}) {
    const port={name:SESSION_PORT,sender,onMessage:event(),onDisconnect:event(),sent:[],
      postMessage(message){this.sent.push(message);},disconnect(){this.onDisconnect.fire();}};
    onConnect.fire(port); return port;
  }
  const command=(port,message)=>port.onMessage.fire(message);
  async function probe(port,runId='one') {command(port,{type:'probe',runId}); await until(()=>port.sent.some(e=>e.type==='probe'&&e.runId===runId)); return port.sent.findLast(e=>e.type==='probe');}
  function start(port,extra={}) {command(port,{type:'start',runId:'one',documentId:session.documentId,data:{schemaVersion:1,contact:{phone:'private phone'}},...extra});}
  const fire=(type,value={})=>{for(const fn of lifecycle.get(type)??[]) fn(value);};
  return {runtime,window,session,port,command,probe,start,fire,writes};
}

test('export requires a document probe and returns a full read-only snapshot',async t=>{
  const f=fixture();t.after(()=>f.session.dispose());const p=f.port();
  f.command(p,{type:'export',runId:'export',documentId:f.session.documentId});assert.equal(p.sent.at(-1).code,'stale_document');
  await f.probe(p,'export');f.command(p,{type:'export',runId:'export',documentId:f.session.documentId});
  await until(()=>p.sent.some(item=>item.type==='exported'));
  const saved=p.sent.find(item=>item.type==='exported');assert.equal(saved.data.schemaVersion,1);assert.equal(saved.data.personal.email,'');assert.equal(saved.data.contact.emergency.address,'');
  assert.equal(Object.hasOwn(saved.data.personal,'confirmEmail'),false);assert.deepEqual(f.writes,[]);
});

test('export cannot run concurrently with filling',async t=>{
  const f=fixture({writeField:()=>new Promise(()=>{})});t.after(()=>f.session.dispose());const filling=f.port(),saving=f.port();
  await f.probe(filling);f.start(filling);await f.probe(saving,'export');
  f.command(saving,{type:'export',runId:'export',documentId:f.session.documentId});assert.equal(saving.sent.at(-1).code,'run_active');
});

test('saved URL seeded before session creation probes and completes a real run',async t=>{
  const f=fixture({},'https://evisa.gov.vn/e-visa/foreigners/fake_saved-123/?email=example%40example.invalid#section');
  t.after(()=>f.session.dispose());const p=f.port();assert.equal((await f.probe(p)).supported,true);f.start(p);
  await until(()=>p.sent.some(e=>e.type==='completed'));assert.ok(f.writes.includes('contact.phone'));
});
test('valid start revalidates data, emits terminal report, and releases owner',async t=>{
  const f=fixture(); t.after(()=>f.session.dispose()); const p=f.port(); await f.probe(p); f.start(p);
  await until(()=>p.sent.some(e=>e.type==='completed')); assert.ok(f.writes.includes('contact.phone'));
  assert.equal(f.session.state,'ready'); assert.ok(!JSON.stringify(p.sent).includes('private phone'));
  await f.probe(p); f.start(p); assert.equal(p.sent.at(-1).code,'stale_run');
  await f.probe(p,'two'); f.start(p,{runId:'two'}); await until(()=>p.sent.some(e=>e.type==='completed'&&e.runId==='two'));
});

for(const [name,thrown] of [
  ['null',null],
  ['throwing code getter',Object.defineProperty({},'code',{get(){throw Error('PRIVATE GETTER');}})]
]) test(`probe adapter ${name} returns a static probe failure and accepts a later probe`,async t=>{
  let fail=true;
  const f=fixture({probe(){if(fail)throw thrown;return {supported:true};}});
  t.after(()=>f.session.dispose());const p=f.port();f.command(p,{type:'probe',runId:'bad'});
  await until(()=>p.sent.length>0);
  assert.deepEqual(p.sent,[{type:'error',runId:'bad',code:'probe_failed'}]);
  fail=false;assert.equal((await f.probe(p,'fresh')).supported,true);
  assert.ok(!JSON.stringify(p.sent).includes('PRIVATE'));
});

test('invalid JSON, schema, images and stale documents perform no DOM writes',async t=>{
  const f=fixture(); t.after(()=>f.session.dispose()); const p=f.port(); await f.probe(p);
  for(const extra of [{json:'{private'}, {data:{schemaVersion:1,unknown:'private'}}, {documentId:'old'},
    {images:{unknown:{}}}, {images:{portrait:{name:'x',type:'image/png',bytes:new ArrayBuffer(10240)}}}]) {
    f.start(p,extra); await tick(); assert.equal(p.sent.at(-1).type,'error');
  }
  assert.deepEqual(f.writes,[]); assert.ok(!JSON.stringify(p.sent).includes('private'));
});

test('sender allowlist rejects page and other extension ports',()=>{
  const f=fixture();
  for(const sender of [{id:'other',url:f.runtime.getURL('sidebar/sidebar.html')},{id:f.runtime.id,url:'https://evisa.gov.vn/e-visa/foreigners'}]) {
    const p=f.port(sender); assert.equal(p.onMessage.listeners.size,0);
  }
  f.session.dispose(); assert.equal(f.runtime.onConnect.listeners.size,0);
});

test('concurrent port cannot start or stop owner, observer disconnect does not stop owner',async t=>{
  let processing=true;
  const f=fixture({observeImages:()=>({processing})}); t.after(()=>f.session.dispose());
  const p=f.port(), q=f.port(); await f.probe(p); await f.probe(q); f.start(p); f.start(q,{runId:'other'});
  assert.equal(q.sent.at(-1).code,'run_active');
  f.command(q,{type:'stop',runId:'one'}); assert.equal(q.sent.at(-1).code,'stale_run'); q.disconnect();
  await tick(); assert.equal(f.session.state,'running'); processing=false;
  await until(()=>p.sent.some(e=>e.type==='completed')); assert.ok(f.writes.includes('contact.phone'));
});

test('owner disconnect aborts wait and removes port listeners',async t=>{
  const f=fixture({observeImages:()=>new Promise(()=>{})}); t.after(()=>f.session.dispose());
  const p=f.port(); await f.probe(p); f.start(p); await tick(); p.disconnect();
  await until(()=>f.session.state==='ready'); assert.deepEqual(f.writes,[]);
  assert.equal(p.onMessage.listeners.size,0); assert.equal(p.onDisconnect.listeners.size,0);
});

test('SPA navigation stops a never settling wait before any mutation',async t=>{
  const f=fixture({observeImages:()=>new Promise(()=>{})}); t.after(()=>f.session.dispose());
  const p=f.port(); await f.probe(p); f.start(p); await tick(); f.window.location.href='https://evisa.gov.vn/';
  await until(()=>p.sent.some(e=>e.type==='cancelled')); assert.deepEqual(f.writes,[]);
});

test('pagehide cancels; persisted pageshow creates identity and requires fresh probe',async t=>{
  let processing=true;
  const f=fixture({observeImages:()=>({processing})}); t.after(()=>f.session.dispose());
  const p=f.port(); const old=await f.probe(p); f.start(p); await tick(); f.fire('pagehide');
  await until(()=>p.sent.some(e=>e.type==='cancelled')); f.fire('pageshow',{persisted:true});
  assert.notEqual(f.session.documentId,old.documentId); f.start(p,{runId:'two',documentId:old.documentId}); assert.equal(p.sent.at(-1).code,'stale_document');
  f.start(p,{runId:'two'}); assert.equal(p.sent.at(-1).code,'stale_document'); processing=false;
  await f.probe(p,'two'); f.start(p,{runId:'two'}); await until(()=>p.sent.some(e=>e.type==='completed'&&e.runId==='two'));
});

test('stale stop does not cancel owner; explicit stop has terminal event',async t=>{
  const f=fixture({observeImages:()=>new Promise(()=>{})}); t.after(()=>f.session.dispose());
  const p=f.port(); await f.probe(p); f.start(p); f.command(p,{type:'stop',runId:'old'});
  assert.equal(p.sent.at(-1).code,'stale_run'); assert.equal(f.session.state,'running');
  f.command(p,{type:'stop',runId:'one'}); await until(()=>p.sent.some(e=>e.type==='cancelled'));
});

test('send failure aborts owner and disposal is idempotent',async()=>{
  const f=fixture({observeImages:()=>new Promise(()=>{})}); const p=f.port(); await f.probe(p);
  p.postMessage=()=>{throw Error('disconnected');}; f.start(p); await until(()=>f.session.state==='ready');
  assert.deepEqual(f.writes,[]); f.session.dispose(); f.session.dispose(); assert.equal(p.onMessage.listeners.size,0);
});

test('paused owner resumes only its current run, and route loss cancels manual pause',async t=>{
  let open=true;
  const f=fixture({observeImages:()=>({processing:false,dialogOpen:open}),observeDialog:()=>open});
  t.after(()=>f.session.dispose()); const p=f.port(); await f.probe(p); f.start(p);
  await until(()=>f.session.state==='paused'); f.command(p,{type:'resume',runId:'old'});
  assert.equal(p.sent.at(-1).code,'stale_run'); f.command(p,{type:'resume',runId:'one'});
  await until(()=>p.sent.filter(e=>e.type==='paused').length===2); assert.deepEqual(f.writes,[]);
  open=false; f.command(p,{type:'resume',runId:'one'}); await until(()=>p.sent.some(e=>e.type==='completed'));
  open=true; await f.probe(p,'two'); f.start(p,{runId:'two'}); await until(()=>f.session.state==='paused');
  f.window.location.href='https://evisa.gov.vn/'; await until(()=>p.sent.some(e=>e.type==='cancelled'&&e.runId==='two'));
});

test('ctx.assertCurrent blocks mutation immediately after navigation, before route interval',async t=>{
  let blocked=false;
  const f=fixture({writeField(_path,_value,ctx){
    f.window.location.href='https://evisa.gov.vn/e-visa/foreigners/other';
    try {ctx.assertCurrent();} catch(error) {blocked=true; throw error;}
    assert.fail('Mutation guard permitted another route');
  }});
  t.after(()=>f.session.dispose()); const p=f.port(); await f.probe(p); f.start(p);
  await until(()=>p.sent.some(e=>e.type==='failed')); assert.equal(blocked,true); assert.deepEqual(f.writes,[]);
});

test('image transport accepts exact size boundaries and preserves ArrayBuffer bytes',async t=>{
  const seen=[];
  const f=fixture({attachImage(role,image,ctx){ctx.assertCurrent(); seen.push({role,image}); return {ok:true};},
    observeImages:()=>({processing:false})});
  t.after(()=>f.session.dispose()); const p=f.port(); await f.probe(p);
  const png=new Uint8Array(10240); png.set([137,80,78,71,13,10,26,10]);
  const jpg=new Uint8Array(2*1024*1024); jpg.set([255,216,255]);
  f.start(p,{images:{portrait:{name:'portrait.png',type:'image/png',bytes:png.buffer},passport:{name:'passport.jpg',type:'image/jpeg',bytes:jpg.buffer}}});
  await until(()=>p.sent.some(e=>e.type==='completed')); assert.equal(seen.length,2);
  assert.equal(seen[0].image.bytes,png.buffer); assert.equal(seen[1].image.bytes,jpg.buffer);
  assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10]);
});

test('never settling probe reaches field deadline and aborts adapter scope',async t=>{
  let ctx;
  const f=fixture({probe:context=>{ctx=context; return new Promise(()=>{});}}); t.after(()=>f.session.dispose());
  const p=f.port(); f.command(p,{type:'probe',runId:'one'});
  await until(()=>p.sent.some(e=>e.code==='probe_timeout'));
  assert.equal(ctx.signal.aborted,true); assert.throws(()=>ctx.assertCurrent());
  f.start(p); assert.equal(p.sent.at(-1).code,'stale_document');
});

test('disconnect and dispose abort pending probes and suppress late reports',async()=>{
  for(const action of ['disconnect','dispose','pagehide']) {
    let ctx,resolve;
    const f=fixture({probe:context=>{ctx=context; return new Promise(done=>{resolve=done;});}});
    const p=f.port(); f.command(p,{type:'probe',runId:'one'}); await until(()=>ctx);
    if(action==='disconnect') p.disconnect(); else if(action==='dispose') f.session.dispose(); else f.fire('pagehide');
    assert.equal(ctx.signal.aborted,true); assert.throws(()=>ctx.assertCurrent());
    resolve({supported:true}); await tick(); assert.deepEqual(p.sent,[]); f.session.dispose();
  }
});

test('new probe aborts older scope and only newest response grants permission',async t=>{
  const contexts=[],resolvers=[];
  const f=fixture({probe:ctx=>{contexts.push(ctx); return new Promise(resolve=>resolvers.push(resolve));}}); t.after(()=>f.session.dispose());
  const p=f.port(); f.command(p,{type:'probe',runId:'old'}); await until(()=>contexts.length===1);
  f.command(p,{type:'probe',runId:'new'}); await until(()=>contexts.length===2);
  assert.equal(contexts[0].signal.aborted,true); resolvers[1]({supported:false}); await tick();
  resolvers[0]({supported:true}); await tick(); assert.equal(p.sent.length,1); assert.equal(p.sent[0].runId,'new');
  f.start(p); assert.equal(p.sent.at(-1).code,'stale_document');
});

test('invalid supported result does not authorize start',async t=>{
  const f=fixture({probe:()=>({supported:'true'})}); t.after(()=>f.session.dispose());
  const p=f.port(); f.command(p,{type:'probe',runId:'one'}); await until(()=>p.sent.length);
  assert.equal(p.sent[0].code,'probe_failed'); f.start(p); assert.equal(p.sent.at(-1).code,'stale_document');
});

test('empty normalized application cannot launch controller or consume run id',async t=>{
  let probes=0;
  const f=fixture({probe:()=>{probes++; return {supported:true};}}); t.after(()=>f.session.dispose());
  const p=f.port(); await f.probe(p); const before=probes;
  f.start(p,{data:{schemaVersion:1,personal:{surname:'  '},trip:{previousVisits:[]}}});
  assert.equal(p.sent.at(-1).code,'no_data'); assert.equal(probes,before); assert.equal(f.session.state,'ready');
  f.start(p); await until(()=>p.sent.some(e=>e.type==='completed'));
});
