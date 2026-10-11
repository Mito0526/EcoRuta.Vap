/* Aquí armo el mapa con Leaflet: la base, los marcadores de contenedores y las rutas.
   Lo usan dashboard.js y conductor.js a través de EcoRuta.MapView. Necesita Leaflet cargado antes. */
(function () {
  'use strict';

  const NS = (globalThis.EcoRuta = globalThis.EcoRuta || {});
  const { Config, Geo } = NS;

  // devuelve ok, mid, high o crit según el porcentaje
  function levelKey(level) {
    return Config.LEVEL_BANDS.find((b) => level >= b.min).key;
  }

  function levelColor(level) {
    return Config.LEVEL_BANDS.find((b) => level >= b.min).color;
  }

  // elementId es el div donde va el mapa; en options paso los callbacks onSelect y onCollect
  function create(elementId, options) {
    const opts = Object.assign({ showCollectButton: true, detailsHref: 'hardware.html' }, options);

    const map = L.map(elementId, { zoomControl: true, preferCanvas: false }).setView(
      Config.CITY.center,
      Config.CITY.zoom
    );

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    const markers = new Map(); // guarda el marcador y el contenedor de cada id
    const routeLayer = L.layerGroup().addTo(map);
    let depotMarker = null;
    let getLevel = () => 0;

    // los estilos del pin están en css/dashboard.css
    function pinHtml(level, seq, dimmed) {
      const key = levelKey(level);
      const badge = seq ? `<span class="pin__seq">${seq}</span>` : '';
      return (
        `<div class="pin pin--${key}${dimmed ? ' pin--dim' : ''}" style="--p:${level}">` +
        `<span class="pin__value">${level}</span>${badge}</div>`
      );
    }

    function makeIcon(level, seq, dimmed) {
      return L.divIcon({
        className: 'pin-wrap',
        html: pinHtml(level, seq, dimmed),
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        popupAnchor: [0, -18],
      });
    }

    function popupHtml(c) {
      const level = getLevel(c.id);
      const key = levelKey(level);
      const band = Config.LEVEL_BANDS.find((b) => b.key === key);
      const street = c.street ? `<p class="popup__street">${Geo.esc(c.street)}</p>` : '';
      const collect = opts.showCollectButton
        ? `<button type="button" class="btn btn--small popup__collect" data-collect="${Geo.esc(c.id)}">Marcar como recolectado</button>`
        : '';
      return (
        `<div class="popup">` +
        `<h3 class="popup__title">${Geo.esc(c.id)}</h3>` +
        `<p class="popup__sector">${Geo.esc(c.sector)}</p>${street}` +
        `<p class="popup__level"><span class="dot dot--${key}"></span> <strong>${level} %</strong> lleno` +
        ` <span class="popup__band">(${Geo.esc(band.label)})</span></p>` +
        `<p class="popup__meta">Batería ${c.battery} % · Señal ${c.rssi} dBm</p>` +
        `<div class="popup__actions">${collect}` +
        `<a class="btn btn--small btn--ghost" href="${opts.detailsHref}">Ver hardware</a></div>` +
        `</div>`
      );
    }

    // el botón del popup se crea cada vez que se abre, por eso escucho popupopen
    map.on('popupopen', (event) => {
      const node = event.popup.getElement();
      if (!node) return;
      const btn = node.querySelector('[data-collect]');
      if (btn && opts.onCollect) {
        btn.addEventListener('click', () => {
          opts.onCollect(btn.getAttribute('data-collect'));
          map.closePopup();
        });
      }
    });

    const view = {
      map,

      setDepot(depot) {
        if (depotMarker) depotMarker.remove();
        depotMarker = L.marker([depot.lat, depot.lng], {
          icon: L.divIcon({
            className: 'pin-wrap',
            html: '<div class="depot" title="Base de los camiones">B</div>',
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          }),
          keyboard: false,
          zIndexOffset: -200,
        })
          .addTo(map)
          .bindTooltip('Base de los camiones', { direction: 'top' });
      },

      // levelFn(id) me da el porcentaje actual de cada contenedor
      setContainers(list, levelFn) {
        getLevel = levelFn;
        markers.forEach((m) => m.marker.remove());
        markers.clear();
        list.forEach((c) => {
          const marker = L.marker([c.lat, c.lng], {
            icon: makeIcon(getLevel(c.id), 0, false),
            title: `${c.id} · ${c.sector}`,
            riseOnHover: true,
          }).addTo(map);
          marker.bindPopup(() => popupHtml(c), { minWidth: 210 });
          marker.on('click', () => opts.onSelect && opts.onSelect(c.id));
          markers.set(c.id, { marker, container: c });
        });
      },

      // seq es el número de visita en la ruta (0 si no está en ninguna) y dimmed lo atenúa
      refreshMarker(id, seq, dimmed) {
        const entry = markers.get(id);
        if (!entry) return;
        entry.marker.setIcon(makeIcon(getLevel(id), seq || 0, Boolean(dimmed)));
        entry.marker.setZIndexOffset(dimmed ? -100 : getLevel(id));
      },

      setVisible(id, visible) {
        const entry = markers.get(id);
        if (!entry) return;
        if (visible && !map.hasLayer(entry.marker)) entry.marker.addTo(map);
        if (!visible && map.hasLayer(entry.marker)) entry.marker.remove();
      },

      focus(id, zoom) {
        const entry = markers.get(id);
        if (!entry) return;
        map.flyTo(entry.marker.getLatLng(), Math.max(map.getZoom(), zoom || 16), { duration: 0.6 });
        entry.marker.openPopup();
      },

      drawRoutes(routes) {
        routeLayer.clearLayers();
        routes.forEach((route) => {
          const coords = [];
          route.legs.forEach((leg) => leg.coords.forEach((p) => coords.push(p)));
          if (coords.length < 2) return;
          // primero una línea blanca más gruesa y encima la de color, para que se vea el contorno
          L.polyline(coords, { color: '#ffffff', weight: 9, opacity: 0.95, lineJoin: 'round', lineCap: 'round' }).addTo(routeLayer);
          const line = L.polyline(coords, {
            color: route.color,
            weight: 5,
            opacity: 0.95,
            lineJoin: 'round',
            lineCap: 'round',
            dashArray: route.source === 'osrm' ? null : '2 9', // punteada cuando la ruta es solo estimada
          }).addTo(routeLayer);
          line.bindTooltip(`Camión ${route.truck} · ${route.distanceKm.toFixed(1)} km`, { sticky: true });
        });
      },

      clearRoutes() {
        routeLayer.clearLayers();
      },

      fitRoutes(routes) {
        const pts = [];
        routes.forEach((r) => r.legs.forEach((l) => l.coords.forEach((p) => pts.push(p))));
        if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
      },

      fitAll() {
        const pts = [];
        markers.forEach((m) => pts.push(m.marker.getLatLng()));
        if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
      },

      // el camión que se mueve en la vista del conductor
      createTruck(color) {
        const truck = L.marker(Config.CITY.center, {
          icon: L.divIcon({
            className: 'pin-wrap',
            html: `<div class="truck" style="--c:${color}" aria-label="Camión"></div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          keyboard: false,
          interactive: false,
          zIndexOffset: 1000,
        }).addTo(map);
        return {
          moveTo(lat, lng) {
            truck.setLatLng([lat, lng]);
          },
          remove() {
            truck.remove();
          },
        };
      },

      // lo llamo cuando el div del mapa cambia de tamaño
      invalidate() {
        map.invalidateSize();
      },
    };

    return view;
  }

  NS.MapView = { create, levelKey, levelColor };
})();
