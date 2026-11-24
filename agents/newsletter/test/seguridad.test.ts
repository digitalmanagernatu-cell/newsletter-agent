import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrarPruebas } from '../src/seguridad.js';
import { Mailrelay } from '../src/plataformas/mailrelay.js';

test('las pruebas solo van a dominios de la empresa', () => {
  const r = filtrarPruebas(['Digitalmanager@NatuAromatic.com', 'a@natulaboratories.es; cliente@gmail.com, x@betreson.com.evil.com', undefined]);
  assert.deepEqual(r.validos, ['digitalmanager@natuaromatic.com', 'a@natulaboratories.es']);
  assert.deepEqual(r.rechazados, ['cliente@gmail.com', 'x@betreson.com.evil.com']);
});

test('programar nunca llama a send_all sin aprobación, sin fecha o con fecha pasada', async () => {
  const llamadas: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => { llamadas.push(String(url)); return new Response('{"id":1}', { status: 200 }); }) as typeof fetch;
  try {
    const m = new Mailrelay('x.example', 'k');
    const ok = { aprobacionId: 'a', aprobadoPor: 'p@natuaromatic.com' };
    await assert.rejects(m.programar(1, { grupos: [6], fecha: new Date(Date.now() + 3600e3), aprobacion: undefined as any }), /aprobación/);
    await assert.rejects(m.programar(1, { grupos: [6], fecha: undefined as any, aprobacion: ok }), /fecha/);
    await assert.rejects(m.programar(1, { grupos: [6], fecha: new Date(Date.now() + 60e3), aprobacion: ok }), /futuro/);
    await assert.rejects(m.programar(1, { grupos: [], fecha: new Date(Date.now() + 3600e3), aprobacion: ok }), /grupos/);
    assert.equal(llamadas.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('programar envía scheduled_at en UTC con el formato de Mailrelay', async () => {
  let cuerpo: any;
  const original = globalThis.fetch;
  globalThis.fetch = (async (_u: string, init: RequestInit) => { cuerpo = JSON.parse(String(init.body)); return new Response('{"id":77}', { status: 200 }); }) as typeof fetch;
  try {
    const fecha = new Date(Date.now() + 2 * 86400e3);
    const r = await new Mailrelay('x.example', 'k').programar(5, { grupos: [6], fecha, aprobacion: { aprobacionId: 'a', aprobadoPor: 'p' } });
    assert.equal(r.envioId, 77);
    assert.match(cuerpo.scheduled_at, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    assert.equal(cuerpo.scheduled_at, fecha.toISOString().slice(0, 19).replace('T', ' '));
    assert.deepEqual(cuerpo.group_ids, [6]);
  } finally {
    globalThis.fetch = original;
  }
});
