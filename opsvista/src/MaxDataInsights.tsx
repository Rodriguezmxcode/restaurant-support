import { useMemo, useState } from 'react';
import './maxDataInsights.css';

export type MaxDataRow = {
  location: string;
  primary: number;
  secondary?: number | null;
  status?: 'good' | 'watch' | 'bad' | 'neutral';
};

type Props = {
  title: string;
  subtitle: string;
  rows: MaxDataRow[];
  primaryLabel: string;
  secondaryLabel?: string;
  primaryFormat?: (value: number) => string;
  secondaryFormat?: (value: number) => string;
  conclusion?: (rows: MaxDataRow[]) => string[];
};

const coordinates: Record<string, { lat: number; lon: number }> = {
  Stamford: { lat: 41.0534, lon: -73.5387 },
  Orange: { lat: 41.2784, lon: -73.0265 },
  Fairfield: { lat: 41.1408, lon: -73.2613 },
  Danbury: { lat: 41.3948, lon: -73.4540 },
  Avon: { lat: 41.8096, lon: -72.8307 },
  Southington: { lat: 41.5965, lon: -72.8776 },
};

const number = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
const defaultConclusions = (rows: MaxDataRow[], label: string, format: (value: number) => string) => {
  if (!rows.length) return ['No hay datos verificables para el alcance seleccionado.'];
  const ranked = [...rows].sort((a, b) => b.primary - a.primary);
  const average = rows.reduce((sum, row) => sum + row.primary, 0) / rows.length;
  const alerts = rows.filter(row => row.status === 'bad' || row.status === 'watch');
  return [
    `${ranked[0].location} lidera ${label.toLowerCase()} con ${format(ranked[0].primary)}.`,
    `El promedio del alcance es ${format(average)} entre ${rows.length} locaciones.`,
    alerts.length ? `${alerts.length} locación${alerts.length === 1 ? '' : 'es'} requiere${alerts.length === 1 ? '' : 'n'} atención.` : 'No hay alertas visibles en este indicador.',
  ];
};

export default function MaxDataInsights({ title, subtitle, rows, primaryLabel, secondaryLabel, primaryFormat = number, secondaryFormat = number, conclusion }: Props) {
  const [selected, setSelected] = useState('All locations');
  const available = useMemo(() => rows.filter(row => Number.isFinite(row.primary)), [rows]);
  const filtered = selected === 'All locations' ? available : available.filter(row => row.location === selected);
  const maxPrimary = Math.max(1, ...available.map(row => row.primary));
  const secondaryValues = available.map(row => row.secondary).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const secondaryMin = secondaryValues.length ? Math.min(...secondaryValues) : 0;
  const secondaryMax = secondaryValues.length ? Math.max(...secondaryValues) : 1;
  const insights = conclusion ? conclusion(filtered) : defaultConclusions(filtered, primaryLabel, primaryFormat);
  const choose = (location: string) => setSelected(current => current === location ? 'All locations' : location);

  return <section className="mmd-insights" aria-label={`${title} interactive dashboard`}>
    <header className="mmd-insights-head">
      <div><span>MAXMAXDATA · DECISION VIEW</span><h2>{title}</h2><p>{subtitle}</p></div>
      <div className="mmd-filter-chips" aria-label="Filtro cruzado de locación">
        <button className={selected === 'All locations' ? 'active' : ''} onClick={() => setSelected('All locations')}>Todas</button>
        {available.map(row => <button key={row.location} className={selected === row.location ? 'active' : ''} onClick={() => choose(row.location)}>{row.location}</button>)}
      </div>
    </header>

    <div className="mmd-visual-grid">
      <section className="mmd-visual-card">
        <div className="mmd-visual-title"><div><span>COMPARACIÓN</span><h3>{primaryLabel}</h3></div><small>Pulsa una barra para filtrar</small></div>
        <div className="mmd-bars" role="list">
          {available.map(row => <button key={row.location} role="listitem" className={`mmd-bar-row ${selected === row.location ? 'selected' : ''} ${selected !== 'All locations' && selected !== row.location ? 'muted' : ''}`} onClick={() => choose(row.location)} aria-label={`Filtrar ${row.location}: ${primaryFormat(row.primary)}`}>
            <span>{row.location}</span><i><b className={row.status || 'neutral'} style={{ width: `${Math.max(3, row.primary / maxPrimary * 100)}%` }} /></i><strong>{primaryFormat(row.primary)}</strong>
          </button>)}
        </div>
      </section>

      <section className="mmd-visual-card mmd-map-card">
        <div className="mmd-visual-title"><div><span>MAPA RELATIVO</span><h3>Connecticut · red de restaurantes</h3></div><small>Latitud / longitud reales</small></div>
        <div className="mmd-map" aria-label="Mapa interactivo de locaciones">
          <span className="mmd-map-axis north">N</span><span className="mmd-map-axis west">Oeste</span><span className="mmd-map-axis east">Este</span>
          {available.map(row => { const point = coordinates[row.location]; if (!point) return null; const x = (point.lon + 73.65) / 1.1 * 100; const y = (41.92 - point.lat) / 1.02 * 100; return <button key={row.location} className={`mmd-map-point ${row.status || 'neutral'} ${selected === row.location ? 'selected' : ''} ${selected !== 'All locations' && selected !== row.location ? 'muted' : ''}`} style={{ left: `${x}%`, top: `${y}%` }} onClick={() => choose(row.location)} aria-label={`Filtrar ${row.location}`}><i/><span>{row.location}</span></button>; })}
        </div>
      </section>

      {secondaryLabel && <section className="mmd-visual-card">
        <div className="mmd-visual-title"><div><span>DISTRIBUCIÓN</span><h3>{secondaryLabel}</h3></div><small>Escala común</small></div>
        <div className="mmd-dotplot">
          {available.map(row => { const value = row.secondary; const position = value == null ? 0 : secondaryMax === secondaryMin ? 50 : (value - secondaryMin) / (secondaryMax - secondaryMin) * 100; return <button key={row.location} className={selected === row.location ? 'selected' : ''} onClick={() => choose(row.location)}><span>{row.location}</span><i><b className={row.status || 'neutral'} style={{ left: `${position}%` }}/></i><strong>{value == null ? '—' : secondaryFormat(value)}</strong></button>; })}
        </div>
      </section>}

      <aside className="mmd-conclusions">
        <span>CONCLUSIONES DEL FILTRO</span><h3>{selected === 'All locations' ? 'Vista de red' : selected}</h3>
        <ol>{insights.map((insight, index) => <li key={`${insight}-${index}`}>{insight}</li>)}</ol>
        <small>Las conclusiones cambian al pulsar barras, puntos, mapa o tabla.</small>
      </aside>
    </div>

    <div className="mmd-table-wrap"><table className="mmd-table"><thead><tr><th>Locación</th><th>{primaryLabel}</th>{secondaryLabel && <th>{secondaryLabel}</th>}<th>Estado</th></tr></thead><tbody>{filtered.map(row => <tr key={row.location} onClick={() => choose(row.location)} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') choose(row.location); }}><td><button onClick={event => { event.stopPropagation(); choose(row.location); }}>{row.location}</button></td><td>{primaryFormat(row.primary)}</td>{secondaryLabel && <td>{row.secondary == null ? '—' : secondaryFormat(row.secondary)}</td>}<td><span className={`mmd-status ${row.status || 'neutral'}`}>{row.status === 'bad' ? 'Acción' : row.status === 'watch' ? 'Vigilar' : row.status === 'good' ? 'Saludable' : 'Informativo'}</span></td></tr>)}</tbody></table></div>
  </section>;
}
