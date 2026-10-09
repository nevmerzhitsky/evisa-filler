const definitions=[
  ['session','Ошибка сеанса','error'],
  ['images','Ошибки фотографий и OCR','error'],
  ['timeout','Превышено время ожидания','error'],
  ['unavailable','Поля недоступны','error'],
  ['verification','Заполнение не подтверждено','error'],
  ['changed','Изменено сайтом','error'],
  ['dependency','Пропущено из-за зависимостей','neutral'],
  ['filled','Заполнено','success'],
  ['unchanged','Без изменений','success'],
  ['empty','Пустые значения пропущены','neutral'],
  ['other','Другие результаты','neutral']
];
function category(result){
  const reason=typeof result.reason==='string'?result.reason:'';
  if(result.status==='error'){
    if(result.path==='session')return 'session';
    if(['images','portrait','passport'].includes(result.path)||/\b(?:OCR|image_state_unknown|upload_unconfirmed)\b/.test(reason))return 'images';
    if(/\b(?:timeout|date_timeout|radio_timeout|select_result_timeout|probe_timeout)\b/.test(reason))return 'timeout';
    if(/\b(?:unavailable|text_input_unavailable|option_missing|option_not_rendered)\b/.test(reason))return 'unavailable';
    return 'verification';
  }
  const statuses={changed_by_site:'changed',skipped_dependency:'dependency',filled:'filled',unchanged:'unchanged',skipped_empty:'empty'};
  return Object.hasOwn(statuses,result.status)?statuses[result.status]:'other';
}
export function groupResults(results){
  const groups=new Map(definitions.map(([id,label,tone])=>[id,{id,label,tone,results:[]}]));
  for(const result of results)groups.get(category(result)).results.push(result);
  return [...groups.values()].filter(group=>group.results.length);
}
