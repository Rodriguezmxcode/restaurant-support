import { useEffect, useMemo, useState } from 'react';
import './localIntelligence.css';

type Provider = { id: 'weather' | 'traffic' | 'events'; name: string; state: 'live' | 'fallback' | 'error' | 'not_configured'; detail: string };
type LocalRow = {
  location: string;
  weather: null | { provider: string; temperature: number; feelsLike: number; precipitation: number; windMph: number; phrase: string; updatedAt: string };
  traffic: null | { provider: string; currentSpeed: number; freeFlowSpeed: number; congestionPct: number; roadClosure: boolean; incidentCount: number; topIncident?: string | null; updatedAt: string };
  events: null | { provider: string; eventCount: number; horizonDays: number; events: Array<{ id: string; name: string; url?: string | null; date?: string | null; venue: string; city: string; category: string }> };
  errors: { weather?: string; traffic?: string; events?: string };
  assessment: { level: 'high' | 'watch' | 'normal'; summary: string; recommendations: string[] };
};
type Payload = { fetchedAt: string; horizonDays: number; providers: Provider[]; locations: LocalRow[] };

const stateLabel: Record<Provider['state'], string> = { live: 'En vivo', fallback: 'Fallback en vivo', error: 'Error', not_configured: 'No configurada' };
const formatUpdated = (value?: string) => value ? new Intl.DateTimeFormat('es-MX', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : 'Sin actualización';
const formatEventDate = (value?: string | null) => {
  if (!value) return 'Fecha pendiente';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/New_York', month: 'short', day: 'numeric' }).format(date);
};

export default function LocalIntelligenceView({ allowedLocations }: { allowedLocations: string[] }) {
  const [location, setLocation] = useState(() => {
    const saved = window.localStorage.getItem('opsvista-local-intelligence-location') || 'All locations';
    return saved === 'All locations' || allowedLocations.includes(saved) ? saved : 'All locations';
  });
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/local-intelligence?location=${encodeURIComponent(location)}`, { credentials: 'include', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Local Intelligence ${response.status}`);
      setPayload(body as Payload);
    } catch (loadError) {
      setPayload(null); setError(loadError instanceof Error ? loadError.message : 'No fue posible actualizar Local Intelligence.');
    } finally { setLoading(false); }
  };

  useEffect(() => { window.localStorage.setItem('opsvista-local-intelligence-location', location); void load(); }, [location]);
  const highRisk = useMemo(() => payload?.locations.filter(row => row.assessment.level === 'high').length ?? 0, [payload]);
  const events = useMemo(() => payload?.locations.reduce((sum, row) => sum + (row.events?.eventCount ?? 0), 0) ?? 0, [payload]);

  return <div className="local-intelligence-page">
    <section className="local-control-bar">
      <label><span>LOCATION</span><select value={location} onChange={event => setLocation(event.target.value)}><option>All locations</option>{allowedLocations.map(item => <option key={item}>{item}</option>)}</select></label>
      <div><span>LIVE HORIZON</span><strong>Ahora + próximos 14 días</strong><small>Clima, tráfico, incidentes y eventos cercanos aplicados a decisiones operativas.</small></div>
      <button onClick={() => void load()} disabled={loading}>↻ {loading ? 'Actualizando…' : 'Actualizar señales'}</button>
    </section>

    {error && <section className="local-error"><strong>Local Intelligence no pudo actualizarse</strong><span>{error}</span></section>}
    <section className="provider-grid">
      {(payload?.providers ?? []).map(provider => <article key={provider.id} className={`provider-card ${provider.state}`}><span>{provider.name}</span><strong>{stateLabel[provider.state]}</strong><small>{provider.detail}</small></article>)}
      {!payload && loading && ['Weather', 'TomTom Traffic', 'Ticketmaster'].map(name => <article className="provider-card loading" key={name}><span>{name}</span><strong>Conectando…</strong><small>Consultando la fuente real</small></article>)}
      <article className="provider-card summary"><span>IMPACTO ALTO</span><strong>{highRisk}</strong><small>{events} eventos encontrados en el horizonte actual</small></article>
    </section>

    <section className="local-location-grid">
      {(payload?.locations ?? []).map(row => <article className={`local-location-card ${row.assessment.level}`} key={row.location}>
        <header><div><span>LOCAL INTELLIGENCE</span><h2>{row.location}</h2></div><strong>{row.assessment.summary}</strong></header>
        <div className="local-signal-grid">
          <section><span>CLIMA</span>{row.weather ? <><strong>{Math.round(row.weather.temperature)}°F</strong><small>Sensación {Math.round(row.weather.feelsLike)}° · viento {Math.round(row.weather.windMph)} mph</small><p>{row.weather.phrase}{row.weather.precipitation > 0 ? ` · ${row.weather.precipitation} in` : ''}</p></> : <p className="source-failure">{row.errors.weather || 'Sin datos'}</p>}</section>
          <section><span>TRÁFICO</span>{row.traffic ? <><strong>{Math.round(row.traffic.currentSpeed)} mph</strong><small>Flujo libre {Math.round(row.traffic.freeFlowSpeed)} mph · congestión {row.traffic.congestionPct}%</small><p>{row.traffic.roadClosure ? 'Cierre vial detectado' : row.traffic.topIncident || `${row.traffic.incidentCount} incidentes cercanos`}</p></> : <p className="source-failure">{row.errors.traffic || 'TomTom no configurado'}</p>}</section>
          <section><span>EVENTOS CERCANOS</span>{row.events ? <><strong>{row.events.eventCount}</strong><small>Próximos {row.events.horizonDays} días · radio de 25 millas</small><div className="local-events">{row.events.events.slice(0, 3).map(event => <p key={event.id}><b>{event.name}</b><em>{formatEventDate(event.date)} · {event.venue}</em>{event.url && <a href={event.url} target="_blank" rel="noreferrer">Ver ↗</a>}</p>)}{!row.events.events.length && <p>Sin eventos publicados.</p>}</div></> : <p className="source-failure">{row.errors.events || 'Ticketmaster no configurado'}</p>}</section>
        </div>
        <div className="local-recommendation"><span>ACCIÓN RECOMENDADA</span>{row.assessment.recommendations.map(item => <p key={item}>• {item}</p>)}</div>
        <footer>Actualizado {formatUpdated(row.weather?.updatedAt || row.traffic?.updatedAt || payload?.fetchedAt)}</footer>
      </article>)}
    </section>
  </div>;
}
