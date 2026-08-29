import { useEffect, useMemo, useState } from 'react';
import CustomDateRangePicker from './CustomDateRangePicker';
import MaxDataInsights from './MaxDataInsights';
import { bonusPolicy, googleReviewPoints } from './bonusEngine';
import { parseVistaSocialReviewsCsv } from './vistaSocialCsv';
import './googleReviews.css';

type Period = 'this-week' | 'previous-week' | 'this-month' | 'last-30-days' | 'custom';
type Review = { id: string; reviewer: string; rating: number; comment: string; createTime: string; answered: boolean };
type LocationSummary = {
  location: string;
  googleTitle?: string;
  reviewCount: number;
  averageRating: number | null;
  fiveStarCount: number;
  lowRatingCount: number;
  unansweredCount: number | null;
  minimumMet: boolean;
  scorePct: number;
  reviews?: Review[];
  mappingError?: string;
};
type ReviewsPayload = {
  source?: string;
  start?: string;
  end?: string;
  minimumReviews?: number;
  lastUpdated?: string | null;
  locations?: LocationSummary[];
  error?: string;
};

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const safeGet = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const safeSet = (key: string, value: string) => { try { window.localStorage.setItem(key, value); } catch { /* Safari can block storage. */ } };

function selectedRange(period: Period, customStart: string, customEnd: string) {
  const today = new Date();
  const sinceWednesday = (today.getDay() - 3 + 7) % 7;
  const weekStart = addDays(today, -sinceWednesday);
  if (period === 'custom') return { start: customStart, end: customEnd };
  if (period === 'previous-week') { const start = addDays(weekStart, -7); return { start: iso(start), end: iso(addDays(start, 6)) }; }
  if (period === 'this-month') return { start: iso(new Date(today.getFullYear(), today.getMonth(), 1)), end: iso(today) };
  if (period === 'last-30-days') return { start: iso(addDays(today, -29)), end: iso(today) };
  return { start: iso(weekStart), end: iso(today) };
}

const periodLabels: Record<Period, string> = {
  'this-week': 'Esta semana',
  'previous-week': 'Semana anterior',
  'this-month': 'Este mes',
  'last-30-days': 'Últimos 30 días',
  custom: 'Personalizado',
};

const formatDate = (value: string) => value ? new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(value)) : 'Fecha no disponible';

const stars = (rating: number) => `${'★'.repeat(rating)}${'☆'.repeat(Math.max(0, 5 - rating))}`;

export default function GoogleReviewsView({ allowedLocations, canImportReviews = false }: { allowedLocations: string[]; canImportReviews?: boolean }) {
  const today = iso(new Date());
  const [period, setPeriod] = useState<Period>(() => {
    const saved = safeGet('opsvista-google-reviews-period');
    return saved && saved in periodLabels ? saved as Period : 'this-week';
  });
  const [customStart, setCustomStart] = useState(() => safeGet('opsvista-google-reviews-custom-start') || today);
  const [customEnd, setCustomEnd] = useState(() => safeGet('opsvista-google-reviews-custom-end') || today);
  const [location, setLocation] = useState(() => {
    const saved = safeGet('opsvista-google-reviews-location') || 'All locations';
    return saved === 'All locations' || allowedLocations.includes(saved) ? saved : 'All locations';
  });
  const [payload, setPayload] = useState<ReviewsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const range = useMemo(() => selectedRange(period, customStart, customEnd), [period, customStart, customEnd]);
  const rangeDays = Math.floor((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86_400_000) + 1;
  const rangeError = !range.start || !range.end || rangeDays < 1 ? 'Selecciona fechas válidas.' : rangeDays > 31 ? 'El periodo puede incluir hasta 31 días.' : '';

  useEffect(() => {
    safeSet('opsvista-google-reviews-period', period);
    safeSet('opsvista-google-reviews-custom-start', customStart);
    safeSet('opsvista-google-reviews-custom-end', customEnd);
    safeSet('opsvista-google-reviews-location', location);
  }, [period, customStart, customEnd, location]);

  useEffect(() => {
    if (location !== 'All locations' && !allowedLocations.includes(location)) setLocation('All locations');
  }, [allowedLocations.join('|'), location]);

  const load = async () => {
    if (rangeError) { setPayload(null); setError(rangeError); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ start: range.start, end: range.end });
      if (location !== 'All locations') query.set('location', location);
      const response = await fetch(`/api/google-business/reviews?${query}`, { credentials: 'include', cache: 'no-store' });
      const body = await response.json().catch(() => ({})) as ReviewsPayload;
      if (!response.ok) throw new Error(body.error || `Google Reviews ${response.status}`);
      setPayload(body);
    } catch (loadError) {
      setPayload(null); setError(loadError instanceof Error ? loadError.message : 'No fue posible obtener Google Reviews.');
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [range.start, range.end, location, rangeError]);

  const importReviews = async (file?: File) => {
    if (!file) return;
    setImporting(true); setNotice('');
    try {
      const parsed = parseVistaSocialReviewsCsv(await file.text());
      if (!parsed.acceptedRows) throw new Error('El archivo no contiene reseñas de las seis locaciones activas.');
      const response = await fetch('/api/google-business/reviews', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aggregates: parsed.aggregates }) });
      const body = await response.json().catch(() => ({})) as { error?: string; import?: { reviewCount?: number } };
      if (!response.ok) throw new Error(body.error || 'No fue posible importar el reporte.');
      setNotice(`${body.import?.reviewCount ?? parsed.acceptedRows} reseñas importadas correctamente.`);
      await load();
    } catch (importError) { setNotice(importError instanceof Error ? importError.message : 'No fue posible importar el reporte.'); }
    finally { setImporting(false); }
  };

  const rows = payload?.locations ?? [];
  const totals = useMemo(() => {
    const reviewCount = rows.reduce((sum, row) => sum + row.reviewCount, 0);
    const weightedRating = rows.reduce((sum, row) => sum + (row.averageRating ?? 0) * row.reviewCount, 0);
    const fiveStarCount = rows.reduce((sum, row) => sum + row.fiveStarCount, 0);
    const lowRatingCount = rows.reduce((sum, row) => sum + row.lowRatingCount, 0);
    const hasAnswerData = rows.some(row => row.unansweredCount !== null);
    const unansweredCount = hasAnswerData ? rows.reduce((sum, row) => sum + (row.unansweredCount ?? 0), 0) : null;
    return { reviewCount, averageRating: reviewCount ? weightedRating / reviewCount : null, fiveStarCount, lowRatingCount, unansweredCount };
  }, [rows]);
  const reviewFeed = useMemo(() => rows.flatMap(row => (row.reviews ?? []).map(review => ({ ...review, location: row.location }))).sort((a, b) => b.createTime.localeCompare(a.createTime)), [rows]);

  return <div className="google-reviews-page">
    <section className="reviews-control-bar">
      <label><span>LOCATION</span><select value={location} onChange={event => setLocation(event.target.value)}><option>All locations</option>{allowedLocations.map(item => <option key={item}>{item}</option>)}</select></label>
      <div className="reviews-period-control"><span>PERIODO</span><div className="reviews-period-tabs">{Object.entries(periodLabels).map(([value, label]) => <button type="button" key={value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value as Period)}>{label}</button>)}</div></div>
      <CustomDateRangePicker active={period === 'custom'} start={customStart} end={customEnd} maxDate={today} maxRangeDays={31} onApply={(start, end) => { setCustomStart(start); setCustomEnd(end); }} ariaLabel="Seleccionar periodo de Google Reviews" />
      <button type="button" onClick={() => void load()} disabled={loading}>↻ {loading ? 'Actualizando…' : 'Actualizar reviews'}</button>
    </section>

    <section className="reviews-source-banner">
      <div><strong>✓ Fuente compartida con Bono semanal</strong><span>{range.start} → {range.end} · {payload?.source || 'Google Business Profile'}</span></div>
      <p>La métrica de Reviews del Bono semanal se actualiza automáticamente: <b>5 puntos</b>, mínimo <b>{bonusPolicy.requirements.minimumWeeklyReviews} reseñas</b>, calidad <b>80%</b> y volumen <b>20%</b>.</p>
    </section>

    {error && <section className="reviews-error"><strong>No fue posible actualizar Google Reviews</strong><span>{error}</span></section>}
    {notice && <section className="reviews-notice">{notice}</section>}

    <section className="reviews-metrics-grid">
      <article><span>RESEÑAS NUEVAS</span><strong>{loading ? '—' : totals.reviewCount}</strong><small>{periodLabels[period]}</small></article>
      <article><span>CALIFICACIÓN MEDIA</span><strong>{loading || totals.averageRating === null ? '—' : `${totals.averageRating.toFixed(2)} ★`}</strong><small>Promedio ponderado</small></article>
      <article className="good"><span>RESEÑAS DE 5★</span><strong>{loading ? '—' : totals.fiveStarCount}</strong><small>{totals.reviewCount ? `${(totals.fiveStarCount / totals.reviewCount * 100).toFixed(1)}% del total` : 'Sin reseñas'}</small></article>
      <article className={totals.lowRatingCount ? 'danger' : ''}><span>RESEÑAS DE 1–2★</span><strong>{loading ? '—' : totals.lowRatingCount}</strong><small>Requieren seguimiento</small></article>
      <article className={(totals.unansweredCount ?? 0) ? 'warn' : ''}><span>SIN RESPUESTA</span><strong>{loading ? '—' : totals.unansweredCount === null ? 'N/D' : totals.unansweredCount}</strong><small>{totals.unansweredCount === null ? 'No disponible en importación' : 'Pendientes de contestar'}</small></article>
    </section>

    {!!rows.length && <MaxDataInsights title="Desempeño de Google Reviews" subtitle="Volumen y calificación por restaurante para el periodo seleccionado." rows={rows.map(row => ({ location: row.location, primary: row.reviewCount, secondary: row.averageRating, status: !row.minimumMet ? 'bad' : (row.averageRating ?? 0) < 4.5 ? 'watch' : 'good' }))} primaryLabel="Reseñas nuevas" secondaryLabel="Calificación media" primaryFormat={value => value.toFixed(0)} secondaryFormat={value => `${value.toFixed(2)} ★`} conclusion={filtered => { if (!filtered.length) return ['No hay reseñas verificables para este filtro.']; const volume = [...filtered].sort((a, b) => b.primary - a.primary); const rating = [...filtered].filter(row => row.secondary !== null).sort((a, b) => (b.secondary ?? 0) - (a.secondary ?? 0)); const below = filtered.filter(row => row.primary < 5); return [`${volume[0].location} recibió el mayor volumen: ${volume[0].primary.toFixed(0)} reseñas.`, rating.length ? `${rating[0].location} obtuvo la calificación más alta: ${(rating[0].secondary ?? 0).toFixed(2)} ★.` : 'Aún no hay calificación media.', below.length ? `${below.map(row => row.location).join(', ')} no cumple${below.length === 1 ? '' : 'n'} el mínimo semanal de 5.` : 'Todas las locaciones cumplen el mínimo semanal.']; }} />}

    <section className="reviews-location-grid">
      {rows.map(row => {
        const points = googleReviewPoints(row.averageRating ?? undefined, row.reviewCount);
        return <article className="reviews-location-card" key={row.location}>
          <header><div><span>GOOGLE BUSINESS PROFILE</span><h2>{row.location}</h2><small>{row.googleTitle || row.location}</small></div><strong>{row.averageRating === null ? '—' : `${row.averageRating.toFixed(2)} ★`}</strong></header>
          {row.mappingError ? <p className="mapping-error">{row.mappingError}</p> : <>
            <div className="reviews-location-stats"><div><span>Reviews</span><strong>{row.reviewCount}</strong></div><div><span>5 estrellas</span><strong>{row.fiveStarCount}</strong></div><div><span>1–2 estrellas</span><strong>{row.lowRatingCount}</strong></div><div><span>Sin respuesta</span><strong>{row.unansweredCount ?? 'N/D'}</strong></div></div>
            <div className="reviews-bonus-progress"><div><span>Bono semanal · Google Reviews</span><strong>{points === undefined ? '0.0 / 5' : `${points.toFixed(1)} / 5`}</strong></div><div className="reviews-progress-track"><i style={{ width: `${Math.min(100, Math.max(0, (points ?? 0) / 5 * 100))}%` }} /></div><small className={row.minimumMet ? 'met' : 'below'}>{row.minimumMet ? '✓ Mínimo semanal cumplido' : `Faltan ${Math.max(0, 5 - row.reviewCount)} para cumplir el mínimo`}</small></div>
          </>}
        </article>;
      })}
    </section>

    <section className="reviews-feed panel">
      <div className="panel-header"><div><h2>Reseñas individuales</h2><p>Texto, calificación, fecha y estado de respuesta desde Google Business Profile.</p></div><span className="count-pill">{reviewFeed.length}</span></div>
      {loading && <div className="reviews-empty">Consultando reseñas reales…</div>}
      {!loading && !reviewFeed.length && <div className="reviews-empty">{payload?.source === 'Vista Social CSV' ? 'La importación contiene métricas agregadas; las reseñas individuales se muestran únicamente desde Google Business Profile.' : 'No hay reseñas nuevas en este periodo.'}</div>}
      {reviewFeed.map(review => <article className="review-row" key={`${review.location}-${review.id}`}><div className={`review-rating rating-${review.rating}`}><strong>{review.rating}.0</strong><span>{stars(review.rating)}</span></div><div className="review-copy"><div><strong>{review.reviewer}</strong><span>{review.location} · {formatDate(review.createTime)}</span></div><p>{review.comment || 'El cliente dejó una calificación sin comentario.'}</p></div><span className={review.answered ? 'review-status answered' : 'review-status pending'}>{review.answered ? 'Respondida' : 'Sin respuesta'}</span></article>)}
    </section>

    {canImportReviews && <section className="reviews-import panel"><div><strong>Importación de respaldo</strong><span>Disponible únicamente para Founder y Corporate si se necesita cargar un CSV histórico.</span></div><label className="primary">{importing ? 'Importando…' : 'Importar Reviews CSV'}<input type="file" accept=".csv,text/csv" disabled={importing} onChange={event => { void importReviews(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label></section>}
  </div>;
}
