// Dates cross the API boundary as ISO; presentation always follows US month/day/year.
export function validISODate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function formatUSDate(value) {
  if (!validISODate(value)) return 'No disponible';
  return `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`;
}
export function validatePeriod(start, end) {
  if (!validISODate(start) || !validISODate(end) || start > end || Date.parse(end) - Date.parse(start) >= 31 * 86400000) throw new Error('Selecciona un período de hasta 31 días.');
}
