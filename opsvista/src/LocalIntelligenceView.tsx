import { useEffect, useMemo, useState } from 'react';
import './localIntelligence.css';

type Provider = { id: 'weather' | 'traffic' | 'events'; name: string; state: 'live' | 'fallback' | 'error' | 'not_configured'; detail: string };
type WeatherForecast = { requestedDays: number; daysAvailable: number; rangeStart?: string | null; rangeEnd?: string | null; highF?: number | null; lowF?: number | null; maxPrecipProbability?: number | null; totalPrecipitation?: number | null; maxWindMph?: number | null };
type LocalRow = {
  location: string;
  weather: null | { provider: string; temperature: number; feelsLike: number; precipitation: number; windMph: number; phrase: string; updatedAt: string; forecast?: WeatherForecast | null };
  traffic: null | { provider: string; currentSpeed: number; freeFlowSpeed: number; congestionPct: number; roadClosure: boolean; incidentCount: number; topIncident?: string | null; updatedAt: string };
  events: null | { provider: string; eventCount: number; horizonDays: number; events: Array<{ id: string; name: string; url?: string | null; date?: string | null; venue: string; city: string; category: string }> };
  errors: { weather?: string; traffic?: string; events?: string };
  assessment: { level: 'high' | 'watch' | 'normal'; summary: string; recommendations: string[] };
};
type HorizonKey = 'today' | 'tomorrow' | 'next_7' | 'next_14' | 'next_30';
type Payload = { source?: string; sharedSource?: boolean; fetchedAt: string; horizonDays: number; horizonKey?: HorizonKey; rangeStart?: string; rangeEnd?: string; providers: Provider[]; locations: LocalRow[] };

const horizonOptions: Record<HorizonKey, { label: string; detail: string }> = {
  today: { label: 'Hoy', detail: 'Señales actuales y eventos publicados de hoy' },
  tomorrow: { label: 'Mañana', detail: 'Eventos publicados para mañana con señales actuales como contexto' },
  next_7: { label: 'Próximos 7 días', detail: 'Eventos publicados en el horizonte operativo de una semana' },
  next_14: { label: 'Próximos 14 días', detail: 'Eventos publicados para apoyar staffing y prep' },
  next_30: { label: 'Próximos 30 días', detail: 'Eventos y riesgos publicados del próximo mes' },
};

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
  const [horizon, setHorizon] = useState<HorizonKey>(() => {
    const saved = window.localStorage.getItem('opsvista-local-intelligence-horizon') as HorizonKey | null;
    return saved && saved in horizonOptions ? saved : 'today';
  });
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ location, horizon });
      const response = await fetch(`/api/local-intelligence?${query}`, { credentials: 'include', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Local Intelligence ${response.status}`);
      setPayload(body as Payload);
    } catch (loadError) {
      setPayload(null); setError(loadError instanceof Error ? loadError.message : 'No fue posible actualizar Local Intelligence.');
    } finally { setLoading(false); }
  };

  useEffect(() => {
    window.localStorage.setItem('opsvista-local-intelligence-location', location);
    window.localStorage.setItem('opsvista-local-intelligence-horizon', horizon);
    void load();
  }, [location, horizon]);
  const highRisk = useMemo(() => payload?.locations.filter(row => row.assessment.level === 'high').length ?? 0, [payload]);
  const events = useMemo(() => payload?.locations.reduce((sum, row) => sum + (row.events?.eventCount ?? 0), 0) ?? 0, [payload]);

  return <div className="local-intelligence-page">
    <section className="local-control-bar">
      <label><span>LOCATION</span><select value={location} onChange={event => setLocation(event.target.value)}><option>All locations</option>{allowedLocations.map(item => <option key={item}>{item}</option>)}</select></label>
      <div className="local-horizon-control"><span>PERIODO</span><div className="local-horizon-tabs" role="group" aria-label="Periodo de Local Intelligence">{Object.entries(horizonOptions).map(([value, option]) => <button key={value} type="button" className={horizon === value ? 'active' : ''} aria-pressed={horizon === value} onClick={() => setHorizon(value as HorizonKey)}>{option.label}</button>)}</div></div>
      <div><span>RESULTADOS MOSTRADOS</span><strong>{horizonOptions[horizon].label}{payload?.rangeStart && payload?.rangeEnd ? ` · ${payload.rangeStart} → ${payload.rangeEnd}` : ''}</strong><small>{horizonOptions[horizon].detail}. El pronóstico muestra la cobertura disponible, los eventos respetan todo el horizonte y el tráfico se identifica como señal actual.</small></div>
      <button onClick={() => void load()} disabled={loading}>↻ {loading ? 'Actualizando…' : 'Actualizar señales'}</button>
    </section>

    {error && <section className="local-error"><strong>Local Intelligence no pudo actualizarse</strong><span>{error}</span></section>}
    {payload?.sharedSource && <section className="local-shared-source"><strong>✓ Conexiones existentes reutilizadas</strong><span>Weather, TomTom y Ticketmaster se consultan desde PV Operations; las llaves permanecen protegidas en Sites.</span></section>}
    <section className="provider-grid">
      {(payload?.providers ?? []).map(provider => <article key={provider.id} className={`provider-card ${provider.state}`}><span>{provider.name}</span><strong>{stateLabel[provider.state]}</strong><small>{provider.detail}</small></article>)}
      {!payload && loading && ['Weather', 'TomTom Traffic', 'Ticketmaster'].map(name => <article className="provider-card loading" key={name}><span>{name}</span><strong>Conectando…</strong><small>Consultando la fuente real</small></article>)}
      <article className="provider-card summary"><span>IMPACTO ALTO</span><strong>{highRisk}</strong><small>{events} eventos encontrados en el horizonte actual</small></article>
    </section>

    <section className="local-location-grid">
      {(payload?.locations ?? []).map(row => {
        const forecast = row.weather?.forecast;
        const showForecast = horizon !== 'today' && Boolean(forecast?.daysAvailable);
        return <article className={`local-location-card ${row.assessment.level}`} key={row.location}>
        <header><div><span>LOCAL INTELLIGENCE</span><h2>{row.location}</h2></div><strong>{row.assessment.summary}</strong></header>
        <div className="local-signal-grid">
          <section><span>{showForecast ? 'PRONÓSTICO' : 'CLIMA ACTUAL'}</span>{row.weather ? showForecast ? <><strong>{Math.round(forecast?.lowF ?? 0)}°–{Math.round(forecast?.highF ?? 0)}°F</strong><small>{Math.round(forecast?.maxPrecipProbability ?? 0)}% lluvia · viento máximo {Math.round(forecast?.maxWindMph ?? 0)} mph</small><p>{forecast?.daysAvailable} de {forecast?.requestedDays} día{forecast?.requestedDays === 1 ? '' : 's'} con pronóstico disponible{forecast?.rangeStart && forecast?.rangeEnd ? ` · ${forecast.rangeStart} → ${forecast.rangeEnd}` : ''}</p></> : <><strong>{Math.round(row.weather.temperature)}°F</strong><small>Sensación {Math.round(row.weather.feelsLike)}° · viento {Math.round(row.weather.windMph)} mph</small><p>{row.weather.phrase}{row.weather.precipitation > 0 ? ` · ${row.weather.precipitation} in` : ''}</p></> : <p className="source-failure">{row.errors.weather || 'Sin datos'}</p>}</section>
          <section><span>TRÁFICO</span>{row.traffic ? <><strong>{Math.round(row.traffic.currentSpeed)} mph</strong><small>Flujo libre {Math.round(row.traffic.freeFlowSpeed)} mph · congestión {row.traffic.congestionPct}%</small><p>{row.traffic.roadClosure ? 'Cierre vial detectado' : row.traffic.topIncident || `${row.traffic.incidentCount} incidentes cercanos`}</p></> : <p className="source-failure">{row.errors.traffic || 'TomTom no configurado'}</p>}</section>
          <section><span>EVENTOS CERCANOS</span>{row.events ? <><strong>{row.events.eventCount}</strong><small>{horizonOptions[horizon].label} · radio de 25 millas</small><div className="local-events">{row.events.events.slice(0, 3).map(event => <p key={event.id}><b>{event.name}</b><em>{formatEventDate(event.date)} · {event.venue}</em>{event.url && <a href={event.url} target="_blank" rel="noreferrer">Ver ↗</a>}</p>)}{!row.events.events.length && <p>Sin eventos publicados.</p>}</div></> : <p className="source-failure">{row.errors.events || 'Ticketmaster no configurado'}</p>}</section>
        </div>
        <div className="local-recommendation"><span>ACCIÓN RECOMENDADA</span>{row.assessment.recommendations.map(item => <p key={item}>• {item}</p>)}</div>
        <footer>Actualizado {formatUpdated(row.weather?.updatedAt || row.traffic?.updatedAt || payload?.fetchedAt)}</footer>
      </article>})}
    </section>
  </div>;
}
