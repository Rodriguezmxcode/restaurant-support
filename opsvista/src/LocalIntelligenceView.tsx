import { useEffect, useMemo, useState } from 'react';
import './localIntelligence.css';
import MaxDataInsights from './MaxDataInsights';
import { useI18n } from './i18n';

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
type RadiusMiles = 5 | 10 | 15 | 20;
type Payload = { source?: string; sharedSource?: boolean; fetchedAt: string; horizonDays: number; horizonKey?: HorizonKey; radiusMiles?:RadiusMiles; rangeStart?: string; rangeEnd?: string; providers: Provider[]; locations: LocalRow[] };

const horizonOptions=(language:'en'|'es'):Record<HorizonKey,{label:string;detail:string}>=>language==='es'?{
  today:{label:'Hoy',detail:'Señales actuales y eventos publicados de hoy'},
  tomorrow:{label:'Mañana',detail:'Eventos publicados para mañana con señales actuales como contexto'},
  next_7:{label:'Próximos 7 días',detail:'Eventos publicados en el horizonte operativo de una semana'},
  next_14:{label:'Próximos 14 días',detail:'Eventos publicados para apoyar staffing y prep'},
  next_30:{label:'Próximos 30 días',detail:'Eventos y riesgos publicados del próximo mes'},
}:{
  today:{label:'Today',detail:'Current signals and events published for today'},
  tomorrow:{label:'Tomorrow',detail:'Events published for tomorrow with current signals as context'},
  next_7:{label:'Next 7 days',detail:'Published events across the one-week operating horizon'},
  next_14:{label:'Next 14 days',detail:'Published events to support staffing and prep'},
  next_30:{label:'Next 30 days',detail:'Published events and risks across the next month'},
};
const radiusOptions=(language:'en'|'es'):Record<RadiusMiles,{label:string;impact:string}>=>language==='es'?{
  5:{label:'1–5 millas',impact:'Impacto directo: prepara inventario, staffing y promociones'},
  10:{label:'10 millas',impact:'Impacto alto: vigila demanda, reservas y rutas'},
  15:{label:'15 millas',impact:'Impacto regional: úsalo para planificación y marketing'},
  20:{label:'20 millas',impact:'Panorama amplio: descubre eventos y oportunidades de mercado'},
}:{
  5:{label:'1–5 miles',impact:'Direct impact: prepare inventory, staffing and promotions'},
  10:{label:'10 miles',impact:'High impact: monitor demand, reservations and routes'},
  15:{label:'15 miles',impact:'Regional impact: use for planning and marketing'},
  20:{label:'20 miles',impact:'Broader view: discover events and market opportunities'},
};
const stateLabels=(language:'en'|'es'):Record<Provider['state'],string>=>language==='es'
  ?{live:'En vivo',fallback:'Fallback en vivo',error:'Error',not_configured:'No configurada'}
  :{live:'Live',fallback:'Live fallback',error:'Error',not_configured:'Not configured'};

export default function LocalIntelligenceView({ allowedLocations, initialLocation, initialHorizon }: { allowedLocations: string[]; initialLocation?: string; initialHorizon?: HorizonKey }) {
  const {language,t,locale}=useI18n();
  const horizons=horizonOptions(language),radii=radiusOptions(language),providerStates=stateLabels(language);
  const formatUpdated=(value?:string)=>value?new Intl.DateTimeFormat(locale,{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value)):t('No update','Sin actualización');
  const formatEventDate=(value?:string|null)=>{if(!value)return t('Date pending','Fecha pendiente');const date=/^\\d{4}-\\d{2}-\\d{2}$/.test(value)?new Date(`${value}T12:00:00`):new Date(value);return new Intl.DateTimeFormat(locale,{timeZone:'America/New_York',month:'short',day:'numeric'}).format(date);};
  const translateWeatherPhrase=(value:string)=>language==='en'?value.replace(/^Precipitación activa$/i,'Active precipitation').replace(/^Sin precipitación activa$/i,'No active precipitation').replace(/^Condiciones actuales$/i,'Current conditions'):value;
  const [location, setLocation] = useState(() => {
    if (initialLocation && allowedLocations.includes(initialLocation)) return initialLocation;
    const saved = window.localStorage.getItem('opsvista-local-intelligence-location') || 'All locations';
    return saved === 'All locations' || allowedLocations.includes(saved) ? saved : 'All locations';
  });
  const [horizon, setHorizon] = useState<HorizonKey>(() => {
    if (initialHorizon) return initialHorizon;
    const saved = window.localStorage.getItem('opsvista-local-intelligence-horizon') as HorizonKey | null;
    return saved && saved in horizons ? saved : 'today';
  });
  const [radius,setRadius]=useState<RadiusMiles>(()=>{
    const saved=Number(window.localStorage.getItem('opsvista-local-intelligence-radius')) as RadiusMiles;
    return saved in radii?saved:5;
  });
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ location, horizon, radius:String(radius),lang:language });
      const response = await fetch(`/api/local-intelligence?${query}`, { credentials: 'include', cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Local Intelligence ${response.status}`);
      setPayload(body as Payload);
    } catch (loadError) {
      setPayload(null); setError(loadError instanceof Error ? loadError.message : t('Local Intelligence could not be updated.','No fue posible actualizar Local Intelligence.'));
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (initialLocation && allowedLocations.includes(initialLocation)) setLocation(initialLocation);
    if (initialHorizon) setHorizon(initialHorizon);
  }, [initialLocation, initialHorizon, allowedLocations.join('|')]);

  useEffect(() => {
    window.localStorage.setItem('opsvista-local-intelligence-location', location);
    window.localStorage.setItem('opsvista-local-intelligence-horizon', horizon);
    window.localStorage.setItem('opsvista-local-intelligence-radius',String(radius));
    void load();
  }, [location, horizon, radius, language]);
  const highRisk = useMemo(() => payload?.locations.filter(row => row.assessment.level === 'high').length ?? 0, [payload]);
  const events = useMemo(() => payload?.locations.reduce((sum, row) => sum + (row.events?.eventCount ?? 0), 0) ?? 0, [payload]);

  return <div className="local-intelligence-page">
    <section className="local-control-bar">
      <label><span>LOCATION</span><select value={location} onChange={event => setLocation(event.target.value)}><option>All locations</option>{allowedLocations.map(item => <option key={item}>{item}</option>)}</select></label>
      <div className="local-horizon-control"><span>{t('PERIOD','PERIODO')}</span><div className="local-horizon-tabs" role="group" aria-label={t('Local Intelligence period','Periodo de Local Intelligence')}>{Object.entries(horizons).map(([value, option]) => <button key={value} type="button" className={horizon === value ? 'active' : ''} aria-pressed={horizon === value} onClick={() => setHorizon(value as HorizonKey)}>{option.label}</button>)}</div></div>
      <div className="local-radius-control"><span>{t('DISTANCE RANGE','RANGO DE DISTANCIA')}</span><div className="local-radius-tabs" role="group" aria-label={t('Local Intelligence radius','Radio de Local Intelligence')}>{(Object.keys(radii).map(Number) as RadiusMiles[]).map(value=><button key={value} type="button" className={radius===value?'active':''} aria-pressed={radius===value} onClick={()=>setRadius(value)}>{radii[value].label}</button>)}</div></div>
      <div><span>{t('RESULTS SHOWN','RESULTADOS MOSTRADOS')}</span><strong>{horizons[horizon].label} · {radii[radius].label}{payload?.rangeStart && payload?.rangeEnd ? ` · ${payload.rangeStart} → ${payload.rangeEnd}` : ''}</strong><small>{radii[radius].impact}. {horizons[horizon].detail}; {t('events and incidents respect the selected radius.','eventos e incidentes respetan el radio seleccionado.')}</small></div>
      <button onClick={() => void load()} disabled={loading}>↻ {loading ? t('Updating…','Actualizando…') : t('Refresh signals','Actualizar señales')}</button>
    </section>

    {error && <section className="local-error"><strong>{t('Local Intelligence could not be updated','Local Intelligence no pudo actualizarse')}</strong><span>{error}</span></section>}
    {payload?.sharedSource && <section className="local-shared-source"><strong>{t('✓ Existing connections reused','✓ Conexiones existentes reutilizadas')}</strong><span>{t('Weather, TomTom and Ticketmaster are queried through PV Operations; keys remain protected in Sites.','Weather, TomTom y Ticketmaster se consultan desde PV Operations; las llaves permanecen protegidas en Sites.')}</span></section>}
    <section className="provider-grid">
      {(payload?.providers ?? []).map(provider => <article key={provider.id} className={`provider-card ${provider.state}`}><span>{provider.name}</span><strong>{providerStates[provider.state]}</strong><small>{provider.detail}</small></article>)}
      {!payload && loading && ['Weather', 'TomTom Traffic', 'Ticketmaster'].map(name => <article className="provider-card loading" key={name}><span>{name}</span><strong>{t('Connecting…','Conectando…')}</strong><small>{t('Querying live source','Consultando la fuente real')}</small></article>)}
      <article className="provider-card summary"><span>{t('HIGH IMPACT','IMPACTO ALTO')}</span><strong>{highRisk}</strong><small>{events} {t('events found in the current horizon','eventos encontrados en el horizonte actual')}</small></article>
    </section>

    {!!payload?.locations.length&&<MaxDataInsights title={t('External signals map','Mapa de señales externas')} subtitle={t('Events and congestion by restaurant; use real relative location to identify risk concentrations.','Eventos y congestión por restaurante; usa la ubicación relativa real para identificar concentraciones de riesgo.')} rows={payload.locations.map(row=>({location:row.location,primary:row.events?.eventCount??0,secondary:row.traffic?.congestionPct,status:row.assessment.level==='high'?'bad':row.assessment.level==='watch'?'watch':'good'}))} primaryLabel={t('Nearby events','Eventos cercanos')} secondaryLabel={t('Current congestion','Congestión actual')} primaryFormat={value=>value.toFixed(0)} secondaryFormat={value=>`${value.toFixed(0)}%`} conclusion={filtered=>{if(!filtered.length)return[t('No external signals for this filter.','Sin señales externas para este filtro.')];const eventsRank=[...filtered].sort((a,b)=>b.primary-a.primary);const traffic=[...filtered].filter(row=>row.secondary!=null).sort((a,b)=>(b.secondary??0)-(a.secondary??0));const risk=filtered.filter(row=>row.status!=='good');return[t(`${eventsRank[0].location} has ${eventsRank[0].primary.toFixed(0)} published events in the horizon.`,`${eventsRank[0].location} concentra ${eventsRank[0].primary.toFixed(0)} eventos publicados en el horizonte.`),traffic.length?t(`${traffic[0].location} shows the highest current congestion: ${(traffic[0].secondary??0).toFixed(0)}%.`,`${traffic[0].location} muestra la mayor congestión actual: ${(traffic[0].secondary??0).toFixed(0)}%.`):t('TomTom is not available yet.','TomTom aún no está disponible.'),risk.length?t(`Review staffing, prep and routes in ${risk.map(row=>row.location).join(', ')}.`,`Revisa staffing, prep y rutas en ${risk.map(row=>row.location).join(', ')}.`):t('No external signals require immediate intervention.','No hay señales externas que exijan intervención inmediata.')];}}/>}

    <section className="local-location-grid">
      {(payload?.locations ?? []).map(row => {
        const forecast = row.weather?.forecast;
        const showForecast = horizon !== 'today' && Boolean(forecast?.daysAvailable);
        return <article className={`local-location-card ${row.assessment.level}`} key={row.location}>
        <header><div><span>LOCAL INTELLIGENCE</span><h2>{row.location}</h2></div><strong>{row.assessment.summary}</strong></header>
        <div className="local-signal-grid">
          <section><span>{showForecast ? t('FORECAST','PRONÓSTICO') : t('CURRENT WEATHER','CLIMA ACTUAL')}</span>{row.weather ? showForecast ? <><strong>{Math.round(forecast?.lowF ?? 0)}°–{Math.round(forecast?.highF ?? 0)}°F</strong><small>{Math.round(forecast?.maxPrecipProbability ?? 0)}% {t('rain','lluvia')} · {t('max wind','viento máximo')} {Math.round(forecast?.maxWindMph ?? 0)} mph</small><p>{forecast?.daysAvailable} {t('of','de')} {forecast?.requestedDays} {t(forecast?.requestedDays===1?'day':'days',forecast?.requestedDays===1?'día':'días')} {t('with forecast available','con pronóstico disponible')}{forecast?.rangeStart && forecast?.rangeEnd ? ` · ${forecast.rangeStart} → ${forecast.rangeEnd}` : ''}</p></> : <><strong>{Math.round(row.weather.temperature)}°F</strong><small>{t('Feels like','Sensación')} {Math.round(row.weather.feelsLike)}° · {t('wind','viento')} {Math.round(row.weather.windMph)} mph</small><p>{translateWeatherPhrase(row.weather.phrase)}{row.weather.precipitation > 0 ? ` · ${row.weather.precipitation} in` : ''}</p></> : <p className="source-failure">{row.errors.weather || t('No data','Sin datos')}</p>}</section>
          <section><span>{t('TRAFFIC','TRÁFICO')}</span>{row.traffic ? <><strong>{Math.round(row.traffic.currentSpeed)} mph</strong><small>{t('Free flow','Flujo libre')} {Math.round(row.traffic.freeFlowSpeed)} mph · {t('congestion','congestión')} {row.traffic.congestionPct}%</small><p>{row.traffic.roadClosure ? t('Road closure detected','Cierre vial detectado') : row.traffic.topIncident || t(`${row.traffic.incidentCount} nearby incidents`,`${row.traffic.incidentCount} incidentes cercanos`)}</p></> : <p className="source-failure">{row.errors.traffic || t('TomTom not configured','TomTom no configurado')}</p>}</section>
          <section><span>{t('NEARBY EVENTS','EVENTOS CERCANOS')}</span>{row.events ? <><strong>{row.events.eventCount}</strong><small>{horizons[horizon].label} · {t('radius','radio de')} {radii[radius].label}</small><div className="local-events">{row.events.events.slice(0, 3).map(event => <p key={event.id}><b>{event.name}</b><em>{formatEventDate(event.date)} · {event.venue}</em>{event.url && <a href={event.url} target="_blank" rel="noreferrer">{t('View ↗','Ver ↗')}</a>}</p>)}{!row.events.events.length && <p>{t('No published events.','Sin eventos publicados.')}</p>}</div></> : <p className="source-failure">{row.errors.events || t('Ticketmaster not configured','Ticketmaster no configurado')}</p>}</section>
        </div>
        <div className="local-recommendation"><span>{t('RECOMMENDED ACTION','ACCIÓN RECOMENDADA')}</span>{row.assessment.recommendations.map(item => <p key={item}>• {item}</p>)}</div>
        <footer>{t('Updated','Actualizado')} {formatUpdated(row.weather?.updatedAt || row.traffic?.updatedAt || payload?.fetchedAt)}</footer>
      </article>})}
    </section>
  </div>;
}
