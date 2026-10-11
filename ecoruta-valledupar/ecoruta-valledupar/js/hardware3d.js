/*
 * hardware3d.js: modelo 3D del contenedor con su equipo, para hardware.html.
 * Uso Three.js r147 con OrbitControls; las medidas están en metros y son ilustrativas.
 * Al separar piezas, cada una sale de su posición de reposo y la hija suma el movimiento de su padre.
 */
(function () {
  'use strict';

  const { Config, Data } = globalThis.EcoRuta;

  // medidas del modelo, en metros
  const BODY = { w: 1.2, h: 1.0, d: 0.8, y: 0.65 }; // y es el centro del cuerpo
  const FLOOR_Y = 0.17; // fondo por dentro del contenedor
  const SURFACE_EMPTY = 0.18; // altura de la basura con 0 %
  const SURFACE_RANGE = 0.62; // lo que sube la basura de 0 a 100 %
  const LID_Y = 1.17; // centro de la tapa
  const PROBE_BOTTOM_REST = 1.11; // punta del sensor con las piezas sin separar
  // semiángulo del haz, valor de referencia
  const BEAM_HALF_ANGLE = (15 * Math.PI) / 180;
  const DEBRIS_COUNT = 36;
  const ALERT_LEVEL = Config.THRESHOLD.default; // desde este nivel salen los anillos de la antena

  // altura de la superficie de los residuos para un llenado de 0 a 1
  const surfaceY = (fill) => SURFACE_EMPTY + fill * SURFACE_RANGE;

  // texto de cada pieza al seleccionarla
  // los valores son de referencia y hay que confirmarlos con las hojas de datos
  const PARTS = {
    probe: {
      name: 'Sensor ultrasónico impermeable',
      label: 'Sensor',
      text: 'Va bajo la tapa mirando hacia los residuos. Emite un pulso de sonido y mide cuánto tarda el eco; con ese tiempo se calcula la distancia y, de ahí, el porcentaje de llenado.',
      specs: [
        'Referencia: sonda sellada tipo JSN-SR04T.',
        'Tiene una zona ciega de unos 20 a 25 cm bajo el sensor; por eso el 100 % se define antes de llegar a la tapa.',
        'Confirmar la protección contra agua en la hoja de datos del modelo final.',
      ],
    },
    pcb: {
      name: 'Módulo de control con radio LoRa',
      label: 'Módulo LoRa',
      text: 'Lee el sensor, calcula el nivel y envía un mensaje corto. Entre lecturas duerme para gastar muy poca batería.',
      specs: [
        'Referencia: microcontrolador de bajo consumo con transceptor LoRa (familia SX127x).',
        'Banda de referencia: 915 MHz; verificar la normativa vigente de la ANE.',
        'Envío de ejemplo: una lectura cada 15 minutos y alerta inmediata al superar el umbral.',
      ],
    },
    battery: {
      name: 'Batería recargable',
      label: 'Batería',
      text: 'Alimenta el módulo. El panel solar la mantiene cargada para que nadie tenga que cambiarla en campo.',
      specs: [
        'Referencia: celda Li-ion 18650 de 3,7 V.',
        'La autonomía real depende del intervalo de envío y se debe medir en pruebas de campo.',
      ],
    },
    solar: {
      name: 'Panel solar pequeño',
      label: 'Panel solar',
      text: 'Recarga la batería durante el día. Valledupar tiene buena radiación solar durante gran parte del año.',
      specs: [
        'Referencia: panel de 5 a 6 V y pocos vatios.',
        'Debe ir inclinado y en un lugar donde no estorbe al abrir la tapa.',
      ],
    },
    antenna: {
      name: 'Antena LoRa',
      label: 'Antena',
      text: 'Saca la señal del módulo hacia el gateway. Los anillos animados aparecen cuando el contenedor supera el umbral y el módulo envía una alerta.',
      specs: [
        'El alcance depende del entorno; en ciudad se esperan desde cientos de metros hasta pocos kilómetros (validar en campo).',
        'Debe quedar fuera de cajas metálicas o de plásticos gruesos.',
      ],
    },
    enclosure: {
      name: 'Caja sellada',
      label: 'Caja sellada',
      text: 'Protege la electrónica de la lluvia, el polvo y los líquidos que sueltan los residuos. El LED muestra el último nivel con el mismo código de colores del mapa.',
      specs: ['Referencia: caja plástica con sellado IP65 o superior.'],
    },
    lid: {
      name: 'Tapa del contenedor',
      label: 'Tapa',
      text: 'Es el punto de montaje: todo el equipo se fija a la tapa, así no hay que modificar el cuerpo del contenedor ni pasar cables por dentro.',
      specs: [],
    },
    waste: {
      name: 'Residuos',
      label: 'Residuos',
      text: 'Se dibujan según el control «Llenado del contenedor». Su superficie es lo que mide el sensor.',
      specs: ['Mueva el control y observe cómo cambia la distancia medida.'],
    },
    body: {
      name: 'Contenedor',
      label: 'Contenedor',
      text: 'Contenedor plástico con ruedas. Las medidas del modelo son ilustrativas y no corresponden a un fabricante.',
      specs: [],
    },
    wheels: {
      name: 'Ruedas',
      label: 'Ruedas',
      text: 'Permiten mover el contenedor; no llevan ningún componente electrónico.',
      specs: [],
    },
  };

  // al tocar gana la pieza pequeña antes que la grande que la cubre; si no, el cuerpo taparía todo
  const PICK_ORDER = ['probe', 'antenna', 'solar', 'pcb', 'battery', 'enclosure', 'lid', 'waste', 'wheels', 'body'];

  // etapas de "Del contenedor a la ruta"
  const FLOW = [
    ['Sensor', 'Mide la distancia hasta los residuos.'],
    ['Radio LoRa', 'Envía un mensaje corto, sin SIM ni plan de datos.'],
    ['Gateway', 'Una antena receptora en un punto alto escucha a muchos contenedores y los conecta a Internet.'],
    ['Plataforma', 'Guarda las lecturas y calcula el porcentaje de llenado.'],
    ['Ruta', 'Con los contenedores sobre el umbral se calcula la ruta del camión.'],
  ];

  // armado del modelo

  function material(color, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.65, metalness: 0.05 }, extra));
  }

  // celdas del panel solar dibujadas en un canvas, así no cargo imágenes
  function solarTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1b2a5c';
    ctx.fillRect(0, 0, 128, 96);
    ctx.strokeStyle = '#6f86c9';
    ctx.lineWidth = 1.5;
    for (let x = 0; x <= 128; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 96);
      ctx.stroke();
    }
    for (let y = 0; y <= 96; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y);
      ctx.stroke();
    }
    return new THREE.CanvasTexture(canvas);
  }

  // sombra suave bajo el contenedor con un degradado radial
  function shadowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    g.addColorStop(0, 'rgba(18,58,56,0.38)');
    g.addColorStop(1, 'rgba(18,58,56,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(canvas);
  }

  function buildModel() {
    const root = new THREE.Group();
    const parts = {}; // por id: grupo, reposo, dirección, mallas y desplazamiento de la etiqueta
    const state = {}; // lo que cambia con el llenado y las opciones

    // guarda la pieza con su posición de reposo y hacia dónde se mueve al separar
    function register(id, group, rest, dir, labelOffset) {
      group.position.copy(rest);
      parts[id] = {
        group,
        rest: rest.clone(),
        dir: dir || new THREE.Vector3(),
        meshes: [],
        labelOffset: labelOffset || new THREE.Vector3(0, 0.15, 0),
      };
      group.traverse((o) => {
        if (o.isMesh) {
          o.userData.partId = id;
          parts[id].meshes.push(o);
        }
      });
      return parts[id];
    }

    // suelo y sombra
    const grid = new THREE.GridHelper(6, 12, 0x9fb0a6, 0xc4d0c8);
    root.add(grid);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.1),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    root.add(shadow);

    // cuerpo transparente con aristas para que se note el contorno
    const bodyMat = material(0x2f9e6e, { transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    const bodyGroup = new THREE.Group();
    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(BODY.w, BODY.h, BODY.d), bodyMat);
    bodyGroup.add(bodyMesh);
    bodyGroup.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(bodyMesh.geometry),
        new THREE.LineBasicMaterial({ color: 0x1d6b4a })
      )
    );
    root.add(bodyGroup);
    register('body', bodyGroup, new THREE.Vector3(0, BODY.y, 0), null, new THREE.Vector3(0.62, 0.2, 0.45));
    state.bodyMat = bodyMat;

    const wheels = new THREE.Group();
    const wheelMat = material(0x1f2a2a);
    [-0.5, 0.5].forEach((x) =>
      [-0.3, 0.3].forEach((z) => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 20), wheelMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0, z);
        wheels.add(wheel);
      })
    );
    root.add(wheels);
    register('wheels', wheels, new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0.6, -0.05, 0.3));

    // residuos como un cubo escalado y cubitos encima
    const wasteMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material(0x8a7a5f, { roughness: 0.95 }));
    const waste = new THREE.Group();
    waste.add(wasteMesh);
    root.add(waste);
    register('waste', waste, new THREE.Vector3(0, 0, 0), null, new THREE.Vector3(-0.55, 0.05, 0.4));
    state.wasteMesh = wasteMesh;

    // semilla fija para que la basura se vea igual en cada carga
    const rng = Data.mulberry32(7);
    const debrisPalette = [0x3b6fd1, 0xd9d4c5, 0x4b9b6a, 0xc9a45c, 0xb04a4a];
    const debris = [];
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const size = 0.05 + rng() * 0.07;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(size, size * 0.6, size * 1.3),
        material(debrisPalette[Math.floor(rng() * debrisPalette.length)])
      );
      m.userData.size = size;
      m.userData.x = (rng() - 0.5) * 0.95;
      m.userData.z = (rng() - 0.5) * 0.6;
      m.rotation.set(rng() * 3, rng() * 3, rng() * 3);
      root.add(m);
      debris.push(m);
    }
    state.debris = debris;

    // plano rojo a la altura del umbral
    const planeGeo = new THREE.PlaneGeometry(1.1, 0.7);
    const plane = new THREE.Mesh(
      planeGeo,
      new THREE.MeshBasicMaterial({ color: 0xd62f3a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = surfaceY(ALERT_LEVEL / 100);
    plane.add(new THREE.LineSegments(new THREE.EdgesGeometry(planeGeo), new THREE.LineBasicMaterial({ color: 0xd62f3a })));
    root.add(plane);

    // la tapa lleva todo el equipo
    const lid = new THREE.Group();
    lid.add(new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.05, 0.86), material(0x24504b)));
    root.add(lid);
    const lidPart = register('lid', lid, new THREE.Vector3(0, LID_Y, 0), new THREE.Vector3(0, 0.75, 0), new THREE.Vector3(-0.55, 0.05, 0.43));

    // panel solar, un poco inclinado
    const solar = new THREE.Group();
    const solarPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.016, 0.26),
      new THREE.MeshStandardMaterial({ map: solarTexture(), roughness: 0.35, metalness: 0.3 })
    );
    solarPanel.rotation.z = 0.2;
    solar.add(solarPanel);
    lid.add(solar);
    register('solar', solar, new THREE.Vector3(-0.3, 0.08, 0.0), new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, 0.08, 0));

    // antena con tres anillos para la alerta
    const antenna = new THREE.Group();
    antenna.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.03, 16), material(0x1f2a2a)));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.22, 12), material(0x111818));
    mast.position.y = 0.125;
    antenna.add(mast);
    lid.add(antenna);
    register('antenna', antenna, new THREE.Vector3(0.45, 0.04, -0.25), new THREE.Vector3(0.3, 0.6, 0), new THREE.Vector3(0, 0.3, 0));

    const rings = [];
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.9, 1, 32),
        new THREE.MeshBasicMaterial({ color: 0xd62f3a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.position.y = 0.24;
      ring.userData.phase = i / 3;
      antenna.add(ring);
      rings.push(ring);
    }
    state.rings = rings;

    // sensor mirando hacia abajo
    const probe = new THREE.Group();
    const probeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 20), material(0x111818));
    probe.add(probeBody);
    const probeFace = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 20), material(0xb8c2bd, { metalness: 0.5 }));
    probeFace.position.y = -0.017;
    probe.add(probeFace);
    lid.add(probe);
    register('probe', probe, new THREE.Vector3(-0.1, -0.045, 0.0), new THREE.Vector3(-0.12, -0.45, 0.1), new THREE.Vector3(0, -0.12, 0));

    // caja con el módulo y la batería adentro
    const enclosure = new THREE.Group();
    const enclosureMat = material(0xdfe6e3, { transparent: true, opacity: 0.35, depthWrite: false });
    const enclosureBox = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.2), enclosureMat);
    enclosure.add(enclosureBox);
    enclosure.add(
      new THREE.LineSegments(new THREE.EdgesGeometry(enclosureBox.geometry), new THREE.LineBasicMaterial({ color: 0x5b6f6a }))
    );
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 12), new THREE.MeshBasicMaterial({ color: 0x2f9e6e }));
    led.position.set(0.1, 0, 0.102);
    enclosure.add(led);
    state.led = led;
    lid.add(enclosure);
    register('enclosure', enclosure, new THREE.Vector3(0.15, -0.09, 0), new THREE.Vector3(0.1, -0.3, 0), new THREE.Vector3(0.1, 0.1, 0));
    state.enclosureMat = enclosureMat;

    const pcb = new THREE.Group();
    pcb.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.15), material(0x1c7a4d)));
    const chip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.06), material(0x111818));
    chip.position.set(-0.04, 0.012, 0);
    pcb.add(chip);
    const can = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.04), material(0xc7ced0, { metalness: 0.7 }));
    can.position.set(0.05, 0.012, 0.03);
    pcb.add(can);
    enclosure.add(pcb);
    register('pcb', pcb, new THREE.Vector3(0, 0.014, 0), new THREE.Vector3(-0.35, 0.0, 0.4), new THREE.Vector3(0, 0.06, 0));

    const battery = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 18), material(0x2457e6, { metalness: 0.4 }));
    battery.rotation.z = Math.PI / 2;
    const batteryGroup = new THREE.Group();
    batteryGroup.add(battery);
    enclosure.add(batteryGroup);
    register('battery', batteryGroup, new THREE.Vector3(0, -0.03, 0), new THREE.Vector3(0.4, -0.1, 0.25), new THREE.Vector3(0, 0.05, 0));

    // cable del sensor a la caja; lo recalculo en cada cuadro
    const cableGeo = new THREE.BufferGeometry();
    cableGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const cable = new THREE.Line(cableGeo, new THREE.LineBasicMaterial({ color: 0x111818 }));
    cable.frustumCulled = false;
    root.add(cable);
    state.cable = cable;

    // cono del haz con el vértice en el sensor
    const beamGeo = new THREE.ConeGeometry(1, 1, 28, 1, true);
    beamGeo.translate(0, -0.5, 0); // el cono viene centrado; lo bajo medio alto para que el vértice quede en el origen
    const beam = new THREE.Mesh(
      beamGeo,
      new THREE.MeshBasicMaterial({ color: 0x2457e6, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.frustumCulled = false;
    root.add(beam);
    state.beam = beam;
    state.plane = plane;

    return { root, parts, state, lidPart };
  }

  // interfaz y animación

  function init() {
    const stage = document.getElementById('stage');
    const labelsEl = document.getElementById('labels');
    const fallback = document.getElementById('stage-fallback');

    // sin WebGL muestro el mensaje de respaldo en vez del modelo
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (err) {
      fallback.hidden = false;
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    stage.insertBefore(renderer.domElement, stage.firstChild);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
    const CAMERA_HOME = { pos: [2.7, 1.9, 3.3], target: [0, 0.95, 0] };

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.5;
    controls.maxDistance = 9;
    controls.maxPolarAngle = Math.PI * 0.495; // para que la cámara no pase del suelo
    controls.autoRotateSpeed = 1.4;

    function resetCamera() {
      camera.position.set(...CAMERA_HOME.pos);
      controls.target.set(...CAMERA_HOME.target);
      controls.update();
    }
    resetCamera();

    // luces
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c4bb, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(3, 5, 2);
    scene.add(sun);

    const model = buildModel();
    scene.add(model.root);
    const { parts, state } = model;

    // estado de los controles
    let explode = 0; // 0 a 1
    let fill = 0.45; // 0 a 1
    let selectedId = null;
    let showLabels = true;
    let showBeam = true;
    let glass = true;

    const $ = (id) => document.getElementById(id);
    const tmp = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();

    // botones HTML que siguen a cada pieza
    const labelNodes = {};
    Object.keys(PARTS).forEach((id) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'label';
      btn.textContent = PARTS[id].label;
      btn.addEventListener('click', () => select(id));
      labelsEl.appendChild(btn);
      labelNodes[id] = btn;
    });

    // muestra la ficha y resalta la pieza elegida
    function select(id) {
      selectedId = id;
      const info = PARTS[id];
      $('part-name').textContent = info.name;
      $('part-text').textContent = info.text;
      const list = $('part-specs');
      list.textContent = '';
      info.specs.forEach((s) => {
        const li = document.createElement('li');
        li.textContent = s;
        list.appendChild(li);
      });
      Object.keys(parts).forEach((pid) => {
        const on = pid === id;
        parts[pid].meshes.forEach((m) => {
          if (m.material && m.material.emissive) {
            m.material.emissive.setHex(on ? 0x1a41b3 : 0x000000);
            m.material.emissiveIntensity = on ? 0.55 : 1;
          }
        });
        labelNodes[pid].classList.toggle('is-selected', on);
      });
    }

    // llenado y separación
    function bandColor(pct) {
      return Config.LEVEL_BANDS.find((b) => pct >= b.min).color;
    }

    function applyFill() {
      const pct = Math.round(fill * 100);
      const top = surfaceY(fill);
      const h = Math.max(0.01, top - FLOOR_Y);
      state.wasteMesh.scale.set(1.1, h, 0.72);
      state.wasteMesh.position.set(0, FLOOR_Y + h / 2, 0);

      const visible = Math.round(fill * DEBRIS_COUNT);
      state.debris.forEach((m, i) => {
        m.visible = i < visible;
        m.position.set(m.userData.x, top + m.userData.size * 0.25, m.userData.z);
      });

      state.led.material.color.set(bandColor(pct));

      // distancia que mediría el sensor con el modelo sin separar
      const distanceCm = Math.round((PROBE_BOTTOM_REST - top) * 100);
      $('fill-out').textContent = `${pct} %`;
      $('reading').textContent =
        `El sensor mide ${distanceCm} cm hasta la superficie, que equivale a ${pct} % lleno.` +
        (pct >= ALERT_LEVEL ? ` Supera el umbral de ${ALERT_LEVEL} %: el módulo envía una alerta.` : '');
    }

    function applyExplode() {
      Object.values(parts).forEach((p) => {
        p.group.position.copy(p.rest).addScaledVector(p.dir, explode);
      });
    }

    function applyGlass() {
      state.bodyMat.opacity = glass ? 0.16 : 0.7;
      state.enclosureMat.opacity = glass ? 0.35 : 0.85;
    }

    // ayudas que recalculo en cada cuadro
    function updateGuides(time) {
      // el cable va del sensor a la caja, en coordenadas del mundo
      parts.probe.group.getWorldPosition(tmp);
      parts.enclosure.group.getWorldPosition(tmp2);
      const attr = state.cable.geometry.getAttribute('position');
      attr.setXYZ(0, tmp.x, tmp.y + 0.015, tmp.z);
      attr.setXYZ(1, tmp2.x, tmp2.y, tmp2.z);
      attr.needsUpdate = true;

      // el haz baja del sensor hasta los residuos; si ya no hay espacio lo oculto
      const bottomY = tmp.y - 0.02;
      const height = bottomY - surfaceY(fill);
      const beamOn = showBeam && height > 0.02;
      state.beam.visible = beamOn;
      if (beamOn) {
        const r = height * Math.tan(BEAM_HALF_ANGLE);
        state.beam.position.set(tmp.x, bottomY, tmp.z);
        state.beam.scale.set(r, height, r);
      }

      // los anillos solo salen si el nivel pasa el umbral
      const alert = Math.round(fill * 100) >= ALERT_LEVEL;
      state.rings.forEach((ring) => {
        ring.visible = alert;
        if (!alert) return;
        const t = (time * 0.0006 + ring.userData.phase) % 1;
        const s = 0.04 + t * 0.2;
        ring.scale.set(s, s, s);
        ring.rotation.x = Math.PI / 2;
        ring.material.opacity = 0.6 * (1 - t);
      });
    }

    function updateLabels() {
      labelsEl.hidden = !showLabels;
      if (!showLabels) return;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      Object.keys(parts).forEach((id) => {
        parts[id].group.getWorldPosition(tmp);
        tmp.add(parts[id].labelOffset);
        tmp.project(camera);
        const node = labelNodes[id];
        const hidden = tmp.z > 1;
        node.style.display = hidden ? 'none' : '';
        if (hidden) return;
        const x = (tmp.x * 0.5 + 0.5) * w;
        const y = (-tmp.y * 0.5 + 0.5) * h;
        node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      });
    }

    // selección con el puntero
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = null;

    renderer.domElement.addEventListener('pointerdown', (e) => {
      downAt = { x: e.clientX, y: e.clientY };
    });
    renderer.domElement.addEventListener('pointerup', (e) => {
      // si el puntero se movió fue un giro de cámara, no un clic
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(model.root, true).filter((h) => h.object.userData.partId);
      if (!hits.length) return;
      hits.sort(
        (a, b) =>
          PICK_ORDER.indexOf(a.object.userData.partId) - PICK_ORDER.indexOf(b.object.userData.partId) ||
          a.distance - b.distance
      );
      select(hits[0].object.userData.partId);
    });

    function resize() {
      const w = Math.max(1, stage.clientWidth);
      const h = Math.max(1, stage.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(stage);
    else window.addEventListener('resize', resize);
    resize();

    // controles del panel lateral
    $('explode').addEventListener('input', (e) => {
      explode = Number(e.target.value) / 100;
      applyExplode();
    });
    $('fill').addEventListener('input', (e) => {
      fill = Number(e.target.value) / 100;
      applyFill();
    });
    $('t-glass').addEventListener('change', (e) => {
      glass = e.target.checked;
      applyGlass();
    });
    $('t-labels').addEventListener('change', (e) => {
      showLabels = e.target.checked;
      labelsEl.hidden = !showLabels;
    });
    $('t-beam').addEventListener('change', (e) => (showBeam = e.target.checked));
    $('t-rotate').addEventListener('change', (e) => (controls.autoRotate = e.target.checked));
    $('btn-camera').addEventListener('click', resetCamera);

    // el giro automático arranca apagado; si el usuario prefiere menos movimiento lo deshabilito
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $('t-rotate').checked = false;
    controls.autoRotate = false;
    if (reduce) $('t-rotate').disabled = true;

    // recorrido del dato
    $('flow').innerHTML = FLOW.map(
      ([title, text]) => `<li class="flow__item"><strong>${title}</strong><span>${text}</span></li>`
    ).join('');

    // primer dibujo y animación
    applyFill();
    applyExplode();
    applyGlass();

    let running = true;
    document.addEventListener('visibilitychange', () => {
      running = !document.hidden;
      if (running) requestAnimationFrame(loop);
    });

    function loop(time) {
      if (!running) return;
      controls.update();
      updateGuides(time || 0);
      updateLabels();
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // empiezo con el sensor seleccionado
    select('probe');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
