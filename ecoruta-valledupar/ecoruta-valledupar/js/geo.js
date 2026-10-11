/* Funciones de distancia y de formato que uso en varios archivos, sin dependencias.
   Un punto suelto es {lat, lng} y una línea es un arreglo de [lat, lng] (como Leaflet).
   OSRM entrega [lng, lat], eso lo convierto en routing.js. */
(function () {
  'use strict';

  const NS = (globalThis.EcoRuta = globalThis.EcoRuta || {});

  const EARTH_RADIUS_M = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;

  // distancia en metros entre dos puntos con la fórmula de haversine
  function haversine(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
  }

  // mueve un punto east metros al este y north metros al norte
  function offsetMeters(origin, east, north) {
    const lat = origin.lat + north / 111320;
    const lng = origin.lng + east / (111320 * Math.cos(toRad(origin.lat)));
    return { lat, lng };
  }

  // longitud total en metros de una línea
  function pathLength(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      total += haversine(
        { lat: coords[i - 1][0], lng: coords[i - 1][1] },
        { lat: coords[i][0], lng: coords[i][1] }
      );
    }
    return total;
  }

  // punto que queda a esos metros desde el inicio de la línea; lo uso para mover el camión del modo conductor
  function pointAlong(coords, meters) {
    if (!coords.length) return null;
    if (coords.length === 1 || meters <= 0) return { lat: coords[0][0], lng: coords[0][1] };
    let remaining = meters;
    for (let i = 1; i < coords.length; i++) {
      const a = { lat: coords[i - 1][0], lng: coords[i - 1][1] };
      const b = { lat: coords[i][0], lng: coords[i][1] };
      const seg = haversine(a, b);
      if (remaining <= seg && seg > 0) {
        const t = remaining / seg;
        return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
      }
      remaining -= seg;
    }
    const last = coords[coords.length - 1];
    return { lat: last[0], lng: last[1] };
  }

  // metros a texto corto, por ejemplo "240 m" o "1,3 km"
  function fmtDistance(m) {
    if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
    return `${(m / 1000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} km`;
  }

  // kilómetros a texto, por ejemplo "12,4 km"
  function fmtKm(km) {
    return `${km.toLocaleString('es-CO', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
  }

  // minutos a texto, por ejemplo "42 min" o "1 h 12 min"
  function fmtMin(min) {
    const m = Math.round(min);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }

  // limpio texto que viene de afuera (como los nombres de calles de OSRM) antes de meterlo en HTML
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  NS.Geo = { haversine, offsetMeters, pathLength, pointAlong, fmtDistance, fmtKm, fmtMin, esc };
})();
