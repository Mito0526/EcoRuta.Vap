/* Vista del conductor: lee la ruta que guardó el panel en el Store y la recorre parada por parada.
   Una ruta con N paradas tiene N+1 tramos: base a la parada 1, entre paradas, y la última de vuelta a la base.
   El panel y esta página se comunican por el Store (localStorage). */
(function () {
  'use strict';

  const { Config, Geo, Data, Store, Routing, Layout, MapView } = globalThis.EcoRuta;

  const $ = (id) => document.getElementById(id);

  // la demo va acelerada: velocidad mínima en m/s y máximo de segundos por tramo
  const DEMO_SPEED_MPS = 45;
  const DEMO_MAX_LEG_SECONDS = 8;

  let byId = new Map();
  let view = null;
  let truck = null;
  let route = null; // ruta del camión elegido
  let legIndex = -1; // tramo actual
  let legLength = 0; // metros del tramo actual
  let traveled = 0; // metros recorridos en el tramo actual
  let rafId = 0;
  let lastFrame = 0;
  let arrivedNotified = false;

  function requestedTruck() {
    const n = Number(new URLSearchParams(location.search).get('truck'));
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function isDone(id) {
    const plan = Store.plan;
    return Boolean(plan && plan.done && plan.done[id]);
  }

  // si ya están todas recolectadas devuelve stops.length
  function nextStopIndex() {
    const i = route.stops.findIndex((id) => !isDone(id));
    return i === -1 ? route.stops.length : i;
  }

  function stopPosition(i) {
    const coords = route.legs[i].coords;
    return coords[coords.length - 1];
  }

  // tomo el último paso del tramo que tenga nombre de calle
  function stopStreet(i) {
    const steps = route.legs[i].steps;
    for (let k = steps.length - 1; k >= 0; k--) if (steps[k].n) return steps[k].n;
    return '';
  }

  function renderEmpty(isEmpty) {
    $('empty').hidden = !isEmpty;
    $('driver').hidden = isEmpty;
  }

  function renderTruckSelect(plan) {
    const select = $('truck-select');
    select.innerHTML = plan.routes
      .map((r) => `<option value="${r.truck}">Camión ${r.truck}</option>`)
      .join('');
    select.value = String(route.truck);
  }

  function renderProgress() {
    const total = route.stops.length;
    const done = route.stops.filter(isDone).length;
    $('progress-text').textContent = `${done} de ${total} recolectados`;
    $('progress-bar').style.width = `${total ? (done / total) * 100 : 0}%`;
  }

  function renderLeg() {
    const idx = legIndex;
    const finished = idx >= route.stops.length;
    const leg = route.legs[idx];

    if (finished) {
      $('stop-label').textContent = 'Ruta completa';
      $('stop-title').textContent = 'Regrese a la base';
      $('stop-sub').textContent = `Se recolectaron los ${route.stops.length} contenedores de este camión.`;
      $('stop-level').textContent = '';
      $('btn-collect').hidden = true;
    } else {
      const id = route.stops[idx];
      const c = byId.get(id);
      const street = stopStreet(idx);
      $('stop-label').textContent = `Próxima parada · ${idx + 1} de ${route.stops.length}`;
      $('stop-title').textContent = id;
      $('stop-sub').textContent = [c.sector, street].filter(Boolean).join(' · ');
      $('stop-level').textContent = `Llenado actual: ${Store.level(id)} %`;
      $('btn-collect').hidden = false;
    }

    $('steps').innerHTML = leg.steps
      .map(
        (s, i) =>
          `<li data-step="${i}"><span>${Geo.esc(Routing.describeStep(s))}</span><span>${Geo.fmtDistance(s.d)}</span></li>`
      )
      .join('');
    updateInstruction();
  }

  function updateInstruction() {
    if (legIndex < 0 || !route) return;
    const leg = route.legs[legIndex];
    const totalSteps = leg.steps.reduce((sum, s) => sum + s.d, 0) || 1;
    // los pasos de OSRM suman casi la longitud del tramo, por eso escalo
    const scaled = legLength ? (traveled / legLength) * totalSteps : 0;

    let acc = 0;
    let current = leg.steps.length - 1;
    for (let i = 0; i < leg.steps.length; i++) {
      acc += leg.steps[i].d;
      if (scaled < acc) {
        current = i;
        break;
      }
    }

    document.querySelectorAll('#steps li').forEach((li, i) => {
      li.classList.toggle('is-current', i === current);
      li.classList.toggle('is-past', i < current);
    });

    const step = leg.steps[current];
    const remaining = Math.max(0, legLength - traveled);
    $('instruction-text').textContent = Routing.describeStep(step);
    $('instruction-meta').textContent =
      legIndex >= route.stops.length
        ? `A ${Geo.fmtDistance(remaining)} de la base`
        : `A ${Geo.fmtDistance(remaining)} del contenedor`;

    $('btn-collect').classList.toggle('btn--ready', remaining < 15 && legIndex < route.stops.length);
  }

  function stopDriving() {
    cancelAnimationFrame(rafId);
    rafId = 0;
    $('btn-drive').textContent = traveled > 0 ? 'Continuar recorrido de prueba' : 'Iniciar recorrido de prueba';
  }

  function placeTruck() {
    const p = Geo.pointAlong(route.legs[legIndex].coords, traveled);
    truck.moveTo(p.lat, p.lng);
  }

  function frame(now) {
    const dt = Math.min(0.25, (now - lastFrame) / 1000); // limito dt por si la pestaña estuvo en segundo plano
    lastFrame = now;
    const speed = Math.max(DEMO_SPEED_MPS, legLength / DEMO_MAX_LEG_SECONDS);
    traveled = Math.min(legLength, traveled + speed * dt);
    placeTruck();
    updateInstruction();

    if (traveled >= legLength) {
      stopDriving();
      if (!arrivedNotified) {
        arrivedNotified = true;
        Layout.toast(
          legIndex >= route.stops.length ? 'El camión llegó a la base.' : `Llegó a ${route.stops[legIndex]}. Marque como recolectado.`
        );
      }
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function toggleDriving() {
    if (rafId) {
      stopDriving();
      return;
    }
    if (traveled >= legLength) return; // ya llegó, falta marcar el contenedor
    $('btn-drive').textContent = 'Pausar recorrido';
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  // ubica la vista en el tramo que toca según lo que ya se recolectó
  function syncLeg() {
    const next = nextStopIndex();
    if (next !== legIndex) {
      stopDriving();
      legIndex = next;
      legLength = Geo.pathLength(route.legs[legIndex].coords);
      traveled = 0;
      arrivedNotified = false;
      placeTruck();
      renderLeg();
    } else {
      $('stop-level').textContent =
        legIndex < route.stops.length ? `Llenado actual: ${Store.level(route.stops[legIndex])} %` : '';
    }
    renderProgress();
  }

  function buildRoute() {
    stopDriving();
    legIndex = -1;

    // solo pongo las paradas de este camión, en el punto donde termina cada tramo
    const stops = route.stops.map((id, i) => {
      const c = byId.get(id);
      const [lat, lng] = stopPosition(i);
      return { ...c, lat, lng, street: stopStreet(i) };
    });
    view.setDepot(Config.DEPOT);
    view.setContainers(stops, Store.level);
    stops.forEach((c, i) => view.refreshMarker(c.id, isDone(c.id) ? 0 : i + 1, isDone(c.id)));
    view.drawRoutes([route]);
    view.fitRoutes([route]);

    if (truck) truck.remove();
    truck = view.createTruck(route.color);
    $('btn-drive').textContent = 'Iniciar recorrido de prueba';
    syncLeg();
  }

  function load(keepTruck) {
    const plan = Store.plan;
    if (!plan || !plan.routes || !plan.routes.length) {
      stopDriving();
      route = null;
      renderEmpty(true);
      return;
    }
    renderEmpty(false);
    const wanted = keepTruck && route ? route.truck : requestedTruck();
    const chosen = plan.routes.find((r) => r.truck === wanted) || plan.routes[0];

    // si el panel calculó otra ruta, reconstruyo todo
    const changed = !route || route.truck !== chosen.truck || plan.createdAt !== load.createdAt;
    route = chosen;
    load.createdAt = plan.createdAt;
    renderTruckSelect(plan);
    if (changed) buildRoute();
    else syncLeg();
    // el mapa pudo cambiar de tamaño al mostrarse el panel
    view.invalidate();
  }

  function collectCurrent() {
    if (!route || legIndex >= route.stops.length) return;
    const id = route.stops[legIndex];
    // marco primero en la ruta para que el panel no recalcule cuando se vacíe el contenedor
    Store.markDone(id);
    Store.collect(id);
    Layout.toast(`${id} recolectado.`);
  }

  function onStoreChange(info) {
    if (info.what === 'plan' || info.what === 'reset') {
      load(true);
      const marker = route && route.stops;
      if (marker) {
        route.stops.forEach((id, i) => view.refreshMarker(id, isDone(id) ? 0 : i + 1, isDone(id)));
      }
    } else if (route) {
      syncLeg();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const containers = Data.createContainers();
    byId = new Map(containers.map((c) => [c.id, c]));
    Store.init(containers);

    view = MapView.create('map', { showCollectButton: false });

    $('btn-drive').addEventListener('click', toggleDriving);
    $('btn-collect').addEventListener('click', collectCurrent);
    $('truck-select').addEventListener('change', (e) => {
      const url = new URL(location.href);
      url.searchParams.set('truck', e.target.value);
      history.replaceState(null, '', url);
      route = null; // así load vuelve a construir la ruta con el camión nuevo
      load(false);
    });

    Store.subscribe(onStoreChange);
    load(false);
  });
})();
