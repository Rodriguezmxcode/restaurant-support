import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const temp=await mkdtemp(join(process.cwd(),'node_modules/.auth-ui-test-'));
try {
  globalThis.window={location:{search:''},localStorage:{getItem:()=> 'es'},matchMedia:()=>({matches:false}),isSecureContext:true};
  await writeFile(join(temp,'package.json'),'{"type":"module"}');
  const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText.replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${path}.js'`);
  for(const name of ['i18n','webPush','PushVerification']) await writeFile(join(temp,name+'.js'),compile(await readFile(new URL('../src/'+name+(name==='webPush'?'.ts':'.tsx'),import.meta.url),'utf8')));
  await writeFile(join(temp,'supabaseClient.js'),'export const supabase={};');
  await writeFile(join(temp,'accessControl.js'),'export function bindAuthenticatedUser(){}');
  const source=await readFile(new URL('../src/AuthGate.tsx',import.meta.url),'utf8');
  const {I18nProvider}=await import(join(temp,'i18n.js'));
  for(const stage of ['password','forgot','enroll','verify','push','push_enroll']) {
    const fixture=source.replace("useState<AuthStage>('password')",`useState<AuthStage>('${stage}')`)
      .replace("inviteToken ? 'signed-out' : 'loading'", "'signed-out'")
      .replace("const [qrCode, setQrCode] = useState('');","const [qrCode, setQrCode] = useState('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E');")
      .replace("const [manualSecret, setManualSecret] = useState('');","const [manualSecret, setManualSecret] = useState('TESTONLYSETUPKEY');");
    await writeFile(join(temp,stage+'.js'),compile(fixture));
    const {default:AuthGate}=await import(join(temp,stage+'.js'));
    const html=renderToStaticMarkup(React.createElement(I18nProvider,null,React.createElement(AuthGate,null,'Protected business data')));
    assert.ok(!html.includes('Protected business data'));
    if(stage==='password'){assert.ok(html.includes('¿Olvidaste tu contraseña?'));assert.ok(html.includes('Iniciar sesión'));}
    if(stage==='forgot'){assert.ok(html.includes('Enviar enlace de recuperación'));assert.ok(html.includes('Volver al inicio de sesión'));}
    if(stage==='enroll'){assert.ok(html.includes('data:image/svg+xml'));assert.ok(html.includes('TESTONLYSETUPKEY'));assert.ok(html.includes('mismo teléfono'));}
    if(stage==='verify'){assert.ok(!html.includes('TESTONLYSETUPKEY'));assert.ok(!html.includes('data:image/svg+xml'));assert.ok(html.includes('vinculaste anteriormente'));}
    if(stage==='push'){assert.ok(html.includes('Enviarme el código'));assert.ok(html.includes('Perdí mi teléfono'));assert.ok(!html.includes('Usar Authenticator'));}
    if(stage==='push_enroll'){assert.ok(html.includes('Vincula tu teléfono personal'));assert.ok(html.includes('Usar Authenticator'));}
  }
  console.log('PASS Spanish sign-in, forgot password, initial QR/manual key, verified-factor guidance, push and recovery entry points; all protect business content');
} finally { await rm(temp,{recursive:true,force:true}); }
