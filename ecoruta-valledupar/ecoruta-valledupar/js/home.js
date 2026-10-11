// Demo de la portada: 14 contenedores de ejemplo y un slider de umbral. No usa el mapa.
(function () {
  'use strict';

  const { Config } = globalThis.EcoRuta;

  // dejo los niveles fijos para que la demo siempre se vea igual
  const LEVELS = [22, 91, 48, 84, 12, 67, 95, 31, 78, 58, 88, 15, 73, 42];

  function colorFor(level) {
    const band = Config.LEVEL_BANDS.find((b) => level >= b.min);
    return band.color;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const tanksEl = document.getElementById('demo-tanks');
    const slider = document.getElementById('demo-threshold');
    const out = document.getElementById('demo-threshold-out');
    const summary = document.getElementById('demo-summary');
    if (!tanksEl || !slider) return;

    // dibujo cada contenedor
    const tanks = LEVELS.map((level) => {
      const tank = document.createElement('div');
      tank.className = 'tank';
      tank.title = level + ' %';
      const fill = document.createElement('div');
      fill.className = 'tank__fill';
      fill.style.setProperty('--level', level + '%');
      fill.style.setProperty('--tank-color', colorFor(level));
      tank.appendChild(fill);
      tanksEl.appendChild(tank);
      return { tank, fill, level };
    });

    // al cargar se llenan uno después de otro
    requestAnimationFrame(() => {
      tanks.forEach((t, i) => setTimeout(() => t.fill.classList.add('tank__fill--ready'), 80 * i));
    });

    // marca los que están por encima del umbral
    function update() {
      const threshold = Number(slider.value);
      out.textContent = threshold + ' %';
      let over = 0;
      tanks.forEach((t) => {
        const isOver = t.level >= threshold;
        t.tank.classList.toggle('tank--over', isOver);
        if (isOver) over++;
      });
      const rest = tanks.length - over;
      summary.innerHTML =
        `<strong>${over} de ${tanks.length}</strong> contenedores entran en la ruta de hoy. ` +
        `Los otros ${rest} se quedan sin visita.`;
    }

    slider.addEventListener('input', update);
    update();
  });
})();
