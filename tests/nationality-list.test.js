import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNationalityList} from '../extension/content/nationality-list.js';

function fixture({rows=1,rendered=true,splitHeader=false}={}) {
  const document={},abort=new AbortController();let reads=0,actions=0;
  class Element {
    constructor(tag='DIV',classes='',attrs={}){this.tagName=tag;this.classes=new Set(classes.split(' ').filter(Boolean));this.attrs=attrs;this.children=[];this.parentElement=null;this.ownerDocument=document;this.isConnected=true;this.disabled=false;this.hidden=false;}
    append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(child=>child!==node);node.parentElement=this;this.children.push(node);}return this;}
    get childElementCount(){return this.children.length;}
    getClientRects(){return this.hidden?[]:[{}];}
    getAttribute(name){if(['id','name','value','title'].includes(name))throw {code:'PRIVATE attribute'};return this.attrs[name]??null;}
    matches(selector){return selector.split(',').some(part=>{
      if(part===':disabled')return this.disabled;
      const tag=part.match(/^[a-z]+/i)?.[0];if(tag&&this.tagName!==tag.toUpperCase())return false;
      for(const match of part.matchAll(/\.([\w-]+)/g))if(!this.classes.has(match[1]))return false;
      for(const match of part.matchAll(/\[([\w-]+)="([^"]+)"\]/g))if(this.attrs[match[1]]!==match[2])return false;
      return true;
    });}
    closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
    contains(node){for(;node;node=node.parentElement)if(node===this)return true;return false;}
    querySelectorAll(selector){reads++;const found=[];function visit(node){for(const child of node.children){if(child.matches(selector))found.push(child);visit(child);}}visit(this);return found;}
    get textContent(){throw {code:'PRIVATE container text'};}
    get value(){throw {code:'PRIVATE value'};}
    get checked(){throw {code:'PRIVATE checked'};}
    get name(){throw {code:'PRIVATE name'};}
    click(){actions++;throw Error('No actions allowed');}
    focus(){actions++;throw Error('No actions allowed');}
  }
  class Input extends Element {constructor(type,attrs={}){super('INPUT','',attrs);this.type=type;}}
  class Table extends Element {constructor(){super('TABLE');}}
  class Section extends Element {constructor(tag,classes){super(tag,classes);}}
  class Row extends Element {constructor(classes=''){super('TR',classes);}}
  class Cell extends Element {constructor(){super('TD');}}
  class Image extends Element {constructor(alt){super('IMG','',{alt});}}
  document.defaultView={HTMLElement:Element,HTMLInputElement:Input,HTMLTableElement:Table,HTMLTableSectionElement:Section,
    HTMLTableRowElement:Row,HTMLTableCellElement:Cell,HTMLImageElement:Image,getComputedStyle:()=>({display:'block',visibility:'visible'})};
  const owner=new Element('DIV','pt-5 border-b'),header=new Element('DIV','flex justify-between pb-5'),caption=new Element(),group=new Element('DIV','ant-radio-group');
  Object.defineProperty(caption,'textContent',{value:'Do you have multiple nationalities?',configurable:true});
  owner.append(header);header.append(caption,group);group.append(new Input('radio'),new Input('radio'));
  const wrapper=new Element('DIV','table-custom'),table=new Table(),body=new Section('TBODY','ant-table-tbody'),summary=new Section('TFOOT','ant-table-summary');
  if(rendered)owner.append(wrapper);
  if(splitHeader)wrapper.append(new Table().append(new Section('THEAD')));
  wrapper.append(table);table.append(body,summary);
  const add=new Image('PlusCircle');summary.append(new Row().append(new Cell().append(add)));
  const rowData=[];
  function makeRow(withRemove){
    const row=new Row('ant-table-row'),first=new Cell(),cell=new Cell(),actionCell=new Cell(),select=new Element('DIV','ant-select'),input=new Input('search',{role:'combobox'});
    select.append(input);row.append(first,cell.append(select),actionCell);let remove=null;
    if(withRemove){remove=new Image('XCircle');actionCell.append(new Element('SPAN','popconfirm').append(remove));}
    return {row,select,input,remove,cell};
  }
  for(let index=0;index<rows;index++){const entry=makeRow(rows>1);body.append(entry.row);rowData.push(entry);}
  // Ant measurement/placeholder rows do not count as data rows.
  body.append(new Row('ant-table-measure-row'));
  const ctx={document,signal:abort.signal,assertCurrent(){}};
  return {ctx,document,owner,header,caption,group,wrapper,table,body,summary,add,rowData,makeRow,Element,Input,Table,Row,Cell,Image,
    resolve:()=>resolveNationalityList(group,ctx),abort:()=>abort.abort(),get reads(){return reads;},get actions(){return actions;}};
}
const rejects=(fn,code)=>assert.throws(fn,error=>error.code===code&&!error.message.includes('PRIVATE'));

test('actual sibling question and anonymous row controls resolve without reading values or acting',()=>{
  for(const rows of [1,2]){
    const f=fixture({rows,splitHeader:true}),result=f.resolve();
    assert.equal(result.status,'resolved');assert.equal(result.add,f.add);assert.equal(result.rows.length,rows);
    assert.equal(result.rows[0].input,f.rowData[0].input);assert.equal(result.rows[0].select,f.rowData[0].select);
    assert.equal(result.rows[0].remove,rows===1?null:f.rowData[0].remove);
    result.assertCurrentStructure();assert.equal(f.actions,0);
    assert.deepEqual(Object.keys(result.rows[0]).sort(),['input','remove','row','select']);
  }
});

test('not rendered is a valid guarded result; mounting a table invalidates the old binding',()=>{
  const f=fixture({rendered:false}),result=f.resolve();assert.equal(result.status,'not_rendered');
  assert.deepEqual(result.rows,[]);assert.equal(result.add,null);result.assertCurrentStructure();
  f.owner.append(f.wrapper);rejects(()=>result.assertCurrentStructure(),'nationality_structure_changed');
});

test('caption/group/header ambiguity and wrong ownership refuse before row traversal',()=>{
  const duplicate=fixture(),caption=new duplicate.Element();Object.defineProperty(caption,'textContent',{value:'Do you have multiple nationalities?'});
  duplicate.header.append(caption);rejects(duplicate.resolve,'nationality_question_ambiguous');
  const wrong=fixture();Object.defineProperty(wrong.caption,'textContent',{value:'Other question'});rejects(wrong.resolve,'nationality_question_ambiguous');
  const groups=fixture();groups.header.append(new groups.Element('DIV','ant-radio-group'));rejects(groups.resolve,'nationality_owner_ambiguous');
  const headers=fixture();headers.owner.append(new headers.Element('DIV','flex justify-between pb-5'));rejects(headers.resolve,'nationality_owner_ambiguous');
});

test('nested table, foreign realm and duplicate/shared row input refuse',()=>{
  const nested=fixture();nested.rowData[0].cell.append(new nested.Table());rejects(nested.resolve,'nationality_table_ambiguous');
  const foreign=fixture();Object.setPrototypeOf(foreign.rowData[0].input,foreign.Element.prototype);rejects(foreign.resolve,'nationality_control_ambiguous');
  const shared=fixture({rows:2});const original=shared.rowData[1].row.querySelectorAll.bind(shared.rowData[1].row);
  shared.rowData[1].row.querySelectorAll=selector=>selector==='input'?[shared.rowData[0].input]:original(selector);
  rejects(shared.resolve,'nationality_control_ambiguous');
});

test('summary in a different table cannot grant Add ownership',()=>{
  const f=fixture(),other=new f.Table();f.wrapper.append(other);other.append(f.summary);
  rejects(f.resolve,'nationality_action_ambiguous');assert.equal(f.actions,0);
});

test('single-select mode, hidden/disabled controls and ambiguous actions refuse',()=>{
  const multiple=fixture();multiple.rowData[0].select.classes.add('ant-select-multiple');rejects(multiple.resolve,'nationality_control_ambiguous');
  for(const property of ['hidden','disabled']){const f=fixture();f.rowData[0].input[property]=true;rejects(f.resolve,'nationality_target_lost');}
  const extra=fixture();extra.summary.children[0].children[0].append(new extra.Image('PlusCircle'));rejects(extra.resolve,'nationality_action_ambiguous');
  const missing=fixture({rows:2});missing.rowData[0].remove.attrs.alt='Other';rejects(missing.resolve,'nationality_action_ambiguous');
  const readonly=fixture();readonly.rowData[0].input.readOnly=true;rejects(readonly.resolve,'nationality_control_ambiguous');
});

test('replacement of otherwise identical row or input is caught by the returned structure guard',()=>{
  for(const replace of ['row','input']){
    const f=fixture(),result=f.resolve();
    if(replace==='row'){const fresh=f.makeRow(false);f.body.children[0]=fresh.row;fresh.row.parentElement=f.body;}
    else{const fresh=new f.Input('search',{role:'combobox'});f.rowData[0].select.children=[fresh];fresh.parentElement=f.rowData[0].select;}
    rejects(()=>result.assertCurrentStructure(),'nationality_structure_changed');
  }
});

test('bounded rows/tables/cells refuse rather than accepting a truncated structure',()=>{
  const rows=fixture({rows:21});rejects(rows.resolve,'nationality_rows_ambiguous');
  const tables=fixture();for(let i=0;i<20;i++)tables.wrapper.append(new tables.Table());rejects(tables.resolve,'nationality_table_ambiguous');
  const cells=fixture();for(let i=0;i<18;i++)cells.rowData[0].row.append(new cells.Cell());rejects(cells.resolve,'nationality_cells_ambiguous');
});

test('cancelled, stale or async context refuses before DOM; subsequent cancellation invalidates refs',()=>{
  for(const kind of ['cancelled','stale','async']){
    const f=fixture();if(kind==='cancelled')f.abort();else f.ctx.assertCurrent=kind==='async'?async()=>true:()=>{throw {code:'PRIVATE'};};
    rejects(f.resolve,kind==='cancelled'?'cancelled':'document_lost');assert.equal(f.reads,0);
  }
  const f=fixture(),result=f.resolve();f.abort();rejects(()=>result.assertCurrentStructure(),'cancelled');
});

test('foreign DOM exceptions/getters are sanitized, including later structure checks',()=>{
  const f=fixture();f.owner.querySelectorAll=()=>{throw {get code(){throw Error('PRIVATE getter');}};};rejects(f.resolve,'nationality_dom_unavailable');
  const later=fixture(),result=later.resolve();later.rowData[0].input.getClientRects=()=>{throw null;};rejects(()=>result.assertCurrentStructure(),'nationality_dom_unavailable');
});
