import { useEffect, useMemo, useState } from 'react';
import './opsVistaDatePicker.css';

type Props = {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  minDate?: string;
  maxDate?: string;
  placeholder?: string;
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

const validIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const monthStart = (value: string) => {
  const date = dateFromIso(value);
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
};

const formatDate = (value: string) => validIsoDate(value) ? new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
}).format(new Date(`${value}T12:00:00Z`)) : 'Select date';

export default function OpsVistaDatePicker({
  value,
  onChange,
  ariaLabel = 'Select due date',
  minDate,
  maxDate,
  placeholder = 'Select date',
}: Props) {
  const today = useMemo(() => isoDate(new Date()), []);
  const normalizedValue = validIsoDate(value) ? value : '';
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(normalizedValue);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(normalizedValue || today));

  useEffect(() => {
    if (!open) return;
    setDraft(normalizedValue);
    setVisibleMonth(monthStart(normalizedValue || today));
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, normalizedValue, today]);

  const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1, 12);
  const gridStart = new Date(first);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
  const monthTitle = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(visibleMonth);

  const selectToday = () => {
    setDraft(today);
    setVisibleMonth(monthStart(today));
  };

  return <div className="ops-date-picker">
    <button
      type="button"
      className={`ops-date-trigger ${normalizedValue ? 'has-value' : ''}`}
      onClick={() => setOpen(true)}
      aria-haspopup="dialog"
      aria-expanded={open}
    >
      <span>{normalizedValue ? formatDate(normalizedValue) : placeholder}</span>
      <i aria-hidden="true">▣</i>
    </button>
    {open && <div className="ops-date-backdrop" onMouseDown={() => setOpen(false)}>
      <section
        className="ops-date-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onMouseDown={event => event.stopPropagation()}
      >
        <header className="ops-date-header">
          <div><span>OPSVISTA CALENDAR</span><h2>{ariaLabel}</h2><p>Choose the deadline for this operational action.</p></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close calendar">×</button>
        </header>
        <div className="ops-date-navigation">
          <button type="button" onClick={() => setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1, 12))} aria-label="Previous month">‹</button>
          <strong>{monthTitle}</strong>
          <button type="button" onClick={() => setVisibleMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1, 12))} aria-label="Next month">›</button>
        </div>
        <div className="ops-date-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="ops-date-days">{days.map(date => {
          const dateValue = isoDate(date);
          const outside = date.getMonth() !== visibleMonth.getMonth();
          const selected = dateValue === draft;
          const current = dateValue === today;
          const disabled = Boolean((minDate && dateValue < minDate) || (maxDate && dateValue > maxDate));
          return <button
            type="button"
            key={dateValue}
            className={`${outside ? 'outside' : ''} ${selected ? 'selected' : ''} ${current ? 'today' : ''}`}
            disabled={disabled}
            aria-pressed={selected}
            aria-label={formatDate(dateValue)}
            onClick={() => setDraft(dateValue)}
          >{date.getDate()}</button>;
        })}</div>
        <footer className="ops-date-footer">
          <div className="ops-date-selection"><span>SELECTED DATE</span><strong>{draft ? formatDate(draft) : 'No date selected'}</strong></div>
          <div className="ops-date-actions">
            <button type="button" className="quiet" onClick={selectToday}>Today</button>
            {normalizedValue && <button type="button" className="quiet" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>}
            <button type="button" className="apply" disabled={!draft} onClick={() => { onChange(draft); setOpen(false); }}>Apply date</button>
          </div>
        </footer>
      </section>
    </div>}
  </div>;
}
