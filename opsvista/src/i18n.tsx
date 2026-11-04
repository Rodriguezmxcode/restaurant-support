import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type OpsVistaLanguage='en'|'es';
type I18nContextValue={language:OpsVistaLanguage;setLanguage:(value:OpsVistaLanguage)=>void;t:(en:string,es:string)=>string;locale:string};

const I18nContext=createContext<I18nContextValue|null>(null);

function initialLanguage():OpsVistaLanguage{
  try{
    const saved=window.localStorage.getItem('opsvista-language');
    if(saved==='en'||saved==='es')return saved;
  }catch{/* ignore storage restrictions */}
  return 'en';
}

export function I18nProvider({children}:{children:ReactNode}){
  const [language,setLanguageState]=useState<OpsVistaLanguage>(initialLanguage);
  const setLanguage=(value:OpsVistaLanguage)=>{
    setLanguageState(value);
    try{window.localStorage.setItem('opsvista-language',value);}catch{/* ignore */}
    document.documentElement.lang=value;
  };
  const value=useMemo<I18nContextValue>(()=>({
    language,setLanguage,t:(en,es)=>language==='es'?es:en,locale:language==='es'?'es-MX':'en-US'
  }),[language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(){
  const value=useContext(I18nContext);
  if(!value)throw new Error('I18nProvider is missing');
  return value;
}
