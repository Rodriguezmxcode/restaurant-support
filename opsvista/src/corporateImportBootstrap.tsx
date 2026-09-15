import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import CorporateImportPanel from './CorporateImportPanel';

let root:Root|undefined;
let host:HTMLElement|undefined;
let scheduled=false;
function selectedCorporate(){return [...document.querySelectorAll<HTMLButtonElement>('.r365-tabs button[aria-selected="true"]')].some(button=>button.textContent?.trim()==='Corporate Office');}
function sync(){
  scheduled=false;
  const page=document.querySelector<HTMLElement>('.r365-page');
  if(!page||!selectedCorporate()){
    if(root){root.unmount();root=undefined;}host?.remove();host=undefined;return;
  }
  if(host&&document.body.contains(host))return;
  host=document.createElement('div');host.id='opsvista-corporate-import-host';
  const controls=page.querySelector('.r365-controls');
  if(controls?.parentElement===page)controls.insertAdjacentElement('afterend',host);else page.appendChild(host);
  root=createRoot(host);root.render(<React.StrictMode><CorporateImportPanel/></React.StrictMode>);
}
function requestSync(){if(scheduled)return;scheduled=true;queueMicrotask(sync);}
const observer=new MutationObserver(requestSync);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-selected']});requestSync();},{once:true});
else{observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-selected']});requestSync();}
