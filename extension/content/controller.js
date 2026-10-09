import { FIELDS, RECORDS, DEPENDENCIES, CONTROLLING_FIELDS } from '../shared/contract.js';

/** Adapter contract (no selectors or framework access belong here):
 * probe(ctx) => {supported:boolean}; readField(path,ctx) => {value,available,valid?,label?}.
 * writeField(path,value,ctx), replaceList(path,rows,ctx), attachImage(role,file,ctx)
 * => {ok?:boolean,label?:string}. attachImage MUST return {ok:true} only after
 * observing completion of this new upload, not a preexisting preview or filename.
 * replaceList must verify all target rows BEFORE
 * deleting surplus rows; it must preserve surplus rows on any partial failure.
 * observeImages(ctx) => {processing:boolean,dialogOpen?:boolean}.
 * observeDialog(ctx) => boolean | {open:boolean}; dispose({runId}) is synchronous.
 * All methods may be async. ctx = {runId,signal,assertCurrent}; adapters MUST call
 * ctx.assertCurrent() immediately before EVERY DOM mutation, including delayed ones.
 * A timeout aborts that operation's signal, so checking only the run signal is unsafe.
 * readField returns canonical JSON values for requested fields.
 * available:false or valid:false means a value cannot safely be read back.
 * Optional prepareField(path,ctx) => {ok:true} prepares a supplied field before
 * its first read, for example switching the birth date mode and waiting for the
 * native picker. Other paths may return {ok:true} without mutation. It receives
 * the same scoped guard and runs only after dependency checks and image loading, never during
 * final verification. Missing confirmation is failure.
 */
export const DEFAULT_SETTINGS = Object.freeze({fieldTimeoutMs:10000,imageTimeoutMs:60000,pollIntervalMs:25});
const get = (data,path) => (path==='personal.confirmEmail'?'personal.email':path).split('.').reduce((v,k) => v?.[k],data);
const normalizedChoice = value => typeof value==='string' ? value.trim().replace(/\s+/g,' ').toLowerCase() : value;
function sameValue(a,b,type) {
  if(type==='choice') return typeof a==='string' && typeof b==='string' && normalizedChoice(a)===normalizedChoice(b);
  if(type==='choices') return Array.isArray(a) && Array.isArray(b) && a.length===b.length && a.every((value,index)=>sameValue(value,b[index],'choice'));
  if(Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length===b.length && a.every((value,index)=>sameValue(value,b[index],type));
  if(a && b && typeof a==='object' && typeof b==='object') {
    const keys=Object.keys(a).filter(key=>Object.hasOwn(b,key) || !(typeof type==='object' && (a[key]==='' || a[key]===null)));
    return keys.length===Object.keys(b).length && keys.every(key=>Object.hasOwn(b,key) && sameValue(a[key],b[key],typeof type==='object'?type[key]:undefined));
  }
  return Object.is(a,b);
}
const equal = (path,a,b) => sameValue(a,b,FIELDS[path]?.type==='records' ? RECORDS[path.split('.').at(-1)] : FIELDS[path]?.type);
const supplied = v => v !== undefined && v !== null && v !== '' && (!Array.isArray(v) || v.length > 0);
const failure = code => Object.assign(new Error(code),{code});
// Only public, static failure codes cross the adapter boundary into reports.
// Page exceptions can have private messages, arbitrary codes or throwing getters.
const publicErrorCodes = new Set([
  'cancelled','document_lost','timeout','unavailable','unsupported_page','write_failed',
  'readback_mismatch','final_mismatch','image_state_unknown','upload_unconfirmed','dependency_cycle',
  'invalid_text_context','invalid_text_value','invalid_text_input','native_text_accessor_unavailable',
  'text_input_unavailable','text_assignment_failed','text_event_creation_failed',
  'text_event_dispatch_failed','text_readback_mismatch',
  'invalid_date_context','invalid_date_input','invalid_date_value','invalid_year_value',
  'native_date_accessor_unavailable','date_target_lost','date_input_not_editable','date_timeout',
  'unsupported_enter','date_event_creation_failed','date_assignment_failed','date_event_dispatch_failed',
  'date_focus_failed','date_blur_failed','date_readback_mismatch','date_clear_unavailable','date_dom_unavailable',
  'invalid_radio_context','invalid_radio_group','invalid_radio_caption','native_radio_accessor_unavailable',
  'radio_target_lost','radio_timeout','radio_group_ambiguous','radio_label_ambiguous',
  'radio_caption_ambiguous','radio_selection_ambiguous','radio_options_changed','radio_option_missing',
  'radio_click_failed','radio_selection_changed','radio_dom_unavailable',
  'invalid_select_context','invalid_select_input','invalid_select_caption','select_dom_unavailable',
  'select_target_lost','selected_display_ambiguous','popup_ambiguous','options_truncated',
  'option_ambiguous','option_disabled','option_not_rendered','option_changed','selected_display_changed',
  'select_event_unavailable','select_open_failed','select_click_failed','select_result_timeout',
  'invalid_file_context','invalid_file_input','invalid_image','file_assignment_failed',
  'file_creation_failed','file_event_creation_failed','file_event_dispatch_failed',
  'file_readback_mismatch','file_transfer_unavailable',
  'invalid_image_context','unsupported_image_role','image_native_unavailable',
  'image_binding_ambiguous','image_target_unavailable','image_assignment_failed',
  'image_upload_failed','image_upload_unconfirmed','image_manual_dialog','image_dom_unavailable',
  'image_rejected_script_tag'
]);
function errorCode(error) {
  try {const code=error?.code;return publicErrorCodes.has(code)?code:'adapter_error';}
  catch {return 'adapter_error';}
}

export function createController(adapter, options = {}) {
  const settings = {...DEFAULT_SETTINGS,...options};
  let active = null;
  const emit = (run,type,extra={}) => options.onEvent?.({runId:run.id,type,...extra});
  const assert = run => {
    if (active !== run || run.abort.signal.aborted) throw failure('cancelled');
    try { if (options.assertCurrent?.(run.id) === false) throw failure('document_lost'); }
    catch { run.abort.abort('document_lost'); throw failure('document_lost'); }
  };
  async function op(run,method,args=[],timeout=settings.fieldTimeoutMs) {
    assert(run);
    const scope = new AbortController();
    const cancel = () => scope.abort(run.abort.signal.reason);
    run.abort.signal.addEventListener('abort',cancel,{once:true});
    let timer, rejectAbort;
    const interrupted = new Promise((_,reject) => {
      rejectAbort = () => reject(failure(scope.signal.reason === 'timeout' ? 'timeout' : run.abort.signal.reason === 'document_lost' ? 'document_lost' : 'cancelled'));
      scope.signal.addEventListener('abort',rejectAbort,{once:true});
      timer = setTimeout(() => scope.abort('timeout'),timeout);
    });
    const ctx = {runId:run.id,signal:scope.signal,assertCurrent() {assert(run); if(scope.signal.aborted) throw failure('cancelled');}};
    try {
      const result = await Promise.race([Promise.resolve().then(() => {ctx.assertCurrent(); return adapter[method](...args,ctx);}),interrupted]);
      ctx.assertCurrent();
      return result;
    } finally {
      clearTimeout(timer); scope.abort('operation_finished');
      scope.signal.removeEventListener('abort',rejectAbort);
      run.abort.signal.removeEventListener('abort',cancel);
    }
  }
  function delay(run,ms) {
    assert(run);
    return new Promise((resolve,reject) => {
      const abort = () => {clearTimeout(timer); reject(failure(run.abort.signal.reason === 'document_lost' ? 'document_lost' : 'cancelled'));};
      const timer = setTimeout(() => {run.abort.signal.removeEventListener('abort',abort); resolve();},ms);
      run.abort.signal.addEventListener('abort',abort,{once:true});
    });
  }
  async function pause(run, reason='Resolve the passport dialog on the site, then continue.', pauseKind='site_dialog') {
    run.state='paused'; emit(run,'paused',{reason,pauseKind});
    while (true) {
      assert(run);
      await new Promise((resolve,reject) => {
        const abort = () => {run.resume=null; reject(failure(run.abort.signal.reason==='document_lost'?'document_lost':'cancelled'));};
        run.abort.signal.addEventListener('abort',abort,{once:true});
        run.resume = () => {run.abort.signal.removeEventListener('abort',abort); run.resume=null; resolve();};
      });
      assert(run);
      const dialog=await op(run,'observeDialog');
      if (!(typeof dialog === 'boolean' ? dialog : dialog?.open)) break;
      emit(run,'paused',{reason:'The passport dialog is still open.',pauseKind:'site_dialog'});
    }
    run.state='running'; emit(run,'progress',{state:'running'});
  }
  const validImageState = state => state && typeof state.processing==='boolean';
  async function imagesReady(run, initialState) {
    let remaining=settings.imageTimeoutMs;
    while(remaining > 0) {
      const before=Date.now();
      const state=initialState ?? await op(run,'observeImages',[],remaining);
      initialState=undefined;
      if(!validImageState(state)) throw failure('image_state_unknown');
      run.siteProcessing=Boolean(state.processing);
      remaining-=Date.now()-before;
      if(state.dialogOpen) {await pause(run); continue;}
      if(!state.processing) return state;
      const wait=Math.min(settings.pollIntervalMs,remaining);
      await delay(run,wait); remaining-=wait;
    }
    throw failure('timeout');
  }
  function record(run,path,status,reason,label) {
    const item={path,label:label || path,status,reason};
    const previous=run.results.findIndex(x=>x.path===path);
    if(previous<0) run.results.push(item); else run.results[previous]=item;
    emit(run,'progress',{result:{...item}}); return item;
  }
  const fatal = error => ['cancelled','document_lost'].includes(errorCode(error));
  async function read(run,path) {
    const result=await op(run,'readField',[path]);
    if(!result || result.available !== true || result.valid === false || !Object.hasOwn(result,'value')) throw failure('unavailable');
    return result;
  }
  async function write(run,path,value) {
    try {
      if(typeof adapter.prepareField==='function') {
        const prepared=await op(run,'prepareField',[path]);
        if(prepared?.ok!==true) throw failure('write_failed');
      }
      const before=await read(run,path);
      if(equal(path,before.value,value)) {record(run,path,'unchanged','Already matches.',before.label); run.verified.set(path,{value}); return true;}
      const method=['records','choices'].includes(FIELDS[path]?.type)?'replaceList':'writeField';
      const result=await op(run,method,[path,value]);
      if(result?.ok===false) throw failure('write_failed');
      const after=await read(run,path);
      if(!equal(path,after.value,value)) throw failure('readback_mismatch');
      record(run,path,'filled','Verified after writing.',after.label || result?.label);
      if(FIELDS[path]?.type==='records') value.forEach((row,index)=>Object.keys(row).forEach(field=>{
        const item=record(run,`${path}[${index}].${field}`,'filled','Verified as part of the replacement list.');
        item.row=index+1; item.field=field;
      }));
      run.verified.set(path,{value}); return true;
    } catch(error) {
      if(fatal(error)) throw error;
      record(run,path,'error',`Action not confirmed: ${errorCode(error)}.`);
      if(FIELDS[path]?.type==='records' && Array.isArray(value)) value.forEach((row,index)=>Object.keys(row).forEach(field=>{
        const item=record(run,`${path}[${index}].${field}`,'error','Replacement row could not be confirmed.'); item.row=index+1; item.field=field;
      }));
      return false;
    }
  }
  async function execute(run) {
    try {
      const probe=await op(run,'probe'); if(probe?.supported!==true) throw failure('unsupported_page');
      const data=run.data;
      const paths=[...Object.keys(FIELDS),'personal.confirmEmail'];
      for(const path of paths) if(!supplied(get(data,path))) record(run,path,'skipped_empty','No supplied value.');
      try {
        await imagesReady(run);
        let blockedUploads=false;
        for(const [role,image] of Object.entries(run.images)) if(image) {
          if(blockedUploads) {record(run,role,'skipped_dependency','Site image processing has not finished; this upload was not attempted.');continue;}
          try {
            const result=await op(run,'attachImage',[role,image],settings.imageTimeoutMs);
            if(result?.ok!==true)throw failure('upload_unconfirmed');
            await imagesReady(run);
            record(run,role,'filled','Completion of this new upload was observed.',result?.label);
          } catch(error) {
            if(fatal(error))throw error;
            const code=errorCode(error);
            const reason=code==='image_rejected_script_tag'
              ?'Сайт отклонил фотографию: «File has script tag, please try again». Попробуйте другой файл.'
              :code==='image_upload_failed'
                ?'Сайт сообщил об ошибке загрузки фотографии. Проверьте уведомление на сайте.'
                :`Image upload not confirmed: ${code}.`;
            record(run,role,'error',reason);
            // Wait for any request already started by the site before uploading again.
            try {await imagesReady(run);}
            catch(waitError) {if(fatal(waitError))throw waitError;blockedUploads=true;}
          }
        }
      } catch(error) {if(fatal(error))throw error;record(run,'images','error',`Current image processing not confirmed: ${errorCode(error)}.`);}
      for(const [role,image] of Object.entries(run.images)) if(image&&!run.results.some(item=>item.path===role))record(run,role,'skipped_dependency','Site image processing has not finished; this upload was not attempted.');
      const pending=new Set(paths.filter(path=>supplied(get(data,path))).sort((a,b)=>Number(CONTROLLING_FIELDS.includes(b))-Number(CONTROLLING_FIELDS.includes(a))));
      const failed=new Set();
      while(pending.size) {
        const path=[...pending].find(p=>!(DEPENDENCIES[p] || []).some(parent=>pending.has(parent)));
        if(!path) throw failure('dependency_cycle');
        pending.delete(path);
        if((DEPENDENCIES[path] || []).some(parent=>failed.has(parent))) {
          failed.add(path); record(run,path,'skipped_dependency','A required parent action failed.');
          if(FIELDS[path]?.type==='records') get(data,path).forEach((row,index)=>Object.keys(row).forEach(field=>{
            const item=record(run,`${path}[${index}].${field}`,'skipped_dependency','A required parent action failed.'); item.row=index+1; item.field=field;
          }));
        } else if(!await write(run,path,get(data,path))) failed.add(path);
      }
      for(const [path,{value}] of run.verified) {
        try {if(!equal(path,(await read(run,path)).value,value)) throw failure('final_mismatch');}
        catch(error) {if(fatal(error)) throw error; record(run,path,'error','Final value could not be confirmed.');
          for(const item of run.results) if(item.path.startsWith(`${path}[`)) {item.status='error'; item.reason='Final list value could not be confirmed.';}
        }
      }
      if(typeof adapter.finalize==='function') {
        try {
          const result=await op(run,'finalize');
          if(result?.ok!==true)throw failure('write_failed');
          record(run,'trip.temporaryResidenceCommitment',result.status==='unchanged'?'unchanged':'filled','Checkbox checked and verified.',result.label);
        } catch(error) {
          if(fatal(error))throw error;
          record(run,'trip.temporaryResidenceCommitment','error',`Declaration checkbox not confirmed: ${errorCode(error)}.`);
        }
      }
      run.state='completed';
    } catch(error) {
      const code=errorCode(error);
      run.state=code==='cancelled'?'cancelled':'failed';
      const reason=code==='cancelled'?'Stopped before this action could be confirmed.':code==='document_lost'?'Target document was lost before this action could be confirmed.':'Session ended before this action could be confirmed.';
      // Every supplied action remains visible even if cancellation interrupts a
      // read or upload before its ordinary result has been recorded.
      for(const path of Object.keys(FIELDS)) if(supplied(get(run.data,path)) && !run.results.some(item=>item.path===path)) {
        record(run,path,'skipped_dependency',reason);
        if(FIELDS[path]?.type==='records') get(run.data,path).forEach((row,index)=>Object.keys(row).forEach(field=>{
          const item=record(run,`${path}[${index}].${field}`,'skipped_dependency',reason); item.row=index+1; item.field=field;
        }));
      }
      for(const [role,image] of Object.entries(run.images)) if(image && !run.results.some(item=>item.path===role)) record(run,role,'skipped_dependency',reason);
      record(run,'session','error',code==='document_lost'?'Target document was lost.':code==='cancelled'?'Stopped. Site requests already sent may still change the page.':'The session could not continue.');
    } finally {
      const report={runId:run.id,state:run.state,results:run.results.map(x=>({...x})),siteProcessing:run.siteProcessing};
      try {adapter.dispose?.({runId:run.id});} catch { /* cleanup must not retain payload */ }
      run.data=null; run.images=null; run.verified.clear(); run.resume=null;
      run.externalSignal?.removeEventListener('abort',run.externalAbort);
      if(active===run) active=null;
      emit(run,run.state,{report}); run.report=report;
    }
    return run.report;
  }
  return {
    start({runId,data,images={},signal}) {
      if(active) return Promise.reject(failure('run_active'));
      if(typeof runId!=='string' || !runId || !data) return Promise.reject(failure('invalid_run'));
      const run={id:runId,data:structuredClone(data),images:{...images},abort:new AbortController(),state:'running',results:[],verified:new Map(),siteProcessing:false};
      active=run;
      if(signal) {run.externalSignal=signal; run.externalAbort=()=>run.abort.abort('cancelled'); signal.addEventListener('abort',run.externalAbort,{once:true}); if(signal.aborted) run.externalAbort();}
      emit(run,'progress',{state:'running'}); return execute(run);
    },
    resume(runId) {if(!active || active.id!==runId || active.state!=='paused' || !active.resume) throw failure('stale_resume'); active.resume();},
    stop(runId) {if(!active || active.id!==runId) throw failure('stale_stop'); active.abort.abort('cancelled');},
    get state() {return active?.state || 'ready';},
    get activeRunId() {return active?.id || null;}
  };
}
