import test from 'node:test';
import assert from 'node:assert/strict';
import {actionState} from '../extension/sidebar/action-state.js';
test('context actions keep only relevant controls and hide clear while work is active',()=>{
  const base={results:[],files:{json:{name:''}}};
  assert.deepEqual(actionState({...base,state:'ready'}),{start:true,clear:false,stop:false,resume:false});
  const loaded={...base,files:{json:{name:'example.json'}}};
  assert.deepEqual(actionState({...loaded,state:'running'}),{start:false,clear:false,stop:true,resume:false});
  assert.deepEqual(actionState({...loaded,state:'paused'}),{start:false,clear:false,stop:true,resume:true});
  assert.equal(actionState({...loaded,state:'paused',canStop:false,canResume:false}).resume,false);
  assert.deepEqual(actionState({...loaded,state:'completed'}),{start:true,clear:true,stop:false,resume:false});
});
