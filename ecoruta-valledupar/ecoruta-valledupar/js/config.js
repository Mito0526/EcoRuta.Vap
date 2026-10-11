/* Aquí dejo las constantes y supuestos del prototipo para poder cambiarlos fácil
   sin tocar la lógica. Los demás archivos leen este objeto (EcoRuta.Config).
   Cada archivo se registra en el objeto global EcoRuta para no usar empaquetador. */
(function () {
  'use strict';

  const NS = (globalThis.EcoRuta = globalThis.EcoRuta || {});

  NS.Config = {
    // datos del proyecto que salen en el encabezado, el pie y la documentación
    PROJECT: {
      name: 'EcoRuta Valledupar',
      course: 'Proyecto de Ingeniería II',
      university: 'Universidad Nacional Abierta y a Distancia (UNAD)',
      phase: 'Fase 3 · Gestión del proyecto',
      authors: ['Juan José Domínguez Picón'],
      group: 'Grupo colaborativo 202337121_7',
    },

    // vista inicial del mapa, con el centro aproximado de Valledupar
    CITY: { name: 'Valledupar', center: [10.465, -73.252], zoom: 13 },

    // base de donde salen y a donde regresan los camiones; es una ubicación
    // de demostración, no la sede real de la empresa de aseo
    DEPOT: {
      id: 'BASE',
      name: 'Base operativa (demostración)',
      lat: 10.454,
      lng: -73.233,
    },

    // umbral de recolección; en los documentos del proyecto uso 80 %
    THRESHOLD: { default: 80, min: 50, max: 100, quick: [80, 90] },

    // colores según el nivel de llenado; min es el límite inferior de cada banda
    // y las dejo ordenadas de mayor a menor
    LEVEL_BANDS: [
      { key: 'crit', min: 90, label: '90 % o más', color: '#D62F3A' },
      { key: 'high', min: 80, label: '80 a 89 %', color: '#EE7A1A' },
      { key: 'mid', min: 50, label: '50 a 79 %', color: '#E8B923' },
      { key: 'ok', min: 0, label: 'Menos de 50 %', color: '#2F9E6E' },
    ],

    // un color de ruta por camión
    ROUTE_COLORS: ['#2457E6', '#7A3CD6', '#0E8A9A'],
    MAX_TRUCKS: 3,

    // simulación de sensores: cada tickMs sube el nivel hasta maxStep %
    SIM: { tickMs: 2000, maxStep: 4 },

    // servidor público de OSRM; sirve para el prototipo, pero uno real
    // debería usar un servidor propio
    OSRM: {
      baseUrl: 'https://router.project-osrm.org',
      profile: 'driving',
      timeoutMs: 9000,
    },

    // si el punto ajustado a la vía queda a más de estos metros, lo ignoro
    SNAP_MAX_M: 150,

    // sin conexión estimo la distancia por calle con estos dos valores
    DETOUR_FACTOR: 1.35, // la calle es ~35 % más larga que la línea recta
    AVG_SPEED_KMH: 22, // velocidad media urbana de un camión recolector

    // supuestos para el panel de ahorro: son estimaciones que se pueden editar,
    // no mediciones. Hay que cambiarlas si se consiguen datos reales de la empresa de aseo
    ESTIMATES: {
      litersPerKm: 0.45, // consumo supuesto de un camión recolector
      kgCo2PerLiter: 2.68, // factor de emisión del diésel
      minutesPerStop: 2, // tiempo supuesto de vaciado por contenedor
    },

    // claves de localStorage; el v1 me sirve para descartar datos viejos si cambio el formato
    STORAGE: {
      state: 'ecoruta.state.v1',
      plan: 'ecoruta.plan.v1',
    },
  };
})();
