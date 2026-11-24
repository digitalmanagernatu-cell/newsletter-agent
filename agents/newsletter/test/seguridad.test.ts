import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filtrarPruebas } from '../src/seguridad.js';
import { Mailrelay } from '../src/plataformas/mailrelay.js';

test('las pruebas solo van a dominios de la empresa', () => {
  const r = filtrarPruebas(['Digitalmanager@NatuAromatic.com', 'a@natulaboratories.es; cliente@gmail.com, x@betreson.com.evil.com', undefined]);
  assert.deepEqual(r.validos, ['digitalmanager@natuaromatic.com', 'a@natulaboratories.es']);
  assert.deepEqual(r.rechazados, ['cliente@gmail.com', 'x@betreson.com.evil.com']);
});

test('el cliente de Mailrelay no puede enviar ni programar a la lista real en esta fase', () => {
  const metodos = Object.getOwnPropertyNames(Mailrelay.prototype).join(' ') + ' ' + Object.keys(new Mailrelay('x', 'y')).join(' ');
  assert.doesNotMatch(metodos, /send_?all|programar|enviarTodos|enviarCampana/i);
});
