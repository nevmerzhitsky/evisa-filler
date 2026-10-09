import test from 'node:test';
import assert from 'node:assert/strict';
import {createController,DEFAULT_SETTINGS} from '../extension/content/controller.js';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(overrides={},options={}) {
  const values=new Map(); const calls=[];
  const adapter={
    probe:()=>({supported:true}),
    readField:path=>({available:true,value:values.get(path) ?? ''}),
    writeField:(path,value,ctx)=>{ctx.assertCurrent(); calls.push(path); values.set(path,value);},
    replaceList:(path,value,ctx)=>{ctx.assertCurrent(); calls.push(path); values.set(path,value);},
    attachImage:(role,_file,ctx)=>{ctx.assertCurrent(); calls.push(role); return {ok:true};},
    observeImages:()=>({processing:false}),
    observeDialog:()=>false,
    dispose:()=>calls.push('dispose'),...overrides
  };
  const controller=createController(adapter,{fieldTimeoutMs:40,imageTimeoutMs:80,pollIntervalMs:2,...options});
  return {controller,values,calls,adapter};
}
const result=(report,path)=>report.results.find(item=>item.path===path);

test('requested blank unrestorable Year still fills and verifies',async()=>{
  const f=fixture({readField(path){const value=f.values.get(path)??'';return {available:true,value,...(path==='personal.yearOfBirth'&&value===''?{restorable:false}:{})};}});
  const report=await f.controller.start({runId:'one',data:{personal:{yearOfBirth:1990},contact:{phone:'123'}}});
  assert.equal(f.values.get('personal.yearOfBirth'),1990);
  assert.equal(result(report,'personal.yearOfBirth').status,'filled');
  assert.equal(result(report,'contact.phone').status,'filled');
});

for(const [name,thrown] of [
  ['null',null],
  ['undefined',undefined],
  ['private code',Object.assign(new Error('PRIVATE MESSAGE'),{code:'PRIVATE PASSPORT'})],
  ['throwing code getter',Object.defineProperty({},'code',{get(){throw Error('PRIVATE GETTER');}})]
]) test(`adapter ${name} is a local failure without private report or event content`,async()=>{
  const events=[];
  const f=fixture({writeField(path,value,ctx){
    ctx.assertCurrent(); if(path==='contact.mailingAddress')throw thrown;
    f.values.set(path,value);
  }},{onEvent:event=>events.push(event)});
  const report=await f.controller.start({runId:'one',data:{contact:{mailingAddress:'X',phone:'123'}}});
  assert.equal(report.state,'completed');
  assert.equal(result(report,'contact.mailingAddress').status,'error');
  assert.equal(result(report,'contact.mailingAddress').reason,'Action not confirmed: adapter_error.');
  assert.equal(result(report,'contact.phone').status,'filled');
  assert.ok(!JSON.stringify({report,events}).includes('PRIVATE'));
  assert.equal(f.controller.state,'ready');
});

for(const code of ['timeout','date_input_not_editable','select_result_timeout','radio_target_lost'])
test(`known static adapter failure ${code} remains diagnostic`,async()=>{
  const f=fixture({writeField(){throw Object.assign(new Error('PRIVATE MESSAGE'),{code});}});
  const report=await f.controller.start({runId:'one',data:{contact:{phone:'123'}}});
  assert.equal(result(report,'contact.phone').reason,`Action not confirmed: ${code}.`);
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));
});

for(const stage of ['observation','upload']) test(`private ${stage} error codes stay out of image reports and events`,async()=>{
  const events=[],privateError=Object.assign(new Error('PRIVATE MESSAGE'),{code:'PRIVATE IMAGE'});
  const f=fixture(stage==='observation'?{observeImages(){throw privateError;}}:{attachImage(){throw privateError;}},
    {onEvent:event=>events.push(event)});
  const report=await f.controller.start({runId:'one',data:{contact:{phone:'123'}},images:{portrait:{}}});
  assert.equal(result(report,'contact.phone').status,'filled');
  assert.ok(!JSON.stringify({report,events}).includes('PRIVATE'));
  assert.match(result(report,stage==='observation'?'images':'portrait').reason,/adapter_error/);
});

test('site script-tag rejection has a clear reason and does not block JSON filling',async()=>{
  const f=fixture({attachImage(){throw Object.assign(new Error('PRIVATE SERVER DETAIL'),{code:'image_rejected_script_tag'});}});
  const report=await f.controller.start({runId:'one',images:{portrait:{}},data:{personal:{surname:'JSON surname'}}});
  assert.equal(result(report,'portrait').status,'error');
  assert.match(result(report,'portrait').reason,/File has script tag/);
  assert.equal(result(report,'personal.surname').status,'filled');
  assert.equal(JSON.stringify(report).includes('PRIVATE SERVER DETAIL'),false);
});

test('one email value fills and verifies both native email fields',async()=>{
  const f=fixture();
  f.values.set('personal.confirmEmail','Old email');
  const report=await f.controller.start({runId:'one',data:{personal:{email:'example@example.invalid'}}});
  assert.equal(f.values.get('personal.email'),'example@example.invalid');assert.equal(f.values.get('personal.confirmEmail'),'example@example.invalid');
  assert.equal(result(report,'personal.confirmEmail').status,'filled');assert.ok(f.calls.indexOf('personal.email')<f.calls.indexOf('personal.confirmEmail'));
});

test('defaults, parent ordering, false and zero, no personal values in reports',async()=>{
  assert.equal(DEFAULT_SETTINGS.fieldTimeoutMs,10000); assert.equal(DEFAULT_SETTINGS.imageTimeoutMs,60000);
  const f=fixture();
  const report=await f.controller.start({runId:'one',data:{trip:{ward:'SECRET WARD',province:'SECRET PROVINCE'},expenses:{estimatedAmount:0,hasInsurance:false}}});
  assert.ok(f.calls.indexOf('trip.province') < f.calls.indexOf('trip.ward'));
  assert.equal(f.values.get('expenses.estimatedAmount'),0); assert.equal(f.values.get('expenses.hasInsurance'),false);
  assert.ok(!JSON.stringify(report).includes('SECRET'));
  assert.equal(f.controller.activeRunId,null);
});
test('failed parent skips descendants; independent field and child without supplied parent continue',async()=>{
  const f=fixture({writeField(path,value,ctx){ctx.assertCurrent(); if(path==='trip.province') throw Error('private value'); f.values.set(path,value);}});
  const report=await f.controller.start({runId:'one',data:{trip:{province:'X',ward:'Y',purposeDetails:'existing parent allows this'},contact:{phone:'123'}}});
  assert.equal(result(report,'trip.ward').status,'skipped_dependency');
  assert.equal(result(report,'trip.purposeDetails').status,'filled'); assert.equal(f.values.get('contact.phone'),'123');
  assert.ok(!JSON.stringify(report).includes('private value'));
});
test('visible image processing finishes before writes',async()=>{
  let processing=true; const f=fixture({observeImages:()=>({processing})});
  const promise=f.controller.start({runId:'one',data:{personal:{surname:'Target'}}});
  await wait(12); assert.equal(f.calls.length,0);
  processing=false; const report=await promise;
  assert.equal(result(report,'personal.surname').status,'filled');
});
test('a single image uploads before JSON fields without requiring a second image',async()=>{
  const events=[];const f=fixture({observeImages:()=>({processing:false})},{onEvent:event=>events.push(event)});
  const report=await f.controller.start({runId:'one',images:{portrait:{bytes:new ArrayBuffer(1)}},data:{personal:{surname:'Target'},contact:{phone:'123'}}});
  assert.equal(events.some(event=>event.type==='paused'),false);assert.equal(result(report,'images'),undefined);
  assert.equal(f.calls[0],'portrait'); assert.equal(result(report,'personal.surname').status,'filled');
  assert.equal(result(report,'contact.phone').status,'filled');
});
test('image observation timeout reports an error without blocking JSON fields',async()=>{
  const f=fixture({observeImages:()=>new Promise(()=>{})},{imageTimeoutMs:8});
  const report=await f.controller.start({runId:'one',data:{personal:{surname:'Target'},contact:{phone:'123'}}});
  assert.equal(result(report,'personal.surname').status,'filled'); assert.equal(result(report,'contact.phone').status,'filled');
});
test('timeout aborts scoped operation and prevents delayed writes',async()=>{
  let lateBlocked=false;
  const f=fixture({writeField(path,value,ctx){if(path!=='contact.phone'){ctx.assertCurrent(); f.values.set(path,value); return;}
    setTimeout(()=>{try {ctx.assertCurrent(); f.values.set(path,value);} catch {lateBlocked=true;}},30);
    return new Promise(()=>{});
  }},{fieldTimeoutMs:8});
  const report=await f.controller.start({runId:'one',data:{contact:{phone:'123'},expenses:{estimatedAmount:0}}});
  assert.equal(result(report,'contact.phone').status,'error'); assert.equal(result(report,'expenses.estimatedAmount').status,'filled');
  await wait(35); assert.equal(lateBlocked,true); assert.equal(f.values.has('contact.phone'),false);
});
test('manual dialog pause has no image timeout and resume while open leaves it paused',async()=>{
  let open=true; const events=[];
  const f=fixture({observeImages:()=>({processing:false,dialogOpen:open}),observeDialog:()=>open},{imageTimeoutMs:8,onEvent:event=>events.push(event)});
  const promise=f.controller.start({runId:'one',data:{contact:{phone:'123'}}});
  await wait(15); assert.equal(f.controller.state,'paused'); assert.equal(f.calls.length,0);
  assert.throws(()=>f.controller.resume('old'),/stale_resume/);
  f.controller.resume('one'); await wait(12); assert.equal(f.controller.state,'paused');
  open=false; f.controller.resume('one'); const report=await promise;
  assert.equal(report.state,'completed'); assert.equal(result(report,'contact.phone').status,'filled');
  assert.ok(events.filter(x=>x.type==='paused').length>=2);
});
test('stop releases paused wait and rejects active second run and stale commands',async()=>{
  const f=fixture({observeImages:()=>({processing:false,dialogOpen:true}),observeDialog:()=>true});
  const promise=f.controller.start({runId:'one',data:{}}); await wait(10);
  await assert.rejects(f.controller.start({runId:'two',data:{}}),/run_active/);
  assert.throws(()=>f.controller.stop('old'),/stale_stop/);
  f.controller.stop('one'); assert.equal((await promise).state,'cancelled');
  assert.equal(f.controller.activeRunId,null); assert.throws(()=>f.controller.resume('one'),/stale_resume/);
  assert.ok(f.calls.includes('dispose'));
});
test('external abort releases a never-settling read and clears active payload',async()=>{
  const abort=new AbortController(); const f=fixture({readField:()=>new Promise(()=>{})});
  const promise=f.controller.start({runId:'one',data:{contact:{phone:'123'}},signal:abort.signal}); await wait(5); abort.abort();
  assert.equal((await promise).state,'cancelled'); assert.equal(f.controller.activeRunId,null);
});

test('idle partial JSON never reads hidden unrelated omitted fields',async()=>{
  const read=[];
  const f=fixture({readField(path){read.push(path); if(path!=='contact.phone') return new Promise(()=>{}); return {available:true,value:f.values.get(path) ?? ''};}});
  const report=await f.controller.start({runId:'one',data:{contact:{phone:'123'}}});
  assert.deepEqual(new Set(read),new Set(['contact.phone']));
  assert.equal(report.results.some(item=>item.status==='changed_by_site'),false);
  assert.equal(result(report,'personal.yearOfBirth').status,'skipped_empty');
});

test('final readback catches site changes after previously verified writes',async()=>{
  const f=fixture({writeField(path,value,ctx){ctx.assertCurrent(); f.values.set(path,value); if(path==='expenses.estimatedAmount') f.values.set('contact.phone','Site rewrite');}});
  const report=await f.controller.start({runId:'one',data:{contact:{phone:'123'},expenses:{estimatedAmount:0}}});
  assert.equal(result(report,'contact.phone').status,'error');
});
test('list replacement reports row fields and final verification downgrades them',async()=>{
  const f=fixture(); const rows=[{from:'2025-01-01',to:'2025-01-02',purpose:'Test'}];
  const report=await f.controller.start({runId:'one',data:{trip:{hasVisitedWithinLastYear:true,previousVisits:rows}}});
  assert.deepEqual(f.values.get('trip.previousVisits'),rows);
  assert.equal(result(report,'trip.previousVisits[0].purpose').row,1);
});
test('document guard failure stops before the next mutation',async()=>{
  let current=true; const f=fixture({writeField(path,value,ctx){ctx.assertCurrent(); f.values.set(path,value); current=false;}},{assertCurrent:()=>current});
  const report=await f.controller.start({runId:'one',data:{contact:{phone:'123',permanentAddress:'Address'}}});
  assert.equal(report.state,'failed'); assert.equal(f.values.size,1);
});
test('missing image state and unconfirmed attachment cannot claim success',async()=>{
  const f=fixture({observeImages:()=>({})});
  const report=await f.controller.start({runId:'one',data:{personal:{surname:'Target'},contact:{phone:'123'}}});
  assert.equal(result(report,'personal.surname').status,'filled'); assert.equal(result(report,'contact.phone').status,'filled');
  const g=fixture({attachImage:()=>undefined,observeImages:()=>({processing:false})});
  const second=await g.controller.start({runId:'two',images:{portrait:{}},data:{personal:{surname:'Target'}}});
  assert.equal(result(second,'portrait').status,'error'); assert.equal(result(second,'personal.surname').status,'filled');
});
test('synchronous stop from paused callback releases without a missed abort',async()=>{
  let controller;
  const f=fixture({observeImages:()=>({processing:false,dialogOpen:true})},{onEvent:event=>{if(event.type==='paused') controller.stop(event.runId);}});
  controller=f.controller;
  assert.equal((await controller.start({runId:'one',data:{}})).state,'cancelled');
});

test('readback waits for asynchronous site response and rejects late mismatch',async()=>{
  let writes=0;
  const f=fixture({async readField(path){if(path==='contact.phone' && writes){await wait(10); return {available:true,value:'Site rejected'};} return {available:true,value:f.values.get(path) ?? ''};},writeField(path,value,ctx){ctx.assertCurrent(); f.values.set(path,value); writes++;}});
  const report=await f.controller.start({runId:'one',data:{contact:{phone:'123'}}});
  assert.equal(result(report,'contact.phone').status,'error');
});
test('two selected images upload sequentially before JSON fields',async()=>{
  const attached=[];
  const f=fixture({attachImage(role,image,ctx){ctx.assertCurrent(); attached.push(role); f.calls.push(role); return {ok:true};},observeImages(){return {processing:false};}});
  const report=await f.controller.start({runId:'one',images:{portrait:{},passport:{}},data:{personal:{surname:'Target'},passport:{number:'P123'}}});
  assert.deepEqual(f.calls.slice(0,2),['portrait','passport']);
  assert.equal(result(report,'portrait').status,'filled'); assert.equal(result(report,'passport').status,'filled');
  assert.equal(result(report,'personal.surname').status,'filled'); assert.equal(result(report,'passport.number').status,'filled');
});

test('cancellation reports the interrupted and remaining supplied actions and image roles',async()=>{
  const f=fixture({attachImage:()=>new Promise(()=>{})});
  const promise=f.controller.start({runId:'one',images:{portrait:{},passport:{}},data:{contact:{phone:'123'},trip:{hasVisitedWithinLastYear:true,previousVisits:[{from:'2025-01-01',to:'2025-01-02',purpose:'Test'}]}}});
  await wait(8); f.controller.stop('one'); const report=await promise;
  for(const path of ['portrait','passport','contact.phone','trip.hasVisitedWithinLastYear','trip.previousVisits','trip.previousVisits[0].purpose']) assert.equal(result(report,path).status,'skipped_dependency');
});
test('single choices compare case and whitespace semantically before and after writes',async()=>{
  const f=fixture(); f.values.set('personal.sex','Male');
  const report=await f.controller.start({runId:'one',data:{personal:{sex:'  MALE  '}}});
  assert.equal(result(report,'personal.sex').status,'unchanged'); assert.equal(f.calls.includes('personal.sex'),false);
  const g=fixture({writeField(path,value,ctx){ctx.assertCurrent(); g.values.set(path,path==='trip.province'?'Ho Chi Minh City':value);}});
  const after=await g.controller.start({runId:'two',data:{trip:{province:' ho   CHI  minh city '}}});
  assert.equal(result(after,'trip.province').status,'filled');
});
test('choice lists normalize each choice while preserving list order',async()=>{
  const f=fixture({replaceList(path,rows,ctx){ctx.assertCurrent(); f.values.set(path,rows.map(value=>value.trim().replace(/\s+/g,' ').toLowerCase()));}});
  const report=await f.controller.start({runId:'one',data:{personal:{hasOtherNationalities:true,otherNationalities:['  UNITED  STATES ',' CANADA ']}}});
  assert.equal(result(report,'personal.otherNationalities').status,'filled');
  const g=fixture({replaceList(path,rows,ctx){ctx.assertCurrent(); g.values.set(path,[...rows].reverse());}});
  const reversed=await g.controller.start({runId:'two',data:{personal:{hasOtherNationalities:true,otherNationalities:['A','B']}}});
  assert.equal(result(reversed,'personal.otherNationalities').status,'error');
});
test('record choices normalize independently of key order; record text remains exact',async()=>{
  const row={number:'P123',fullName:'Test  Name',dateOfBirth:'1990-01-01',nationality:'  UNITED  STATES '};
  const f=fixture({replaceList(path,rows,ctx){ctx.assertCurrent(); f.values.set(path,rows.map(item=>({nationality:'United States',dateOfBirth:item.dateOfBirth,fullName:item.fullName,number:item.number})));}});
  const report=await f.controller.start({runId:'one',data:{personal:{hasUsedOtherPassports:true,previousPassports:[row]}}});
  assert.equal(result(report,'personal.previousPassports').status,'filled');
  const g=fixture({replaceList(path,rows,ctx){ctx.assertCurrent(); g.values.set(path,rows.map(item=>({...item,fullName:'test name'})));}});
  const changed=await g.controller.start({runId:'two',data:{personal:{hasUsedOtherPassports:true,previousPassports:[row]}}});
  assert.equal(result(changed,'personal.previousPassports').status,'error');
});
test('text fields do not normalize case or internal spaces',async()=>{
  const f=fixture({writeField(path,value,ctx){ctx.assertCurrent(); f.values.set(path,'test name');}});
  const report=await f.controller.start({runId:'one',data:{personal:{surname:'Test  Name'}}});
  assert.equal(result(report,'personal.surname').status,'error');
});
test('malformed field availability and form support never prove successful writes',async()=>{
  const f=fixture({readField:()=>({value:'123'})});
  const report=await f.controller.start({runId:'one',data:{contact:{phone:'123'}}});
  assert.equal(result(report,'contact.phone').status,'error'); assert.equal(f.calls.includes('contact.phone'),false);
  const g=fixture({probe:()=>({supported:'yes'})});
  const unsupported=await g.controller.start({runId:'two',data:{contact:{phone:'123'}}});
  assert.equal(unsupported.state,'failed'); assert.equal(g.calls.includes('contact.phone'),false);
});

test('an upload timeout cannot start a second upload while the site request remains active',async()=>{
  const attached=[]; let processing=false;
  const f=fixture({attachImage(role){attached.push(role); processing=true; return new Promise(()=>{});},observeImages:()=>({processing})},{imageTimeoutMs:8});
  const report=await f.controller.start({runId:'one',images:{portrait:{},passport:{}},data:{contact:{phone:'123'}}});
  assert.deepEqual(attached,['portrait']); assert.equal(result(report,'portrait').status,'error');
  assert.equal(result(report,'passport').status,'skipped_dependency'); assert.equal(result(report,'contact.phone').status,'filled');
});
test('initial image observation timeout reports selected but unattempted images',async()=>{
  const f=fixture({observeImages:()=>new Promise(()=>{})},{imageTimeoutMs:8});
  const report=await f.controller.start({runId:'one',images:{portrait:{},passport:{}},data:{contact:{phone:'123'}}});
  assert.equal(result(report,'portrait').status,'skipped_dependency'); assert.equal(result(report,'passport').status,'skipped_dependency');
  assert.equal(result(report,'images').status,'error'); assert.equal(result(report,'contact.phone').status,'filled');
});

test('preparation switches an inactive birth mode before reading the requested field',async()=>{
  let mode='date'; const calls=[]; let guardChecks=0;
  const f=fixture({
    prepareField(path,ctx){calls.push(`prepare:${path}`); assert.equal(ctx.runId,'one'); assert.ok(ctx.signal instanceof AbortSignal); ctx.assertCurrent(); if(path==='personal.yearOfBirth'){mode='year'; f.values.set('personal.dateOfBirth','');} return {ok:true};},
    readField(path){calls.push(`read:${path}`); if(path==='personal.yearOfBirth' && mode!=='year') return {available:false}; return {available:true,value:f.values.get(path) ?? ''};},
    writeField(path,value,ctx){ctx.assertCurrent(); calls.push(`write:${path}`); f.values.set(path,value);}
  },{assertCurrent(){guardChecks++; return true;}});
  f.values.set('personal.dateOfBirth','1990-01-01');
  const report=await f.controller.start({runId:'one',data:{personal:{yearOfBirth:1991}}});
  assert.deepEqual(calls.slice(0,4),['prepare:personal.yearOfBirth','read:personal.yearOfBirth','write:personal.yearOfBirth','read:personal.yearOfBirth']);
  assert.equal(calls.filter(item=>item==='prepare:personal.yearOfBirth').length,1);
  assert.ok(guardChecks>0); assert.equal(result(report,'personal.yearOfBirth').status,'filled');
  assert.equal(result(report,'personal.dateOfBirth').status,'skipped_empty');
});
test('failed or unconfirmed preparation prevents read and write while independent fields continue',async()=>{
  for(const confirmation of [undefined,{ok:false}]) {
    const reads=[]; const writes=[];
    const f=fixture({prepareField:path=>path==='contact.phone'?confirmation:{ok:true},readField(path){reads.push(path); return {available:true,value:f.values.get(path) ?? ''};},writeField(path,value,ctx){ctx.assertCurrent(); writes.push(path); f.values.set(path,value);}});
    const report=await f.controller.start({runId:'one',data:{contact:{phone:'123',permanentAddress:'Address'}}});
    assert.equal(reads.includes('contact.phone'),false); assert.equal(writes.includes('contact.phone'),false);
    assert.equal(result(report,'contact.phone').status,'error'); assert.equal(result(report,'contact.permanentAddress').status,'filled');
  }
});
test('failed parent blocks only its dependent preparation',async()=>{
  const prepared=[];
  const f=fixture({prepareField(path){prepared.push(path); return path==='trip.province'?{ok:false}:{ok:true};},observeImages:()=>({processing:false})});
  const report=await f.controller.start({runId:'one',data:{trip:{province:'Province',ward:'Ward'},personal:{surname:'Name'}}});
  assert.deepEqual(prepared,['trip.province','personal.surname']); assert.equal(result(report,'trip.ward').status,'skipped_dependency');
  assert.equal(result(report,'personal.surname').status,'filled');
});
test('cancellation during pending preparation prevents target read and delayed date write',async()=>{
  const calls=[]; let blocked=false;
  const f=fixture({prepareField(path,ctx){calls.push(`prepare:${path}`); setTimeout(()=>{try{ctx.assertCurrent(); f.values.set(path,1991);}catch{blocked=true;}},25); return new Promise(()=>{});},readField(path){calls.push(`read:${path}`); return {available:true,value:''};}});
  const promise=f.controller.start({runId:'one',data:{personal:{yearOfBirth:1991}}});
  await wait(5); f.controller.stop('one'); const report=await promise; await wait(30);
  assert.equal(report.state,'cancelled'); assert.equal(calls.includes('read:personal.yearOfBirth'),false);
  assert.equal(f.values.has('personal.yearOfBirth'),false); assert.equal(blocked,true);
});
test('document lost after pending preparation resolves prevents target read and write',async()=>{
  let current=true; let finish; const calls=[];
  const f=fixture({prepareField(){return new Promise(resolve=>{finish=resolve;});},readField(path){calls.push(path); return {available:true,value:''};}},{assertCurrent:()=>current});
  const promise=f.controller.start({runId:'one',data:{personal:{yearOfBirth:1991}}}); await wait(5);
  current=false; finish({ok:true}); const report=await promise;
  assert.equal(report.state,'failed'); assert.equal(calls.includes('personal.yearOfBirth'),false); assert.equal(f.values.size,0);
});

test('one JSON overwrites existing supplied values and ignores omitted fields affected by the site',async()=>{
  const reads=[];let attached=false;
  const f=fixture({
    readField(path){reads.push(path);assert.ok(['personal.surname','trip.province'].includes(path));return {available:true,value:f.values.get(path)??''};},
    attachImage(role,_image,ctx){ctx.assertCurrent();attached=true;f.values.set('personal.givenNames','OCR value');return {ok:true};},
    observeImages(){return {processing:false};},
    writeField(path,value,ctx){ctx.assertCurrent();f.calls.push(path);f.values.set(path,value);if(path==='trip.province')f.values.set('trip.ward','Site reset');}
  });
  f.values.set('personal.surname','Previously entered');f.values.set('personal.givenNames','Previously entered');f.values.set('trip.ward','Old ward');
  const report=await f.controller.start({runId:'one',images:{passport:{}},data:{personal:{surname:'JSON surname'},trip:{province:'JSON province'}}});
  assert.equal(report.state,'completed');assert.equal(f.values.get('personal.surname'),'JSON surname');assert.equal(f.values.get('trip.province'),'JSON province');
  assert.equal(f.values.get('personal.givenNames'),'OCR value');assert.equal(f.values.get('trip.ward'),'Site reset');
  for(const path of ['personal.givenNames','trip.ward'])assert.equal(result(report,path).status,'skipped_empty');
  assert.equal(report.results.some(item=>['error','changed_by_site'].includes(item.status)),false);
  assert.deepEqual(new Set(reads),new Set(['personal.surname','trip.province']));
});
