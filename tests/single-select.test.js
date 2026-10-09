import test from 'node:test';
import assert from 'node:assert/strict';
import {readSingleSelect,selectSingleOption} from '../extension/content/single-select.js';

function fixture() {
  const calls=[];let open=false,selected='Male',rewrite=false;
  class EventTarget {dispatchEvent(event){calls.push(event.type);setTimeout(()=>{open=true;},1);return true;}}
  class HTMLElement extends EventTarget {
    constructor(){super();this.isConnected=true;this.childElementCount=0;this.attrs={};this.disabled=false;}
    getAttribute(key){return this.attrs[key]??null;}
    getClientRects(){return [{}];}
    matches(selector){return selector.includes('disabled')&&this.disabled;}
    querySelectorAll(){return [];}
    closest(){return null;}
    click(){calls.push('native-click');setTimeout(()=>{selected=this.caption;open=false;if(rewrite)setTimeout(()=>{selected='Male';},10);},1);}
    get value(){throw Error('private value must not be read');}
  }
  class HTMLInputElement extends HTMLElement {}
  class MouseEvent {constructor(type,options){this.type=type;this.options=options;calls.push('realm-mouse');}}
  const realm={HTMLElement,HTMLInputElement,EventTarget,MouseEvent,getComputedStyle:node=>({display:node===dropdown&&!open?'none':'block',visibility:'visible'})};
  const doc={defaultView:realm,querySelectorAll:selector=>selector==='[id]'?nodes:owners};
  const input=new HTMLInputElement(),root=new HTMLElement(),selector=new HTMLElement(),display=new HTMLElement(),dropdown=new HTMLElement(),list=new HTMLElement();
  input.ownerDocument=doc;input.attrs={role:'combobox','aria-controls':'popup','aria-owns':'popup'};
  input.closest=key=>key==='.ant-select'?root:null;
  root.querySelectorAll=key=>key==='.ant-select-selector'?[selector]:key==='.ant-select-selection-item'?[display]:key==='input[role="combobox"]'?[input]:[];
  selector.contains=node=>node===input||node===display;
  display.closest=key=>key==='.ant-select'?root:null;Object.defineProperty(display,'textContent',{configurable:true,get:()=>selected});
  list.id='popup';list.attrs={role:'listbox'};list.closest=key=>key==='.ant-select-dropdown'?dropdown:null;
  const rows=['Male','Female'].map(caption=>{
    const row=new HTMLElement(),leaf=new HTMLElement();row.caption=caption;leaf.textContent=caption;
    row.closest=key=>key==='.ant-select-dropdown'?dropdown:null;
    leaf.closest=key=>key==='.ant-select-item-option'?row:null;
    row.querySelectorAll=()=>[leaf];row.click=()=>{throw Error('own click forbidden');};
    return row;
  });
  dropdown.querySelectorAll=key=>key==='[role="listbox"]'?[list]:rows;
  const nodes=[list],owners=[input];const abort=new AbortController();
  const ctx={document:doc,signal:abort.signal,assertCurrent:()=>true,timeoutMs:30,pollMs:2};
  return {input,root,selector,display,dropdown,list,rows,nodes,owners,calls,ctx,abort,
    setOpen:value=>{open=value;},setSelected:value=>{selected=value;},rewrite:()=>{rewrite=true;}};
}
const rejects=(promise,code)=>assert.rejects(promise,error=>error.code===code&&error.message===code);

test('reads dedicated normalized display without input values; empty display is null',()=>{
  const f=fixture();f.setSelected('  Some   caption ');assert.equal(readSingleSelect(f.input,f.ctx),'Some caption');f.setSelected('');assert.equal(readSingleSelect(f.input,f.ctx),null);
});
test('async opening and native row click confirm local stable selection',async()=>{
  const f=fixture();assert.deepEqual(await selectSingleOption(f.input,' Female ',f.ctx),{assigned:true});
  assert.deepEqual(f.calls,['realm-mouse','mousedown','native-click']);assert.equal(readSingleSelect(f.input,f.ctx),'Female');
});
test('same selected caption avoids actions and already open popup avoids toggling',async()=>{
  const f=fixture();await selectSingleOption(f.input,'Male',f.ctx);assert.deepEqual(f.calls,[]);
  f.setOpen(true);await selectSingleOption(f.input,'Female',f.ctx);assert.deepEqual(f.calls,['native-click']);
});
test('delayed site rewrite fails the stability check',async()=>{
  const f=fixture();f.rewrite();await rejects(selectSingleOption(f.input,'Female',f.ctx),'selected_display_changed');
});
test('unrendered, duplicate and disabled choices fail with static errors',async()=>{
  const missing=fixture();await rejects(selectSingleOption(missing.input,'Unknown',missing.ctx),'option_not_rendered');
  const duplicate=fixture();duplicate.rows.push(duplicate.rows[1]);await rejects(selectSingleOption(duplicate.input,'Female',duplicate.ctx),'option_ambiguous');
  const disabled=fixture();disabled.rows[1].disabled=true;await rejects(selectSingleOption(disabled.input,'Female',disabled.ctx),'option_disabled');
});
test('duplicate IDs and alias popup ownership fail before opening',async()=>{
  const duplicate=fixture();duplicate.nodes.push(duplicate.list);await rejects(selectSingleOption(duplicate.input,'Female',duplicate.ctx),'popup_ambiguous');assert.deepEqual(duplicate.calls,[]);
  const alias=fixture();alias.dropdown.id='wrapper';alias.nodes.push(alias.dropdown);alias.owners.push({getAttribute:key=>key==='aria-controls'?'wrapper':null});
  await rejects(selectSingleOption(alias.input,'Female',alias.ctx),'popup_ambiguous');assert.deepEqual(alias.calls,[]);
});
test('wrong document, disabled, detached and replaced targets fail closed',async()=>{
  for(const mutate of [f=>{f.input.ownerDocument={};},f=>{f.input.disabled=true;},f=>{f.input.isConnected=false;},f=>{f.root.querySelectorAll=()=>[];}]) {
    const f=fixture();mutate(f);await assert.rejects(selectSingleOption(f.input,'Female',f.ctx));assert.deepEqual(f.calls,[]);
  }
});
test('abort before opening and during waits cancels without click or lingering work',async()=>{
  const early=fixture();early.abort.abort();await rejects(selectSingleOption(early.input,'Female',early.ctx),'cancelled');assert.deepEqual(early.calls,[]);
  const waiting=fixture();const promise=selectSingleOption(waiting.input,'Unknown',waiting.ctx);setTimeout(()=>waiting.abort.abort(),5);await rejects(promise,'cancelled');assert.ok(!waiting.calls.includes('native-click'));
});
test('cancellation in opening handler prevents subsequent click',async()=>{
  const f=fixture();f.ctx.document.defaultView.EventTarget.prototype.dispatchEvent=function(){f.calls.push('mousedown');f.abort.abort();return true;};
  await rejects(selectSingleOption(f.input,'Female',f.ctx),'cancelled');assert.ok(!f.calls.includes('native-click'));
});
test('postclick cancellation and stale synchronous guard stop postchecks',async()=>{
  const f=fixture();f.ctx.document.defaultView.HTMLElement.prototype.click=function(){f.abort.abort();};await rejects(selectSingleOption(f.input,'Female',f.ctx),'cancelled');
  const stale=fixture();stale.ctx.assertCurrent=()=>Promise.resolve(true);await rejects(selectSingleOption(stale.input,'Female',stale.ctx),'document_lost');
});
test('ambiguous or nonleaf selected display is refused without text read',()=>{
  const f=fixture();f.display.childElementCount=1;Object.defineProperty(f.display,'textContent',{get:()=>{throw Error('must not read');}});
  assert.throws(()=>readSingleSelect(f.input,f.ctx),error=>error.code==='selected_display_ambiguous');
});

test('DOM exceptions cannot expose private error messages and constructors fail statically',async()=>{
  const f=fixture();Object.defineProperty(f.display,'textContent',{get(){throw Error('private@example.test');}});
  assert.throws(()=>readSingleSelect(f.input,f.ctx),error=>error.code==='select_dom_unavailable'&&!error.message.includes('@'));
  await rejects(selectSingleOption(f.input,'Female',f.ctx),'select_dom_unavailable');
  const missing=fixture();missing.ctx.document.defaultView.MouseEvent=null;await rejects(selectSingleOption(missing.input,'Female',missing.ctx),'select_event_unavailable');
});

test('replacement during popup wait prevents click on the old target',async()=>{
  const f=fixture();const promise=selectSingleOption(f.input,'Unknown',f.ctx);setTimeout(()=>{f.input.isConnected=false;},5);
  await rejects(promise,'select_target_lost');assert.ok(!f.calls.includes('native-click'));
});

test('wrapper ARIA target and excessive rows fail without option value guesses',async()=>{
  const wrapper=fixture();wrapper.list.attrs.role=null;await rejects(selectSingleOption(wrapper.input,'Female',wrapper.ctx),'popup_ambiguous');
  const many=fixture();many.rows.push(...Array.from({length:499},()=>many.rows[0]));await rejects(selectSingleOption(many.input,'Female',many.ctx),'options_truncated');
});

test('same wanted selection still requires closed popup and stable readback without writes',async()=>{
  const open=fixture();open.setOpen(true);await rejects(selectSingleOption(open.input,'Male',open.ctx),'select_result_timeout');assert.deepEqual(open.calls,[]);
  const closes=fixture();closes.setOpen(true);setTimeout(()=>closes.setOpen(false),5);assert.deepEqual(await selectSingleOption(closes.input,'Male',closes.ctx),{assigned:true});assert.deepEqual(closes.calls,[]);
});

test('abort during final option caption recheck prevents native click',async()=>{
  const f=fixture();f.setOpen(true);let reads=0;
  const leaf=f.rows[1].querySelectorAll()[0];Object.defineProperty(leaf,'textContent',{get(){if(++reads===3)f.abort.abort();return 'Female';}});
  await rejects(selectSingleOption(f.input,'Female',f.ctx),'cancelled');assert.ok(!f.calls.includes('native-click'));
});

test('abort during target DOM validation is detected by the closing guard',async()=>{
  const f=fixture();f.selector.contains=()=>{f.abort.abort();return true;};
  await rejects(selectSingleOption(f.input,'Female',f.ctx),'cancelled');assert.deepEqual(f.calls,[]);
});
