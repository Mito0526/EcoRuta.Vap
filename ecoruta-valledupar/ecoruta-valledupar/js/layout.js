/* Encabezado, pie de página y avisos que comparten todas las páginas, para definir el menú en un solo lugar.
   Cada HTML dice cuál es con data-page en el body, y data-footer="true" si quiere pie.
   Se insertan donde estén #site-header y #site-footer. */
(function () {
  'use strict';

  const NS = (globalThis.EcoRuta = globalThis.EcoRuta || {});
  const { Config, Geo } = NS;

  // el menú se genera a partir de esta lista
  const PAGES = [
    { id: 'home', href: 'index.html', label: 'Inicio' },
    { id: 'dashboard', href: 'dashboard.html', label: 'Mapa y rutas' },
    { id: 'hardware', href: 'hardware.html', label: 'Hardware 3D' },
    { id: 'conductor', href: 'conductor.html', label: 'Conductor' },
    { id: 'docs', href: 'proyecto.html', label: 'Proyecto' },
  ];

  const BRAND_ICON =
    '<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">' +
    '<rect x="4" y="5" width="18" height="18" rx="3" fill="#fff"/>' +
    '<rect x="4" y="13" width="18" height="10" rx="3" fill="#2f9e6e"/>' +
    '<rect x="2" y="2.5" width="22" height="4.5" rx="2" fill="#2457e6"/></svg>';

  function renderHeader() {
    const host = document.getElementById('site-header');
    if (!host) return;
    const current = document.body.dataset.page;
    const links = PAGES.map(
      (p) => `<a href="${p.href}"${p.id === current ? ' aria-current="page"' : ''}>${p.label}</a>`
    ).join('');
    host.outerHTML =
      `<header class="site-header">` +
      `<a class="brand" href="index.html">${BRAND_ICON}<span>EcoRuta<small>Valledupar</small></span></a>` +
      `<nav class="site-nav" aria-label="Principal">${links}</nav>` +
      `<span class="demo-flag">Datos de demostración</span></header>`;
  }

  function renderFooter() {
    const host = document.getElementById('site-footer');
    if (!host) return;
    const p = Config.PROJECT;
    host.outerHTML =
      `<footer class="site-footer"><div class="site-footer__inner">` +
      `<strong>${Geo.esc(p.name)}</strong>` +
      `<span>${Geo.esc(p.course)} · ${Geo.esc(p.university)}</span>` +
      `<span>${Geo.esc(p.phase)} · ${Geo.esc(p.group)}</span>` +
      `<span>Autoría: ${p.authors.map(Geo.esc).join(', ')}</span>` +
      `<span>Las ubicaciones y los niveles de llenado son simulados; no representan contenedores reales.</span>` +
      `</div></footer>`;
  }

  // muestra un aviso corto abajo en la pantalla
  function toast(message, ms) {
    let area = document.getElementById('toast-area');
    if (!area) {
      area = document.createElement('div');
      area.id = 'toast-area';
      area.className = 'toast-area';
      area.setAttribute('role', 'status');
      area.setAttribute('aria-live', 'polite');
      document.body.appendChild(area);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    area.appendChild(el);
    setTimeout(() => el.remove(), ms || 3200);
  }

  document.addEventListener('DOMContentLoaded', () => {
    renderHeader();
    if (document.body.dataset.footer === 'true') renderFooter();
  });

  NS.Layout = { PAGES, toast };
})();
