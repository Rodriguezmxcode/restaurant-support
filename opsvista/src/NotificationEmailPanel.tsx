import { useEffect, useState } from 'react';
import './notificationEmail.css';

type EmailStatus = { recipientEmail: string; emailEnabled: boolean; senderConfigured: boolean };
type TestResult = EmailStatus & { accepted: boolean; reason: string; providerId?: string };

export default function NotificationEmailPanel() {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<TestResult | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/workflows?resource=notification_email_status', { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || typeof body.recipientEmail !== 'string') throw new Error('No se pudo consultar la configuración de correo.');
        setStatus(body);
      }).catch(() => { if (!controller.signal.aborted) setError('No se pudo consultar la configuración de correo.'); });
    return () => controller.abort();
  }, []);

  const toggleEmail = async () => {
    if (!status) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/workflows?resource=notification_preferences', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailEnabled: !status.emailEnabled }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.emailEnabled !== 'boolean') throw new Error();
      setStatus({ ...status, emailEnabled: body.emailEnabled });
    } catch { setError('No se pudo guardar tu preferencia. Inténtalo de nuevo.'); }
    finally { setBusy(false); }
  };

  const sendTest = async () => {
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await fetch('/api/workflows?resource=notification_test', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'email' }),
      });
      const body = await response.json();
      if (!response.ok || typeof body.accepted !== 'boolean') throw new Error();
      setResult(body); setStatus(body);
    } catch { setError('No se pudo confirmar el envío. Puedes reintentar la prueba.'); }
    finally { setBusy(false); }
  };

  return <section className="notification-email-panel" aria-labelledby="notification-email-title">
    <div className="notification-email-heading">
      <div><h3 id="notification-email-title">Notificaciones por correo</h3>
        <p>{status ? <>Tu correo: <strong>{status.recipientEmail}</strong></> : 'Consultando tu cuenta…'}</p>
      </div>
      <div className="notification-email-controls">
        <label><input type="checkbox" checked={status?.emailEnabled ?? false} disabled={!status || busy} onChange={() => void toggleEmail()} /> Recibir correos</label>
        <button type="button" disabled={busy || !status?.senderConfigured || !status.emailEnabled} onClick={() => void sendTest()}>{busy ? 'Procesando…' : 'Enviarme correo de prueba'}</button>
      </div>
    </div>
    {status && !status.senderConfigured && <p className="notification-email-warning">El remitente está pendiente de configuración. Todavía no se pueden enviar correos.</p>}
    {result && <p role="status" className={result.accepted ? 'notification-email-success' : 'notification-email-warning'}>
      {result.accepted
        ? `El servicio de correo aceptó la prueba para ${result.recipientEmail}. Revisa tu bandeja y spam para confirmar la entrega.`
        : result.reason === 'email_disabled' ? 'Activa “Recibir correos” para enviar la prueba.'
        : result.reason === 'sender_unconfigured' ? 'El remitente aún no está configurado. No se envió la prueba.'
        : 'No se pudo confirmar el envío. Hay que revisar la conexión del remitente.'}
    </p>}
    {error && <p role="alert" className="notification-email-warning">{error}</p>}
  </section>;
}
