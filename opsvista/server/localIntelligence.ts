type LocationPoint = { name: string; lat: number; lon: number };

type ProviderState = {
  id: 'weather' | 'traffic' | 'events';
  name: string;
  state: 'live' | 'fallback' | 'error' | 'not_configured';
  detail: string;
};

export type LocalIntelligenceHorizonKey = 'today' | 'tomorrow' | 'next_7' | 'next_14' | 'next_30';
export type LocalIntelligenceHorizon = { key: LocalIntelligenceHorizonKey; startOffsetDays: number; horizonDays: number };
export const localIntelligenceHorizons: Record<LocalIntelligenceHorizonKey, LocalIntelligenceHorizon> = {
  today: { key: 'today', startOffsetDays: 0, horizonDays: 1 },
  tomorrow: { key: 'tomorrow', startOffsetDays: 1, horizonDays: 1 },
  next_7: { key: 'next_7', startOffsetDays: 0, horizonDays: 7 },
  next_14: { key: 'next_14', startOffsetDays: 0, horizonDays: 14 },
  next_30: { key: 'next_30', startOffsetDays: 0, horizonDays: 30 },
};

function easternToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function easternMidnightUtc(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(guess);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const representedAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
  return new Date(guess.getTime() - (representedAsUtc - guess.getTime()));
}

function horizonRange(horizon: LocalIntelligenceHorizon) {
  const today = easternToday();
  const rangeStart = addIsoDays(today, horizon.startOffsetDays);
  const rangeEnd = addIsoDays(rangeStart, horizon.horizonDays - 1);
  const boundaryStart = easternMidnightUtc(rangeStart);
  const now = new Date();
  const start = horizon.startOffsetDays === 0 && now > boundaryStart ? now : boundaryStart;
  const end = easternMidnightUtc(addIsoDays(rangeEnd, 1));
  return { start, end, rangeStart, rangeEnd };
}

const locations: LocationPoint[] = [
  { name: 'Stamford', lat: 41.0534, lon: -73.5387 },
  { name: 'Orange', lat: 41.2784, lon: -73.0265 },
  { name: 'Fairfield', lat: 41.1408, lon: -73.2613 },
  { name: 'Danbury', lat: 41.3948, lon: -73.4540 },
  { name: 'Avon', lat: 41.8096, lon: -72.8307 },
  { name: 'Southington', lat: 41.5965, lon: -72.8776 },
  { name: 'Middletown', lat: 41.5623, lon: -72.6506 },
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
      forecast: null,
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
    forecast: null,
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

async function getEvents(place: LocationPoint, key: string, horizon: LocalIntelligenceHorizon) {
  const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
  const { start, end } = horizonRange(horizon);
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
  return { provider: 'Ticketmaster Discovery', eventCount: source.length, events, horizonDays: horizon.horizonDays, updatedAt: new Date().toISOString() };
}

function operatingAssessment(weather: any, traffic: any, events: any, horizonDays: number) {
  const recommendations: string[] = [];
  let riskScore = 0;
  if (weather) {
    const rainProbability = Number(weather.forecast?.maxPrecipProbability ?? 0);
    const projectedRain = Number(weather.forecast?.totalPrecipitation ?? 0);
    const projectedWind = Number(weather.forecast?.maxWindMph ?? weather.windMph ?? 0);
    if (weather.precipitation > 0) {
      riskScore += 2;
      recommendations.push('Protege delivery, entradas y estacionamiento por precipitación activa.');
    } else if (rainProbability >= 60 || projectedRain >= 0.25) {
      riskScore += 2;
      recommendations.push(`Prepara delivery, entradas y estacionamiento: el pronóstico alcanza ${Math.round(rainProbability)}% de probabilidad de lluvia.`);
    }
    if (projectedWind >= 25) { riskScore += 2; recommendations.push('Revisa patio, letreros y seguridad exterior por viento fuerte en el periodo.'); }
  }
  if (traffic) {
    if (traffic.roadClosure) { riskScore += 3; recommendations.push('Existe un cierre vial cercano; avisa al equipo y anticipa retrasos de clientes y delivery.'); }
    else if (traffic.congestionPct >= 30 || traffic.incidentCount > 0) { riskScore += 2; recommendations.push('Escalona entradas y comunica rutas alternas por congestión o incidentes cercanos.'); }
  }
  if (events?.eventCount >= 5) { riskScore += 2; recommendations.push(`Revisa staffing, reservas, prep e inventario: hay ${events.eventCount} eventos cercanos en el horizonte de ${horizonDays} día${horizonDays === 1 ? '' : 's'}.`); }
  else if (events?.eventCount > 0) recommendations.push('Compara los eventos cercanos con reservas y ventas históricas antes de ajustar staffing.');
  if (!recommendations.length) recommendations.push('Sin señales externas críticas ahora; conserva el staffing planificado y monitorea cambios.');
  return {
    level: riskScore >= 5 ? 'high' : riskScore >= 2 ? 'watch' : 'normal',
    summary: riskScore >= 5 ? 'Impacto operativo alto' : riskScore >= 2 ? 'Requiere vigilancia' : 'Condiciones normales',
    recommendations,
  };
}

async function getExistingConnectedSource(requestedLocations: string[] | undefined, horizon: LocalIntelligenceHorizon) {
  const configuredUrl = process.env.OPSVISTA_LOCAL_INTELLIGENCE_SOURCE_URL?.trim();
  const candidates = [...new Set([
    configuredUrl,
    'https://app.getopsvista.com/api/public-local-intelligence',
    'https://pv-operations.rodriguez10.chatgpt.site/api/public-local-intelligence',
  ].filter(Boolean) as string[])];
  let source: any;
  let sourceUrl = '';
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (requestedLocations?.length === 1) url.searchParams.set('location', requestedLocations[0]);
      const range = horizonRange(horizon);
      url.searchParams.set('horizonDays', String(horizon.horizonDays));
      url.searchParams.set('startOffsetDays', String(horizon.startOffsetDays));
      url.searchParams.set('rangeStart', range.rangeStart);
      url.searchParams.set('rangeEnd', range.rangeEnd);
      source = await timedJson(url, 9_000, 'Existing Local Intelligence connection');
      sourceUrl = `${url.origin}${url.pathname}`;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!source) throw lastError instanceof Error ? lastError : new Error('Existing Local Intelligence connection unavailable');

  const selected = locations.filter(location => !requestedLocations?.length || requestedLocations.includes(location.name));
  const weatherRows = Array.isArray(source.weather) ? source.weather : [];
  const trafficRows = Array.isArray(source.traffic) ? source.traffic : [];
  const eventRows = Array.isArray(source.events) ? source.events : [];
  const sourceErrors = source.errors && typeof source.errors === 'object' ? source.errors : {};
  const byName = (rows: any[]) => new Map(rows.map(row => [String(row.name || row.location || ''), row]));
  const weatherByName = byName(weatherRows);
  const trafficByName = byName(trafficRows);
  const eventsByName = byName(eventRows);

  const rows = await Promise.all(selected.map(async place => {
    const weatherSource = weatherByName.get(place.name);
    const trafficSource = trafficByName.get(place.name);
    const eventsSource = eventsByName.get(place.name);
    const forecastSource = weatherSource?.forecast;
    let weather = weatherSource ? {
      provider: String(weatherSource.provider || 'The Weather Company'),
      temperature: Number(weatherSource.temperature ?? 0),
      feelsLike: Number(weatherSource.feels ?? weatherSource.feelsLike ?? weatherSource.temperature ?? 0),
      precipitation: Number(weatherSource.precipitation ?? 0),
      windMph: Number(weatherSource.wind ?? weatherSource.windMph ?? 0),
      phrase: String(weatherSource.phrase || (Number(weatherSource.precipitation ?? 0) > 0 ? 'Precipitación activa' : 'Sin precipitación activa')),
      updatedAt: String(weatherSource.updated || weatherSource.updatedAt || new Date().toISOString()),
      forecast: forecastSource ? {
        requestedDays: Number(forecastSource.requestedDays ?? horizon.horizonDays),
        daysAvailable: Number(forecastSource.daysAvailable ?? 0),
        rangeStart: forecastSource.rangeStart ? String(forecastSource.rangeStart) : null,
        rangeEnd: forecastSource.rangeEnd ? String(forecastSource.rangeEnd) : null,
        highF: forecastSource.highF == null ? null : Number(forecastSource.highF),
        lowF: forecastSource.lowF == null ? null : Number(forecastSource.lowF),
        maxPrecipProbability: forecastSource.maxPrecipProbability == null ? null : Number(forecastSource.maxPrecipProbability),
        totalPrecipitation: forecastSource.totalPrecipitation == null ? null : Number(forecastSource.totalPrecipitation),
        maxWindMph: forecastSource.maxWindMph == null ? null : Number(forecastSource.maxWindMph),
      } : null,
    } : null;
    if (!weather) {
      try {
        weather = await getWeather(place);
      } catch {
        weather = null;
      }
    }
    const traffic = trafficSource ? {
      provider: 'TomTom Traffic',
      currentSpeed: Number(trafficSource.currentSpeed ?? 0),
      freeFlowSpeed: Number(trafficSource.freeFlowSpeed ?? 0),
      congestionPct: Number(trafficSource.congestion ?? trafficSource.congestionPct ?? 0),
      roadClosure: Boolean(trafficSource.roadClosure),
      incidentCount: Number(trafficSource.incidentCount ?? 0),
      topIncident: trafficSource.topIncident || null,
      updatedAt: String(trafficSource.updatedAt || new Date().toISOString()),
    } : null;
    const requestedRange = horizonRange(horizon);
    const sourceMatchesHorizon = Number(source.horizonDays) === horizon.horizonDays && Number(source.startOffsetDays || 0) === horizon.startOffsetDays;
    const sourceEvents = Array.isArray(eventsSource?.events) ? eventsSource.events : [];
    const matchingEvents = sourceMatchesHorizon ? sourceEvents : sourceEvents.filter((event: any) => {
      const date = String(event?.date || '').slice(0, 10);
      return date && date >= requestedRange.rangeStart && date <= requestedRange.rangeEnd;
    });
    const events = eventsSource ? {
      provider: 'Ticketmaster Discovery',
      eventCount: sourceMatchesHorizon ? Number(eventsSource.eventCount ?? matchingEvents.length) : matchingEvents.length,
      events: matchingEvents,
      horizonDays: horizon.horizonDays,
      updatedAt: String(eventsSource.updatedAt || new Date().toISOString()),
    } : null;
    return {
      location: place.name,
      weather,
      traffic,
      events,
      errors: {
        weather: weather ? '' : String(sourceErrors.weather?.[0] || 'La fuente compartida no devolvió clima.'),
        traffic: traffic ? '' : String(sourceErrors.traffic?.[0] || 'La fuente compartida no devolvió tráfico.'),
        events: events ? '' : String(sourceErrors.events?.[0] || 'La fuente compartida no devolvió eventos.'),
      },
      assessment: operatingAssessment(weather, traffic, events, horizon.horizonDays),
    };
  }));

  const weatherCount = rows.filter(row => row.weather).length;
  const trafficCount = rows.filter(row => row.traffic).length;
  const eventCount = rows.filter(row => row.events).length;
  const provider = (id: ProviderState['id'], name: string, count: number): ProviderState => ({
    id,
    name,
    state: count > 0 ? (id === 'weather' && /(open-meteo|national weather service)/i.test(name) ? 'fallback' : 'live') : 'error',
    detail: count > 0 ? `${count}/${rows.length} locations updated through PV Operations` : 'Existing provider did not return data',
  });
  return {
    source: 'Existing PV Operations provider connections',
    sourceUrl,
    sharedSource: true,
    fetchedAt: new Date().toISOString(),
    horizonKey: horizon.key,
    horizonDays: horizon.horizonDays,
    rangeStart: horizonRange(horizon).rangeStart,
    rangeEnd: horizonRange(horizon).rangeEnd,
    providers: [
      provider('weather', String(rows.find(row => row.weather)?.weather?.provider || 'Weather'), weatherCount),
      provider('traffic', 'TomTom Traffic', trafficCount),
      provider('events', 'Ticketmaster Discovery', eventCount),
    ],
    locations: rows,
  };
}

export async function getLocalIntelligence(requestedLocations?: string[], horizon: LocalIntelligenceHorizon = localIntelligenceHorizons.next_14) {
  const selected = locations.filter(location => !requestedLocations?.length || requestedLocations.includes(location.name));
  const cacheKey = `${horizon.key}|${selected.map(location => location.name).sort().join('|') || 'none'}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const tomtomKey = process.env.TOMTOM_API_KEY;
  const ticketmasterKey = process.env.TICKETMASTER_API_KEY;
  const weatherKey = process.env.WEATHER_COMPANY_API_KEY || process.env.WEATHER_API_KEY;

  // Reuse the already configured provider runtime before asking for any new
  // deployment secrets. Only public weather, traffic and event data crosses
  // this server-to-server boundary; provider keys remain in PV Operations.
  if (!tomtomKey || !ticketmasterKey) {
    try {
      const sharedPayload = await getExistingConnectedSource(requestedLocations, horizon);
      responseCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60_000, value: sharedPayload });
      return sharedPayload;
    } catch {
      // Continue to the direct providers/Open-Meteo fallback so this module
      // remains honest and usable if the existing source is temporarily down.
    }
  }

  const rows = await Promise.all(selected.map(async place => {
    const [weatherResult, trafficResult, eventsResult] = await Promise.allSettled([
      getWeather(place, weatherKey),
      tomtomKey ? getTraffic(place, tomtomKey) : Promise.resolve(null),
      ticketmasterKey ? getEvents(place, ticketmasterKey, horizon) : Promise.resolve(null),
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
      assessment: operatingAssessment(weather, traffic, events, horizon.horizonDays),
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
    source: 'OpsVista Local Intelligence', fetchedAt: new Date().toISOString(), horizonKey: horizon.key, horizonDays: horizon.horizonDays,
    rangeStart: horizonRange(horizon).rangeStart, rangeEnd: horizonRange(horizon).rangeEnd,
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
