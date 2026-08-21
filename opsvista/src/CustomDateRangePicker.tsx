import { useEffect, useMemo, useRef, useState } from 'react';
import './customDateRangePicker.css';

type DatePreset = { key: string; label: string; start: string; end: string };

type Props = {
  active: boolean;
  start: string;
  end: string;
  onApply: (start: string, end: string) => void;
  maxDate?: string;
  minDate?: string;
  maxRangeDays?: number;
  ariaLabel?: string;
};

const isoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const dateFromIso = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
};

const addDays = (value: string, amount: number) => {
  const date = dateFromIso(value);
  date.setDate(date.getDate() + amount);
  return isoDate(date);
};

const monthStart = (value: string, offset = 0) => {
  const date = dateFromIso(value);
  return new Date(date.getFullYear(), date.getMonth() + offset, 1, 12);
};

const formatDate = (value: string) => new Intl.DateTimeFormat('es-MX', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T12:00:00Z`)).replaceAll(' de ', ' ');

const operatingWeekStart = (value: string) => {
  const date = dateFromIso(value);
  return addDays(value, -((date.getDay() - 3 + 7) % 7));
};

function buildPresets(today: string): DatePreset[] {
  const weekStart = operatingWeekStart(today);
  const current = dateFromIso(today);
  const thisMonthStart = isoDate(new Date(current.getFullYear(), current.getMonth(), 1, 12));
  const previousMonthStart = isoDate(new Date(current.getFullYear(), current.getMonth() - 1, 1, 12));
  const previousMonthEnd = isoDate(new Date(current.getFullYear(), current.getMonth(), 0, 12));
  return [
    { key: 'today', label: 'Hoy', start: today, end: today },
    { key: 'yesterday', label: 'Ayer', start: addDays(today, -1), end: addDays(today, -1) },
    { key: 'this-week', label: 'Esta semana', start: weekStart, end: today },
    { key: 'prior-week', label: 'Semana anterior', start: addDays(weekStart, -7), end: addDays(weekStart, -1) },
    { key: 'last-7', label: 'Últimos 7 días', start: addDays(today, -6), end: today },
    { key: 'last-30', label: 'Últimos 30 días', start: addDays(today, -29), end: today },
    { key: 'this-month', label: 'Este mes', start: thisMonthStart, end: today },
    { key: 'prior-month', label: 'Mes anterior', start: previousMonthStart, end: previousMonthEnd },
  ];
}

function CalendarMonth({ month, start, end, minDate, maxDate, onSelect }: {
  month: Date;
  start: string;
  end: string;
  minDate?: string;
  maxDate?: string;
  onSelect: (date: string) => void;
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
  const title = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(month);
  return <section className="range-calendar-month">
    <h3>{title}</h3>
    <div className="range-calendar-weekdays">{['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'].map(day => <span key={day}>{day}</span>)}</div>
    <div className="range-calendar-days">{days.map(date => {
      const value = isoDate(date);
      const outside = date.getMonth() !== month.getMonth();
      const selected = value === start || value === end;
      const between = Boolean(start && end && value > start && value < end);
      const disabled = Boolean((minDate && value < minDate) || (maxDate && value > maxDate));
      return <button
        type="button"
        key={value}
        className={`${outside ? 'outside' : ''} ${selected ? 'selected' : ''} ${between ? 'between' : ''}`}
        disabled={disabled}
        aria-pressed={selected}
        aria-label={formatDate(value)}
        onClick={() => onSelect(value)}
      >{date.getDate()}</button>;
    })}</div>
  </section>;
}

export default function CustomDateRangePicker({
  active,
  start,
  end,
  onApply,
  maxDate,
  minDate,
  maxRangeDays = 31,
  ariaLabel = 'Seleccionar periodo personalizado',
}: Props) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(start || maxDate || isoDate(new Date())));
  const [error, setError] = useState('');
  const previousActive = useRef(active);
  const today = maxDate || isoDate(new Date());
  const presets = useMemo(() => buildPresets(today), [today]);
  const secondMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1, 12);

  useEffect(() => {
    if (active && !previousActive.current) setOpen(true);
    previousActive.current = active;
  }, [active]);

  useEffect(() => {
    if (!open) return;
    setDraftStart(start);
    setDraftEnd(end);
    setVisibleMonth(monthStart(start || maxDate || today));
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, start, end, maxDate, today]);

  const selectDay = (value: string) => {
    setError('');
    if (!draftStart || draftEnd || value < draftStart) {
      setDraftStart(value);
      setDraftEnd('');
      return;
    }
    setDraftEnd(value);
  };

  const apply = () => {
    if (!draftStart || !draftEnd || draftStart > draftEnd) {
      setError('Selecciona una fecha inicial y final válidas.');
      return;
    }
    const days = Math.floor((Date.parse(`${draftEnd}T00:00:00Z`) - Date.parse(`${draftStart}T00:00:00Z`)) / 86_400_000) + 1;
    if (days > maxRangeDays) {
      setError(`El rango puede incluir hasta ${maxRangeDays} días.`);
      return;
    }
    onApply(draftStart, draftEnd);
    setOpen(false);
  };

  if (!active) return null;
  return <>
    <button type="button" className="custom-range-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
      <span>CALENDARIO</span>
      <strong>{start && end ? `${formatDate(start)} → ${formatDate(end)}` : 'Seleccionar fechas'}</strong>
      <em>▣</em>
    </button>
    {open && <div className="range-calendar-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="range-calendar-dialog" role="dialog" aria-modal="true" aria-label={ariaLabel} onMouseDown={event => event.stopPropagation()}>
        <header className="range-calendar-mobile-head"><div><span>PERIODO PERSONALIZADO</span><strong>Selecciona una fecha o rango</strong></div><button type="button" onClick={() => setOpen(false)} aria-label="Cerrar calendario">×</button></header>
        <aside className="range-calendar-presets">
          <div><span>RANGOS RÁPIDOS</span><strong>Semana operativa miércoles–martes</strong></div>
          {presets.map(preset => <button type="button" key={preset.key} onClick={() => {
            setDraftStart(preset.start);
            setDraftEnd(preset.end);
            setVisibleMonth(monthStart(preset.start));
            setError('');
          }}>
            <strong>{preset.label}</strong><span>{formatDate(preset.start)} – {formatDate(preset.end)}</span>
          </button>)}
        </aside>
        <section className="range-calendar-workspace">
          <div className="range-calendar-navigation">
            <button type="button" onClick={() => setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1, 12))} aria-label="Mes anterior">‹</button>
            <strong>Selecciona una fecha o rango</strong>
            <button type="button" onClick={() => setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1, 12))} aria-label="Mes siguiente">›</button>
          </div>
          <div className="range-calendar-months">
            <CalendarMonth month={visibleMonth} start={draftStart} end={draftEnd} minDate={minDate} maxDate={maxDate} onSelect={selectDay} />
            <CalendarMonth month={secondMonth} start={draftStart} end={draftEnd} minDate={minDate} maxDate={maxDate} onSelect={selectDay} />
          </div>
          <div className="range-calendar-selection">
            <div><span>DESDE</span><strong>{draftStart ? formatDate(draftStart) : 'Seleccionar'}</strong></div>
            <i>→</i>
            <div><span>HASTA</span><strong>{draftEnd ? formatDate(draftEnd) : 'Seleccionar'}</strong></div>
          </div>
          {error && <p className="range-calendar-error">{error}</p>}
          <button type="button" className="range-calendar-apply" onClick={apply} disabled={!draftStart || !draftEnd}>Aplicar periodo</button>
        </section>
      </div>
    </div>}
  </>;
}
