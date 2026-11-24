import { test } from 'node:test';
import assert from 'node:assert/strict';
import { madridAUtc } from '@natu/shared';

test('hora de Madrid a UTC en invierno y en verano', () => {
  assert.equal(madridAUtc('2026-12-01T09:30').toISOString(), '2026-12-01T08:30:00.000Z');
  assert.equal(madridAUtc('2026-07-01 09:30').toISOString(), '2026-07-01T07:30:00.000Z');
  assert.equal(madridAUtc('2026-03-29T04:00').toISOString(), '2026-03-29T02:00:00.000Z'); // día del cambio de hora
  assert.equal(madridAUtc('2026-12-01T09:30:00Z').toISOString(), '2026-12-01T09:30:00.000Z');
});
