import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarKit } from '../src/brand.js';
import { componerMjml } from '../src/layout.js';
import { compilar } from '../src/render.js';
import { revisarReglas } from '../src/lint.js';
import { ComposicionSchema } from '../src/schema.js';

const IMG = 'https://assets.ipzmarketing.com/data/47c03f282c326e732cba24458db095632f9aa559/media_files/156/original/PETS.png';
const base = ComposicionSchema.parse({
  asunto: 'Prueba de render', preheader: 'Preheader de prueba para comprobar el render completo',
  bloques: [
    { block: 'hero', src: IMG, alt: 'Gama Pets' },
    { block: 'title', title_html: 'Hola <em>farmacia</em>', eyebrow: 'Prueba', subtitle: 'Sub' },
    { block: 'text', html: '<p>Texto con <mark>destacado</mark> y <strong>negrita</strong>.</p><script>alert(1)</script>' },
    { block: 'product_rows', items: [{ name: 'A', image: IMG, description_html: 'desc' }, { name: 'B', image: IMG }] },
    { block: 'product_grid', columns: 2, items: [{ name: 'A' }, { name: 'B' }] },
    { block: 'price_table', title: 'Precios', rows: [{ label: '12 a 132', value: '1,17 €/ud' }] },
    { block: 'highlight_box', html: '<p>Dato</p>' }, { block: 'quote', text: 'Cita' }, { block: 'banner', text: 'Navidad' },
    { block: 'bullets', items_html: ['uno', 'dos'] }, { block: 'cta', text_html: '<strong>Haz tu pedido</strong>' },
    { block: 'divider' }, { block: 'spacer', height: 20 },
  ],
});

test('BetrésON compila sin errores MJML y con pie legal y baja', () => {
  const kit = cargarKit('betreson');
  const { html, errores } = compilar(componerMjml(kit, base));
  assert.deepEqual(errores, []);
  assert.ok(html.includes('[unsubscribe_url_click]'));
  assert.ok(html.includes('pedidosbetreson@natuaromatic.com'));
  assert.ok(!html.includes('<script>'));
  const avisos = revisarReglas(kit, base, html, errores);
  assert.equal(avisos.filter((a) => a.nivel === 'error').length, 0, JSON.stringify(avisos));
});

test('detecta palabra prohibida y baja codificada', () => {
  const kit = cargarKit('betreson');
  const comp = { ...base, asunto: 'Novedades de higiene corporal' };
  const html = compilar(componerMjml(kit, comp)).html.replace('[unsubscribe_url_click]', '%5Bunsubscribe_url_click%5D');
  const reglas = revisarReglas(kit, comp, html, []).filter((a) => a.nivel === 'error').map((a) => a.regla);
  assert.ok(reglas.includes('tono'));
  assert.ok(reglas.includes('baja'));
});
