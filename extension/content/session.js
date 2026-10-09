import {createController,DEFAULT_SETTINGS} from './controller.js';
import {validateApplication} from '../shared/validator.js';
import {FIELDS} from '../shared/contract.js';
import {isPersonalFormUrl} from '../shared/route.js';
import {captureForm} from './form-export.js';

export const SESSION_PORT = 'evisa-filler';
const terminal = new Set(['completed','cancelled','failed']);
const fail = code => Object.assign(new Error(code),{code});
function probeErrorCode(error) {
  try {const code=error?.code;return ['probe_timeout','document_lost'].includes(code)?code:'probe_failed';}
  catch {return 'probe_failed';}
}
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function imagesFrom(input = {}) {
  if (!plain(input)) throw fail('invalid_images');
  const images = {};
  for (const [role,image] of Object.entries(input)) {
    if (!['portrait','passport'].includes(role) || !plain(image) ||
      Object.keys(image).some(key => !['name','type','bytes'].includes(key)) ||
      typeof image.name !== 'string' || !image.name ||
      !['image/png','image/jpeg'].includes(image.type) || !(image.bytes instanceof ArrayBuffer) ||
      image.bytes.byteLength < 10 * 1024 || image.bytes.byteLength > 2 * 1024 * 1024) throw fail('invalid_images');
    const bytes = new Uint8Array(image.bytes);
    const signature = image.type === 'image/png'
      ? [137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!signature) throw fail('invalid_images');
    images[role] = {name:image.name,type:image.type,bytes:image.bytes};
  }
  return images;
}

/** Bootstrap calls this once in the top frame, with the real adapter and browser.runtime.
 * The sidebar opens SESSION_PORT on that frame. Its sender URL must be exactly
 * runtime.getURL('sidebar/sidebar.html'). Every command has {type,runId}.
 * probe replies {type:'probe',runId,documentId,supported}; start additionally sends
 * that documentId, data (JSON-compatible object) or json (JSON text), and optional
 * images {portrait?,passport?}, each {name,type,bytes:ArrayBuffer}.
 * The sidebar must fully decode its image files before sending; signatures here
 * are a transport check and do not prove the image can be decoded.
 * Events follow the controller contract; protocol errors are {type:'error',runId,code}.
 * The returned dispose() removes listeners and stops the active run. This module
 * alone is not a loadable extension: bootstrap, verified adapter and manifest are separate.
 * routeGuard is an optional synchronous additional predicate. uuid and settings
 * allow deterministic identities and controller deadlines in tests.
 */
export function createSession({runtime,adapter,window,document = window.document,
  routeGuard = () => true,uuid = () => globalThis.crypto.randomUUID(),settings = {},routePollMs = 50}) {
  let documentId = uuid(), disposed = false, hidden = false, owner = null, active = null, routeTimer = null;
  const initialHref=window.location.href;
  const ports = new Map();
  let exporting=null;
  // IDs are metadata only. Reusing one would make an old stop/resume ambiguous.
  const usedRuns = new Set();
  function current() {
    if (disposed || hidden || window.document !== document) return false;
    try {
      const url = new URL(window.location.href);
      return window.location.href===initialHref && isPersonalFormUrl(url) &&
        routeGuard({window,document,documentId}) !== false;
    } catch {return false;}
  }
  function clearWatch() {if (routeTimer !== null) {window.clearInterval(routeTimer); routeTimer = null;}}
  function stop() {if (active) {try {controller.stop(active.runId);} catch { /* already terminal */ }}}
  function invalidateProbe(state) {
    state.probe = null; state.probeRequest++;
    state.probeScope?.abort('cancelled'); state.probeScope = null;
  }
  function disconnect(port) {
    const state = ports.get(port); if (!state) return;
    ports.delete(port);
    state.exportScope?.abort('cancelled');
    port.onMessage.removeListener(state.message); port.onDisconnect.removeListener(state.disconnect);
    invalidateProbe(state);
    if (owner === port) {owner = null; stop();}
  }
  function send(port,event) {
    if (!ports.has(port)) return false;
    try {port.postMessage(event); return true;} catch {disconnect(port); return false;}
  }
  const controller = createController(adapter,{...settings,
    assertCurrent(runId) {if (!active || active.runId !== runId || active.documentId !== documentId || !current()) throw fail('document_lost');},
    onEvent(event) {
      if (!active || event.runId !== active.runId) return;
      if (owner) send(owner,event);
      if (terminal.has(event.type)) {clearWatch(); active = null; owner = null;}
    }
  });
  async function command(port,state,message) {
    const runId = typeof message?.runId === 'string' ? message.runId : '';
    const error = code => send(port,{type:'error',runId,code});
    if (!runId || !plain(message)) return error('invalid_command');
    if (message.type === 'probe') {
      invalidateProbe(state);
      const request = state.probeRequest;
      const identity = documentId;
      if (!current()) return send(port,{type:'probe',runId,documentId:identity,supported:false});
      const scope = new AbortController(); state.probeScope = scope;
      let rejectAbort;
      const interrupted = new Promise((_,reject) => {
        rejectAbort = () => reject(fail(scope.signal.reason === 'timeout' ? 'probe_timeout' : 'document_lost'));
        scope.signal.addEventListener('abort',rejectAbort,{once:true});
      });
      const probeDeadline = setTimeout(() => scope.abort('timeout'),settings.fieldTimeoutMs ?? DEFAULT_SETTINGS.fieldTimeoutMs);
      const probeRouteWatch = window.setInterval(() => {if (!current()) scope.abort('document_lost');},routePollMs);
      const ctx = {runId,signal:scope.signal,assertCurrent() {
        if (scope.signal.aborted || request !== state.probeRequest || !ports.has(port) || documentId !== identity || !current()) throw fail('document_lost');
      }};
      try {
        const result = await Promise.race([Promise.resolve().then(() => {ctx.assertCurrent(); return adapter.probe(ctx);}),interrupted]);
        if (!ports.has(port) || request !== state.probeRequest) return;
        if (identity !== documentId || !current()) return error('document_lost');
        ctx.assertCurrent();
        if (typeof result?.supported !== 'boolean') return error('probe_failed');
        if (result.supported === true) state.probe = identity;
        send(port,{type:'probe',runId,documentId:identity,supported:result.supported});
      } catch(errorValue) {
        if (ports.has(port) && request === state.probeRequest) error(probeErrorCode(errorValue));
      } finally {
        clearTimeout(probeDeadline); window.clearInterval(probeRouteWatch);
        scope.signal.removeEventListener('abort',rejectAbort); scope.abort('operation_finished');
        if (state.probeScope === scope) state.probeScope = null;
      }
      return;
    }
    if(message.type==='export'){
      if(active||controller.activeRunId||exporting)return error('run_active');
      if(!current()||message.documentId!==documentId||state.probe!==documentId)return error('stale_document');
      const scope=new AbortController(),identity=documentId,request=state.probeRequest;
      exporting=scope;state.exportScope=scope;state.probe=null;
      const ctx={runId,signal:scope.signal,assertCurrent(){
        if(scope.signal.aborted||!ports.has(port)||!current()||documentId!==identity||state.probeRequest!==request)throw fail('document_lost');
      }};
      let rejectAbort;
      const interrupted=new Promise((_,reject)=>{rejectAbort=()=>reject(fail(scope.signal.reason==='timeout'?'export_timeout':'document_lost'));scope.signal.addEventListener('abort',rejectAbort,{once:true});});
      const deadline=setTimeout(()=>scope.abort('timeout'),settings.exportTimeoutMs??15000);
      const watch=window.setInterval(()=>{if(!current())scope.abort('document_lost');},routePollMs);
      try {
        const snapshot=await Promise.race([captureForm(adapter,ctx),interrupted]);ctx.assertCurrent();
        send(port,{type:'exported',runId,...snapshot});
      }catch {error(scope.signal.reason==='timeout'?'export_timeout':'export_failed');}
      finally {
        clearTimeout(deadline);window.clearInterval(watch);scope.signal.removeEventListener('abort',rejectAbort);scope.abort('finished');
        if(exporting===scope)exporting=null;state.exportScope=null;
      }
      return;
    }
    if (message.type === 'start') {
      if (active || controller.activeRunId || exporting) return error('run_active');
      if (usedRuns.has(runId)) return error('stale_run');
      if (!current() || message.documentId !== documentId || state.probe !== documentId) return error('stale_document');
      let validation, images;
      try {
        validation = validateApplication(typeof message.json === 'string' ? message.json : JSON.stringify(message.data));
        if (!validation.ok) return error('invalid_data');
        images = imagesFrom(message.images);
        const hasFields = Object.keys(FIELDS).some(path => {
          const value = path.split('.').reduce((value,key) => value?.[key],validation.data);
          return value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
        });
        if (!hasFields && !Object.keys(images).length) return error('no_data');
      } catch {return error('invalid_payload');}
      usedRuns.add(runId); owner = port; active = {runId,documentId}; state.probe = null;
      routeTimer = window.setInterval(() => {if (!current()) stop();},routePollMs);
      // Payload belongs only to the controller after this call, never to port state.
      controller.start({runId,data:validation.data,images}).catch(() => {
        if (active?.runId === runId) {error('start_failed'); clearWatch(); active = null; owner = null;}
      });
      return;
    }
    if (!['resume','stop'].includes(message.type)) return error('invalid_command');
    if (owner !== port || active?.runId !== runId) return error('stale_run');
    try {
      if (message.type === 'resume' && !current()) {stop(); return error('document_lost');}
      controller[message.type](runId);
    } catch {error(message.type === 'resume' ? 'stale_resume' : 'stale_stop');}
  }
  function connect(port) {
    if (disposed || port.name !== SESSION_PORT || port.sender?.id !== runtime.id ||
      port.sender?.url !== runtime.getURL('sidebar/sidebar.html')) {try {port.disconnect();} catch {} return;}
    const state = {probe:null,probeRequest:0,probeScope:null};
    state.message = message => {command(port,state,message).catch(() => send(port,{type:'error',runId:typeof message?.runId === 'string' ? message.runId : '',code:'invalid_command'}));};
    state.disconnect = () => disconnect(port);
    ports.set(port,state); port.onMessage.addListener(state.message); port.onDisconnect.addListener(state.disconnect);
  }
  const pagehide = () => {hidden = true; exporting?.abort('document_lost');ports.forEach(invalidateProbe); stop();};
  const pageshow = event => {if (event.persisted) {documentId = uuid(); ports.forEach(invalidateProbe);} hidden = false;};
  runtime.onConnect.addListener(connect);
  window.addEventListener('pagehide',pagehide); window.addEventListener('pageshow',pageshow);
  return {
    get documentId() {return documentId;},
    get state() {return controller.state;},
    dispose() {
      if (disposed) return; disposed = true; stop(); clearWatch();
      runtime.onConnect.removeListener(connect);
      window.removeEventListener('pagehide',pagehide); window.removeEventListener('pageshow',pageshow);
      for (const port of [...ports.keys()]) disconnect(port);
      usedRuns.clear();
    }
  };
}
