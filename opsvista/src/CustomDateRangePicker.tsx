import { useEffect, useMemo, useRef, useState } from 'react';
import './customDateRangePicker.css';
import { useI18n } from './i18n';

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

const formatDateFor = (value: string, locale:string) => new Intl.DateTimeFormat(locale, {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(`${value}T12:00:00Z`)).replaceAll(' de ', ' ');

const operatingWeekStart = (value: string) => {
  const date = dateFromIso(value);
  return addDays(value, -((date.getDay() - 3 + 7) % 7));
};

function buildPresets(today: string, language:'en'|'es'): DatePreset[] {
  const weekStart = operatingWeekStart(today);
  const current = dateFromIso(today);
  const thisMonthStart = isoDate(new Date(current.getFullYear(), current.getMonth(), 1, 12));
  const previousMonthStart = isoDate(new Date(current.getFullYear(), current.getMonth() - 1, 1, 12));
  const previousMonthEnd = isoDate(new Date(current.getFullYear(), current.getMonth(), 0, 12));
  return [
    { key: 'today', label: language==='es'?'Hoy':'Today', start: today, end: today },
    { key: 'yesterday', label: language==='es'?'Ayer':'Yesterday', start: addDays(today, -1), end: addDays(today, -1) },
    { key: 'this-week', label: language==='es'?'Esta semana':'This week', start: weekStart, end: today },
    { key: 'prior-week', label: language==='es'?'Semana anterior':'Previous week', start: addDays(weekStart, -7), end: addDays(weekStart, -1) },
    { key: 'last-7', label: language==='es'?'Últimos 7 días':'Last 7 days', start: addDays(today, -6), end: today },
    { key: 'last-30', label: language==='es'?'Últimos 30 días':'Last 30 days', start: addDays(today, -29), end: today },
    { key: 'this-month', label: language==='es'?'Este mes':'This month', start: thisMonthStart, end: today },
    { key: 'prior-month', label: language==='es'?'Mes anterior':'Previous month', start: previousMonthStart, end: previousMonthEnd },
  ];
}

function CalendarMonth({ month, start, end, minDate, maxDate, onSelect, language }: {
  month: Date;
  start: string;
  end: string;
  minDate?: string;
  maxDate?: string;
  onSelect: (date: string) => void;
  language:'en'|'es';
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
  const locale=language==='es'?'es-MX':'en-US';const title = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(month);
  return <section className="range-calendar-month">
    <h3>{title}</h3>
    <div className="range-calendar-weekdays">{(language==='es'?['Do','Lu','Ma','Mi','Ju','Vi','Sá']:['Su','Mo','Tu','We','Th','Fr','Sa']).map(day => <span key={day}>{day}</span>)}</div>
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
        aria-label={formatDateFor(value,locale)}
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
  const {language,t,locale}=useI18n();
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(start || maxDate || isoDate(new Date())));
  const [error, setError] = useState('');
  const previousActive = useRef(active);
  const today = maxDate || isoDate(new Date());
  const presets = useMemo(() => buildPresets(today,language), [today,language]);
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
      setError(t('Select a valid start and end date.','Selecciona una fecha inicial y final válidas.'));
      return;
    }
    const days = Math.floor((Date.parse(`${draftEnd}T00:00:00Z`) - Date.parse(`${draftStart}T00:00:00Z`)) / 86_400_000) + 1;
    if (days > maxRangeDays) {
      setError(t(`The range can include up to ${maxRangeDays} days.`,`El rango puede incluir hasta ${maxRangeDays} días.`));
      return;
    }
    onApply(draftStart, draftEnd);
    setOpen(false);
  };

  if (!active) return null;
  return <>
    <button type="button" className="custom-range-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
      <span>{t('CALENDAR','CALENDARIO')}</span>
      <strong>{start && end ? `${formatDateFor(start,locale)} → ${formatDateFor(end,locale)}`  : t('Select dates','Seleccionar fechas')}</strong>
      <em>▣</em>
    </button>
    {open && <div className="range-calendar-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="range-calendar-dialog" role="dialog" aria-modal="true" aria-label={ariaLabel} onMouseDown={event => event.stopPropagation()}>
        <header className="range-calendar-mobile-head"><div><span>{t('CUSTOM PERIOD','PERIODO PERSONALIZADO')}</span><strong>{t('Select a date or range','Selecciona una fecha o rango')}</strong></div><button type="button" onClick={() => setOpen(false)} aria-label={t('Close calendar','Cerrar calendario')}>×</button></header>
        <aside className="range-calendar-presets">
          <div><span>{t('QUICK RANGES','RANGOS RÁPIDOS')}</span><strong>{t('Operating week Wednesday–Tuesday','Semana operativa miércoles–martes')}</strong></div>
          {presets.map(preset => <button type="button" key={preset.key} onClick={() => {
            setDraftStart(preset.start);
            setDraftEnd(preset.end);
            setVisibleMonth(monthStart(preset.start));
            setError('');
          }}>
            <strong>{preset.label}</strong><span>{formatDateFor(preset.start,locale)} – {formatDateFor(preset.end,locale)}</span>
          </button>)}
        </aside>
        <section className="range-calendar-workspace">
          <div className="range-calendar-navigation">
            <button type="button" onClick={() => setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1, 12))} aria-label={t('Previous month','Mes anterior')}>‹</button>
            <strong>{t('Select a date or range','Selecciona una fecha o rango')}</strong>
            <button type="button" onClick={() => setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1, 12))} aria-label={t('Next month','Mes siguiente')}>›</button>
          </div>
          <div className="range-calendar-months">
            <CalendarMonth month={visibleMonth} start={draftStart} end={draftEnd} minDate={minDate} maxDate={maxDate} onSelect={selectDay} language={language} />
            <CalendarMonth month={secondMonth} start={draftStart} end={draftEnd} minDate={minDate} maxDate={maxDate} onSelect={selectDay} language={language} />
          </div>
          <div className="range-calendar-selection">
            <div><span>{t('FROM','DESDE')}</span><strong>{draftStart ? formatDateFor(draftStart,locale) : t('Select','Seleccionar')}</strong></div>
            <i>→</i>
            <div><span>{t('TO','HASTA')}</span><strong>{draftEnd ? formatDateFor(draftEnd,locale) : t('Select','Seleccionar')}</strong></div>
          </div>
          {error && <p className="range-calendar-error">{error}</p>}
          <button type="button" className="range-calendar-apply" onClick={apply} disabled={!draftStart || !draftEnd}>{t('Apply period','Aplicar periodo')}</button>
        </section>
      </div>
    </div>}
  </>;
}
