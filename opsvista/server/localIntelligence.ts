type LocationPoint = { name: string; lat: number; lon: number };

type ProviderState = {
  id: 'weather' | 'traffic' | 'events';
  name: string;
  state: 'live' | 'fallback' | 'error' | 'not_configured';
  detail: string;
};

const locations: LocationPoint[] = [
  { name: 'Stamford', lat: 41.0534, lon: -73.5387 },
  { name: 'Orange', lat: 41.2784, lon: -73.0265 },
  { name: 'Fairfield', lat: 41.1408, lon: -73.2613 },
  { name: 'Danbury', lat: 41.3948, lon: -73.4540 },
  { name: 'Avon', lat: 41.8096, lon: -72.8307 },
  { name: 'Southington', lat: 41.5965, lon: -72.8776 },
];

const responseCache = new Map<string, { expiresAt: number; value: any }>();

async function timedJson(url: URL, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${label} ${response.status}`);
    return body as any;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error(`${label} timed out`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getWeather(place: LocationPoint, weatherKey?: string) {
  if (weatherKey) {
    const url = new URL('https://api.weather.com/v3/wx/observations/current');
    url.searchParams.set('geocode', `${place.lat},${place.lon}`);
    url.searchParams.set('units', 'e');
    url.searchParams.set('language', 'es-US');
    url.searchParams.set('format', 'json');
    url.searchParams.set('apiKey', weatherKey);
    const data = await timedJson(url, 7_000, 'The Weather Company');
    return {
      provider: 'The Weather Company', temperature: Number(data.temperature ?? 0),
      feelsLike: Number(data.temperatureFeelsLike ?? data.temperature ?? 0),
      precipitation: Number(data.precip1Hour ?? 0), windMph: Number(data.windSpeed ?? 0),
      phrase: String(data.wxPhraseLong || 'Condiciones actuales'),
      updatedAt: data.validTimeUtc ? new Date(Number(data.validTimeUtc) * 1000).toISOString() : new Date().toISOString(),
    };
  }

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(place.lat));
  url.searchParams.set('longitude', String(place.lon));
  url.searchParams.set('current', 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m');
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('wind_speed_unit', 'mph');
  url.searchParams.set('timezone', 'America/New_York');
  const data = await timedJson(url, 7_000, 'Open-Meteo');
  const current = data.current ?? {};
  return {
    provider: 'Open-Meteo', temperature: Number(current.temperature_2m ?? 0),
    feelsLike: Number(current.apparent_temperature ?? current.temperature_2m ?? 0),
    precipitation: Number(current.precipitation ?? 0), windMph: Number(current.wind_speed_10m ?? 0),
    phrase: Number(current.precipitation ?? 0) > 0 ? 'Precipitación activa' : 'Sin precipitación activa',
    updatedAt: String(current.time || new Date().toISOString()),
  };
}

async function getTraffic(place: LocationPoint, key: string) {
  const flowUrl = new URL('https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json');
  flowUrl.searchParams.set('point', `${place.lat},${place.lon}`);
  flowUrl.searchParams.set('unit', 'MPH');
  flowUrl.searchParams.set('key', key);

  const delta = 0.055;
  const incidentUrl = new URL('https://api.tomtom.com/traffic/services/5/incidentDetails');
  incidentUrl.searchParams.set('bbox', `${place.lon - delta},${place.lat - delta},${place.lon + delta},${place.lat + delta}`);
  incidentUrl.searchParams.set('fields', '{incidents{type,properties{iconCategory,magnitudeOfDelay,events{description},delay,from,to}}}');
  incidentUrl.searchParams.set('language', 'en-US');
  incidentUrl.searchParams.set('timeValidityFilter', 'present');
  incidentUrl.searchParams.set('key', key);

  const [flow, incidentResult] = await Promise.all([
    timedJson(flowUrl, 7_000, 'TomTom flow'),
    timedJson(incidentUrl, 7_000, 'TomTom incidents').catch(() => ({ incidents: [] })),
  ]);
  const segment = flow.flowSegmentData ?? {};
  const currentSpeed = Number(segment.currentSpeed ?? 0);
  const freeFlowSpeed = Number(segment.freeFlowSpeed ?? 0);
  const congestionPct = freeFlowSpeed ? Math.max(0, Math.min(100, Math.round((1 - currentSpeed / freeFlowSpeed) * 100))) : 0;
  const incidents = Array.isArray(incidentResult.incidents) ? incidentResult.incidents : [];
  return {
    provider: 'TomTom Traffic', currentSpeed, freeFlowSpeed, congestionPct,
    roadClosure: Boolean(segment.roadClosure), incidentCount: incidents.length,
    topIncident: incidents[0]?.properties?.events?.[0]?.description || null,
    updatedAt: new Date().toISOString(),
  };
}

async function getEvents(place: LocationPoint, key: string) {
  const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
  const start = new Date();
  const end = new Date(start.getTime() + 14 * 86_400_000);
  url.searchParams.set('apikey', key);
  url.searchParams.set('latlong', `${place.lat},${place.lon}`);
  url.searchParams.set('radius', '25');
  url.searchParams.set('unit', 'miles');
  url.searchParams.set('startDateTime', start.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  url.searchParams.set('endDateTime', end.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  url.searchParams.set('size', '20');
  url.searchParams.set('sort', 'date,asc');
  const data = await timedJson(url, 7_000, 'Ticketmaster');
  const source = Array.isArray(data._embedded?.events) ? data._embedded.events : [];
  const events = source.slice(0, 5).map((event: any) => ({
    id: String(event.id), name: String(event.name || 'Evento'), url: event.url || null,
    date: event.dates?.start?.dateTime || event.dates?.start?.localDate || null,
    localTime: event.dates?.start?.localTime || null,
    venue: event._embedded?.venues?.[0]?.name || 'Venue por confirmar',
    city: event._embedded?.venues?.[0]?.city?.name || place.name,
    category: event.classifications?.[0]?.segment?.name || 'Event',
  }));
  return { provider: 'Ticketmaster Discovery', eventCount: source.length, events, horizonDays: 14, updatedAt: new Date().toISOString() };
}

function operatingAssessment(weather: any, traffic: any, events: any) {
  const recommendations: string[] = [];
  let riskScore = 0;
  if (weather) {
    if (weather.precipitation > 0) { riskScore += 2; recommendations.push('Protege delivery, entradas y estacionamiento por precipitación activa.'); }
    if (weather.windMph >= 25) { riskScore += 2; recommendations.push('Revisa patio, letreros y seguridad exterior por viento fuerte.'); }
  }
  if (traffic) {
    if (traffic.roadClosure) { riskScore += 3; recommendations.push('Existe un cierre vial cercano; avisa al equipo y anticipa retrasos de clientes y delivery.'); }
    else if (traffic.congestionPct >= 30 || traffic.incidentCount > 0) { riskScore += 2; recommendations.push('Escalona entradas y comunica rutas alternas por congestión o incidentes cercanos.'); }
  }
  if (events?.eventCount >= 5) { riskScore += 2; recommendations.push('Revisa reservas, prep e inventario: hay varios eventos cercanos en los próximos 14 días.'); }
  else if (events?.eventCount > 0) recommendations.push('Compara los eventos cercanos con reservas y ventas históricas antes de ajustar staffing.');
  if (!recommendations.length) recommendations.push('Sin señales externas críticas ahora; conserva el staffing planificado y monitorea cambios.');
  return {
    level: riskScore >= 5 ? 'high' : riskScore >= 2 ? 'watch' : 'normal',
    summary: riskScore >= 5 ? 'Impacto operativo alto' : riskScore >= 2 ? 'Requiere vigilancia' : 'Condiciones normales',
    recommendations,
  };
}

export async function getLocalIntelligence(requestedLocations?: string[]) {
  const selected = locations.filter(location => !requestedLocations?.length || requestedLocations.includes(location.name));
  const cacheKey = selected.map(location => location.name).sort().join('|') || 'none';
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const tomtomKey = process.env.TOMTOM_API_KEY;
  const ticketmasterKey = process.env.TICKETMASTER_API_KEY;
  const weatherKey = process.env.WEATHER_COMPANY_API_KEY || process.env.WEATHER_API_KEY;

  const rows = await Promise.all(selected.map(async place => {
    const [weatherResult, trafficResult, eventsResult] = await Promise.allSettled([
      getWeather(place, weatherKey),
      tomtomKey ? getTraffic(place, tomtomKey) : Promise.resolve(null),
      ticketmasterKey ? getEvents(place, ticketmasterKey) : Promise.resolve(null),
    ]);
    const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : null;
    const traffic = trafficResult.status === 'fulfilled' ? trafficResult.value : null;
    const events = eventsResult.status === 'fulfilled' ? eventsResult.value : null;
    return {
      location: place.name, weather, traffic, events,
      errors: {
        weather: weatherResult.status === 'rejected' ? String(weatherResult.reason?.message || weatherResult.reason) : '',
        traffic: trafficResult.status === 'rejected' ? String(trafficResult.reason?.message || trafficResult.reason) : '',
        events: eventsResult.status === 'rejected' ? String(eventsResult.reason?.message || eventsResult.reason) : '',
      },
      assessment: operatingAssessment(weather, traffic, events),
    };
  }));

  const providerState = (id: ProviderState['id'], configured: boolean, hasRows: boolean, failedRows: number, fallback = false): ProviderState => ({
    id,
    name: id === 'weather' ? (weatherKey ? 'The Weather Company' : 'Open-Meteo') : id === 'traffic' ? 'TomTom Traffic' : 'Ticketmaster Discovery',
    state: !configured ? (fallback ? (hasRows ? 'fallback' : 'error') : 'not_configured') : hasRows ? 'live' : 'error',
    detail: !configured ? (fallback ? (hasRows ? 'Live fallback weather' : 'Weather fallback did not return data') : 'API key not configured') : hasRows ? `${rows.length - failedRows}/${rows.length} locations updated` : 'Provider did not return data',
  });
  const weatherFailures = rows.filter(row => !row.weather).length;
  const trafficFailures = rows.filter(row => !row.traffic).length;
  const eventFailures = rows.filter(row => !row.events).length;
  const payload = {
    source: 'OpsVista Local Intelligence', fetchedAt: new Date().toISOString(), horizonDays: 14,
    providers: [
      providerState('weather', Boolean(weatherKey), weatherFailures < rows.length, weatherFailures, true),
      providerState('traffic', Boolean(tomtomKey), trafficFailures < rows.length, trafficFailures),
      providerState('events', Boolean(ticketmasterKey), eventFailures < rows.length, eventFailures),
    ],
    locations: rows,
  };
  responseCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value: payload });
  return payload;
}

export const localIntelligenceLocationNames = locations.map(location => location.name);
