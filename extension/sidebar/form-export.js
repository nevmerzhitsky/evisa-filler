import {isPersonalFormUrl} from '../shared/route.js';

export function exportFilename(date=new Date()) {
  const pad=value=>String(value).padStart(2,'0');
  return `evisa-${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}.json`;
}

export async function readCurrentForm(browser,{requestId=crypto.randomUUID(),timeoutMs=20000}={}) {
  const [tab]=await browser.tabs.query({active:true,currentWindow:true});
  if(!Number.isInteger(tab?.id)||!isPersonalFormUrl(tab.url))throw new Error('unsupported_page');
  const port=browser.tabs.connect(tab.id,{name:'evisa-filler',frameId:0});
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      port.onMessage.removeListener(message);port.onDisconnect.removeListener(disconnected);
      try{port.disconnect();}catch{}
      if(error)reject(new Error(error));else resolve(result);
    };
    const disconnected=()=>finish('document_lost');
    const message=event=>{
      if(event?.runId!==requestId)return;
      if(event.type==='probe'){
        if(event.supported!==true||typeof event.documentId!=='string')return finish('unsupported_page');
        try{port.postMessage({type:'export',runId:requestId,documentId:event.documentId});}catch{finish('document_lost');}
      }else if(event.type==='exported'){
        if(event.data?.schemaVersion!==1||!Array.isArray(event.warnings))return finish('invalid_response');
        finish(null,{data:event.data,warnings:event.warnings});
      }else if(event.type==='error')finish(event.code==='run_active'?'run_active':'export_failed');
    };
    const timer=setTimeout(()=>finish('export_timeout'),timeoutMs);
    port.onMessage.addListener(message);port.onDisconnect.addListener(disconnected);
    try{port.postMessage({type:'probe',runId:requestId});}catch{finish('document_lost');}
  });
}

export async function saveFormJSON(browser,data,{date=new Date(),urlAPI=URL}={}) {
  const url=urlAPI.createObjectURL(new Blob([JSON.stringify(data,null,2)+'\n'],{type:'application/json;charset=utf-8'}));
  let id,finish;
  const early=new Map();
  const completed=new Promise(resolve=>{finish=resolve;});
  const changed=event=>{
    const state=event.state?.current;
    if(!['complete','interrupted'].includes(state))return;
    const result={state,error:event.error?.current};
    if(id===undefined)early.set(event.id,result);
    else if(event.id===id)finish(result);
  };
  browser.downloads.onChanged.addListener(changed);
  try {
    id=await browser.downloads.download({url,filename:exportFilename(date),saveAs:true});
    if(early.has(id))finish(early.get(id));
    const [item]=await browser.downloads.search({id});
    if(['complete','interrupted'].includes(item?.state))finish({state:item.state,error:item.error});
    const result=await completed;
    if(result.state==='interrupted'){
      if(result.error==='USER_CANCELED')return false;
      throw new Error('download_interrupted');
    }
    return true;
  }catch(error){
    if(/cancel(?:ed|led)|USER_CANCELED/i.test(error?.message??''))return false;
    throw new Error('save_failed');
  }finally {
    browser.downloads.onChanged.removeListener(changed);urlAPI.revokeObjectURL(url);early.clear();
  }
}
