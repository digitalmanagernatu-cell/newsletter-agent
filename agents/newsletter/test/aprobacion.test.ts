// Flujo de aprobación con base de datos real (DATABASE_URL de pruebas) y Mailrelay simulado.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { q, emitirAprobacion, cerrarDb } from '@natu/shared';

const conBd = !!process.env.DATABASE_URL_TEST;
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
process.env.APPROVAL_SECRET = 'x'.repeat(40);
delete process.env.N8N_EVENTS_URL;

const llamadas: { url: string; metodo: string; cuerpo: any }[] = [];
const fetchOriginal = globalThis.fetch;
let peticionId = '';

before(async () => {
  if (!conBd) return;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    llamadas.push({ url: String(url), metodo: init.method ?? 'GET', cuerpo: init.body ? JSON.parse(String(init.body)) : undefined });
    if (String(url).includes('/send_all')) return new Response('{"id":555}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const [p] = await q(`INSERT INTO newsletter.peticiones (marca, peticion, solicitante, estado) VALUES ('betreson', '{"objetivo":"test"}', 'a@natuaromatic.com', 'prueba_enviada') RETURNING id`);
  peticionId = p.id;
  for (const [enfoque, camp] of [['editorial', '901'], ['comercial', '902']]) {
    const [v] = await q(`INSERT INTO newsletter.versiones (peticion_id, numero, enfoque, composicion, mjml, html) VALUES ($1, 1, $2, '{"asunto":"A","preheader":"P"}', '', '') RETURNING id`, [peticionId, enfoque]);
    await q(`INSERT INTO newsletter.campanas (version_id, plataforma, id_externo, destino) VALUES ($1, 'mailrelay', $2, '{}')`, [v.id, camp]);
  }
});
after(async () => { globalThis.fetch = fetchOriginal; if (conBd) await cerrarDb(); });

test('aprobar programa una sola vez, en UTC, y descarta la otra propuesta', { skip: !conBd }, async () => {
  const { aprobarYProgramar } = await import('../src/aprobacion.js');
  const [v] = await q(`SELECT id FROM newsletter.versiones WHERE peticion_id = $1 AND enfoque = 'comercial'`, [peticionId]);
  const recurso = `newsletter.peticion:${peticionId}`;
  const { token } = await emitirAprobacion({ agente: 'newsletter', accion: 'programar_campana', recurso, parametros: { version_id: v.id, enfoque: 'comercial', ronda: 1, campana_mailrelay: 902, fecha_envio: '2030-01-15T09:30' } });
  const { token: otro } = await emitirAprobacion({ agente: 'newsletter', accion: 'programar_campana', recurso, parametros: { version_id: v.id, enfoque: 'editorial', ronda: 1, campana_mailrelay: 901, fecha_envio: '2030-01-15T09:30' } });

  await assert.rejects(aprobarYProgramar(token, 'alguien@gmail.com'), /email de la empresa/);
  await assert.rejects(aprobarYProgramar(token + 'x', 'irene@natuaromatic.com'), /no válido/);
  await assert.rejects(aprobarYProgramar(token, 'irene@natuaromatic.com', '2020-01-01T10:00'), /ya ha pasado/);
  assert.equal(llamadas.filter((l) => l.url.includes('send_all')).length, 0);

  const r = await aprobarYProgramar(token, 'Irene@NatuAromatic.com');
  const envios = llamadas.filter((l) => l.url.includes('/send_all'));
  assert.equal(envios.length, 1);
  assert.match(envios[0].url, /\/campaigns\/902\/send_all$/);
  assert.equal(envios[0].cuerpo.scheduled_at, '2030-01-15 08:30:00'); // 09:30 Madrid = 08:30 UTC en invierno
  assert.deepEqual(envios[0].cuerpo.group_ids, [6]);
  assert.equal(r.aprobador, 'irene@natuaromatic.com');

  await assert.rejects(aprobarYProgramar(token, 'irene@natuaromatic.com'), /ya se ha usado|ya está programada/);
  await assert.rejects(aprobarYProgramar(otro, 'irene@natuaromatic.com'), /ya no es válido|ya está programada/);
  assert.equal(llamadas.filter((l) => l.url.includes('send_all')).length, 1);

  const estados = await q(`SELECT c.id_externo, c.estado, c.id_envio FROM newsletter.campanas c JOIN newsletter.versiones v ON v.id = c.version_id WHERE v.peticion_id = $1 ORDER BY 1`, [peticionId]);
  assert.deepEqual(estados.map((e) => [e.id_externo, e.estado]), [['901', 'descartada'], ['902', 'programada']]);
  const [pet] = await q('SELECT estado FROM newsletter.peticiones WHERE id = $1', [peticionId]);
  assert.equal(pet.estado, 'programada');
  const [ev] = await q(`SELECT actor FROM shared.eventos WHERE recurso = $1 AND tipo = 'aprobada_y_programada'`, [recurso]);
  assert.equal(ev.actor, 'irene@natuaromatic.com');
});

test('si Mailrelay falla, el enlace sigue sirviendo', { skip: !conBd }, async () => {
  const { aprobarYProgramar } = await import('../src/aprobacion.js');
  const [p] = await q(`INSERT INTO newsletter.peticiones (marca, peticion, estado) VALUES ('betreson', '{}', 'prueba_enviada') RETURNING id`);
  const [v] = await q(`INSERT INTO newsletter.versiones (peticion_id, numero, enfoque, composicion, mjml, html) VALUES ($1, 1, 'comercial', '{}', '', '') RETURNING id`, [p.id]);
  await q(`INSERT INTO newsletter.campanas (version_id, plataforma, id_externo, destino) VALUES ($1, 'mailrelay', '903', '{}')`, [v.id]);
  const { token } = await emitirAprobacion({ agente: 'newsletter', accion: 'programar_campana', recurso: `newsletter.peticion:${p.id}`, parametros: { version_id: v.id, enfoque: 'comercial', ronda: 1, campana_mailrelay: 903, fecha_envio: '2030-02-01T10:00' } });
  globalThis.fetch = (async () => new Response('{"error":"x"}', { status: 422 })) as typeof fetch;
  await assert.rejects(aprobarYProgramar(token, 'irene@natuaromatic.com'), /Mailrelay 422/);
  const [a] = await q(`SELECT estado FROM shared.aprobaciones WHERE recurso = $1`, [`newsletter.peticion:${p.id}`]);
  assert.equal(a.estado, 'emitida');
});
