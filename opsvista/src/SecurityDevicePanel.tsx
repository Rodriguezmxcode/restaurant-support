import { useEffect, useState } from 'react';
import { useI18n } from './i18n';
import PushVerification, { securityRequest } from './PushVerification';
export default function SecurityDevicePanel() {
  const { t } = useI18n();
  const [config, setConfig] = useState<{ founder?: boolean; linked?: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; securityRequest('mfa_status').then(value => { if (active) setConfig(value); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, []);
  if (config?.founder) return <p>{t('Founder access is protected by Authenticator.', 'El acceso Founder está protegido con Authenticator.')}</p>;
  if (!config) return failed ? <p>{t('Sign in again to manage your security device.', 'Inicia sesión de nuevo para administrar tu dispositivo de seguridad.')}</p> : null;
  return <section style={{ padding: 20, margin: '20px 0', border: '1px solid #cbd5e1', borderRadius: 14, background: '#fff' }}>
    {editing ? <><PushVerification enroll onComplete={() => { setEditing(false); setConfig({ linked: true }); }} /><button type="button" onClick={() => setEditing(false)}>{t('Close setup', 'Cerrar configuración')}</button></> : <>
      <h3>{t('Sign-in verification', 'Verificación de acceso')}</h3>
      <p>{config.linked ? t('Your account has a phone linked for sign-in codes. Security notifications remain active after sign-out.', 'Tu cuenta tiene un teléfono vinculado para los códigos de acceso. Las notificaciones de seguridad permanecen activas al cerrar sesión.') : t('Link your personal phone to receive sign-in codes by push notification.', 'Vincula tu teléfono personal para recibir códigos de acceso por notificación push.')}</p>
      <button type="button" onClick={() => setEditing(true)}>{config.linked ? t('Replace linked phone', 'Reemplazar teléfono vinculado') : t('Link my phone', 'Vincular mi teléfono')}</button>
    </>}
  </section>;
}
