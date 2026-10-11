/*
 * leaflet-stub.js: sustituto de Leaflet que usé solo para probar sin internet.
 * Pinta marcadores y rutas en un contenedor simple; no se carga en las páginas reales.
 */
(function () {
  'use strict';
  // recuadro aproximado de Valledupar para pasar lat/lng a píxeles
  const BOUNDS = { s: 10.43, n: 10.5, w: -73.285, e: -73.22 };

  function project(map, ll) {
    const r = map._el.getBoundingClientRect();
    const x = ((ll.lng - BOUNDS.w) / (BOUNDS.e - BOUNDS.w)) * r.width;
    const y = ((BOUNDS.n - ll.lat) / (BOUNDS.n - BOUNDS.s)) * r.height;
    return { x, y };
  }
  const toLL = (p) => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : p);

  class Layer {
    addTo(target) {
      this._map = target._map || target;
      if (target._group) target._layers.push(this);
      this._attach && this._attach();
      return this;
    }
    remove() {
      this._detach && this._detach();
      this._map = null;
      return this;
    }
    bindTooltip() { return this; }
    bindPopup(fn) { this._popup = fn; return this; }
    on(name, fn) { (this._h = this._h || {})[name] = fn; return this; }
  }

  class Marker extends Layer {
    constructor(ll, opts) {
      super();
      this._ll = toLL(ll);
      this._opts = opts || {};
      this._icon = this._opts.icon;
      this._z = 0;
    }
    _attach() {
      this._node = document.createElement('div');
      this._node.className = 'stub-marker';
      this._node.style.cssText = 'position:absolute;width:0;height:0';
      this._node.addEventListener('click', () => {
        this._h && this._h.click && this._h.click();
        this.openPopup();
      });
      this._map._el.appendChild(this._node);
      this._paint();
    }
    _detach() { this._node && this._node.remove(); this._node = null; }
    _paint() {
      if (!this._node) return;
      const p = project(this._map, this._ll);
      const size = (this._icon && this._icon.iconSize) || [30, 30];
      const anchor = (this._icon && this._icon.iconAnchor) || [15, 15];
      this._node.style.left = p.x - anchor[0] + 'px';
      this._node.style.top = p.y - anchor[1] + 'px';
      this._node.style.zIndex = String(500 + this._z);
      this._node.innerHTML = '<div class="' + ((this._icon && this._icon.className) || '') +
        '" style="width:' + size[0] + 'px;height:' + size[1] + 'px">' + ((this._icon && this._icon.html) || '') + '</div>';
    }
    setIcon(icon) { this._icon = icon; this._paint(); return this; }
    setZIndexOffset(z) { this._z = z; if (this._node) this._node.style.zIndex = String(500 + z); return this; }
    setLatLng(ll) { this._ll = toLL(ll); this._paint(); return this; }
    getLatLng() { return this._ll; }
    openPopup() {
      if (!this._map || !this._popup) return this;
      const box = this._map._el;
      box.querySelectorAll('.stub-popup').forEach((n) => n.remove());
      const pop = document.createElement('div');
      pop.className = 'stub-popup leaflet-popup-content';
      const p = project(this._map, this._ll);
      pop.style.cssText = 'position:absolute;z-index:900;background:#fff;padding:10px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);left:' + (p.x + 20) + 'px;top:' + (p.y - 80) + 'px';
      pop.innerHTML = this._popup();
      box.appendChild(pop);
      this._map._fire('popupopen', { popup: { getElement: () => pop } });
      return this;
    }
  }

  class Polyline extends Layer {
    constructor(coords, opts) { super(); this._coords = coords.map(toLL); this._opts = opts || {}; }
    _attach() {
      const m = this._map;
      if (!m._svg) {
        m._svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        m._svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:400');
        m._el.appendChild(m._svg);
      }
      this._path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = this._coords.map((c, i) => { const p = project(m, c); return (i ? 'L' : 'M') + p.x + ' ' + p.y; }).join(' ');
      this._path.setAttribute('d', d);
      this._path.setAttribute('fill', 'none');
      this._path.setAttribute('stroke', this._opts.color || '#00f');
      this._path.setAttribute('stroke-width', this._opts.weight || 3);
      if (this._opts.dashArray) this._path.setAttribute('stroke-dasharray', this._opts.dashArray);
      m._svg.appendChild(this._path);
    }
    _detach() { this._path && this._path.remove(); }
  }

  class Group {
    constructor() { this._group = true; this._layers = []; }
    addTo(map) { this._map = map; return this; }
    clearLayers() { this._layers.forEach((l) => l.remove()); this._layers = []; }
  }

  class MapStub {
    constructor(id) {
      this._el = document.getElementById(id);
      this._el.style.position = this._el.style.position || 'absolute';
      this._el.style.overflow = 'hidden';
      this._h = {};
      this._zoom = 13;
      this._map = this;
      this.calls = [];
    }
    setView(c, z) { this._zoom = z; return this; }
    on(name, fn) { (this._h[name] = this._h[name] || []).push(fn); return this; }
    _fire(name, ev) { (this._h[name] || []).forEach((fn) => fn(ev)); }
    flyTo() { this.calls.push('flyTo'); return this; }
    fitBounds() { this.calls.push('fitBounds'); return this; }
    getZoom() { return this._zoom; }
    closePopup() { this._el.querySelectorAll('.stub-popup').forEach((n) => n.remove()); }
    invalidateSize() {}
    hasLayer(l) { return Boolean(l._node || l._path); }
  }

  globalThis.L = {
    map: (id) => new MapStub(id),
    tileLayer: () => ({ addTo() { return this; } }),
    layerGroup: () => new Group(),
    marker: (ll, o) => new Marker(ll, o),
    polyline: (c, o) => new Polyline(c, o),
    divIcon: (o) => o,
    latLngBounds: (pts) => pts,
  };
})();
