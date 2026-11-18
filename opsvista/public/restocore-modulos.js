const rail = document.querySelector('.module-rail');
const toggle = document.getElementById('rail-toggle');
let compact = window.matchMedia('(max-width: 760px)').matches;
try { compact = JSON.parse(localStorage.getItem('restocore-compact') ?? JSON.stringify(compact)); } catch {}
function paintRail() {
  document.body.classList.toggle('compact-rail', compact);
  toggle.setAttribute('aria-expanded', String(!compact));
  toggle.setAttribute('aria-label', compact ? 'Expandir módulos' : 'Contraer módulos');
}
toggle.onclick = () => {
  compact = !compact;
  paintRail();
  try { localStorage.setItem('restocore-compact', JSON.stringify(compact)); } catch {}
};
function selectModule() {
  const archive = location.pathname.endsWith('restocore-datos.html');
  const key = archive ? 'datos' : location.hash.slice(1) || 'invoices';
  const button = Array.from(document.querySelectorAll('[data-rc-view]')).find(b => b.dataset.rcView === key);
  if (button) button.click();
  for (const link of rail.querySelectorAll('a')) {
    if (link.dataset.module === key) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  }
}
paintRail();
selectModule();
window.addEventListener('hashchange', selectModule);
