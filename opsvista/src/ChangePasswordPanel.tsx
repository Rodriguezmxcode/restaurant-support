import { useState } from 'react';

export default function ChangePasswordPanel() {
  const [currentPassword,setCurrentPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [message,setMessage]=useState('');
  const [saving,setSaving]=useState(false);

  const submit=async()=>{
    setMessage('');
    if(newPassword.length<12){setMessage('La nueva contraseña debe tener al menos 12 caracteres.');return;}
    if(newPassword!==confirmPassword){setMessage('La confirmación no coincide con la nueva contraseña.');return;}
    setSaving(true);
    try{
      const response=await fetch('/api/auth/change-password',{
        method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({currentPassword,newPassword})
      });
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok) throw new Error(body.error||'No se pudo cambiar la contraseña.');
      setCurrentPassword('');setNewPassword('');setConfirmPassword('');
      setMessage('Contraseña actualizada correctamente. Usa la nueva contraseña en tu próximo inicio de sesión.');
    }catch(error){setMessage(error instanceof Error?error.message:'No se pudo cambiar la contraseña.');}
    finally{setSaving(false);}
  };

  return <section className="panel">
    <div className="panel-header"><div><h2>Seguridad de la cuenta</h2><p>Cambia tu contraseña de acceso a OpsVista. La actualización queda registrada en el Audit Log.</p></div><span className="count-pill">PASSWORD</span></div>
    <div style={{padding:18,display:'grid',gap:12,maxWidth:620}}>
      <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>CONTRASEÑA ACTUAL</label><input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>
      <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>NUEVA CONTRASEÑA</label><input type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>
      <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>CONFIRMAR NUEVA CONTRASEÑA</label><input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>
      <div style={{display:'flex',alignItems:'center',gap:12}}><button className="primary" disabled={saving||!currentPassword||!newPassword||!confirmPassword} onClick={submit}>{saving?'Actualizando…':'Cambiar contraseña'}</button><span style={{fontSize:12,color:'#64748b'}}>Mínimo 12 caracteres.</span></div>
      {message&&<div className="detail-block"><label>SEGURIDAD</label><p>{message}</p></div>}
    </div>
  </section>;
}
