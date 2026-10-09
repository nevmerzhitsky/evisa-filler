import test from 'node:test';
import assert from 'node:assert/strict';
import {watchPageMode} from '../extension/sidebar/page-mode.js';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

function event(){
  const callbacks=new Set();
  return {addListener:fn=>callbacks.add(fn),removeListener:fn=>callbacks.delete(fn),
    emit(...args){for(const fn of callbacks)fn(...args);},get size(){return callbacks.size;}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('page mode follows active tabs and navigation, and releases listeners on close',async()=>{
  let url='https://evisa.gov.vn/e-visa/foreigners';
  const modes=[],tabs={onActivated:event(),onUpdated:event(),query:async criteria=>{
    assert.deepEqual(criteria,{active:true,currentWindow:true});return [{url}];
  }};
  const dispose=watchPageMode({tabs},mode=>modes.push(mode));
  await settle();assert.deepEqual(modes,['new']);
  url='https://evisa.gov.vn/e-visa/foreigners/fake_saved-123/?email=example%40example.invalid#form';
  tabs.onActivated.emit({tabId:2});await settle();assert.equal(modes.at(-1),'saved');
  url='https://evisa.gov.vn/e-visa/foreigners';
  tabs.onUpdated.emit(2,{url},{active:true});await settle();assert.equal(modes.at(-1),'new');
  tabs.onUpdated.emit(3,{url:'https://example.invalid'},{active:false});await settle();assert.equal(modes.length,3);
  url='https://example.invalid';tabs.onActivated.emit({tabId:3});await settle();assert.equal(modes.at(-1),null);
  dispose();assert.equal(tabs.onActivated.size,0);assert.equal(tabs.onUpdated.size,0);
});

test('late queries and queries pending at disposal cannot restore the previous mode',async()=>{
  const pending=[],modes=[],tabs={onActivated:event(),onUpdated:event(),query:()=>new Promise(resolve=>pending.push(resolve))};
  const dispose=watchPageMode({tabs},mode=>modes.push(mode));
  tabs.onActivated.emit({tabId:2});
  pending[1]([{url:'https://evisa.gov.vn/e-visa/foreigners/fake_saved-123'}]);await settle();
  pending[0]([{url:'https://evisa.gov.vn/e-visa/foreigners'}]);await settle();
  assert.deepEqual(modes,['saved']);
  tabs.onActivated.emit({tabId:3});dispose();
  pending[2]([{url:'https://evisa.gov.vn/e-visa/foreigners'}]);await settle();
  assert.deepEqual(modes,['saved']);
});

test('sidebar shows only export for saved forms and restores filling on a new form',async()=>{
  const source=await readFile(new URL('../extension/sidebar/sidebar.js',import.meta.url),'utf8');
  const nodes=new Map();
  const document={getElementById(id){
    if(!nodes.has(id))nodes.set(id,{hidden:false,textContent:id==='help-text'?'Fill help':'',addEventListener(){}});
    return nodes.get(id);
  }};
  let url='https://evisa.gov.vn/e-visa/foreigners/fake_saved-123';
  const tabs={onActivated:event(),onUpdated:event(),query:async()=>[{url}]};
  let pagehide;
  vm.runInNewContext(source.replace(/^import .*;\r?\n/gm,''),{
    document,browser:{tabs},watchPageMode,
    createSidebarModel:()=>({dispose(){}}),
    window:{addEventListener(_type,callback){pagehide=callback;}}
  });
  await settle();
  assert.equal(nodes.get('fill-panel').hidden,true);
  assert.equal(nodes.get('panel-title').textContent,'Сохранение e-Visa');
  assert.equal(nodes.get('export').hidden,false);
  assert.match(nodes.get('help-text').textContent,/Сохранить форму в JSON/);
  url='https://evisa.gov.vn/e-visa/foreigners';
  tabs.onUpdated.emit(1,{url},{active:true});await settle();
  assert.equal(nodes.get('fill-panel').hidden,false);
  assert.equal(nodes.get('panel-title').textContent,'Заполнение e-Visa');
  assert.equal(nodes.get('help-text').textContent,'Fill help');
  pagehide();assert.equal(tabs.onActivated.size,0);
});
