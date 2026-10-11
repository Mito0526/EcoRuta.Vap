// Pruebas de la lógica del prototipo, sin navegador (node tests/run-tests.js).
// Cubro solo los módulos que no usan el DOM: geo, data, store y routing.
'use strict';

const assert = require('assert');
const path = require('path');

// los módulos se cargan en globalThis.EcoRuta, igual que en el navegador
['config', 'geo', 'data', 'store', 'routing'].forEach((name) =>
  require(path.join(__dirname, '..', 'js', name + '.js'))
);
const { Config, Geo, Data, Store, Routing } = globalThis.EcoRuta;

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failures.push(name);
    console.log('  FAIL ' + name + '\n       ' + (err && err.message));
  }
}

(async () => {
  console.log('geo');
  await test('haversine: 0,01° de latitud ≈ 1,11 km', () => {
    const d = Geo.haversine({ lat: 10.46, lng: -73.25 }, { lat: 10.47, lng: -73.25 });
    assert.ok(Math.abs(d - 1112) < 15, 'distancia = ' + d);
  });
  await test('offsetMeters: 300 m al este y 400 m al norte → 500 m', () => {
    const o = { lat: 10.46, lng: -73.25 };
    const p = Geo.offsetMeters(o, 300, 400);
    assert.ok(Math.abs(Geo.haversine(o, p) - 500) < 5);
  });
  await test('pointAlong: punto a mitad de una línea recta', () => {
    const a = [10.46, -73.25];
    const b = [10.47, -73.25];
    const mid = Geo.pointAlong([a, b], Geo.pathLength([a, b]) / 2);
    assert.ok(Math.abs(mid.lat - 10.465) < 1e-4);
  });
  await test('formatos de distancia y tiempo', () => {
    assert.strictEqual(Geo.fmtMin(42), '42 min');
    assert.strictEqual(Geo.fmtMin(72), '1 h 12 min');
    assert.ok(/m$/.test(Geo.fmtDistance(240)));
    assert.ok(/km$/.test(Geo.fmtDistance(1300)));
  });
  await test('esc: escapa HTML', () => {
    assert.strictEqual(Geo.esc('<b>"a"</b>'), '&lt;b&gt;&quot;a&quot;&lt;/b&gt;');
  });

  console.log('data');
  const containers = Data.createContainers();
  await test('se generan 53 contenedores con ids únicos', () => {
    assert.strictEqual(containers.length, 53);
    assert.strictEqual(new Set(containers.map((c) => c.id)).size, 53);
  });
  await test('los datos son reproducibles', () => {
    const again = Data.createContainers();
    assert.deepStrictEqual(again[10], containers[10]);
  });
  await test('contenedores del mismo sector separados al menos 150 m', () => {
    for (let i = 0; i < containers.length; i++) {
      for (let j = i + 1; j < containers.length; j++) {
        if (containers[i].sectorCode !== containers[j].sectorCode) continue;
        const d = Geo.haversine(containers[i], containers[j]);
        assert.ok(d >= 150, `${containers[i].id} y ${containers[j].id} a ${d.toFixed(0)} m`);
      }
    }
  });
  await test('cada contenedor tiene un vecino del sector a 150–320 m', () => {
    containers.forEach((c) => {
      const near = Math.min(
        ...containers.filter((o) => o !== c && o.sectorCode === c.sectorCode).map((o) => Geo.haversine(c, o))
      );
      assert.ok(near >= 150 && near <= 320, `${c.id}: vecino a ${near.toFixed(0)} m`);
    });
  });
  await test('niveles iniciales en rango y con algunos críticos', () => {
    assert.ok(containers.every((c) => c.level >= 0 && c.level <= 100));
    const critical = containers.filter((c) => c.level >= 80).length;
    assert.ok(critical >= 6 && critical <= 25, 'críticos = ' + critical);
  });
  await test('todos los puntos caen dentro de la zona urbana esperada', () => {
    containers.forEach((c) => {
      assert.ok(c.lat > 10.43 && c.lat < 10.5 && c.lng > -73.29 && c.lng < -73.22, c.id);
    });
  });

  console.log('store');
  Store.init(containers);
  await test('niveles, umbral y recolección', () => {
    Store.setThreshold(90);
    assert.strictEqual(Store.threshold, 90);
    Store.setThreshold(10); // menor que el mínimo permitido
    assert.strictEqual(Store.threshold, Config.THRESHOLD.min);
    Store.setLevel(containers[0].id, 150);
    assert.strictEqual(Store.level(containers[0].id), 100);
    Store.collect(containers[0].id);
    assert.strictEqual(Store.level(containers[0].id), 0);
    Store.setTrucks(9);
    assert.strictEqual(Store.trucks, Config.MAX_TRUCKS);
  });
  await test('reset vuelve a los niveles iniciales', () => {
    Store.reset();
    assert.strictEqual(Store.level(containers[0].id), containers[0].level);
    assert.strictEqual(Store.threshold, Config.THRESHOLD.default);
  });

  console.log('routing');
  // sin servicio de rutas: hago que fetch falle para probar la red estimada
  globalThis.fetch = async () => {
    throw new Error('sin red (prueba)');
  };
  const network = await Routing.initNetwork(containers, Config.DEPOT);
  await test('initNetwork sin OSRM cae al modo estimado', () => {
    assert.strictEqual(network.mode, 'estimada');
    assert.strictEqual(network.durations.length, containers.length + 1);
  });

  await test('2-opt nunca empeora el recorrido y gana al azar', () => {
    const cost = (i, j) => network.durations[i][j];
    const nodes = Array.from(network.index.values()).slice(0, 12);
    const nn = Routing.nearestNeighbor(cost, nodes);
    const opt = Routing.twoOpt(cost, nn);
    assert.ok(Routing.tourCost(cost, opt) <= Routing.tourCost(cost, nn) + 1e-6);
    assert.strictEqual(new Set(opt).size, nodes.length);
  });

  await test('con 7 paradas la heurística queda a menos de 10 % del óptimo exacto', () => {
    const cost = (i, j) => network.durations[i][j];
    const nodes = Array.from(network.index.values()).slice(0, 7);
    const permute = (arr) =>
      arr.length <= 1 ? [arr] : arr.flatMap((x, i) => permute([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
    const best = Math.min(...permute(nodes).map((p) => Routing.tourCost(cost, p)));
    const heur = Routing.tourCost(cost, Routing.orderTour(cost, nodes));
    assert.ok(heur <= best * 1.1, `heurística ${heur.toFixed(0)} vs óptimo ${best.toFixed(0)}`);
  });

  await test('cluster reparte todos los puntos sin grupos vacíos', () => {
    const crit = containers.filter((c) => c.level >= 60);
    [1, 2, 3].forEach((k) => {
      const groups = Routing.cluster(crit, k, Config.DEPOT);
      assert.strictEqual(groups.length, k);
      assert.ok(groups.every((g) => g.length > 0));
      assert.strictEqual(groups.reduce((s, g) => s + g.length, 0), crit.length);
    });
  });

  await test('plan estimado: cada crítico aparece una sola vez y hay ahorro', async () => {
    const crit = containers.filter((c) => c.level >= 80);
    const result = await Routing.plan(crit, 2, network, Config.DEPOT);
    const ids = result.routes.flatMap((r) => r.stops);
    assert.strictEqual(ids.length, crit.length);
    assert.strictEqual(new Set(ids).size, crit.length);
    assert.strictEqual(result.mode, 'estimada');
    assert.ok(result.savings.savedKm > 0, 'ahorro = ' + result.savings.savedKm);
    assert.ok(result.routes.every((r) => r.legs.length === r.stops.length + 1));
  });

  await test('plan con servicio OSRM simulado usa la geometría por calles', async () => {
    const fakeRoute = (n) => ({
      code: 'Ok',
      routes: [
        {
          distance: 1000 * n,
          duration: 120 * n,
          legs: Array.from({ length: n }, () => ({
            distance: 1000,
            duration: 120,
            steps: [
              { distance: 600, name: 'Calle 16', maneuver: { type: 'depart' }, geometry: { coordinates: [[-73.25, 10.46], [-73.249, 10.461]] } },
              { distance: 400, name: 'Carrera 9', maneuver: { type: 'turn', modifier: 'left' }, geometry: { coordinates: [[-73.249, 10.461], [-73.248, 10.462]] } },
            ],
          })),
        },
      ],
    });
    globalThis.fetch = async (url) => ({
      ok: true,
      json: async () => {
        if (url.includes('/table/')) {
          const n = containers.length + 1;
          const m = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 100 + Math.abs(i - j) * 10)));
          return {
            code: 'Ok',
            durations: m,
            distances: m,
            sources: Array.from({ length: n }, (_, i) => ({ location: [-73.25 + i * 1e-4, 10.46], name: 'Calle ' + i, distance: 20 })),
          };
        }
        const stops = (url.match(/;/g) || []).length;
        return fakeRoute(stops);
      },
    });
    const net = await Routing.initNetwork(containers, Config.DEPOT);
    assert.strictEqual(net.mode, 'osrm');
    assert.strictEqual(net.snapped.size, containers.length);
    const crit = containers.filter((c) => c.level >= 85);
    const result = await Routing.plan(crit, 1, net, Config.DEPOT);
    assert.strictEqual(result.mode, 'osrm');
    assert.ok(result.routes[0].legs[0].coords.length >= 3);
    assert.strictEqual(Routing.describeStep(result.routes[0].legs[0].steps[1]), 'Gire a la izquierda en Carrera 9');
  });

  await test('describeStep traduce maniobras comunes', () => {
    assert.strictEqual(Routing.describeStep({ t: 'depart', m: '', n: 'Calle 5', d: 100, e: 0 }), 'Salga por Calle 5');
    assert.strictEqual(Routing.describeStep({ t: 'arrive', m: '', n: '', d: 0, e: 0 }), 'Llegó al contenedor');
    assert.strictEqual(
      Routing.describeStep({ t: 'roundabout', m: 'right', n: 'Carrera 19', d: 50, e: 2 }),
      'En la glorieta, tome la salida 2 en Carrera 19'
    );
  });

  console.log(`\n${passed} pruebas correctas, ${failures.length} con fallo`);
  process.exit(failures.length ? 1 : 0);
})();
