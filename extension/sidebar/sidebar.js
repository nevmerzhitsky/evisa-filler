import {createSidebarModel} from './model.js';
import {groupResults} from './result-groups.js';
import {actionState} from './action-state.js';
import {readCurrentForm,saveFormJSON} from './form-export.js';
import {watchPageMode} from './page-mode.js';
const element=id=>document.getElementById(id);
const labels={empty:'Нет данных',invalid:'Ошибка данных',ready:'Готово',running:'Заполнение',paused:'Пауза',completed:'Завершено',cancelled:'Остановлено',failed:'Ошибка'};
const statuses={filled:'Заполнено',unchanged:'Без изменений',skipped_empty:'Пустое значение пропущено',skipped_dependency:'Пропущено из-за зависимости',error:'Ошибка',changed_by_site:'Изменено сайтом'};
let reportRun,exportBusy=false;
const openGroups=new Map();
function render(view){
  element('export').disabled=view.inputsDisabled||exportBusy;
  for(const role of ['json','portrait','passport']){
    const file=view.files[role];element(role).disabled=view.inputsDisabled||exportBusy;
    if(!file?.name)element(role).value='';
    const filename=element(`${role}-name`);
    filename.textContent=file?.name||'Выбрать файл';filename.title=file?.name??'';
    filename.parentElement.title=file?.name||'Выбрать локальный файл';
    element(`${role}-status`).textContent=file?.pending?'Проверка…':file?.errors.length?file.errors.map(error=>`${error.path}: ${error.reason}`).join('; '):'';
  }
  element('start').disabled=!view.canStart||exportBusy;element('clear').disabled=exportBusy;element('stop').disabled=!view.canStop;element('resume').disabled=!view.canResume;
  for(const [action,visible] of Object.entries(actionState(view)))element(action).hidden=!visible;
  element('stop').textContent=view.canStop?'Остановить':'Остановка…';
  element('resume').textContent=view.canResume?'Продолжить':'Продолжение…';
  element('actions').dataset.state=view.state;
  element('state').textContent=view.notice||labels[view.state];
  element('target').textContent=view.target?`evisa.gov.vn · Вкладка ${view.target.tabId}`:'Вкладка ещё не выбрана';
  element('target').title=view.target?.url??'При запуске будет выбрана текущая вкладка формы';
  const container=element('results');
  if(reportRun!==view.runId){openGroups.clear();reportRun=view.runId;}
  else for(const group of container.children)openGroups.set(group.dataset.group,group.open);
  const counts={filled:0,error:0,skipped:0};
  const renderResult=result=>{
    const item=document.createElement('li');
    if(Object.hasOwn(statuses,result.status))item.className=`result-${result.status}`;
    const label=document.createElement('span');label.className='result-label';
    label.textContent=`${result.label??result.path??result.role??'Поле'}${result.row!==undefined?` · Строка ${result.row}`:''}`;
    const status=document.createElement('span');status.className='result-status';status.textContent=statuses[result.status]??result.status??'';
    item.append(label,status);
    if(result.reason){const reason=document.createElement('span');reason.className='result-reason';reason.textContent=result.reason;item.append(reason);}
    if(result.status==='filled'||result.status==='unchanged')counts.filled++;
    else if(result.status==='error'||result.status==='changed_by_site')counts.error++;
    else if(result.status?.startsWith('skipped_'))counts.skipped++;
    return item;
  };
  const groups=groupResults(view.results).map(group=>{
    const details=document.createElement('details');details.dataset.group=group.id;
    details.className=`result-group group-${group.tone}`;details.open=openGroups.get(group.id)===true;
    const summary=document.createElement('summary');summary.textContent=group.label;
    const count=document.createElement('span');count.className='count';count.textContent=String(group.results.length);summary.append(count);
    const list=document.createElement('ol');list.append(...group.results.map(renderResult));
    details.append(summary,list);return details;
  });
  container.replaceChildren(...groups);
  element('result-count').textContent=String(view.results.length);
  const summary=element('result-summary');
  if(view.results.length){
    const parts=[['summary-confirmed',`Подтверждено: ${counts.filled}`],['summary-errors',`Ошибки: ${counts.error}`],['summary-skipped',`Пропущено: ${counts.skipped}`]];
    const nodes=[];
    for(const [className,text] of parts){
      if(nodes.length){const separator=document.createElement('span');separator.textContent=' · ';nodes.push(separator);}
      const part=document.createElement('span');part.className=className;part.textContent=text;nodes.push(part);
    }
    summary.replaceChildren(...nodes);
  }else summary.textContent='Результатов пока нет';
  element('state').parentElement.dataset.state=view.state==='completed'&&counts.error>0?'completed-warning':view.state;
  if(view.state==='completed'&&counts.error>0){
    element('state').textContent=view.notice.replace('Заполнение завершено.',`Заполнение завершено с ошибками. Ошибок: ${counts.error}.`);
  }
}
const model=createSidebarModel({browser:globalThis.browser,render});
const fillHelp=element('help-text').textContent;
const stopWatching=watchPageMode(globalThis.browser,mode=>{
  const saved=mode==='saved';
  element('fill-panel').hidden=saved;
  element('panel-title').textContent=saved?'Сохранение e-Visa':'Заполнение e-Visa';
  element('help-text').textContent=saved?'Нажмите «Сохранить форму в JSON», чтобы сохранить текущие значения сохранённой заявки в локальный файл.':fillHelp;
});
for(const role of ['json','portrait','passport'])element(role).addEventListener('change',()=>model.selectFile(role,element(role).files[0]??null));
for(const action of ['start','stop','resume','clear'])element(action).addEventListener('click',()=>model[action]());
element('export').addEventListener('click',async()=>{
  if(exportBusy||model.snapshot().inputsDisabled)return;
  exportBusy=true;render(model.snapshot());
  const status=element('export-status');status.textContent='Чтение текущей формы…';
  element('export-warnings').hidden=true;element('export-warning-list').replaceChildren();
  try {
    const snapshot=await readCurrentForm(globalThis.browser);
    if(snapshot.warnings.length){
      element('export-warning-list').replaceChildren(...snapshot.warnings.map(warning=>{
        const item=document.createElement('li');
        const label=document.createElement('span');label.className='result-label';label.textContent=warning.path;
        const reason=document.createElement('span');reason.className='result-reason';reason.textContent=warning.reason;
        item.append(label,reason);return item;
      }));
      element('export-warning-count').textContent=String(snapshot.warnings.length);
      element('export-warnings').hidden=false;
    }
    status.textContent='Выберите место сохранения JSON…';
    const saved=await saveFormJSON(globalThis.browser,snapshot.data);
    status.textContent=saved?snapshot.warnings.length?`JSON сохранён. Предупреждений: ${snapshot.warnings.length}.`:'JSON сохранён.':'Сохранение отменено.';
  }catch(error){
    const messages={unsupported_page:'Откройте английскую форму e-Visa для сохранения JSON.',run_active:'Дождитесь завершения заполнения.',save_failed:'Не удалось сохранить JSON.',export_timeout:'Не удалось прочитать форму за отведённое время.',document_lost:'Страница закрыта или изменилась. Повторите сохранение.'};
    status.textContent=messages[error?.message]??'Не удалось прочитать текущую форму.';
  }finally {exportBusy=false;render(model.snapshot());}
});
element('close').addEventListener('click',()=>{
  const failed=()=>{element(element('fill-panel').hidden?'export-status':'state').textContent='Не удалось закрыть панель. Используйте кнопку закрытия Firefox.';};
  try{const closing=globalThis.browser.sidebarAction.close();Promise.resolve(closing).catch(failed);}catch{failed();}
});
window.addEventListener('pagehide',()=>{stopWatching();model.dispose();},{once:true});
