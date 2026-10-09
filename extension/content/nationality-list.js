const issued=new WeakSet();
const fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const groups='.ant-radio-group,[role="radiogroup"]';
const headers='.flex.justify-between.pb-5';
const owners='.pt-5.border-b';
const question='Do you have multiple nationalities?';

/** Read-only binding for a caller-attributed, concrete additional-nationalities
 * radio group. ctx.assertCurrent is synchronous; ctx.document and signal are
 * optional. Returns owned native row/input/select and Add/Remove nodes, never
 * field values, selections or generated identifiers. No actions are performed.
 * Call assertCurrentStructure immediately before using any returned reference.
 * Summary Add must belong to the data table, even with a separate header table.
 * Remove is only an owned image trigger, not permission to delete or confirm.
 */
export function resolveNationalityList(group,ctx) {
  try {
    if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_nationality_context');
    function current() {
      if(ctx.signal?.aborted)throw fail('cancelled');
      try {
        const result=ctx.assertCurrent();
        if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}
        if(result===false)throw null;
      }catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}
      if(ctx.signal?.aborted)throw fail('cancelled');
    }
    current();
    const doc=ctx.document??globalThis.document,realm=doc?.defaultView;
    if(!realm||typeof realm.HTMLElement!=='function'||!(group instanceof realm.HTMLElement))throw fail('invalid_nationality_group');
    const constructors=['HTMLInputElement','HTMLTableElement','HTMLTableSectionElement','HTMLTableRowElement','HTMLTableCellElement','HTMLImageElement'];
    if(constructors.some(name=>typeof realm[name]!=='function'))throw fail('nationality_native_unavailable');
    const visible=node=>node?.isConnected&&node.ownerDocument===doc&&node.getClientRects().length>0&&
      realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
    const ready=node=>node instanceof realm.HTMLElement&&visible(node)&&!node.matches(':disabled')&&node.getAttribute('aria-disabled')!=='true';
    const bounded=(node,selector,max,code)=>{const found=[...node.querySelectorAll(selector)];if(found.length>max||new Set(found).size!==found.length)throw fail(code);return found;};
    const one=(nodes,code)=>{if(nodes.length!==1)throw fail(code);return nodes[0];};
    const requireReady=(node,code)=>{if(!ready(node))throw fail(code);};
    function resolve() {
      current();requireReady(group,'nationality_target_lost');
      if(!group.matches(groups)||group.querySelectorAll(groups).length||group.parentElement?.closest(groups))throw fail('nationality_owner_ambiguous');
      const header=group.closest(headers),owner=header?.closest(owners);
      if(!owner||group.closest(owners)!==owner)throw fail('nationality_owner_ambiguous');
      requireReady(header,'nationality_target_lost');requireReady(owner,'nationality_target_lost');
      if(one(bounded(owner,headers,20,'nationality_owner_ambiguous'),'nationality_owner_ambiguous')!==header||
        one(bounded(owner,groups,20,'nationality_owner_ambiguous'),'nationality_owner_ambiguous')!==group||
        header.querySelectorAll(groups).length!==1)throw fail('nationality_owner_ambiguous');
      const children=[...header.children];if(children.length>10)throw fail('nationality_owner_ambiguous');
      const captions=children.filter(node=>node!==group&&!node.contains(group)&&['DIV','SPAN'].includes(node.tagName)&&
        node.childElementCount===0&&ready(node)&&node.textContent.trim().replace(/\s+/g,' ')===question);
      const caption=one(captions,'nationality_question_ambiguous');
      const radios=bounded(group,'input',10,'nationality_owner_ambiguous');
      if(radios.length!==2||radios.some(input=>!(input instanceof realm.HTMLInputElement)||input.type!=='radio'||
        input.closest(groups)!==group||!ready(input)))throw fail('nationality_owner_ambiguous');
      const wrappers=bounded(owner,'.table-custom',2,'nationality_table_ambiguous');
      const identity=[owner,header,caption,group,...radios];
      if(!wrappers.length){current();return {status:'not_rendered',owner,header,wrapper:null,table:null,body:null,rows:[],add:null,identity};}
      const wrapper=one(wrappers,'nationality_table_ambiguous');requireReady(wrapper,'nationality_target_lost');
      if(wrapper.closest(owners)!==owner)throw fail('nationality_table_ambiguous');
      const tables=bounded(wrapper,'table',20,'nationality_table_ambiguous');
      if(!tables.length||tables.some(table=>!(table instanceof realm.HTMLTableElement)||table.closest('.table-custom')!==wrapper||
        table.parentElement?.closest('table')))throw fail('nationality_table_ambiguous');
      const body=one(bounded(wrapper,'tbody.ant-table-tbody',2,'nationality_table_ambiguous'),'nationality_table_ambiguous');
      const table=body.closest('table');
      if(!(body instanceof realm.HTMLTableSectionElement)||!tables.includes(table))throw fail('nationality_table_ambiguous');
      requireReady(body,'nationality_target_lost');requireReady(table,'nationality_target_lost');
      const rowNodes=bounded(body,'tr.ant-table-row',20,'nationality_rows_ambiguous');
      if(!rowNodes.length)throw fail('nationality_rows_ambiguous');
      const rows=rowNodes.map(row=>{
        if(!(row instanceof realm.HTMLTableRowElement)||row.parentElement!==body||row.closest('table')!==table)throw fail('nationality_rows_ambiguous');
        requireReady(row,'nationality_target_lost');
        const cells=bounded(row,'td',20,'nationality_cells_ambiguous');
        if(!cells.length||cells.some(cell=>!(cell instanceof realm.HTMLTableCellElement)||cell.parentElement!==row||cell.closest('table')!==table||!ready(cell)))throw fail('nationality_cells_ambiguous');
        const input=one(bounded(row,'input',10,'nationality_control_ambiguous'),'nationality_control_ambiguous');
        const select=input.closest('.ant-select'),cell=input.closest('td');
        if(!(input instanceof realm.HTMLInputElement)||input.type!=='search'||input.readOnly||input.getAttribute('role')!=='combobox'||
          !select||!cells.includes(cell)||select.closest('tr')!==row||select.closest('td')!==cell||
          select.closest('.table-custom')!==wrapper||select.matches('.ant-select-multiple,.ant-select-disabled')||
          select.parentElement?.closest('.ant-select')||!select.contains(input)||
          one(bounded(row,'.ant-select',2,'nationality_control_ambiguous'),'nationality_control_ambiguous')!==select||
          one(bounded(select,'input',2,'nationality_control_ambiguous'),'nationality_control_ambiguous')!==input)throw fail('nationality_control_ambiguous');
        requireReady(input,'nationality_target_lost');requireReady(select,'nationality_target_lost');
        const removes=bounded(row,'img[alt="XCircle"]',2,'nationality_action_ambiguous');
        if(removes.length!==(rowNodes.length===1?0:1))throw fail('nationality_action_ambiguous');
        const remove=removes[0]??null;
        if(remove){if(!(remove instanceof realm.HTMLImageElement)||
          remove.closest('tr')!==row||remove.closest('table')!==table||!cells.includes(remove.closest('td'))||
          remove.closest('.table-custom')!==wrapper)throw fail('nationality_action_ambiguous');requireReady(remove,'nationality_target_lost');}
        identity.push(row,...cells,select,input,remove);return {row,select,input,remove};
      });
      const summary=one(bounded(wrapper,'tfoot.ant-table-summary',2,'nationality_action_ambiguous'),'nationality_action_ambiguous');
      if(!(summary instanceof realm.HTMLTableSectionElement)||summary.closest('table')!==table)throw fail('nationality_action_ambiguous');
      requireReady(summary,'nationality_target_lost');
      const add=one(bounded(wrapper,'img[alt="PlusCircle"]',2,'nationality_action_ambiguous'),'nationality_action_ambiguous');
      const addCell=add.closest('td');
      if(!(add instanceof realm.HTMLImageElement)||add.closest('tfoot')!==summary||add.closest('table')!==table||
        !(addCell instanceof realm.HTMLTableCellElement)||addCell.closest('tfoot')!==summary)throw fail('nationality_action_ambiguous');
      requireReady(add,'nationality_target_lost');requireReady(addCell,'nationality_target_lost');
      // Controls/actions outside the owned data rows must not be silently omitted.
      if(bounded(wrapper,'input[role="combobox"]',50,'nationality_control_ambiguous').length!==rows.length||
        bounded(wrapper,'img[alt="XCircle"]',50,'nationality_action_ambiguous').length!==rows.filter(row=>row.remove).length)throw fail('nationality_control_ambiguous');
      identity.push(wrapper,...tables,body,summary,addCell,add);current();
      return {status:'resolved',owner,header,wrapper,table,body,rows,add,identity};
    }
    const initial=resolve(),identity=[...initial.identity];
    function assertCurrentStructure() {
      try {const fresh=resolve();if(fresh.status!==initial.status||fresh.identity.length!==identity.length||
        fresh.identity.some((node,index)=>node!==identity[index]))throw fail('nationality_structure_changed');current();}
      catch(error){throw issued.has(error)?error:fail('nationality_dom_unavailable');}
    }
    const {identity:unused,...result}=initial;
    return Object.freeze({...result,rows:Object.freeze(result.rows.map(row=>Object.freeze(row))),assertCurrentStructure});
  }catch(error){throw issued.has(error)?error:fail('nationality_dom_unavailable');}
}
