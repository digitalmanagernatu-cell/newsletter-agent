// Flujo de aprobación con base de datos real (DATABASE_URL_TEST) y plataformas simuladas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { q, emitirAprobacion, cerrarDb } from '@natu/shared';

const conBd = !!process.env.DATABASE_URL_TEST;
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
process.env.APPROVAL_SECRET = 'x'.repeat(40);
delete process.env.N8N_EVENTS_URL;
delete process.env.MAILRELAY_GROUP_IDS;
delete process.env.MAILCHIMP_SEGMENT_OVERRIDE;

type Llamada = { url: string; metodo: string; cuerpo: any };
let llamadas: Llamada[] = [];
let responder: (l: Llamada) => Response = () => new Response('{}', { status: 200 });
const fetchOriginal = globalThis.fetch;

before(() => {
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const l = { url: String(url), metodo: init.method ?? 'GET', cuerpo: init.body ? JSON.parse(String(init.body)) : undefined };
    llamadas.push(l);
    return responder(l);
  }) as typeof fetch;
});
after(async () => { globalThis.fetch = fetchOriginal; if (conBd) await cerrarDb(); });

async function peticionCon(marca: 'betreson' | 'natu', camps: [string, string, string][]) {
  const [p] = await q(`INSERT INTO newsletter.peticiones (marca, peticion, solicitante, estado) VALUES ($1, '{"objetivo":"test"}', 'a@natuaromatic.com', 'prueba_enviada') RETURNING id`, [marca]);
  const campanas = [];
  const sufijo = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
  for (const [enfoque, idioma, base] of camps) {
    const id = marca === 'betreson' ? `${base}${sufijo}` : `${base}-${sufijo}`;
    const [v] = await q(`INSERT INTO newsletter.versiones (peticion_id, numero, enfoque, idioma, composicion, mjml, html) VALUES ($1, 1, $2, $3, '{"asunto":"A","preheader":"P"}', '', '') RETURNING id`, [p.id, enfoque, idioma]);
    await q(`INSERT INTO newsletter.campanas (version_id, plataforma, id_externo, destino) VALUES ($1, $2, $3, '{}')`, [v.id, marca === 'natu' ? 'mailchimp' : 'mailrelay', id]);
    campanas.push({ enfoque, id, idioma, version_id: v.id });
  }
  return { id: p.id as string, recurso: `newsletter.peticion:${p.id}`, campanas };
}

const token = async (pet: Awaited<ReturnType<typeof peticionCon>>, enfoque: string, plataforma: string, fecha: string) =>
  (await emitirAprobacion({ agente: 'newsletter', accion: 'programar_campana', recurso: pet.recurso,
    parametros: { enfoque, ronda: 1, plataforma, fecha_envio: fecha, campanas: pet.campanas.filter((c) => c.enfoque === enfoque).map(({ id, idioma, version_id }) => ({ id, idioma, version_id })) } })).token;

test('BetrésON: aprobar programa una sola vez, en UTC, y descarta la otra propuesta', { skip: !conBd }, async () => {
  const { aprobarYProgramar } = await import('../src/aprobacion.js');
  llamadas = []; responder = (l) => new Response(l.url.includes('/send_all') ? '{"id":555}' : '{}', { status: 200 });
  const pet = await peticionCon('betreson', [['editorial', 'es', '901'], ['comercial', 'es', '902']]);
  const t = await token(pet, 'comercial', 'mailrelay', '2030-01-15T09:30');
  const otro = await token(pet, 'editorial', 'mailrelay', '2030-01-15T09:30');

  await assert.rejects(aprobarYProgramar(t, 'alguien@gmail.com'), /email de la empresa/);
  await assert.rejects(aprobarYProgramar(t + 'x', 'irene@natuaromatic.com'), /no válido/);
  await assert.rejects(aprobarYProgramar(t, 'irene@natuaromatic.com', '2020-01-01T10:00'), /ya ha pasado/);
  assert.equal(llamadas.filter((l) => l.url.includes('send_all')).length, 0);

  const r = await aprobarYProgramar(t, 'Irene@NatuAromatic.com');
  const envios = llamadas.filter((l) => l.url.includes('/send_all'));
  assert.equal(envios.length, 1);
  assert.match(envios[0].url, /\/campaigns\/902\d{6}\/send_all$/);
  assert.equal(envios[0].cuerpo.scheduled_at, '2030-01-15 08:30:00');
  assert.deepEqual(envios[0].cuerpo.group_ids, [6]);
  assert.equal(r.aprobador, 'irene@natuaromatic.com');

  await assert.rejects(aprobarYProgramar(t, 'irene@natuaromatic.com'), /ya se ha usado|ya está programada/);
  await assert.rejects(aprobarYProgramar(otro, 'irene@natuaromatic.com'), /ya no es válido|ya está programada/);
  assert.equal(llamadas.filter((l) => l.url.includes('send_all')).length, 1);
  const estados = await q(`SELECT c.id_externo, c.estado FROM newsletter.campanas c JOIN newsletter.versiones v ON v.id = c.version_id WHERE v.peticion_id = $1 ORDER BY 1`, [pet.id]);
  assert.deepEqual(estados.map((e) => [e.id_externo.slice(0, 3), e.estado]), [['901', 'descartada'], ['902', 'programada']]);
});

test('BetrésON: si Mailrelay falla, el enlace sigue sirviendo', { skip: !conBd }, async () => {
  const { aprobarYProgramar } = await import('../src/aprobacion.js');
  responder = () => new Response('{"error":"x"}', { status: 422 });
  const pet = await peticionCon('betreson', [['comercial', 'es', '903']]);
  const t = await token(pet, 'comercial', 'mailrelay', '2030-02-01T10:00');
  await assert.rejects(aprobarYProgramar(t, 'irene@natuaromatic.com'), /Mailrelay 422/);
  const [a] = await q(`SELECT estado FROM shared.aprobaciones WHERE recurso = $1`, [pet.recurso]);
  assert.equal(a.estado, 'emitida');
});

const SEGMENTOS: Record<string, number> = { es: 7222685, it: 7222686, fr: 7222687, ro: 7222688 };
const respuestaMailchimp = (fallaEn?: string) => (l: Llamada) => {
  const id = /campaigns\/([^/]+)/.exec(l.url)?.[1] ?? '';
  if (l.url.endsWith('/send-checklist')) return new Response('{"is_ready":true,"items":[]}', { status: 200 });
  if (l.url.endsWith('/actions/schedule') && fallaEn && id.startsWith(fallaEn)) return new Response('{"detail":"no"}', { status: 400 });
  if (l.url.includes('/actions/')) return new Response(null, { status: 204 });
  if (l.metodo === 'GET' && /campaigns\/[^/]+$/.test(l.url)) {
    const idioma = id.split('-')[1];
    return new Response(JSON.stringify({ id, web_id: 1, status: 'save', settings: { subject_line: 's' }, recipients: { list_id: '269aad017f', segment_opts: { saved_segment_id: SEGMENTOS[idioma] } } }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
};

test('NATU: una aprobación programa todos los idiomas en su segmento, redondeando al cuarto de hora', { skip: !conBd }, async () => {
  const { aprobarYProgramar } = await import('../src/aprobacion.js');
  llamadas = []; responder = respuestaMailchimp();
  const pet = await peticionCon('natu', [['comercial', 'es', 'c-es'], ['comercial', 'it', 'c-it'], ['comercial', 'fr', 'c-fr'], ['comercial', 'ro', 'c-ro']]);
  const r = await aprobarYProgramar(await token(pet, 'comercial', 'mailchimp', '2030-01-15T09:37'), 'irene@natuaromatic.com');
  const prog = llamadas.filter((l) => l.url.endsWith('/actions/schedule'));
  assert.equal(prog.length, 4);
  for (const p of prog) assert.equal(p.cuerpo.schedule_time, '2030-01-15T08:30:00.000Z'); // 09:37 Madrid → 09:30 → 08:30 UTC
  assert.match(r.aviso ?? '', /cuartos de hora/);
  assert.equal(llamadas.filter((l) => l.url.endsWith('/actions/send')).length, 0);
});

test('NATU: si falla un idioma se desprograman los demás y el enlace sigue sirviendo', { skip: !conBd }, async () => {
  const { aprobarYProgramar } = await import('../src/aprobacion.js');
  llamadas = []; responder = respuestaMailchimp('c2-fr');
  const pet = await peticionCon('natu', [['comercial', 'es', 'c2-es'], ['comercial', 'it', 'c2-it'], ['comercial', 'fr', 'c2-fr']]);
  await assert.rejects(aprobarYProgramar(await token(pet, 'comercial', 'mailchimp', '2030-03-01T10:00'), 'irene@natuaromatic.com'), /Mailchimp 400/);
  const desprog = llamadas.filter((l) => l.url.endsWith('/actions/unschedule')).map((l) => /campaigns\/([^/]+)/.exec(l.url)![1].split('-').slice(0, 2).join('-')).sort();
  assert.deepEqual(desprog, ['c2-es', 'c2-it']);
  const [a] = await q(`SELECT estado FROM shared.aprobaciones WHERE recurso = $1`, [pet.recurso]);
  assert.equal(a.estado, 'emitida');
  const [p] = await q(`SELECT estado FROM newsletter.peticiones WHERE id = $1`, [pet.id]);
  assert.equal(p.estado, 'prueba_enviada');
});
