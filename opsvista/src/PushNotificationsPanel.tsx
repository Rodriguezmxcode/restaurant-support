import ConnectionHealthPanel from './ConnectionHealthPanel';
import NotificationPreferencesPanel from './NotificationPreferencesPanel';
import { useEffect, useState } from 'react';
import { useI18n } from './i18n';
import { applicationServerKey, needsHomeScreen, pushRegistration, pushRequest, supportsWebPush } from './webPush';
import './pushNotifications.css';
import OperationalAlertInbox from './OperationalAlertInbox';
import SecurityDevicePanel from './SecurityDevicePanel';

export default function PushNotificationsPanel() {
  const { t, language } = useI18n();
  const [loading, setLoading] = useState(true);
  const [accountPushEnabled, setAccountPushEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(() => 'Notification' in window ? Notification.permission : 'default');
  const install = needsHomeScreen(), supported = supportsWebPush();
  useEffect(() => {
    if (!supported || install) { setLoading(false); return; }
    let cancelled = false;
    Promise.all([pushRequest(), pushRegistration()]).then(async ([config, registration]) => {
      const subscription = await registration.pushManager.getSubscription();
      const status = subscription ? await pushRequest({ action: 'status', endpoint: subscription.endpoint }) : { registered: false };
      if (!cancelled) { setPublicKey(config.publicKey); setEnabled(Boolean(status.registered && Notification.permission === 'granted')); }
    }).catch(error => { if (!cancelled) { setFailed(true); setMessage(error instanceof Error ? error.message : 'unavailable'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [supported, install]);

  async function enable() {
    setBusy(true); setFailed(false); setMessage('');
    try {
      // Called before any network await: iOS requires a direct user gesture.
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== 'granted') { setMessage(granted === 'denied' ? 'denied' : 'dismissed'); return; }
      const registration = await pushRegistration();
      let subscription = await registration.pushManager.getSubscription();
      const key = applicationServerKey(publicKey);
      if (subscription?.options.applicationServerKey && Array.from(new Uint8Array(subscription.options.applicationServerKey)).join() !== Array.from(key).join()) {
        await subscription.unsubscribe(); subscription = null;
      }
      subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await pushRequest({ action: 'subscribe', subscription: subscription.toJSON(), locale: language });
      setEnabled(true); setMessage('enabled');
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : 'unavailable'); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true); setFailed(false); setMessage('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const result = await pushRequest({ action: 'unsubscribe', endpoint: subscription.endpoint });
        if (!result.retainSubscription) await subscription.unsubscribe();
      }
      setEnabled(false); setMessage('disabled');
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : 'unavailable'); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setFailed(false); setMessage('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) { setEnabled(false); setMessage('not_registered'); return; }
      const result = await pushRequest({ action: 'test', endpoint: subscription.endpoint });
      setMessage(result.accepted ? 'accepted' : result.reason); setFailed(!result.accepted);
      if (result.reason === 'not_registered') setEnabled(false);
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : 'unavailable'); }
    finally { setBusy(false); }
  }
  const messages: Record<string, string> = {
    enabled: t('Enabled on this device. Send a test to check delivery.', 'Activadas en este dispositivo. Envía una prueba para comprobar la entrega.'),
    disabled: t('Notifications turned off on this device.', 'Notificaciones desactivadas en este dispositivo.'),
    accepted: t('The push service accepted your test. Check your notifications to confirm it arrived.', 'El servicio push aceptó tu prueba. Revisa tus notificaciones para confirmar que llegó.'),
    rate_limited: t('Wait 30 seconds before sending another test.', 'Espera 30 segundos antes de enviar otra prueba.'),
    denied: t('Notifications are blocked. Allow them in this device’s browser or notification settings, then try again.', 'Las notificaciones están bloqueadas. Permítelas en los ajustes del navegador o de notificaciones de este dispositivo y vuelve a intentar.'),
    dismissed: t('Permission was not granted. You can try again when you are ready.', 'No se concedió el permiso. Puedes volver a intentarlo cuando quieras.'),
    unavailable: t('Could not connect notifications. Reload OpsVista and try again.', 'No se pudieron conectar las notificaciones. Recarga OpsVista y vuelve a intentar.'),
    session_expired: t('Your session expired. Sign in again to connect notifications.', 'Tu sesión venció. Inicia sesión de nuevo para conectar las notificaciones.'),
    account_access: t('Your account access could not be verified. Sign in again; if this continues, contact OpsVista support.', 'No se pudo verificar el acceso de tu cuenta. Inicia sesión de nuevo; si continúa, contacta a soporte de OpsVista.'),
    not_registered: t('Activate notifications on this device first.', 'Primero activa las notificaciones en este dispositivo.'),
    push_disabled: t('Turn on Push notifications in your account preferences to receive the test.', 'Activa Notificaciones push en las preferencias de tu cuenta para recibir la prueba.'),
    delivery_unconfirmed: t('Delivery could not be confirmed. Try turning notifications off and on again.', 'No se pudo confirmar el envío. Intenta desactivar y volver a activar las notificaciones.'),
  };
  return <section id="opsvista-push-panel" className="push-panel" aria-labelledby="push-title" aria-busy={busy || loading}>
    <NotificationPreferencesPanel onPushEnabled={setAccountPushEnabled} />
    <div className="push-heading"><div><h2 id="push-title">{t('This device', 'Este dispositivo')}</h2>
      <p>{t('Receive updates for your account, even when OpsVista is closed.', 'Recibe las actualizaciones de tu cuenta aunque OpsVista esté cerrada.')}</p></div>
      <span className="push-status">{loading ? t('Checking…', 'Consultando…') : enabled ? t('On · this device', 'Activadas · este dispositivo') : t('Off · this device', 'Desactivadas · este dispositivo')}</span></div>
    {install ? <div className="push-help"><strong>{t('First, add OpsVista to your Home Screen', 'Primero, añade OpsVista a tu pantalla de inicio')}</strong><ol>
      <li>{t('Open this page in Safari and tap Share.', 'Abre esta página en Safari y toca Compartir.')}</li>
      <li>{t('Choose Add to Home Screen, keep Open as Web App enabled if shown, and tap Add.', 'Elige Agregar a pantalla de inicio, conserva Abrir como app web si aparece y toca Agregar.')}</li>
      <li>{t('Open the OpsVista icon, sign in, and return to Notifications → Enable notifications → Allow.', 'Abre el icono de OpsVista, inicia sesión y vuelve a Notificaciones → Activar notificaciones → Permitir.')}</li>
    </ol><p>{t('Requires iOS or iPadOS 16.4 or later.', 'Requiere iOS o iPadOS 16.4 o posterior.')}</p></div>
      : !supported ? <p>{t('This browser does not support push notifications. Open OpsVista in a compatible browser over HTTPS.', 'Este navegador no admite notificaciones push. Abre OpsVista en un navegador compatible mediante HTTPS.')}</p>
      : <div className="push-controls"><button type="button" disabled={loading || busy || !publicKey} onClick={() => void (enabled ? disable() : enable())}>{busy ? t('Processing…', 'Procesando…') : enabled ? t('Turn off on this device', 'Desactivar en este dispositivo') : t('Enable notifications', 'Activar notificaciones')}</button>
        <button type="button" className="push-secondary" disabled={busy || !enabled || !accountPushEnabled} onClick={() => void test()}>{t('Send me a test', 'Enviarme una prueba')}</button></div>}
    {permission === 'denied' && <p className="push-feedback" role="status">{messages.denied}</p>}
    {message && <p className={`push-feedback ${failed ? 'push-error' : ''}`} role={failed ? 'alert' : 'status'}>{messages[message] || messages.unavailable}</p>}
    <p className="push-privacy">{t('Notifications show the location, alert and priority. Sign-out disconnects operational updates. A linked security device remains available for sign-in codes.', 'Las notificaciones muestran la locación, la alerta y su prioridad. Cerrar sesión desconecta las alertas operativas. Un dispositivo de seguridad vinculado sigue disponible para los códigos de acceso.')}</p>
    <SecurityDevicePanel />
    <details className="push-inbox"><summary>{t('Connection status','Estado de conexiones')}</summary><ConnectionHealthPanel/></details>
      <OperationalAlertInbox />
  </section>;
}
