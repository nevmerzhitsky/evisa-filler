import {assignImageFile} from './file-transfer.js';

const bindings={portrait:'basic_anhMat',passport:'basic_anhHoChieu'};
const issued=new WeakSet();
const fail=code=>{const error=Object.assign(new Error(code),{code});issued.add(error);return error;};
const fileCodes=new Set(['cancelled','document_lost','invalid_file_input','invalid_image','file_creation_failed','file_transfer_unavailable','file_assignment_failed','file_readback_mismatch','file_event_creation_failed','file_event_dispatch_failed']);

/** Uploads use the real file input and retain no image bytes. New, loaded remote
 * preview identity is evidence of this upload, never the file name or old preview.
 * Visible errors/busy UI/dialogs are observed without surrounding text or values.
 * API methods use controller ctx={signal,assertCurrent,runId}, plus document here.
 */
export function createImageFieldAccess(document,{assertContext}={}) {
  const realm=document?.defaultView;
  let attempted=false;
  function guard(ctx) {
    if(!ctx||typeof ctx.assertCurrent!=='function')throw fail('invalid_image_context');
    if(ctx.signal?.aborted)throw fail('cancelled');
    try {
      for(const callback of [ctx.assertCurrent,assertContext].filter(Boolean)) {
        const result=callback(ctx);
        if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw null;}
        if(result===false)throw null;
      }
    }catch{throw fail(ctx.signal?.aborted?'cancelled':'document_lost');}
    if(ctx.signal?.aborted)throw fail('cancelled');
  }
  const visible=node=>node?.isConnected===true&&node.ownerDocument===document&&node.getClientRects().length>0&&realm.getComputedStyle(node).display!=='none'&&!['hidden','collapse'].includes(realm.getComputedStyle(node).visibility);
  function inputFor(kind,ctx) {
    guard(ctx);
    if(!Object.hasOwn(bindings,kind))throw fail('unsupported_image_role');
    const getId=Object.getOwnPropertyDescriptor(realm?.Element?.prototype,'id')?.get;
    const getType=Object.getOwnPropertyDescriptor(realm?.HTMLInputElement?.prototype,'type')?.get;
    const getDisabled=Object.getOwnPropertyDescriptor(realm?.HTMLInputElement?.prototype,'disabled')?.get;
    if(!getId||!getType||!getDisabled)throw fail('image_native_unavailable');
    const nodes=[...document.querySelectorAll('[id]')];if(nodes.length>1000)throw fail('image_binding_ambiguous');
    const found=nodes.filter(node=>getId.call(node)===bindings[kind]);
    if(found.length!==1||!(found[0] instanceof realm.HTMLInputElement)||getType.call(found[0])!=='file'||getDisabled.call(found[0])||found[0].ownerDocument!==document||found[0].isConnected!==true)throw fail('image_target_unavailable');
    const input=found[0],container=input.closest('.ant-form-item')||input.closest('.ant-upload-wrapper')||input.parentElement;
    if(!container||!visible(container))throw fail('image_target_unavailable');
    guard(ctx);return {input,container};
  }
  function previews(container) {
    return [...container.querySelectorAll('img')].filter(visible).map(image=>({image,source:image.currentSrc||image.getAttribute('src')||''})).filter(({image,source})=>{
      if(!image.complete||image.naturalWidth<=0)return false;
      // A server-returned preview is different evidence from a local blob preview.
      try {const url=new URL(source,document.URL);return ['http:','https:'].includes(url.protocol)&&!url.pathname.includes('/assets/');}catch{return false;}
    });
  }
  function visibleAny(root,selector){return [...root.querySelectorAll(selector)].some(visible);}
  function notifications() {
    return new Map([...document.querySelectorAll('.ant-notification-notice,.ant-message-notice')].filter(visible).map(node=>[node,node.textContent.trim()]));
  }
  function uploadRejection(before) {
    for(const [node,text] of notifications()) {
      if(before.get(node)===text)continue;
      if(/file has script tag, please try again/i.test(text))return 'image_rejected_script_tag';
      if(visibleAny(node,'.ant-notification-notice-icon-error,.ant-message-error'))return 'image_upload_failed';
    }
    return null;
  }
  function observeDialog(ctx) {
    guard(ctx);const open=visibleAny(document,'[role="dialog"],.ant-modal');guard(ctx);return {open};
  }
  function observeImages(ctx) {
    guard(ctx);let processing=false;
    for(const role of Object.keys(bindings)) {
      const {container}=inputFor(role,ctx);
      processing||=visibleAny(container,'.ant-upload-list-item-uploading,.ant-spin-spinning,[aria-busy="true"]');
    }
    processing||=visibleAny(document,'.ant-spin-spinning,[aria-busy="true"]');
    const {open:dialogOpen}=observeDialog(ctx);
    guard(ctx);
    return {processing,dialogOpen};
  }
  function delay(ctx,ms) {
    guard(ctx);return new Promise((resolve,reject)=>{
      const abort=()=>{clearTimeout(timer);ctx.signal?.removeEventListener('abort',abort);reject(fail('cancelled'));};
      const timer=setTimeout(()=>{ctx.signal?.removeEventListener('abort',abort);try{guard(ctx);resolve();}catch(error){reject(error);}},ms);
      ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)abort();
    });
  }
  async function attachImage(kind,image,ctx) {
    try {
      const {input,container}=inputFor(kind,ctx),before=new Set(previews(container).map(item=>item.source)),hadDialog=observeDialog(ctx).open;
      const previousNotifications=notifications();
      const current=()=>{guard(ctx);const latest=inputFor(kind,ctx);if(latest.input!==input||latest.container!==container)throw fail('document_lost');};
      attempted=true;
      try {assignImageFile(input,image,{document,signal:ctx.signal,assertCurrent:current,FileCtor:realm.File,DataTransferCtor:realm.DataTransfer,EventCtor:realm.Event});}
      catch(error){if(issued.has(error))throw error;let code;try{code=error?.code;}catch{}throw fail(fileCodes.has(code)?code:'image_assignment_failed');}
      const deadline=Date.now()+15000;
      while(true) {
        current();
        const rejection=uploadRejection(previousNotifications);
        if(rejection)throw fail(rejection);
        if(visibleAny(container,'.ant-upload-list-item-error,.ant-form-item-has-error,[aria-invalid="true"]'))throw fail('image_upload_failed');
        const fresh=previews(container).some(item=>!before.has(item.source));
        const busy=visibleAny(container,'.ant-upload-list-item-uploading,.ant-spin-spinning,[aria-busy="true"]');
        current();
        if(fresh&&!busy)return {ok:true,label:kind==='portrait'?'Portrait photograph':'Passport photograph'};
        // The site's repeated-passport upload handler opens its manual decision
        // dialog. Yield immediately so the controller can pause without a timer.
        if(kind==='passport'&&!hadDialog&&observeDialog(ctx).open)return {ok:true,label:'Passport photograph',pendingDialog:true};
        if(observeDialog(ctx).open)throw fail('image_manual_dialog');
        if(Date.now()>=deadline)throw fail('image_upload_unconfirmed');
        await delay(ctx,75);
      }
    }catch(error){throw issued.has(error)?error:fail('image_dom_unavailable');}
  }
  return {
    attachImage,
    observeImages(ctx){try{return observeImages(ctx);}catch(error){throw issued.has(error)?error:fail('image_dom_unavailable');}},
    observeDialog(ctx){try{return observeDialog(ctx);}catch(error){throw issued.has(error)?error:fail('image_dom_unavailable');}},
    dispose(){attempted=false;},
    get uploadAttempted(){return attempted;}
  };
}
