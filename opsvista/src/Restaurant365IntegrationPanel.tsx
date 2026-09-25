import { useEffect, useState } from 'react';

type R365Location = { id: string; number?: string; name: string; opsVistaLocation?: string; entityType?: 'restaurant'|'corporate-office' };
type R365Status = {
  configured: boolean;
  connected: boolean;
  credentialSource?: 'encrypted-store' | 'environment';
  domain?: string;
  usernameHint?: string;
  savedAt?: string;
  checkedAt?: string;
  latestTransactionAt?: string;
  locations: R365Location[];
  expectedLocations: string[];
  mappedLocationCount: number;
  mappedRestaurantCount: number;
  corporateMapped: boolean;
  probes: { locations: boolean; glAccounts: boolean; transactions: boolean };
  probeErrors?: Partial<Record<'locations'|'glAccounts'|'transactions',string>>;
  pnlReady: boolean;
  error?: string;
};

const noticeStyle = { margin:'14px 0', padding:'12px 14px', borderRadius:10 } as const;

export default function Restaurant365IntegrationPanel({canManage}:{canManage:boolean}) {
  const [status,setStatus]=useState<R365Status>();
  const [domain,setDomain]=useState('');
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);

  const load=async()=>{
    const response=await fetch('/api/integrations/restaurant365',{credentials:'include',cache:'no-store'});
    const body=await response.json().catch(()=>({})) as R365Status&{error?:string};
    if(!response.ok)throw new Error(body.error||'No se pudo consultar Restaurant365.');
    setStatus(body);
    if(body.domain)setDomain(body.domain);
    setError(body.error||'');
    return body;
  };

  useEffect(()=>{void load().catch(reason=>setError(reason instanceof Error?reason.message:'No se pudo consultar Restaurant365.'));},[]);

  const submit=async(action:'save'|'test'|'disconnect')=>{
    setSaving(true);setError('');setNotice('');
    try{
      const response=await fetch('/api/integrations/restaurant365',{
        method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(action==='save'?{action,domain,username,password}:{action}),
      });
      const body=await response.json().catch(()=>({})) as R365Status&{error?:string;disconnected?:boolean};
      if(!response.ok)throw new Error(body.error||'Restaurant365 no pudo completar la operación.');
      if(action==='disconnect'){
        setStatus(undefined);setDomain('');setUsername('');setPassword('');
        setNotice('La conexión guardada de Restaurant365 fue eliminada.');await load();return;
      }
      setStatus(body);setPassword('');setError(body.error||'');
      setNotice(body.error?'La cuenta fue autenticada; revisa el diagnóstico de recursos.':action==='save'?'Restaurant365 quedó conectado en modo de solo lectura.':'Conexión de Restaurant365 validada correctamente.');
    }catch(reason){setError(reason instanceof Error?reason.message:'Restaurant365 no pudo completar la operación.');}
    finally{setSaving(false);}
  };

  const mapped=new Map((status?.locations||[]).filter(location=>location.opsVistaLocation).map(location=>[location.opsVistaLocation,location]));
  const expectedCount=status?.expectedLocations.length||7;
  const corporateMapped=status?.corporateMapped||Boolean(mapped.get('Corporate Office'));
  const badge=status?.connected?'CONECTADO':status?.configured?'REQUIERE ATENCIÓN':'PENDIENTE';

  return <section className="panel" style={{marginBottom:18}}>
    <div className="panel-header">
      <div><h2>Restaurant365 · Contabilidad</h2><p>Transacciones, facturas AP, detalle de cuentas, vendors y locaciones para construir un P&amp;L verificable.</p></div>
      <span className="count-pill">{badge}</span>
    </div>

    {notice&&<div style={{...noticeStyle,border:'1px solid #86efac',background:'#f0fdf4',color:'#166534'}}>{notice}</div>}
    {error&&<div style={{...noticeStyle,border:'1px solid #fca5a5',background:'#fff1f2',color:'#991b1b'}}>{error}</div>}

    <div style={{padding:18,display:'grid',gap:16}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10}}>
        {[
          ['Acceso','Solo lectura',status?.connected],
          ['Entidades',`${status?.mappedLocationCount||0} de ${expectedCount} mapeadas`,status?.mappedLocationCount===expectedCount],
          ['Corporate Office',corporateMapped?'Mapeada':'Sin validar',corporateMapped],
          ['Plan de cuentas',status?.probes.glAccounts?'Detectado':'Sin validar',status?.probes.glAccounts],
          ['P&L',status?.pnlReady?'Listo para clasificación':'Pendiente de clasificación',status?.pnlReady],
        ].map(([label,value,ok])=><div key={String(label)} style={{padding:'13px 14px',border:`1px solid ${ok?'#bbf7d0':'#dbe5ef'}`,borderRadius:10,background:ok?'#f0fdf4':'#f8fafc'}}><span style={{display:'block',fontSize:10,fontWeight:850,letterSpacing:'.07em',color:'#64748b'}}>{label}</span><strong style={{display:'block',marginTop:5,color:ok?'#166534':'#334155'}}>{value}</strong></div>)}
      </div>

      {status?.connected&&<>
        <div>
          <strong>Mapeo de entidades contables</strong>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:8,marginTop:10}}>
            {status.expectedLocations.map(location=>{const source=mapped.get(location);const corporate=location==='Corporate Office';return <div key={location} style={{padding:'11px 12px',border:`1px solid ${source?'#bbf7d0':'#fed7aa'}`,borderRadius:9,background:source?'#f0fdf4':'#fff7ed'}}><strong style={{color:source?'#166534':'#9a3412'}}>{source?'✓':'!'} {location}</strong><small style={{display:'block',marginTop:3,color:'#64748b'}}>{source?`${source.name} · ${corporate?'Centro de costos':'Restaurante'}`:'Sin coincidencia en R365'}</small></div>})}
          </div>
        </div>
        <p style={{margin:0,color:'#64748b',fontSize:12}}>Usuario: <strong>{status.usernameHint}</strong> · Dominio: <strong>{status.domain}</strong>{status.latestTransactionAt?` · Última transacción detectada: ${new Date(status.latestTransactionAt).toLocaleString()}`:''}</p>
      </>}

      {!status?.connected&&canManage&&<div style={{padding:16,border:'1px solid #dbe5ef',borderRadius:12}}>
        <strong>Conecta una identidad dedicada de Restaurant365</strong>
        <p style={{margin:'6px 0 12px',color:'#64748b',lineHeight:1.45}}>En R365 crea un usuario exclusivo para OpsVista con acceso OData a los seis restaurantes y Puerto Vallarta Corporate. Usa el rol mínimo autorizado por R365 (Accounting Clerk) y no compartas esta cuenta con managers o usuarios que solo suben recibos.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(210px,1fr))',gap:8}}>
          <input aria-label="Dominio Restaurant365" value={domain} onChange={event=>setDomain(event.target.value)} placeholder="Dominio R365 (sin https://)" autoComplete="organization" style={{padding:10,border:'1px solid #cbd5e1',borderRadius:8}}/>
          <input aria-label="Usuario Restaurant365" value={username} onChange={event=>setUsername(event.target.value)} placeholder="Usuario del conector" autoComplete="username" style={{padding:10,border:'1px solid #cbd5e1',borderRadius:8}}/>
          <input aria-label="Contraseña Restaurant365" type="password" value={password} onChange={event=>setPassword(event.target.value)} placeholder={status?.configured?'Contraseña nueva':'Contraseña'} autoComplete="new-password" style={{padding:10,border:'1px solid #cbd5e1',borderRadius:8}}/>
          <button className="primary" onClick={()=>void submit('save')} disabled={saving||!domain||!username||password.length<8}>{saving?'Validando…':'Guardar y probar'}</button>
        </div>
      </div>}

      {!status?.connected&&!canManage&&<div style={{padding:16,border:'1px solid #dbe5ef',borderRadius:12,background:'#f8fafc'}}><strong>Conexión pendiente</strong><p style={{margin:'6px 0 0',color:'#64748b'}}>Solo Founder puede guardar o reemplazar las credenciales de Restaurant365.</p></div>}

      {status?.configured&&<div style={{padding:14,border:'1px solid #dbe5ef',borderRadius:10}}>
        <strong>Diagnóstico OData</strong>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:8,marginTop:10}}>
          {[
            ['Locaciones','locations',status.probes.locations],
            ['Plan de cuentas','glAccounts',status.probes.glAccounts],
            ['Transacciones','transactions',status.probes.transactions],
          ].map(([label,key,ok])=><div key={String(key)} style={{padding:'10px 12px',border:`1px solid ${ok?'#bbf7d0':'#fecaca'}`,borderRadius:8,background:ok?'#f0fdf4':'#fff1f2'}}><strong style={{color:ok?'#166534':'#991b1b'}}>{ok?'✓':'!'} {label}</strong>{!ok&&status.probeErrors?.[key as 'locations'|'glAccounts'|'transactions']&&<small style={{display:'block',marginTop:4,color:'#991b1b'}}>{status.probeErrors[key as 'locations'|'glAccounts'|'transactions']}</small>}</div>)}
        </div>
      </div>}

      <div style={{padding:14,border:'1px solid #fde68a',borderRadius:10,background:'#fffbeb',color:'#854d0e',fontSize:12,lineHeight:1.5}}>
        <strong>Control contable:</strong> Jonathan seguirá procesando facturas en Restaurant365. OpsVista leerá únicamente movimientos aprobados y su detalle de GL. El archivo del recibo y el estado exacto de pago se habilitarán solo si la cuenta de R365 expone esos campos en un reporte o API verificable.
      </div>

      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        {status?.connected&&canManage&&<button onClick={()=>void submit('test')} disabled={saving}>{saving?'Probando…':'Probar conexión'}</button>}
        {status?.configured&&status.credentialSource==='encrypted-store'&&canManage&&<button onClick={()=>void submit('disconnect')} disabled={saving} style={{color:'#991b1b'}}>Desconectar</button>}
        <a href="https://docs.restaurant365.com/docs/restaurant365-odata-connector" target="_blank" rel="noreferrer" style={{alignSelf:'center'}}>Guía oficial de R365 OData</a>
      </div>
    </div>
  </section>;
}
