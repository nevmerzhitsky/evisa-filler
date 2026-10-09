import test from 'node:test';
import assert from 'node:assert/strict';
import {checkResidenceCommitment} from '../extension/content/residence-commitment.js';

function fixture(initial=false) {
  let checked=initial,clicks=0;
  class Element {click(){clicks++;checked=!checked;}}
  class Input extends Element {
    get checked(){return checked;}
    type='checkbox';isConnected=true;disabled=false;
    matches(){return false;}getClientRects(){return [{}];}
  }
  const input=new Input(),abort=new AbortController();
  const document={defaultView:{HTMLElement:Element,HTMLInputElement:Input},querySelectorAll(selector){
    assert.equal(selector,'[id="basic_ttcdCqTcCamDoan"]');return [input];
  }};
  return {document,input,ctx:{signal:abort.signal,assertCurrent(){}},abort,get clicks(){return clicks;}};
}
test('checks the requested declaration once and preserves it on repeated runs',async()=>{
  const f=fixture();
  assert.equal((await checkResidenceCommitment(f.document,f.ctx)).status,'filled');
  assert.equal(f.input.checked,true);
  assert.equal((await checkResidenceCommitment(f.document,f.ctx)).status,'unchanged');
  assert.equal(f.clicks,1);
});
test('refuses disabled checkbox and cancellation without clicking',async()=>{
  const f=fixture();f.input.disabled=true;
  await assert.rejects(checkResidenceCommitment(f.document,f.ctx),{code:'unavailable'});
  f.input.disabled=false;f.abort.abort();
  await assert.rejects(checkResidenceCommitment(f.document,f.ctx),{code:'cancelled'});
  assert.equal(f.clicks,0);
});
