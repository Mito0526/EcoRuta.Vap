/*
 * three-stub.js: sustituto de Three.js y OrbitControls que usé solo para probar sin internet.
 * Guarda una escena simple para que hardware3d.js corra completo, pero no dibuja nada.
 */
(function () {
  'use strict';

  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { return this.set(v.x, v.y, v.z); }
    clone() { return new Vector3(this.x, this.y, this.z); }
    add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
    addScaledVector(v, s) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
    project() { this.x = 0; this.y = 0; this.z = 0.5; return this; }
  }

  class Obj {
    constructor(geometry, material) {
      this.children = [];
      this.parent = null;
      this.position = new Vector3();
      this.rotation = new Vector3();
      this.scale = new Vector3(1, 1, 1);
      this.visible = true;
      this.userData = {};
      this.geometry = geometry && geometry.isGeometry ? geometry : undefined;
      this.material = material;
      if (geometry && geometry.isGeometry) this.isMesh = Boolean(material);
    }
    add(...objs) { objs.forEach((o) => { o.parent = this; this.children.push(o); }); return this; }
    traverse(fn) { fn(this); this.children.forEach((c) => c.traverse(fn)); }
    getWorldPosition(v) {
      let x = 0, y = 0, z = 0;
      for (let o = this; o; o = o.parent) { x += o.position.x; y += o.position.y; z += o.position.z; }
      return v.set(x, y, z);
    }
  }

  class Geo {
    constructor() { this.isGeometry = true; this._attrs = {}; }
    translate() { return this; }
    setAttribute(n, a) { this._attrs[n] = a; }
    getAttribute(n) { return this._attrs[n] || { setXYZ() {}, needsUpdate: false }; }
  }

  class Color {
    constructor() { this.hex = 0; }
    set(v) { this.hex = v; return this; }
    setHex(v) { this.hex = v; return this; }
  }

  class Mat {
    constructor(opts) { Object.assign(this, { opacity: 1 }, opts); this.color = new Color(); this.emissive = new Color(); }
  }

  class Renderer {
    constructor() { this.domElement = document.createElement('canvas'); this.frames = 0; }
    setPixelRatio() {}
    setSize() {}
    render() { this.frames++; globalThis.__threeFrames = this.frames; }
  }

  class Raycaster {
    setFromCamera() {}
    intersectObject() { return []; }
  }

  class Controls {
    constructor() { this.target = new Vector3(); this.autoRotate = false; }
    update() {}
  }

  const known = {
    Vector3,
    Vector2: Vector3,
    Group: Obj,
    Mesh: Obj,
    Line: Obj,
    LineSegments: Obj,
    Scene: Obj,
    PerspectiveCamera: class extends Obj { updateProjectionMatrix() {} },
    WebGLRenderer: Renderer,
    Raycaster,
    BufferAttribute: class { setXYZ() {} },
    Float32Array,
    BufferGeometry: Geo,
    DoubleSide: 2,
    OrbitControls: Controls,
  };

  globalThis.THREE = new Proxy(known, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key !== 'string') return undefined;
      if (/Geometry$/.test(key)) return Geo;
      if (/Material$/.test(key)) return Mat;
      return Obj; // luces, helpers y texturas caen aquí
    },
  });
})();
