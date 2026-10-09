import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdapter,isSupportedRoute} from '../extension/content/adapter.js';
import {createSession,SESSION_PORT} from '../extension/content/session.js';
const PRIVATE='PRIVATE@example.test';
function fixture({id='basic_ttllSdt',maxLength=50,caption=null}={}){
  const doc={},meta=new WeakMap(),trace=[],abort=new AbortController(),listeners=new Set();let afterSet,onEvent,reads=0,captionReads=0;
  class Element{
    constructor(classes=''){meta.set(this,{id:'',classes:new Set(classes.split(' ').filter(Boolean)),text:'',hidden:false});this.children=[];this.parentElement=null;this.ownerDocument=doc;this.isConnected=true;}
    get id(){return meta.get(this).id;}
    append(...nodes){for(const node of nodes){this.children.push(node);node.parentElement=this;}return this;}
    matches(selector){return selector.split(',').some(part=>{if(part===':disabled')return meta.get(this).disabled===true;
      if(part==='label')return this instanceof Label;if(['input','textarea','select'].includes(part))return part==='input'&&this instanceof Input;
      return [...part.matchAll(/\.([\w-]+)/g)].every(match=>meta.get(this).classes.has(match[1]));});}
    closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
    querySelectorAll(selector){reads++;const result=[];function walk(node){for(const child of node.children){let match=child.matches(selector);
      if(selector==='.ant-form-item-label label')match=child instanceof Label&&Boolean(child.parentElement?.closest('.ant-form-item-label'));
      if(match)result.push(child);walk(child);}}walk(this);return result;}
    contains(node){for(;node;node=node.parentElement)if(node===this)return true;return false;}
    getClientRects(){return meta.get(this).hidden?[]:[{}];}
    getAttribute(key){if(['value','name','title'].includes(key))throw {code:PRIVATE};return meta.get(this)[key]??null;}
    get textContent(){if(this instanceof Label){captionReads++;if(caption===null)throw {code:PRIVATE};}
      return meta.get(this).text+this.children.map(child=>child.textContent).join('');}
    get childElementCount(){return this.children.length;}
    focus(){throw Error('No focus');}blur(){throw Error('No blur');}click(){throw Error('No click');}
  }
  class Input extends Element{
    get type(){return meta.get(this).type;}get maxLength(){return meta.get(this).maxLength;}
    get disabled(){return meta.get(this).disabled;}get readOnly(){return meta.get(this).readOnly;}
    get labels(){return meta.get(this).labels;}
    get value(){return meta.get(this).value;}
    set value(value){trace.push('setter');meta.get(this).value=value;afterSet?.();}
    dispatchEvent(event){trace.push(event.type);onEvent?.(event);}
  }
  class Label extends Element{get control(){return meta.get(this).control;}get htmlFor(){return meta.get(this).htmlFor;}}
  doc.defaultView={Element,HTMLElement:Element,HTMLInputElement:Input,HTMLLabelElement:Label,Node:Element,
    getComputedStyle:()=>({display:'block',visibility:'visible'}),Event:class{constructor(type,props){this.type=type;Object.assign(this,props);}}};
  const form=new Element('ant-form-item'),labelBox=new Element('ant-form-item-label'),label=new Label(),input=new Input();
  form.append(labelBox.append(label),input);Object.assign(meta.get(input),{id,type:'text',maxLength,disabled:false,readOnly:false,labels:[label],value:'old'});
  Object.assign(meta.get(label),{control:input,htmlFor:id,text:caption??'UNREAD PRIVATE LABEL'});
  let identified=[input],stale=false;
  doc.querySelectorAll=selector=>{assert.equal(selector,'[id]');reads++;return identified;};
  const signal={get aborted(){return abort.signal.aborted;},addEventListener(type,fn,opts){listeners.add(fn);abort.signal.addEventListener(type,fn,opts);},removeEventListener(type,fn){listeners.delete(fn);abort.signal.removeEventListener(type,fn);}};
  const ctx={document:doc,signal,stableMs:5,assertCurrent(){if(stale)throw {code:PRIVATE};}};
  return {doc,ctx,input,label,labelBox,form,meta,Element,Input,Label,trace,listeners,abort,
    identify:nodes=>{identified=nodes;},afterSet:fn=>{afterSet=fn;},onEvent:fn=>{onEvent=fn;},stale:()=>{stale=true;},get reads(){return reads;},get captionReads(){return captionReads;}};
}
function applicationFixture() {
  const f=fixture({caption:'Phone'}),all=[f.input],listeners=new Map();
  Object.defineProperty(f.Input.prototype,'files',{get(){return f.meta.get(this).files??[];},set(files){f.meta.get(this).files=files;}});
  for (const [id,type,caption] of [['basic_ttcnEmail','text','Email'],['basic_ttcnConfirmEmail','text','Re-enter Email'],
    ['basic_ttcnNgayThangNamSinhStr','text'],['basic_anhMat','file'],['basic_anhHoChieu','file']]) {
    const input=new f.Input();Object.assign(f.meta.get(input),{id,type,files:[]});
    if(type==='file') {
      const container=new f.Element('ant-form-item');container.append(input);
      container.querySelectorAll=()=>[];
    }
    if(caption){const label=new f.Label();Object.assign(f.meta.get(label),{text:caption,control:input,htmlFor:id});f.meta.get(input).labels=[label];}
    all.push(input);
  }
  f.doc.querySelectorAll=selector=>selector==='[id]'?all:selector.startsWith('[id="')?all.filter(node=>node.id===selector.slice(5,-2)):[];
  const window=Object.assign(f.doc.defaultView,{document:f.doc,location:{href:'https://evisa.gov.vn/e-visa/foreigners'},setInterval,clearInterval,
    addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
    removeEventListener(type,fn){listeners.get(type)?.delete(fn);}});
  window.top=window;
  const adapter=createAdapter({window,document:f.doc});
  return {...f,window,all,adapter};
}
test('actual native text dispatch works twice; unknown fields refuse writes and route guard cannot be bypassed',async()=>{
  const f=applicationFixture();assert.equal(f.adapter.probe(f.ctx).supported,true);
  await f.adapter.writeField('contact.phone','first',f.ctx);assert.equal((await f.adapter.readField('contact.phone',f.ctx)).value,'first');
  await f.adapter.writeField('contact.phone','second',f.ctx);assert.deepEqual(f.trace,['setter','input','change','setter','input','change']);
  assert.deepEqual(await f.adapter.readField('trip.ward',f.ctx),{available:false,valid:false});
  await assert.rejects(f.adapter.writeField('trip.ward','private',f.ctx),{code:'unavailable'});
  f.window.location.href+='/unexpected/nested';assert.equal(isSupportedRoute(f.window),false);
  await assert.rejects(f.adapter.writeField('contact.phone','late',f.ctx),{code:'document_lost'});
  assert.equal(f.meta.get(f.input).value,'second');
});
test('saved application URL with fictitious query supports actual native DOM writes',async()=>{
  const f=applicationFixture();f.window.location.href='https://evisa.gov.vn/e-visa/foreigners/fake_saved-123?email=example%40example.invalid#section';
  assert.equal(f.adapter.probe(f.ctx).supported,true);
  await f.adapter.writeField('contact.phone','Saved application phone',f.ctx);
  assert.equal((await f.adapter.readField('contact.phone',f.ctx)).value,'Saved application phone');
});
test('English signature requires unique native inputs and actual known labels, independently of html lang',()=>{
  const f=applicationFixture();assert.equal(f.adapter.probe(f.ctx).supported,true);
  const email=f.all.find(node=>node.id==='basic_ttcnEmail');f.meta.get(f.meta.get(email).labels[0]).text='Wrong language';
  assert.equal(f.adapter.probe(f.ctx).supported,false);
  f.meta.get(f.meta.get(email).labels[0]).text='Email';f.all.push(email);assert.equal(f.adapter.probe(f.ctx).supported,false);
});
test('photo count does not require review; cancellation prevents mutations',async()=>{
  const f=applicationFixture();assert.equal(f.adapter.observeImages(f.ctx).processing,false);
  f.meta.get(f.all.find(node=>node.id==='basic_anhHoChieu')).files=[{}];
  assert.deepEqual(f.adapter.observeImages(f.ctx),{processing:false,dialogOpen:false});
  f.meta.get(f.all.find(node=>node.id==='basic_anhMat')).files=[{}];
  assert.deepEqual(f.adapter.observeImages(f.ctx),{processing:false,dialogOpen:false});
  f.abort.abort();await assert.rejects(f.adapter.writeField('contact.phone','late',f.ctx),{code:'cancelled'});assert.deepEqual(f.trace,[]);
});
test('conditional scalar binding and address autocomplete use actual native dispatch, blur and readback',async()=>{
  const conditional=applicationFixture();
  Object.assign(conditional.meta.get(conditional.input),{id:'basic_kpbhCongTyTen',maxLength:100});
  conditional.meta.get(conditional.label).htmlFor='basic_kpbhCongTyTen';
  await conditional.adapter.writeField('expenses.sponsor.name','Example company',conditional.ctx);
  assert.equal((await conditional.adapter.readField('expenses.sponsor.name',conditional.ctx)).value,'Example company');
  const f=applicationFixture(),select=new f.Element('ant-select');
  f.form.children=f.form.children.filter(node=>node!==f.input);f.form.append(select.append(f.input));
  Object.assign(f.meta.get(f.input),{id:'basic_ttcdDcTamTru',type:'search',role:'combobox'});
  f.meta.get(f.label).htmlFor='basic_ttcdDcTamTru';
  f.Element.prototype.blur=function(){f.trace.push('blur');};
  await f.adapter.writeField('trip.address','Example stay address',f.ctx);
  assert.equal((await f.adapter.readField('trip.address',f.ctx)).value,'Example stay address');
  assert.deepEqual(f.trace,['setter','input','change','blur']);
  f.onEvent(event=>{if(event.type==='change')f.meta.get(f.input).value='';});
  await assert.rejects(f.adapter.writeField('trip.address','Reset by site',f.ctx),{code:'unavailable'});
  const pending=f.adapter.writeField('trip.address','Cancelled',f.ctx);f.abort.abort();
  await assert.rejects(pending,{code:'cancelled'});
});
function event(){const listeners=new Set();return {addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn),fire:value=>{for(const fn of [...listeners])fn(value);}};}
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Session timed out');}
test('real session port drives actual adapter native writes, supports second run and cancels active wait',async t=>{
  const f=applicationFixture(),runtime={id:'extension',getURL:path=>`moz-extension://test/${path}`,onConnect:event()};
  let serial=0;const session=createSession({runtime,window:f.window,document:f.doc,adapter:f.adapter,uuid:()=>`doc-${++serial}`});t.after(()=>session.dispose());
  const port={name:SESSION_PORT,sender:{id:runtime.id,url:runtime.getURL('sidebar/sidebar.html')},onMessage:event(),onDisconnect:event(),sent:[],postMessage(message){this.sent.push(message);}};
  runtime.onConnect.fire(port);
  for(const [runId,value] of [['one','first'],['two','second']]){
    port.onMessage.fire({type:'probe',runId});await until(()=>port.sent.some(item=>item.type==='probe'&&item.runId===runId));
    port.onMessage.fire({type:'start',runId,documentId:session.documentId,data:{schemaVersion:1,contact:{phone:value}}});
    await until(()=>port.sent.some(item=>item.type==='completed'&&item.runId===runId));assert.equal(f.meta.get(f.input).value,value);
  }
  port.onMessage.fire({type:'probe',runId:'three'});await until(()=>port.sent.some(item=>item.type==='probe'&&item.runId==='three'));
  port.onMessage.fire({type:'start',runId:'three',documentId:session.documentId,data:{schemaVersion:1,contact:{phone:'cancelled value'}}});
  await until(()=>f.trace.length>6);port.onMessage.fire({type:'stop',runId:'three'});
  await until(()=>port.sent.some(item=>item.type==='cancelled'&&item.runId==='three'));const count=f.trace.length;
  await new Promise(resolve=>setTimeout(resolve,80));assert.equal(f.trace.length,count);
});




test('new site script-tag rejection ends the image upload without waiting for preview timeout',async()=>{
  const f=applicationFixture();let rejected=false;
  f.all.find(node=>node.id==='basic_anhMat').tagName='INPUT';
  const toast=new f.Element('ant-notification-notice');f.meta.get(toast).text='File has script tag, please try again';
  const query=f.doc.querySelectorAll;
  f.doc.querySelectorAll=selector=>selector==='.ant-notification-notice,.ant-message-notice'?rejected?[toast]:[]:query(selector);
  f.window.File=class{constructor(parts,name,{type}){this.name=name;this.type=type;this.size=parts[0].byteLength;}};
  f.window.DataTransfer=class{constructor(){this.files=[];this.items={add:file=>{this.files.push(file);return file;}};}};
  f.onEvent(()=>{rejected=true;});
  const timer=setTimeout(()=>f.abort.abort(),300);
  try {await assert.rejects(f.adapter.attachImage('portrait',{name:'portrait.jpg',type:'image/jpeg',bytes:new ArrayBuffer(2*1024*1024)},f.ctx),{code:'image_rejected_script_tag'});}
  finally {clearTimeout(timer);}
  assert.equal(f.abort.signal.aborted,false);
});
