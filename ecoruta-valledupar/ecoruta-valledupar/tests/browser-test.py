"""Prueba de navegador del prototipo con Playwright. Sin Internet, uso los stubs de tests/stubs
en vez de las librerías externas y simulo OSRM. Compruebo la lógica y la estructura, no el dibujo real.
Uso: python tests/browser-test.py CARPETA_DE_CAPTURAS"""
import json
import math
import re
import sys
import threading
import http.server
import socketserver
from functools import partial
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots')
SHOTS.mkdir(parents=True, exist_ok=True)

results = []


def check(name, cond, extra=''):
    results.append((name, bool(cond)))
    print(('  ok   ' if cond else '  FALLA ') + name + (f'  [{extra}]' if extra and not cond else ''))


# servidor local
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


handler = partial(Quiet, directory=str(ROOT))
httpd = socketserver.TCPServer(('127.0.0.1', 0), handler)
PORT = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{PORT}'


# OSRM simulado
def hav(a, b):
    r = 6371000
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def parse_coords(url):
    seg = re.search(r'/driving/([^?]+)', url).group(1)
    return [tuple(float(v) for v in p.split(',')) for p in seg.split(';')]


def osrm_table(url):
    pts = parse_coords(url)
    dist = [[hav(a, b) * 1.3 for b in pts] for a in pts]
    dur = [[d / 6.1 for d in row] for row in dist]
    sources = [{'location': [p[0] + 0.0001, p[1] + 0.0001], 'name': 'Calle 15', 'distance': 14.2} for p in pts]
    return {'code': 'Ok', 'durations': dur, 'distances': dist, 'sources': sources, 'destinations': sources}


def osrm_route(url):
    pts = parse_coords(url)
    legs = []
    for a, b in zip(pts, pts[1:]):
        elbow = (b[0], a[1])
        d1, d2 = hav(a, elbow) * 1.1, hav(elbow, b) * 1.1
        steps = [
            {'maneuver': {'type': 'depart'}, 'name': 'Calle 15', 'distance': d1,
             'geometry': {'coordinates': [list(a), list(elbow)]}},
            {'maneuver': {'type': 'turn', 'modifier': 'left'}, 'name': 'Carrera 9', 'distance': d2,
             'geometry': {'coordinates': [list(elbow), list(b)]}},
            {'maneuver': {'type': 'arrive'}, 'name': 'Carrera 9', 'distance': 0,
             'geometry': {'coordinates': [list(b)]}},
        ]
        legs.append({'distance': d1 + d2, 'duration': (d1 + d2) / 6.1, 'steps': steps})
    return {'code': 'Ok', 'routes': [{'distance': sum(l['distance'] for l in legs),
                                       'duration': sum(l['duration'] for l in legs), 'legs': legs}]}


def make_router(osrm_up):
    def handle(route):
        url = route.request.url
        if 'router.project-osrm.org' in url:
            if not osrm_up:
                return route.abort()
            body = osrm_table(url) if '/table/' in url else osrm_route(url)
            return route.fulfill(status=200, content_type='application/json', body=json.dumps(body))
        if 'leaflet.min.js' in url:
            return route.fulfill(status=200, content_type='text/javascript', body=(ROOT / 'tests/stubs/leaflet-stub.js').read_text())
        if 'three.min.js' in url:
            return route.fulfill(status=200, content_type='text/javascript', body=(ROOT / 'tests/stubs/three-stub.js').read_text())
        if 'OrbitControls.js' in url:
            return route.fulfill(status=200, content_type='text/javascript', body='')
        if ('fonts.googleapis' in url or url.endswith('.css')) and '127.0.0.1' not in url:
            return route.fulfill(status=200, content_type='text/css', body='')
        if 'fonts.gstatic' in url or 'tile.openstreetmap' in url:
            return route.fulfill(status=204, body='')
        return route.continue_()
    return handle


def new_context(browser, osrm_up=True, width=1366, height=820):
    ctx = browser.new_context(viewport={'width': width, 'height': height})
    ctx.route('**/*', make_router(osrm_up))
    return ctx


def watch(page, errors):
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.on('console', lambda m: errors.append(f'console: {m.text}') if m.type == 'error' else None)


with sync_playwright() as p:
    browser = p.chromium.launch()

    # portada
    print('Portada')
    ctx = new_context(browser)
    errors = []
    page = ctx.new_page()
    watch(page, errors)
    page.goto(BASE + '/index.html')
    page.wait_for_selector('.tank')
    check('14 contenedores de demostración', page.locator('.tank').count() == 14)
    check('encabezado con 5 enlaces', page.locator('.site-nav a').count() == 5)
    before = page.inner_text('#demo-summary')
    page.fill('#demo-threshold', '90')
    page.dispatch_event('#demo-threshold', 'input')
    after = page.inner_text('#demo-summary')
    check('el umbral cambia el resumen', before != after, f'{before} | {after}')
    page.wait_for_timeout(1800)
    page.screenshot(path=str(SHOTS / 'index.png'))
    for href in ['dashboard.html', 'hardware.html', 'conductor.html', 'proyecto.html']:
        check(f'index enlaza {href}', page.locator(f'a[href="{href}"]').count() >= 1)
    check('portada sin errores', not errors, '; '.join(errors))
    ctx.close()

    # panel con OSRM
    print('Panel (OSRM simulado)')
    ctx = new_context(browser)
    errors = []
    page = ctx.new_page()
    watch(page, errors)
    page.goto(BASE + '/dashboard.html')
    page.wait_for_function("document.getElementById('routing-badge').dataset.mode")
    check('modo OSRM detectado', page.get_attribute('#routing-badge', 'data-mode') == 'osrm')
    check('53 marcadores', page.locator('.pin').count() == 53, str(page.locator('.pin').count()))
    check('53 filas en la lista', page.locator('.crow').count() == 53)
    check('KPI total = 53', page.inner_text('#kpi-total') == '53')

    crit80 = int(page.inner_text('#kpi-crit'))
    page.click('.chip[data-threshold="90"]')
    crit90 = int(page.inner_text('#kpi-crit'))
    check('umbral 90 % deja menos o igual críticos que 80 %', crit90 <= crit80, f'{crit80} -> {crit90}')
    page.click('.chip[data-threshold="80"]')
    check('chip 80 % marcado', page.get_attribute('.chip[data-threshold="80"]', 'aria-pressed') == 'true')

    order = page.eval_on_selector_all('.crow__pct', 'els => els.map(e => parseInt(e.textContent))')
    check('lista ordenada de mayor a menor', order == sorted(order, reverse=True))

    page.check('#only-critical', force=True)
    page.wait_for_selector('.rcard', timeout=8000)
    check('1 tarjeta de ruta con 1 camión', page.locator('.rcard').count() == 1)
    check('lista solo muestra críticos', page.locator('.crow').count() == crit80, str(page.locator('.crow').count()))
    check('panel de ahorro visible', page.is_visible('#savings'))
    check('la ruta se dibuja', page.locator('svg path').count() >= 2)
    check('insignia de rutas reales', 'calles reales' in page.inner_text('#routing-badge'))
    seqs = page.locator('.pin__seq').count()
    check('números de visita en marcadores', seqs == crit80, f'{seqs} vs {crit80}')
    saved = page.inner_text('#kpi-save')
    check('KPI de ahorro con km', 'km' in saved, saved)
    page.screenshot(path=str(SHOTS / 'dashboard-route.png'))

    page.select_option('#trucks', '3')
    page.wait_for_function("document.querySelectorAll('.rcard').length === 3", timeout=8000)
    check('3 camiones = 3 tarjetas', page.locator('.rcard').count() == 3)
    colors = page.eval_on_selector_all('.rcard', 'els => els.map(e => e.style.getPropertyValue("--c"))')
    check('colores distintos por camión', len(set(colors)) == 3, str(colors))
    plan = json.loads(page.evaluate("localStorage.getItem('ecoruta.plan.v1')"))
    all_stops = [s for r in plan['routes'] for s in r['stops']]
    check('cada crítico en una sola ruta', len(all_stops) == len(set(all_stops)) == crit80)
    page.screenshot(path=str(SHOTS / 'dashboard-3trucks.png'))

    # recoger desde el mapa
    first_id = plan['routes'][0]['stops'][0]
    created = plan['createdAt']
    page.click('#tab-list')
    page.locator('.crow', has_text=first_id).first.click()
    page.wait_for_selector('.stub-popup')
    check('popup con el contenedor', first_id in page.inner_text('.stub-popup'))
    page.click('.stub-popup [data-collect]')
    page.wait_for_timeout(700)
    lvl = json.loads(page.evaluate("localStorage.getItem('ecoruta.state.v1')"))['levels'][first_id]
    check('recolectar deja el nivel en 0', lvl == 0, str(lvl))
    plan2 = json.loads(page.evaluate("localStorage.getItem('ecoruta.plan.v1')"))
    check('recolectar no recalcula la ruta', plan2['createdAt'] == created)
    check('queda marcado como hecho', plan2['done'].get(first_id) is True)

    # simulación
    page.click('#btn-sim')
    s0 = json.loads(page.evaluate("localStorage.getItem('ecoruta.state.v1')"))['levels']
    page.wait_for_timeout(4600)
    s1 = json.loads(page.evaluate("localStorage.getItem('ecoruta.state.v1')"))['levels']
    changed = sum(1 for k in s0 if s1[k] != s0[k])
    check('la simulación sube niveles', changed > 20, str(changed))
    page.click('#btn-sim')

    # búsqueda y reinicio
    page.uncheck('#only-critical', force=True)
    page.click('#tab-list')
    page.fill('#search', 'CEN')
    page.dispatch_event('#search', 'input')
    check('búsqueda por barrio', 0 < page.locator('.crow').count() < 53)
    page.fill('#search', '')
    page.dispatch_event('#search', 'input')
    page.click('#btn-reset')
    page.wait_for_timeout(400)
    check('reiniciar restaura 53 filas', page.locator('.crow').count() == 53)
    check('reiniciar borra la ruta', page.evaluate("localStorage.getItem('ecoruta.plan.v1')") is None)
    check('panel sin errores', not errors, '; '.join(errors[:3]))
    ctx.close()

    # conductor
    print('Conductor')
    ctx = new_context(browser, width=390, height=844)
    errors = []
    page = ctx.new_page()
    watch(page, errors)
    page.goto(BASE + '/conductor.html')
    page.wait_for_selector('#empty:not([hidden])')
    check('sin ruta: invita al panel', page.locator('#empty a[href="dashboard.html"]').count() == 1)

    dash = ctx.new_page()
    watch(dash, errors)
    dash.goto(BASE + '/dashboard.html')
    dash.wait_for_function("document.getElementById('routing-badge').dataset.mode")
    dash.check('#only-critical', force=True)
    dash.wait_for_selector('.rcard', timeout=8000)

    page.wait_for_selector('#driver:not([hidden])', timeout=5000)
    check('el conductor recibe la ruta de otra pestaña', page.is_visible('#driver'))
    plan = json.loads(page.evaluate("localStorage.getItem('ecoruta.plan.v1')"))
    stops = plan['routes'][0]['stops']
    check('próxima parada = primera de la ruta', page.inner_text('#stop-title') == stops[0], page.inner_text('#stop-title'))
    check('indicaciones en español', page.locator('#steps li').count() >= 2 and 'Salga' in page.inner_text('#steps'))
    page.screenshot(path=str(SHOTS / 'conductor-mobile.png'))

    page.click('#btn-drive')
    page.wait_for_selector('#btn-collect.btn--ready', timeout=15000)
    page.click('#btn-collect')
    page.wait_for_timeout(500)
    check('avanza a la siguiente parada', len(stops) < 2 or page.inner_text('#stop-title') == stops[1], page.inner_text('#stop-title'))
    check('progreso 1 recolectado', page.inner_text('#progress-text').startswith('1 de'))
    created = plan['createdAt']
    plan_after = json.loads(page.evaluate("localStorage.getItem('ecoruta.plan.v1')"))
    check('el panel no recalcula al recolectar', plan_after['createdAt'] == created)
    dash.wait_for_timeout(600)
    check('el panel refleja lo recolectado', dash.locator('.rcard').first.inner_text().count('por recolectar') == 1)

    for s in stops[1:]:
        page.click('#btn-collect')
        page.wait_for_timeout(250)
    check('ruta completa', 'Regrese' in page.inner_text('#stop-title'), page.inner_text('#stop-title'))
    check('botón recolectar oculto al terminar', not page.is_visible('#btn-collect'))
    check('conductor sin errores', not errors, '; '.join(errors[:3]))
    ctx.close()

    # sin OSRM
    print('Panel sin OSRM')
    ctx = new_context(browser, osrm_up=False)
    errors = []
    page = ctx.new_page()
    watch(page, [])
    page.goto(BASE + '/dashboard.html')
    page.wait_for_function("document.getElementById('routing-badge').dataset.mode", timeout=15000)
    check('modo estimado', page.get_attribute('#routing-badge', 'data-mode') == 'estimada')
    page.check('#only-critical', force=True)
    page.wait_for_selector('.rcard', timeout=8000)
    check('igual se crea la ruta', page.locator('.rcard').count() == 1)
    check('insignia avisa que es estimada', 'estimadas' in page.inner_text('#routing-badge'))
    dashes = page.locator('svg path[stroke-dasharray]').count()
    check('ruta estimada punteada', dashes >= 1, str(dashes))
    page.screenshot(path=str(SHOTS / 'dashboard-estimada.png'))
    ctx.close()

    # hardware
    print('Hardware 3D')
    ctx = new_context(browser)
    errors = []
    page = ctx.new_page()
    watch(page, errors)
    page.goto(BASE + '/hardware.html')
    page.wait_for_selector('.label')
    check('10 etiquetas de piezas', page.locator('.label').count() == 10, str(page.locator('.label').count()))
    page.wait_for_timeout(300)
    check('el ciclo de dibujo corre', page.evaluate('globalThis.__threeFrames') > 3)
    r0 = page.inner_text('#reading')
    page.fill('#fill', '90')
    page.dispatch_event('#fill', 'input')
    r1 = page.inner_text('#reading')
    check('la lectura cambia con el llenado', r0 != r1 and '90 %' in r1 and 'umbral' in r1, r1)
    page.locator('.label', has_text='Antena').dispatch_event('click')
    check('la ficha cambia al elegir pieza', page.inner_text('#part-name') == 'Antena LoRa')
    page.fill('#explode', '100')
    page.dispatch_event('#explode', 'input')
    check('5 etapas del recorrido del dato', page.locator('.flow__item').count() == 5)
    page.uncheck('#t-labels', force=True)
    check('etiquetas se ocultan', not page.is_visible('#labels'))
    page.screenshot(path=str(SHOTS / 'hardware.png'))
    check('hardware sin errores', not errors, '; '.join(errors[:3]))
    ctx.close()

    # documentación
    print('Documentación')
    ctx = new_context(browser)
    errors = []
    page = ctx.new_page()
    watch(page, errors)
    page.goto(BASE + '/proyecto.html')
    check('tabla de funciones', page.locator('tbody tr').count() >= 10)
    check('pie de página con autoría', 'Domínguez' in page.inner_text('.site-footer'))
    page.screenshot(path=str(SHOTS / 'proyecto.png'), full_page=True)
    check('documentación sin errores', not errors, '; '.join(errors))
    ctx.close()

    browser.close()

httpd.shutdown()
failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)} correctas, {len(failed)} con fallo')
sys.exit(1 if failed else 0)
