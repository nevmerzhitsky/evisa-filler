import {validateApplication} from '../shared/validator.js';
import {validateImage as checkImage} from '../shared/images.js';
import {FIELDS} from '../shared/contract.js';
import {personalFormMode} from '../shared/route.js';

export function createSidebarModel({browser,parseJSON=validateApplication,validateImage=checkImage,
  render=()=>{},uuid=()=>crypto.randomUUID(),probeTimeoutMs=10000,setTimer=setTimeout,clearTimer=clearTimeout}) {
  let state='empty',generation=0,port=null,runId=null,target=null,timer=null,stopRequested=false,resumeRequested=false;
  let json={name:'',pending:false,valid:true,data:{schemaVersion:1},errors:[]};
  let images={},results=[],notice='Нет данных для заполнения';
  const revisions={json:0,portrait:0,passport:0},scopes={};
  const busy=()=>state==='running'||state==='paused';
  const hasData=()=>json.valid && (Object.keys(FIELDS).some(path=>path.split('.').reduce((value,key)=>value?.[key],json.data)!==undefined)||Object.values(images).some(item=>item.image));
  const pending=()=>json.pending||Object.values(images).some(item=>item.pending);
  function snapshot(){return {state,target:target?{...target}:null,runId,notice,results:results.map(item=>({...item})),files:{json:{name:json.name,pending:json.pending,errors:json.errors.map(item=>({...item}))},...Object.fromEntries(Object.entries(images).map(([role,item])=>[role,{name:item.name,pending:item.pending,errors:item.errors.map(error=>({...error}))}]))},canStart:!busy()&&!pending()&&hasData(),canStop:busy()&&!stopRequested,canResume:state==='paused'&&!stopRequested&&!resumeRequested,inputsDisabled:busy()};}
  const emit=()=>render(snapshot());
  function ready(){state=!json.valid?'invalid':hasData()?'ready':'empty';notice=!json.valid?'Ошибка JSON. Исправьте файл перед запуском.':pending()?'Проверка файлов…':hasData()?'Данные проверены':'Нет данных для заполнения';emit();}
  function releasePort(){if(timer!==null){clearTimer(timer);timer=null;}if(port){const old=port;port=null;old.onMessage.removeListener(message);old.onDisconnect.removeListener(disconnected);try{old.disconnect();}catch{}}}
  function fail(reason){releasePort();state='failed';notice=reason;stopRequested=false;resumeRequested=false;emit();}
  function disconnected(){const old=port;port=null;old?.onMessage.removeListener(message);old?.onDisconnect.removeListener(disconnected);if(timer!==null){clearTimer(timer);timer=null;}generation++;for(const [role,scope] of Object.entries(scopes)){scope.abort();delete scopes[role];}resumeRequested=false;stopRequested=false;images={};json={name:'',pending:false,valid:true,data:{schemaVersion:1},errors:[]};if(busy()){state='cancelled';notice='Соединение закрыто. Выполненные изменения остаются на сайте.';}emit();}
  function message(event){
    if(event?.runId!==runId||!port)return;
    if(event.type==='probe'){
      if(timer===null)return;
      clearTimer(timer);timer=null;
      if(event.supported!==true||typeof event.documentId!=='string'||!event.documentId){fail('Открытая страница не поддерживается');return;}
      if(stopRequested){releasePort();state='cancelled';notice='Запуск остановлен до заполнения';emit();return;}
      try{port.postMessage({type:'start',runId,documentId:event.documentId,data:json.data,images:Object.fromEntries(Object.entries(images).filter(([,item])=>item.image).map(([role,item])=>[role,item.image]))});}
      catch{fail('Не удалось передать данные странице');}
      return;
    }
    if(event.type==='error'){fail(`Ошибка сеанса: ${typeof event.code==='string'?event.code:'invalid_response'}`);return;}
    if(!['progress','paused','completed','cancelled','failed'].includes(event.type))return;
    if(event.result){const index=results.findIndex(item=>item.path===event.result.path);if(index>=0)results[index]={...event.result};else results.push({...event.result});}
    if(Array.isArray(event.results))results=event.results.map(item=>({...item}));
    if(Array.isArray(event.report?.results))results=event.report.results.map(item=>({...item}));
    if(event.type==='progress'&&event.state==='running'){resumeRequested=false;state='running';notice='Заполнение…';}
    if(event.type==='paused'){
      resumeRequested=false;state='paused';
      notice=event.pauseKind==='site_dialog'
          ?'На сайте открыт диалог. Завершите действие в нём и нажмите «Продолжить».'
          :'Заполнение приостановлено. Проверьте страницу и нажмите «Продолжить».';
    }
    if(['completed','cancelled','failed'].includes(event.type)){
      state=event.type;stopRequested=false;resumeRequested=false;notice=event.type==='completed'?'Заполнение завершено. Проверьте каждое поле и результат на сайте.':event.type==='cancelled'?'Запуск остановлен. Выполненные изменения остаются на сайте.':'Заполнение завершилось ошибкой';
      if(event.report?.siteProcessing)notice+=' Сайт ещё обрабатывает изображения и может изменить поля.';
      releasePort();
    }
    emit();
  }
  async function selectFile(role,file){
    if(busy()||!Object.hasOwn(revisions,role))return false;
    const revision=++revisions[role],epoch=generation;
    scopes[role]?.abort();const scope=new AbortController();scopes[role]=scope;
    if(role==='json')json={name:file?.name??'',pending:!!file,valid:!file,data:file?null:{schemaVersion:1},errors:[]};
    else if(file)images[role]={name:file.name,pending:true,image:null,errors:[]};else delete images[role];
    ready();if(!file){delete scopes[role];return true;}
    let result;
    try{result=role==='json'?parseJSON(await file.text()):await validateImage(file,role,{signal:scope.signal});}
    catch{result={ok:false,errors:[{path:role,reason:'Не удалось прочитать файл'}]};}
    if(generation!==epoch||revisions[role]!==revision||scope.signal.aborted)return false;
    if(role==='json')json={name:file.name,pending:false,valid:result.ok===true,data:result.ok?result.data:null,errors:result.errors??[]};
    else images[role]={name:file.name,pending:false,image:result.ok?result.image:null,errors:result.errors??[]};
    delete scopes[role];ready();return true;
  }
  async function start(){
    if(!snapshot().canStart){if(!busy()){notice=!json.valid?'Ошибка JSON. Исправьте файл перед запуском.':'Нет данных для заполнения';emit();}return false;}
    releasePort();state='running';stopRequested=false;resumeRequested=false;results=[];notice='Проверка целевой вкладки…';target=null;runId=uuid();const epoch=generation;emit();
    try{
      const [tab]=await browser.tabs.query({active:true,currentWindow:true});
      if(epoch!==generation||!busy())return false;
      const url=new URL(tab?.url??'');
      if(!Number.isInteger(tab?.id)||personalFormMode(url)!=='new'){fail(personalFormMode(url)==='saved'?'Сохранённая заявка доступна только для сохранения в JSON.':'Откройте английскую личную форму https://evisa.gov.vn/e-visa/foreigners');return false;}
      target={tabId:tab.id,url:`${url.origin}${url.pathname}`};
      if(stopRequested){state='cancelled';notice='Запуск остановлен до заполнения';emit();return false;}
      port=browser.tabs.connect(tab.id,{name:'evisa-filler',frameId:0});port.onMessage.addListener(message);port.onDisconnect.addListener(disconnected);
      timer=setTimer(()=>fail('Превышено время проверки страницы'),probeTimeoutMs);
      port.postMessage({type:'probe',runId});emit();return true;
    }catch{if(epoch===generation)fail('Не удалось соединиться с целевой вкладкой');return false;}
  }
  function stop(){if(!busy()||stopRequested)return;stopRequested=true;resumeRequested=false;notice='Остановка…';if(port&&timer===null){try{port.postMessage({type:'stop',runId});}catch{disconnected();}}emit();}
  function resume(){if(state!=='paused'||stopRequested||resumeRequested||!port)return;resumeRequested=true;try{port.postMessage({type:'resume',runId});notice='Продолжение заполнения…';emit();}catch{disconnected();}}
  function clear(){generation++;for(const [role,scope] of Object.entries(scopes)){scope.abort();delete scopes[role];}releasePort();json={name:'',pending:false,valid:true,data:{schemaVersion:1},errors:[]};images={};results=[];runId=null;target=null;stopRequested=false;resumeRequested=false;ready();}
  emit();return {snapshot,selectFile,start,stop,resume,clear,dispose:clear};
}
