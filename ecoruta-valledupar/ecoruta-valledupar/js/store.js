/* Aquí guardo el estado compartido (niveles, umbral, filtro, camiones) y el último plan
   de ruta en localStorage. El mapa y la vista del conductor son pestañas distintas y
   se avisan entre sí con el evento storage. Uso try/catch porque localStorage puede
   estar bloqueado y en ese caso el prototipo sigue, solo que sin guardar. */
(function () {
  'use strict';

  const NS = (globalThis.EcoRuta = globalThis.EcoRuta || {});
  const { Config } = NS;

  let containers = []; // lista de referencia (id, posición, nivel inicial)
  let state = null; // { levels, threshold, onlyCritical, trucks }
  let plan = null; // última ruta calculada, o null
  const listeners = new Set();

  function read(key) {
    try {
      const raw = globalThis.localStorage && globalThis.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function write(key, value) {
    try {
      if (!globalThis.localStorage) return;
      if (value == null) globalThis.localStorage.removeItem(key);
      else globalThis.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      // si no hay almacenamiento sigo solo en memoria
    }
  }

  function initialLevels() {
    const levels = {};
    containers.forEach((c) => (levels[c.id] = c.level));
    return levels;
  }

  function defaultState() {
    return {
      levels: initialLevels(),
      threshold: Config.THRESHOLD.default,
      onlyCritical: false,
      trucks: 1,
    };
  }

  // el estado guardado solo lo uso si tiene todos los contenedores actuales
  function isValid(saved) {
    return (
      saved &&
      saved.levels &&
      typeof saved.threshold === 'number' &&
      containers.every((c) => typeof saved.levels[c.id] === 'number')
    );
  }

  function emit(info) {
    listeners.forEach((fn) => fn(info || {}));
  }

  function persist() {
    write(Config.STORAGE.state, state);
  }

  const Store = {
    // la llamo una vez por página con la lista de contenedores
    init(list) {
      containers = list;
      const saved = read(Config.STORAGE.state);
      state = isValid(saved) ? saved : defaultState();
      plan = read(Config.STORAGE.plan);

      // si otra pestaña cambia algo, lo vuelvo a leer y aviso a la interfaz
      if (globalThis.addEventListener) {
        globalThis.addEventListener('storage', (event) => {
          if (event.key === Config.STORAGE.state) {
            const next = read(Config.STORAGE.state);
            if (isValid(next)) state = next;
            emit({ source: 'storage', what: 'state' });
          } else if (event.key === Config.STORAGE.plan) {
            plan = read(Config.STORAGE.plan);
            emit({ source: 'storage', what: 'plan' });
          }
        });
      }
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    level(id) {
      return state.levels[id] == null ? 0 : state.levels[id];
    },
    get threshold() {
      return state.threshold;
    },
    get onlyCritical() {
      return state.onlyCritical;
    },
    get trucks() {
      return state.trucks;
    },
    get plan() {
      return plan;
    },

    setLevel(id, value) {
      state.levels[id] = Math.max(0, Math.min(100, Math.round(value)));
      persist();
      emit({ source: 'local', what: 'level', id });
    },

    // cambia varios niveles de una vez (la simulación) y avisa una sola vez
    setLevels(changes) {
      Object.keys(changes).forEach((id) => {
        state.levels[id] = Math.max(0, Math.min(100, Math.round(changes[id])));
      });
      persist();
      emit({ source: 'local', what: 'levels' });
    },

    // el camión vació el contenedor, vuelve a 0 %
    collect(id) {
      Store.setLevel(id, 0);
    },

    setThreshold(value) {
      state.threshold = Math.max(Config.THRESHOLD.min, Math.min(Config.THRESHOLD.max, Math.round(value)));
      persist();
      emit({ source: 'local', what: 'threshold' });
    },

    setOnlyCritical(flag) {
      state.onlyCritical = Boolean(flag);
      persist();
      emit({ source: 'local', what: 'filter' });
    },

    setTrucks(n) {
      state.trucks = Math.max(1, Math.min(Config.MAX_TRUCKS, Math.round(n)));
      persist();
      emit({ source: 'local', what: 'trucks' });
    },

    // guarda la ruta calculada, o la borra si le paso null
    setPlan(next) {
      plan = next;
      write(Config.STORAGE.plan, plan);
      emit({ source: 'local', what: 'plan' });
    },

    // marca una parada como atendida sin recalcular la ruta (modo conductor)
    markDone(id) {
      if (!plan) return;
      plan.done = plan.done || {};
      plan.done[id] = true;
      write(Config.STORAGE.plan, plan);
      emit({ source: 'local', what: 'plan' });
    },

    // vuelve a los datos iniciales de demostración
    reset() {
      state = defaultState();
      plan = null;
      persist();
      write(Config.STORAGE.plan, null);
      emit({ source: 'local', what: 'reset' });
    },
  };

  NS.Store = Store;
})();
