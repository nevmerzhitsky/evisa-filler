export function actionState(view){
  const running=view.state==='running',paused=view.state==='paused';
  const hasContent=Boolean(view.results.length||Object.values(view.files).some(file=>file?.name));
  return {start:!running&&!paused,clear:!running&&!paused&&hasContent,stop:running||paused,resume:paused&&view.canStop!==false};
}
