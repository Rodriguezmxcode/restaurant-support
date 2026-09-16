import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PriceWatchPanel from './PriceWatchPanel';

let root:Root|undefined,host:HTMLElement|undefined,active=false,scheduled=false;
function page(){return document.querySelector<HTMLElement>('.r365-page');}
function tabs(){return page()?.querySelector<HTMLElement>('.r365-tabs');}
function restore(){const p=page();if(!p)return;for(const child of [...p.children] as HTMLElement[]){if(child===host)continue;if(child.dataset.priceWatchHidden==='1'){child.style.removeProperty('display');delete child.dataset.priceWatchHidden;}}if(host)host.style.display='none';active=false;}
function show(){sync();const p=page(),tab=tabs();if(!p||!tab||!host)return;active=true;for(const button of [...tab.querySelectorAll<HTMLButtonElement>('button')]){const selected=button.dataset.priceWatchTab==='1';button.setAttribute('aria-selected',selected?'true':'false');button.classList.toggle('active',selected);}for(const child of [...p.children] as HTMLElement[]){if(child===tab||child===host||child.getAttribute('aria-label')==='Guardado y sincronización')continue;child.dataset.priceWatchHidden='1';child.style.display='none';}host.style.removeProperty('display');host.hidden=false;host.scrollIntoView({block:'start',behavior:'smooth'});}
function sync(){scheduled=false;const p=page(),tab=tabs();if(!p||!tab){if(root){root.unmount();root=undefined;}host?.remove();host=undefined;active=false;return;}let button=tab.querySelector<HTMLButtonElement>('button[data-price-watch-tab="1"]');if(!button){button=document.createElement('button');button.type='button';button.setAttribute('role','tab');button.dataset.priceWatchTab='1';button.textContent='Price Watch';tab.appendChild(button);}if(!host||!p.contains(host)){host=document.createElement('div');host.id='opsvista-price-watch-host';host.hidden=true;host.style.display='none';tab.insertAdjacentElement('afterend',host);root=createRoot(host);root.render(<React.StrictMode><PriceWatchPanel/></React.StrictMode>);}if(active)show();}
function request(){if(scheduled)return;scheduled=true;queueMicrotask(sync);}
function handleClick(event:MouseEvent){const target=event.target instanceof Element?event.target.closest<HTMLButtonElement>('button'):null;if(!target)return;const tab=tabs();if(!tab||!tab.contains(target))return;if(target.dataset.priceWatchTab==='1'||target.textContent?.trim()==='Price Watch'){event.preventDefault();event.stopImmediatePropagation();show();return;}if(active)restore();}
document.addEventListener('click',handleClick,true);
const observer=new MutationObserver(request);
function start(){observer.observe(document.body,{childList:true,subtree:true});request();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
