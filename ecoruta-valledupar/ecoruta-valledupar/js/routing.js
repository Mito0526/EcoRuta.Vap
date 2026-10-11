/* Aquí calculo las rutas de recolección: pido las matrices a OSRM, reparto los contenedores
   críticos entre camiones, ordeno las paradas y comparo contra recorrer todos los contenedores.
   El orden es una heurística (vecino más cercano y 2-opt), da rutas buenas pero no la óptima.
   Si OSRM no responde, uso distancias estimadas en línea recta. No depende de Leaflet ni del DOM. */
(function () {
  'use strict';

  const NS = (globalThis.EcoRuta = globalThis.EcoRuta || {});
  const { Config, Geo } = NS;

  async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // OSRM espera las coordenadas como lng,lat separadas por punto y coma
  function coordString(points) {
    return points.map((p) => p.lng.toFixed(6) + ',' + p.lat.toFixed(6)).join(';');
  }

  // matrices estimadas con línea recta, para cuando no hay servicio de rutas
  function estimatedMatrices(points) {
    const speedMs = Config.AVG_SPEED_KMH / 3.6;
    const distances = points.map((a) =>
      points.map((b) => Geo.haversine(a, b) * Config.DETOUR_FACTOR)
    );
    const durations = distances.map((row) => row.map((d) => d / speedMs));
    return { distances, durations };
  }

  // OSRM devuelve null donde no hay camino, así que pongo un valor enorme
  const cleanMatrix = (m) => m.map((row) => row.map((v) => (v == null ? 1e9 : v)));

  // arma la red de trabajo con una sola consulta a OSRM (servicio table); además
  // ajusta cada punto a la vía más cercana. El índice 0 es la base y del 1 al n los contenedores
  async function initNetwork(containers, depot) {
    const points = [depot, ...containers];
    const network = {
      points,
      index: new Map(containers.map((c, i) => [c.id, i + 1])),
      mode: 'estimada',
      durations: null,
      distances: null,
      snapped: new Map(), // por id: {lat, lng, street, snapDist}
      depot: null, // base ajustada a la vía
      baseline: null, // se calcula una sola vez en baseline()
      error: null,
    };

    try {
      const url =
        `${Config.OSRM.baseUrl}/table/v1/${Config.OSRM.profile}/${coordString(points)}` +
        '?annotations=duration,distance';
      const data = await fetchJson(url, Config.OSRM.timeoutMs);
      if (data.code !== 'Ok') throw new Error(data.code || 'respuesta inválida');

      network.durations = cleanMatrix(data.durations);
      network.distances = cleanMatrix(data.distances);
      network.mode = 'osrm';

      (data.sources || []).forEach((s, i) => {
        if (!s || !s.location || s.distance > Config.SNAP_MAX_M) return;
        const snapped = { lat: s.location[1], lng: s.location[0], street: s.name || '', snapDist: s.distance };
        if (i === 0) network.depot = snapped;
        else network.snapped.set(containers[i - 1].id, snapped);
      });
    } catch (err) {
      const m = estimatedMatrices(points);
      network.durations = m.durations;
      network.distances = m.distances;
      network.error = String((err && err.message) || err);
    }
    return network;
  }

  // costo de un recorrido cerrado: sale de la base, pasa por las paradas y vuelve
  function tourCost(cost, order) {
    let total = 0;
    let prev = 0;
    for (const node of order) {
      total += cost(prev, node);
      prev = node;
    }
    return total + cost(prev, 0);
  }

  // vecino más cercano: siempre va a la parada pendiente que le queda más cerca
  function nearestNeighbor(cost, nodes) {
    const pending = new Set(nodes);
    const order = [];
    let current = 0;
    while (pending.size) {
      let best = null;
      let bestCost = Infinity;
      for (const n of pending) {
        const c = cost(current, n);
        if (c < bestCost) {
          bestCost = c;
          best = n;
        }
      }
      order.push(best);
      pending.delete(best);
      current = best;
    }
    return order;
  }

  // 2-opt: invierte tramos del recorrido mientras eso lo haga más corto
  function twoOpt(cost, order) {
    let best = order.slice();
    let bestCost = tourCost(cost, best);
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < best.length - 1; i++) {
        for (let j = i + 1; j < best.length; j++) {
          const candidate = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1));
          const c = tourCost(cost, candidate);
          if (c < bestCost - 1e-9) {
            best = candidate;
            bestCost = c;
            improved = true;
          }
        }
      }
    }
    return best;
  }

  // orden de visita para un conjunto de nodos (índices de la red)
  function orderTour(cost, nodes) {
    if (nodes.length <= 2) return nearestNeighbor(cost, nodes);
    return twoOpt(cost, nearestNeighbor(cost, nodes));
  }

  // agrupa los puntos en k grupos cercanos con k-means. Arranco desde el punto más lejano
  // para que el resultado salga igual cada vez, y ordeno los grupos por su dirección respecto a la base
  function cluster(points, k, depot) {
    if (k <= 1 || points.length <= 1) return [points.slice()];
    k = Math.min(k, points.length);

    // primer centroide el más lejano a la base, y luego el más lejano a los ya elegidos
    const centroids = [];
    let first = points[0];
    points.forEach((p) => {
      if (Geo.haversine(p, depot) > Geo.haversine(first, depot)) first = p;
    });
    centroids.push({ lat: first.lat, lng: first.lng });
    while (centroids.length < k) {
      let far = null;
      let farDist = -1;
      points.forEach((p) => {
        const d = Math.min(...centroids.map((c) => Geo.haversine(p, c)));
        if (d > farDist) {
          farDist = d;
          far = p;
        }
      });
      centroids.push({ lat: far.lat, lng: far.lng });
    }

    let groups = [];
    for (let iter = 0; iter < 15; iter++) {
      groups = centroids.map(() => []);
      points.forEach((p) => {
        let bestIdx = 0;
        let bestDist = Infinity;
        centroids.forEach((c, idx) => {
          const d = Geo.haversine(p, c);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = idx;
          }
        });
        groups[bestIdx].push(p);
      });
      // si un grupo queda vacío le paso un punto del grupo más grande
      groups.forEach((g, idx) => {
        if (g.length) return;
        const donor = groups.reduce((a, b) => (b.length > a.length ? b : a));
        g.push(donor.pop());
        centroids[idx] = { lat: g[0].lat, lng: g[0].lng };
      });
      groups.forEach((g, idx) => {
        centroids[idx] = {
          lat: g.reduce((s, p) => s + p.lat, 0) / g.length,
          lng: g.reduce((s, p) => s + p.lng, 0) / g.length,
        };
      });
    }

    const bearing = (g) => {
      const c = { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lng: g.reduce((s, p) => s + p.lng, 0) / g.length };
      return Math.atan2(c.lat - depot.lat, c.lng - depot.lng);
    };
    return groups.sort((a, b) => bearing(a) - bearing(b));
  }

  // redondeo a 5 decimales (más o menos 1 m) para que el plan guardado pese menos
  const round5 = (n) => Math.round(n * 1e5) / 1e5;

  // pide a OSRM la ruta por los puntos en orden y devuelve un tramo por cada par de paradas seguidas
  async function routeVia(points) {
    const url =
      `${Config.OSRM.baseUrl}/route/v1/${Config.OSRM.profile}/${coordString(points)}` +
      '?overview=false&geometries=geojson&steps=true';
    const data = await fetchJson(url, Config.OSRM.timeoutMs);
    if (data.code !== 'Ok' || !data.routes || !data.routes[0]) throw new Error(data.code || 'sin ruta');

    const route = data.routes[0];
    const legs = route.legs.map((leg) => {
      const coords = [];
      const steps = leg.steps.map((st) => {
        st.geometry.coordinates.forEach(([lng, lat]) => {
          const last = coords[coords.length - 1];
          const p = [round5(lat), round5(lng)];
          if (!last || last[0] !== p[0] || last[1] !== p[1]) coords.push(p);
        });
        return {
          t: st.maneuver.type, // tipo de maniobra (turn, arrive, roundabout...)
          m: st.maneuver.modifier || '', // giro (left, right, straight…)
          n: st.name || '', // nombre de la calle
          d: Math.round(st.distance), // metros del tramo
          e: st.maneuver.exit || 0, // salida de la glorieta
        };
      });
      return { distance: leg.distance, duration: leg.duration, coords, steps };
    });
    return { distance: route.distance, duration: route.duration, legs };
  }

  // tramos en línea recta para el modo estimado
  function straightLegs(points, durationFn) {
    const legs = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const distance = Geo.haversine(a, b) * Config.DETOUR_FACTOR;
      legs.push({
        distance,
        duration: durationFn ? durationFn(i - 1, i) : distance / (Config.AVG_SPEED_KMH / 3.6),
        coords: [
          [a.lat, a.lng],
          [b.lat, b.lng],
        ],
        steps: [{ t: 'straight', m: '', n: '', d: Math.round(distance), e: 0 }],
      });
    }
    return legs;
  }

  // pasa una maniobra de OSRM a una instrucción en español
  function describeStep(step) {
    const street = step.n ? ` por ${step.n}` : '';
    const onStreet = step.n ? ` en ${step.n}` : '';
    const side = {
      left: 'a la izquierda',
      right: 'a la derecha',
      'slight left': 'levemente a la izquierda',
      'slight right': 'levemente a la derecha',
      'sharp left': 'de forma cerrada a la izquierda',
      'sharp right': 'de forma cerrada a la derecha',
      straight: 'de frente',
      uturn: 'para retornar',
    }[step.m];

    switch (step.t) {
      case 'depart':
        return `Salga${street}`;
      case 'arrive':
        return 'Llegó al contenedor';
      case 'turn':
      case 'end of road':
        return side ? `Gire ${side}${onStreet}` : `Siga${street}`;
      case 'fork':
        return side ? `Tome la bifurcación ${side}${onStreet}` : `Siga${street}`;
      case 'merge':
        return `Incorpórese${onStreet}`;
      case 'on ramp':
      case 'off ramp':
        return `Tome el acceso${onStreet}`;
      case 'roundabout':
      case 'rotary':
      case 'roundabout turn':
        return step.e ? `En la glorieta, tome la salida ${step.e}${onStreet}` : `Entre a la glorieta${onStreet}`;
      case 'exit roundabout':
      case 'exit rotary':
        return `Salga de la glorieta${onStreet}`;
      case 'continue':
        return side && step.m !== 'straight' ? `Continúe ${side}${onStreet}` : `Continúe${street}`;
      case 'straight':
        return 'Siga en línea recta hasta el contenedor';
      default:
        return `Siga${street}`;
    }
  }

  // recorrido de referencia: un solo camión pasando por todos los contenedores
  function baseline(network) {
    if (network.baseline) return network.baseline;
    const all = Array.from(network.index.values());
    const cost = (i, j) => network.durations[i][j];
    const order = orderTour(cost, all);
    let meters = 0;
    let seconds = 0;
    let prev = 0;
    [...order, 0].forEach((n) => {
      meters += network.distances[prev][n];
      seconds += network.durations[prev][n];
      prev = n;
    });
    network.baseline = { km: meters / 1000, drivingMin: seconds / 60, stops: all.length };
    return network.baseline;
  }

  function savings(network, routes) {
    const base = baseline(network);
    const minPerStop = Config.ESTIMATES.minutesPerStop;
    const baseMin = base.drivingMin + base.stops * minPerStop;
    const optKm = routes.reduce((s, r) => s + r.distanceKm, 0);
    const optMin = routes.reduce((s, r) => s + r.totalMin, 0);
    const savedKm = Math.max(0, base.km - optKm);
    const liters = savedKm * Config.ESTIMATES.litersPerKm;
    return {
      baselineKm: base.km,
      baselineMin: baseMin,
      baselineStops: base.stops,
      optKm,
      optMin,
      optStops: routes.reduce((s, r) => s + r.stops.length, 0),
      savedKm,
      savedPct: base.km > 0 ? (savedKm / base.km) * 100 : 0,
      savedMin: Math.max(0, baseMin - optMin),
      savedLiters: liters,
      savedKgCo2: liters * Config.ESTIMATES.kgCo2PerLiter,
    };
  }

  // calcula las rutas de los contenedores que pasan el umbral; network viene de initNetwork()
  // y depot es la base, ajustada a la vía si se pudo
  async function plan(criticals, trucks, network, depot) {
    const k = Math.max(1, Math.min(trucks, criticals.length));
    const groups = cluster(criticals, k, depot);
    let usedOsrm = network.mode === 'osrm';

    const routes = [];
    for (let g = 0; g < groups.length; g++) {
      const nodes = groups[g].map((c) => network.index.get(c.id));
      const cost = (i, j) => network.durations[i][j];
      const order = orderTour(cost, nodes);
      const byIndex = new Map(groups[g].map((c) => [network.index.get(c.id), c]));
      const stops = order.map((idx) => byIndex.get(idx));
      const path = [depot, ...stops, depot];

      let result = null;
      if (usedOsrm) {
        try {
          result = await routeVia(path);
        } catch (err) {
          usedOsrm = false; // si una consulta falla, el resto se calcula estimado
        }
      }
      if (!result) {
        // en modo estimado saco los tiempos de la matriz para que coincidan con el resto
        const idxPath = [0, ...order, 0];
        const legs = straightLegs(path, (a, b) => network.durations[idxPath[a]][idxPath[b]]);
        result = {
          distance: legs.reduce((s, l) => s + l.distance, 0),
          duration: legs.reduce((s, l) => s + l.duration, 0),
          legs,
        };
      }

      const serviceMin = stops.length * Config.ESTIMATES.minutesPerStop;
      routes.push({
        truck: g + 1,
        color: Config.ROUTE_COLORS[g % Config.ROUTE_COLORS.length],
        stops: stops.map((s) => s.id),
        distanceKm: result.distance / 1000,
        drivingMin: result.duration / 60,
        serviceMin,
        totalMin: result.duration / 60 + serviceMin,
        legs: result.legs,
        source: usedOsrm && result.legs.some((l) => l.coords.length > 2) ? 'osrm' : 'estimada',
      });
    }

    return {
      createdAt: Date.now(),
      mode: routes.every((r) => r.source === 'osrm') ? 'osrm' : 'estimada',
      trucks: routes.length,
      routes,
      savings: savings(network, routes),
      done: {},
    };
  }

  NS.Routing = {
    initNetwork,
    plan,
    cluster,
    orderTour,
    tourCost,
    nearestNeighbor,
    twoOpt,
    baseline,
    savings,
    describeStep,
    estimatedMatrices,
  };
})();
