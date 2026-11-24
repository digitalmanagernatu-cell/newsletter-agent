import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, cerrarDb } from './db.js';

/** Aplica en orden las migraciones de /shared/migrations que falten. */
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
await db().query('CREATE SCHEMA IF NOT EXISTS shared; CREATE TABLE IF NOT EXISTS shared.migraciones (nombre text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())');
const hechas = new Set((await db().query('SELECT nombre FROM shared.migraciones')).rows.map((r) => r.nombre));
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const nombre = f.replace(/\.sql$/, '');
  if (hechas.has(nombre)) continue;
  const c = await db().connect();
  try {
    await c.query('BEGIN');
    await c.query(readFileSync(path.join(dir, f), 'utf8'));
    await c.query('INSERT INTO shared.migraciones (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [nombre]);
    await c.query('COMMIT');
    console.log(`Aplicada ${nombre}`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
await cerrarDb();
