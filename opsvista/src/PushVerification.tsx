import { useState, type FormEvent } from 'react';
import { useI18n } from './i18n';
import { supabase } from './supabaseClient';
import { applicationServerKey, needsHomeScreen, pushRegistration, supportsWebPush } from './webPush';

export async function securityRequest(action: string, values: Record<string, unknown> = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('session_expired');
  const response = await fetch('/api/auth/session', { method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, action, accessToken: data.session.access_token }),
    signal: AbortSignal.timeout(25000) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.code || 'unavailable');
  return result;
}
export default function PushVerification({ enroll = false, onComplete, onAlternative }: {
  enroll?: boolean; onComplete: () => Promise<void> | void; onAlternative?: () => void;
}) {
  const { t, language } = useI18n();
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const install = enroll && needsHomeScreen(), supported = supportsWebPush();
  const messages: Record<string, string> = {
    invalid_code: t('This code is incorrect, expired or already used. Check the latest notification. After 5 attempts, request a new code.', 'El código es incorrecto, venció o ya se usó. Revisa la notificación más reciente. Después de 5 intentos, solicita otro código.'),
    invalid_recovery_code: t('That recovery code is invalid or already used.', 'Ese código de recuperación es inválido o ya se usó.'),
    rate_limited: t('Please wait before trying again. Codes are limited to one per minute and ten per hour.', 'Espera antes de volver a intentar. Los envíos se limitan a uno por minuto y diez por hora.'),
    recovery_limited: t('Too many recovery attempts. Try again in one hour.', 'Demasiados intentos de recuperación. Vuelve a intentar en una hora.'),
    delivery_unconfirmed: t('We could not send the notification. Check your phone’s connection and notification permissions, or use another verification method.', 'No pudimos enviar la notificación. Revisa la conexión y los permisos del teléfono, o usa otro método de verificación.'),
    device_not_linked: t('No phone is linked yet. Complete the initial security setup.', 'Todavía no hay un teléfono vinculado. Completa la configuración inicial de seguridad.'),
    device_in_use: t('This device is already linked to another account. Use your personal phone.', 'Este dispositivo ya está vinculado a otra cuenta. Usa tu teléfono personal.'),
    denied: t('Allow notifications in this device’s settings, then try again.', 'Permite las notificaciones en los ajustes de este dispositivo y vuelve a intentar.'),
    mfa_required: t('Complete sign-in with your existing second factor or a recovery code before replacing your phone.', 'Completa el acceso con tu segundo factor actual o un código de recuperación antes de reemplazar el teléfono.'),
    session_expired: t('Your session expired. Sign in again.', 'Tu sesión venció. Inicia sesión de nuevo.'),
    password_required: t('Sign out and sign in with your password before linking your phone.', 'Cierra sesión y entra con tu contraseña antes de vincular el teléfono.'),
    unavailable: t('Verification is temporarily unavailable. Please try again.', 'La verificación no está disponible por el momento. Vuelve a intentar.'),
  };
  const button = { padding: '12px 16px', borderRadius: 10, border: 0, background: '#12395b', color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer', width: '100%' };
  const secondary = { ...button, background: '#fff', color: '#12395b', border: '1px solid #cbd5e1', marginTop: 10 };
  async function send() {
    if (busy) return;
    if (Date.now() < retryAt) { setError('rate_limited'); return; }
    setBusy(true); setError('');
    try {
      let values: Record<string, unknown> = {};
      if (enroll) {
        // Keep permission inside the original user gesture, before network awaits.
        if (await Notification.requestPermission() !== 'granted') throw new Error('denied');
        const config = await securityRequest('mfa_status');
        if (!config.canEnroll || !config.publicKey) throw new Error('mfa_required');
        const registration = await pushRegistration();
        const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) });
        values = { subscription: subscription.toJSON(), locale: language };
      }
      const result = await securityRequest(enroll ? 'push_enroll_start' : 'push_start', values);
      setChallengeId(result.challengeId); setCode(''); setRetryAt(Date.now() + result.retryAfter * 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'unavailable'); }
    finally { setBusy(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await securityRequest(recovery ? 'recovery_verify' : enroll ? 'push_enroll_verify' : 'push_verify', { challengeId, code });
      setCode('');
      if (result.recoveryCodes?.length) setRecoveryCodes(result.recoveryCodes);
      else await onComplete();
    } catch (reason) { const message = reason instanceof Error ? reason.message : 'unavailable'; setError(recovery && message === 'rate_limited' ? 'recovery_limited' : message); }
    finally { setBusy(false); }
  }
  if (recoveryCodes.length) return <div>
    <h2>{t('Your phone is linked', 'Tu teléfono está vinculado')}</h2>
    <p>{t('Keep these recovery codes in a safe place. Each works once if you lose your phone. They are shown only now.', 'Guarda estos códigos de recuperación en un lugar seguro. Cada uno sirve una sola vez si pierdes el teléfono. Solo se muestran ahora.')}</p>
    <pre style={{ whiteSpace: 'pre-wrap', padding: 16, background: '#f1f5f9', lineHeight: 1.8, fontSize: 14 }}>{recoveryCodes.join('\n')}</pre>
    <label style={{ display: 'block', margin: '16px 0' }}><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} /> {t('I saved my recovery codes.', 'Ya guardé mis códigos de recuperación.')}</label>
    <button type="button" disabled={!saved || busy} style={{ ...button, opacity: saved ? 1 : .5 }} onClick={async () => { setBusy(true); try { await onComplete(); } finally { setBusy(false); } }}>{t('Continue to OpsVista', 'Continuar a OpsVista')}</button>
  </div>;
  return <div aria-busy={busy}>
    <h2 style={{ marginTop: 0 }}>{recovery ? t('Use a recovery code', 'Usar código de recuperación') : enroll ? t('Link your personal phone', 'Vincula tu teléfono personal') : t('Check your phone', 'Revisa tu teléfono')}</h2>
    <p style={{ color: '#475569', lineHeight: 1.6 }}>{recovery ? t('Enter one unused code saved when you linked your phone.', 'Ingresa un código sin usar de los que guardaste al vincular tu teléfono.') : enroll ? t('Next time you sign in, we will send a 6-digit code to this device. Use your personal phone, not a shared restaurant device.', 'La próxima vez que entres, enviaremos un código de 6 dígitos a este dispositivo. Usa tu teléfono personal, no un equipo compartido del restaurante.') : t('Request your code, then enter the 6 digits from the OpsVista notification on your previously linked phone. The code expires in 5 minutes.', 'Solicita tu código e ingresa los 6 dígitos de la notificación de OpsVista en tu teléfono previamente vinculado. El código vence en 5 minutos.')}</p>
    {install ? <ol style={{ paddingLeft: 20, lineHeight: 1.6 }}><li>{t('In Safari, tap Share → Add to Home Screen.', 'En Safari, toca Compartir → Agregar a pantalla de inicio.')}</li><li>{t('Open the OpsVista icon and sign in.', 'Abre el icono de OpsVista e inicia sesión.')}</li><li>{t('Tap Link this phone, then Allow notifications.', 'Toca Vincular este teléfono y permite las notificaciones.')}</li></ol> : enroll && !supported ? <p>{t('Open OpsVista on your personal phone with a browser that supports notifications. You can also use Authenticator below.', 'Abre OpsVista en tu teléfono personal con un navegador que admita notificaciones. También puedes usar Authenticator abajo.')}</p> : null}
    {!recovery && <button type="button" onClick={() => void send()} disabled={busy || Boolean(enroll && (install || !supported))} style={button}>{busy ? t('Processing…', 'Procesando…') : challengeId ? t('Send a new code', 'Enviar otro código') : enroll ? t('Link this phone', 'Vincular este teléfono') : t('Send my code', 'Enviarme el código')}</button>}
    {(challengeId || recovery) && <form onSubmit={verify} style={{ marginTop: 18 }}>
      {!recovery && <p role="status">{t('Code sent to the push service. Check your notifications. You may request another after 60 seconds.', 'Código enviado al servicio push. Revisa tus notificaciones. Puedes solicitar otro después de 60 segundos.')}</p>}
      <label htmlFor="opsvista-security-code">{recovery ? t('Recovery code', 'Código de recuperación') : t('6-digit code', 'Código de 6 dígitos')}</label>
      <input id="opsvista-security-code" inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" autoFocus maxLength={recovery ? 32 : 6} value={code} onChange={event => setCode(recovery ? event.target.value : event.target.value.replace(/\D/g, ''))} required style={{ display: 'block', width: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 10, padding: 12, margin: '8px 0 14px', fontSize: recovery ? 17 : 26, letterSpacing: recovery ? 1 : 6 }} />
      <button type="submit" style={button} disabled={busy || (!recovery && code.length !== 6)}>{t('Verify and continue', 'Verificar y continuar')}</button>
    </form>}
    {error && <p role="alert" style={{ color: '#9f1239' }}>{messages[error] || messages.unavailable}</p>}
    {!enroll && <button type="button" style={secondary} disabled={busy} onClick={() => { setRecovery(!recovery); setCode(''); setError(''); }}>{recovery ? t('Use a push code', 'Usar código por push') : t('I lost my phone / recovery code', 'Perdí mi teléfono / código de recuperación')}</button>}
    {onAlternative && <button type="button" style={secondary} disabled={busy} onClick={onAlternative}>{t('Use Authenticator', 'Usar Authenticator')}</button>}
    <p style={{ color: '#64748b', fontSize: 12, lineHeight: 1.5 }}>{t('If you cannot use any registered method, contact your administrator to verify your identity. Your password alone cannot replace an existing security device.', 'Si no puedes usar ningún método registrado, contacta al administrador para verificar tu identidad. La contraseña sola no permite reemplazar un dispositivo de seguridad existente.')}</p>
  </div>;
}
