/* Datos de demostración: los sectores de Valledupar y los contenedores simulados.*/
(function () {
  'use strict';

  const NS = (globalThis.EcoRuta = globalThis.EcoRuta || {});
  const { Geo } = NS;

  // sectores de demostración, con coordenadas aproximadas del centro de cada barrio
  // code es el prefijo del id, heading el giro de la cuadrícula en grados
  // y fillRate qué tan rápido se llena (1 es lo normal)
  const SECTORS = [
    { code: 'CEN', name: 'Centro', lat: 10.4745, lng: -73.2465, heading: 10, count: 6, fillRate: 1.4 },
    { code: 'ALP', name: 'Alfonso López', lat: 10.4688, lng: -73.2412, heading: 15, count: 5, fillRate: 1.0 },
    { code: 'CAN', name: 'Cañaguate', lat: 10.456, lng: -73.2575, heading: 20, count: 6, fillRate: 1.2 },
    { code: 'MAY', name: 'Los Mayales', lat: 10.4805, lng: -73.269, heading: 0, count: 5, fillRate: 0.9 },
    { code: 'NOV', name: 'Novalito', lat: 10.4625, lng: -73.2655, heading: 25, count: 5, fillRate: 1.1 },
    { code: 'MUS', name: 'Los Músicos', lat: 10.4475, lng: -73.249, heading: 10, count: 5, fillRate: 0.8 },
    { code: 'DOC', name: '12 de Octubre', lat: 10.443, lng: -73.26, heading: 30, count: 6, fillRate: 1.3 },
    { code: 'GAR', name: 'Garupal', lat: 10.489, lng: -73.254, heading: 5, count: 5, fillRate: 0.9 },
    { code: 'DAN', name: 'Dangond', lat: 10.466, lng: -73.254, heading: 15, count: 5, fillRate: 1.0 },
    { code: 'VCL', name: 'Villa Clara', lat: 10.452, lng: -73.24, heading: 20, count: 5, fillRate: 1.0 },
  ];

  const GRID_STEP_M = 200; // separación entre cruces de la cuadrícula
  const JITTER_M = 20; // variación aleatoria máxima de cada contenedor

  // generador aleatorio con semilla (mulberry32) para que los datos salgan iguales cada vez
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // convierte un texto en un número para usarlo de semilla
  function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // nivel inicial sesgado para que más o menos 1 de cada 4 pase del 80 %
  function initialLevel(rng) {
    return Math.min(100, Math.round(100 * Math.pow(rng(), 0.75)));
  }

  // arma la lista de contenedores de demostración
  function createContainers() {
    const containers = [];

    SECTORS.forEach((sector) => {
      const rng = mulberry32(hashString(sector.code));
      const theta = (sector.heading * Math.PI) / 180;

      // cruces de una cuadrícula de 200 m, ordenados por cercanía al centro con algo de azar
      const nodes = [];
      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
          const x = i * GRID_STEP_M;
          const y = j * GRID_STEP_M;
          nodes.push({ x, y, score: Math.hypot(x, y) + rng() * 120 });
        }
      }
      nodes.sort((p, q) => p.score - q.score);

      // me quedo con los primeros count, les sumo la variación y giro la cuadrícula
      nodes.slice(0, sector.count).forEach((node, index) => {
        const x = node.x + (rng() * 2 - 1) * JITTER_M;
        const y = node.y + (rng() * 2 - 1) * JITTER_M;
        const east = x * Math.cos(theta) - y * Math.sin(theta);
        const north = x * Math.sin(theta) + y * Math.cos(theta);
        const pos = Geo.offsetMeters(sector, east, north);

        containers.push({
          id: `${sector.code}-${String(index + 1).padStart(2, '0')}`,
          sector: sector.name,
          sectorCode: sector.code,
          fillRate: sector.fillRate,
          lat: pos.lat,
          lng: pos.lng,
          street: '', // se completa al ajustar a la vía (OSRM)
          snapped: false,
          level: initialLevel(rng), // nivel inicial (la simulación lo modifica)
          battery: 62 + Math.round(rng() * 38), // % de batería del sensor
          rssi: -118 + Math.round(rng() * 33), // señal LoRa en dBm
        });
      });
    });

    return containers;
  }

  NS.Data = { SECTORS, createContainers, mulberry32 };
})();
