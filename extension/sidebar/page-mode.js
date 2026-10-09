import {personalFormMode} from '../shared/route.js';

// Each query supersedes earlier ones so a slow response cannot restore the
// controls for a tab the user has already left.
export function watchPageMode(browser,onChange) {
  let revision=0,disposed=false;
  async function refresh(){
    const current=++revision;
    try {
      const [tab]=await browser.tabs.query({active:true,currentWindow:true});
      if(!disposed&&current===revision)onChange(personalFormMode(tab?.url));
    }catch{if(!disposed&&current===revision)onChange(null);}
  }
  const updated=(_tabId,change,tab)=>{
    if(tab.active&&(change.url!==undefined||change.status!==undefined))refresh();
  };
  browser.tabs.onActivated.addListener(refresh);
  browser.tabs.onUpdated.addListener(updated);
  refresh();
  return ()=>{
    disposed=true;revision++;
    browser.tabs.onActivated.removeListener(refresh);
    browser.tabs.onUpdated.removeListener(updated);
  };
}
