/* Lógica de la página Mapa y rutas. Creo los contenedores simulados, dibujo el mapa y consulto OSRM
   en segundo plano para ajustar los contenedores a la calle. Todos los cambios del Store pasan por onStoreChange. */
(function () {
  'use strict';

  const { Config, Geo, Data, Store, Routing, Layout, MapView } = globalThis.EcoRuta;

  const $ = (id) => document.getElementById(id);

  let containers = [];
  let byId = new Map();
  let view = null;
  let networkPromise = null;
  let depot = Config.DEPOT; // si OSRM responde, lo ajusto a la vía
  let planToken = 0; // me sirve para descartar cálculos viejos
  let planTimer = null;
  let simTimer = null;
  let openRoutesTab = false; // al activar solo críticos, la primera ruta abre la pestaña Rutas

  function criticalList() {
    return containers.filter((c) => Store.level(c.id) >= Store.threshold);
  }

  function isShown(c) {
    return !Store.onlyCritical || Store.level(c.id) >= Store.threshold;
  }

  // para cada id guardo el camión y el número de visita en la ruta
  function sequenceMap() {
    const map = new Map();
    const plan = Store.plan;
    if (!plan || !Store.onlyCritical) return map;
    plan.routes.forEach((route) => {
      route.stops.forEach((id, i) => {
        if (!plan.done || !plan.done[id]) map.set(id, { truck: route.truck, seq: i + 1 });
      });
    });
    return map;
  }

  function renderMarkers() {
    const seqs = sequenceMap();
    containers.forEach((c) => {
      const shown = isShown(c);
      view.setVisible(c.id, shown);
      if (!shown) return;
      const s = seqs.get(c.id);
      view.refreshMarker(c.id, s ? s.seq : 0, false);
    });
  }

  function renderKpis() {
    const crit = criticalList().length;
    const avg = containers.reduce((sum, c) => sum + Store.level(c.id), 0) / (containers.length || 1);
    $('kpi-total').textContent = containers.length;
    $('kpi-crit').textContent = crit;
    $('kpi-avg').textContent = `${Math.round(avg)} %`;
    const plan = Store.plan;
    $('kpi-save').textContent =
      plan && Store.onlyCritical ? Geo.fmtKm(plan.savings.savedKm) : '–';
  }

  function renderControls() {
    $('threshold').value = Store.threshold;
    $('threshold-out').textContent = `${Store.threshold} %`;
    document.querySelectorAll('.chip').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(Number(chip.dataset.threshold) === Store.threshold));
    });
    $('only-critical').checked = Store.onlyCritical;
    $('trucks').value = String(Store.trucks);
  }

  // lista lateral ordenada de más a menos lleno, con búsqueda por nombre o barrio
  function renderList() {
    const q = $('search').value.trim().toLowerCase();
    const rows = containers
      .filter((c) => isShown(c))
      .filter((c) => !q || `${c.id} ${c.sector}`.toLowerCase().includes(q))
      .sort((a, b) => Store.level(b.id) - Store.level(a.id));

    const list = $('container-list');
    if (!rows.length) {
      list.innerHTML = '<li class="clist__none">Ningún contenedor coincide con el filtro.</li>';
      return;
    }
    list.innerHTML = rows
      .map((c) => {
        const level = Store.level(c.id);
        const key = MapView.levelKey(level);
        return (
          `<li><button type="button" class="crow" data-id="${Geo.esc(c.id)}">` +
          `<span class="dot dot--${key}"></span>` +
          `<span><span class="crow__name">${Geo.esc(c.id)}</span>` +
          `<span class="crow__sector">${Geo.esc(c.sector)}</span></span>` +
          `<span class="crow__bar"><i style="width:${level}%;--bar:${MapView.levelColor(level)}"></i></span>` +
          `<span class="crow__pct">${level} %</span></button></li>`
        );
      })
      .join('');
  }

  function renderRoutes() {
    const plan = Store.plan;
    const show = Boolean(plan && Store.onlyCritical && plan.routes.length);
    $('routes-empty').hidden = show;
    $('savings').hidden = !show;
    const cards = $('route-cards');

    if (!show) {
      cards.innerHTML = '';
      view.clearRoutes();
      renderBadge();
      return;
    }

    cards.innerHTML = plan.routes
      .map((r) => {
        const pending = r.stops.filter((id) => !(plan.done && plan.done[id]));
        const names = r.stops.map((id) => Geo.esc(id)).join(' → ');
        return (
          `<article class="rcard" style="--c:${r.color}">` +
          `<h3>Camión ${r.truck}</h3>` +
          `<p class="rcard__stats"><span><strong>${r.stops.length}</strong> paradas</span>` +
          `<span><strong>${Geo.fmtKm(r.distanceKm)}</strong></span>` +
          `<span><strong>${Geo.fmtMin(r.totalMin)}</strong> con recolección</span>` +
          `<span>${pending.length} por recolectar</span></p>` +
          `<p class="rcard__stops">Base → ${names} → Base</p>` +
          `<div class="rcard__actions">` +
          `<button type="button" class="btn btn--small btn--ghost" data-fit="${r.truck}">Ver en el mapa</button>` +
          `<a class="btn btn--small" href="conductor.html?truck=${r.truck}">Vista del conductor</a>` +
          `</div></article>`
        );
      })
      .join('');

    const s = plan.savings;
    const fmt = (n, d) => n.toLocaleString('es-CO', { maximumFractionDigits: d });
    $('savings').innerHTML =
      `<h3>Ahorro frente a recoger todo</h3>` +
      `<dl>` +
      `<dt>Un camión por los ${s.baselineStops} contenedores</dt><dd>${Geo.fmtKm(s.baselineKm)}</dd>` +
      `<dt>Ruta con ${s.optStops} críticos</dt><dd>${Geo.fmtKm(s.optKm)}</dd>` +
      `<dt>Distancia ahorrada</dt><dd>${Geo.fmtKm(s.savedKm)} (${fmt(s.savedPct, 0)} %)</dd>` +
      `<dt>Tiempo ahorrado</dt><dd>${Geo.fmtMin(s.savedMin)}</dd>` +
      (plan.routes.length > 1
        ? `<dt>Jornada del camión más largo</dt><dd>${Geo.fmtMin(Math.max(...plan.routes.map((r) => r.totalMin)))}</dd>`
        : '') +
      `<dt>Combustible estimado</dt><dd>${fmt(s.savedLiters, 1)} L</dd>` +
      `<dt>CO₂ evitado</dt><dd>${fmt(s.savedKgCo2, 1)} kg</dd>` +
      `</dl>` +
      (plan.routes.length > 1 && s.savedKm < 0.5
        ? `<p class="savings__note">Con varios camiones el recorrido total puede igualar o superar al de un solo camión; lo que baja es el tiempo que trabaja cada uno.</p>`
        : '') +
      `<p class="savings__note">Estimación con ${Config.ESTIMATES.litersPerKm} L/km y ` +
      `${Config.ESTIMATES.kgCo2PerLiter} kg de CO₂ por litro; los valores se pueden cambiar en js/config.js.</p>`;

    view.drawRoutes(plan.routes);
    renderBadge();
  }

  function renderBadge(busy) {
    const badge = $('routing-badge');
    badge.className = 'badge';
    if (busy) {
      badge.textContent = 'Calculando ruta…';
      return;
    }
    if (!networkPromise || !badge.dataset.mode) {
      badge.textContent = 'Preparando calles…';
      return;
    }
    if (badge.dataset.mode === 'osrm') {
      badge.classList.add('badge--ok');
      badge.textContent = 'Rutas por calles reales';
    } else {
      badge.classList.add('badge--warn');
      badge.textContent = 'Rutas estimadas (sin servicio de calles)';
      badge.title = 'No se pudo consultar OSRM. Las distancias se estiman en línea recta con un factor de desvío.';
    }
  }

  function renderAll() {
    renderControls();
    renderMarkers();
    renderKpis();
    renderList();
  }

  // revisa si la ruta guardada ya cubre los críticos actuales, sin contar los recolectados
  function planIsCurrent() {
    const plan = Store.plan;
    if (!plan) return false;
    const done = plan.done || {};
    const wanted = criticalList()
      .map((c) => c.id)
      .filter((id) => !done[id])
      .sort()
      .join(',');
    const planned = plan.routes
      .flatMap((r) => r.stops)
      .filter((id) => !done[id])
      .sort()
      .join(',');
    const expectedTrucks = Math.max(1, Math.min(Store.trucks, criticalList().length));
    return wanted === planned && plan.routes.length === expectedTrucks;
  }

  function schedulePlan() {
    clearTimeout(planTimer);
    planTimer = setTimeout(computePlan, 300); // espero un poco para juntar cambios seguidos, como el slider
  }

  async function computePlan() {
    if (!Store.onlyCritical) {
      if (Store.plan) Store.setPlan(null);
      return;
    }
    const criticals = criticalList();
    if (!criticals.length) {
      if (Store.plan) Store.setPlan(null);
      return;
    }
    if (planIsCurrent()) return;

    const token = ++planToken;
    renderBadge(true);
    try {
      const network = await networkPromise;
      const result = await Routing.plan(
        criticals.map((c) => ({ id: c.id, lat: c.lat, lng: c.lng })),
        Store.trucks,
        network,
        depot
      );
      if (token !== planToken) return; // ya hay una petición más nueva
      Store.setPlan(result);
      view.fitRoutes(result.routes);
      if (openRoutesTab) {
        openRoutesTab = false;
        selectTab('routes');
      }
    } catch (err) {
      console.error('No se pudo calcular la ruta', err);
      Layout.toast('No se pudo calcular la ruta. Intente de nuevo.');
      renderBadge();
    }
  }

  function onStoreChange(info) {
    if (info.what === 'plan') {
      renderMarkers();
      renderKpis();
      renderRoutes();
      return;
    }
    renderAll();
    renderRoutes();
    schedulePlan();
  }

  function collect(id) {
    const plan = Store.plan;
    // marco primero en la ruta para que el cambio de nivel no dispare otro cálculo
    if (plan && plan.routes.some((r) => r.stops.includes(id))) Store.markDone(id);
    Store.collect(id);
    Layout.toast(`${id} marcado como recolectado.`);
  }

  function selectFromList(id) {
    view.focus(id);
    if (window.innerWidth <= 900) $('map').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function simulationTick() {
    const changes = {};
    const crossed = [];
    containers.forEach((c) => {
      const current = Store.level(c.id);
      if (current >= 100) return;
      const step = Math.random() * Config.SIM.maxStep * c.fillRate;
      const next = Math.min(100, current + step);
      changes[c.id] = next;
      if (current < Store.threshold && Math.round(next) >= Store.threshold) crossed.push(c.id);
    });
    Store.setLevels(changes);
    if (crossed.length) {
      Layout.toast(
        crossed.length === 1
          ? `${crossed[0]} superó el ${Store.threshold} %.`
          : `${crossed.length} contenedores superaron el ${Store.threshold} %.`
      );
    }
  }

  function toggleSimulation() {
    const btn = $('btn-sim');
    if (simTimer) {
      clearInterval(simTimer);
      simTimer = null;
    } else {
      simTimer = setInterval(simulationTick, Config.SIM.tickMs);
    }
    btn.setAttribute('aria-pressed', String(Boolean(simTimer)));
    btn.classList.toggle('btn--active', Boolean(simTimer));
    btn.textContent = simTimer ? 'Detener simulación' : 'Simular sensores';
  }

  function bindControls() {
    $('threshold').addEventListener('input', (e) => Store.setThreshold(Number(e.target.value)));
    document.querySelectorAll('.chip').forEach((chip) =>
      chip.addEventListener('click', () => Store.setThreshold(Number(chip.dataset.threshold)))
    );
    $('only-critical').addEventListener('change', (e) => {
      openRoutesTab = e.target.checked;
      Store.setOnlyCritical(e.target.checked);
    });
    $('trucks').addEventListener('change', (e) => Store.setTrucks(Number(e.target.value)));
    $('btn-sim').addEventListener('click', toggleSimulation);
    $('btn-reset').addEventListener('click', () => {
      Store.reset();
      Layout.toast('Datos reiniciados.');
    });
    $('search').addEventListener('input', renderList);

    // un solo listener para todas las filas de la lista
    $('container-list').addEventListener('click', (e) => {
      const row = e.target.closest('[data-id]');
      if (row) selectFromList(row.dataset.id);
    });

    // botón Ver en el mapa de las tarjetas de ruta
    $('route-cards').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-fit]');
      if (!btn || !Store.plan) return;
      const route = Store.plan.routes.find((r) => r.truck === Number(btn.dataset.fit));
      if (route) view.fitRoutes([route]);
    });

    $('tab-list').addEventListener('click', () => selectTab('list'));
    $('tab-routes').addEventListener('click', () => selectTab('routes'));
  }

  function selectTab(name) {
    ['list', 'routes'].forEach((other) => {
      const active = other === name;
      $('tab-' + other).setAttribute('aria-selected', String(active));
      $('view-' + other).hidden = !active;
    });
  }

  // consulta la red y ajusta cada contenedor a la calle más cercana
  function loadNetwork() {
    networkPromise = Routing.initNetwork(containers, Config.DEPOT).then((network) => {
      if (network.depot) depot = { ...Config.DEPOT, lat: network.depot.lat, lng: network.depot.lng };
      network.snapped.forEach((s, id) => {
        const c = byId.get(id);
        if (!c) return;
        c.lat = s.lat;
        c.lng = s.lng;
        c.street = s.street;
        c.snapped = true;
      });
      // vuelvo a crear los marcadores con las posiciones ya ajustadas
      view.setDepot(depot);
      view.setContainers(containers, Store.level);
      renderMarkers();
      $('routing-badge').dataset.mode = network.mode;
      renderBadge();
      if (network.mode === 'estimada') {
        Layout.toast('No se pudo consultar el servicio de calles; las rutas serán estimadas.', 5000);
      }
      return network;
    });
    return networkPromise;
  }

  document.addEventListener('DOMContentLoaded', () => {
    containers = Data.createContainers();
    byId = new Map(containers.map((c) => [c.id, c]));
    Store.init(containers);

    view = MapView.create('map', { onCollect: collect });
    view.setDepot(depot);
    view.setContainers(containers, Store.level);
    view.fitAll();

    bindControls();
    renderAll();
    renderRoutes();
    Store.subscribe(onStoreChange);

    loadNetwork().then(() => {
      // si abrí la página con solo críticos activo, calculo la ruta
      if (Store.onlyCritical) schedulePlan();
    });
  });
})();
