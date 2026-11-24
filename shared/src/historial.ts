import { q } from './db.js';

/** Tareas, eventos y coste: el registro común de todos los agentes. */
export async function crearTarea(t: { agente: string; tipo: string; entrada: unknown; solicitante?: string; origen?: string }): Promise<string> {
  const [r] = await q<{ id: string }>(
    'INSERT INTO shared.tareas (agente, tipo, entrada, solicitante, origen) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [t.agente, t.tipo, JSON.stringify(t.entrada), t.solicitante ?? null, t.origen ?? null],
  );
  return r.id;
}

export async function actualizarTarea(id: string, cambios: { estado?: string; salida?: unknown; error?: string }) {
  await q(
    `UPDATE shared.tareas SET estado = COALESCE($2, estado), salida = COALESCE($3, salida), error = COALESCE($4, error), actualizado = now() WHERE id = $1`,
    [id, cambios.estado ?? null, cambios.salida === undefined ? null : JSON.stringify(cambios.salida), cambios.error ?? null],
  );
}

export async function leerTarea(id: string) {
  const [t] = await q('SELECT id, agente, tipo, estado, salida, error, creado, actualizado FROM shared.tareas WHERE id = $1', [id]);
  return t;
}

export async function registrarEvento(e: { agente: string; tipo: string; recurso?: string; tareaId?: string; actor?: string; datos?: unknown }) {
  await q('INSERT INTO shared.eventos (agente, tarea_id, recurso, tipo, actor, datos) VALUES ($1,$2,$3,$4,$5,$6)', [
    e.agente, e.tareaId ?? null, e.recurso ?? null, e.tipo, e.actor ?? null, JSON.stringify(e.datos ?? {}),
  ]);
}

/** Precio aproximado por millón de tokens (USD). Ajustable sin tocar código con LLM_PRECIOS_JSON. */
const PRECIOS: Record<string, [number, number]> = {
  'gpt-5.4': [2.5, 15], 'gpt-5.4-mini': [0.4, 3.2], 'gpt-5': [1.25, 10], 'gpt-5-mini': [0.25, 2],
  ...(process.env.LLM_PRECIOS_JSON ? JSON.parse(process.env.LLM_PRECIOS_JSON) : {}),
};

export async function registrarCoste(c: { agente: string; tareaId?: string; proveedor: string; modelo: string; entrada: number; salida: number }) {
  const base = Object.keys(PRECIOS).sort((a, b) => b.length - a.length).find((m) => c.modelo.startsWith(m));
  const usd = base ? (c.entrada * PRECIOS[base][0] + c.salida * PRECIOS[base][1]) / 1e6 : null;
  await q('INSERT INTO shared.costes (agente, tarea_id, proveedor, modelo, tokens_entrada, tokens_salida, coste_usd) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    c.agente, c.tareaId ?? null, c.proveedor, c.modelo, c.entrada, c.salida, usd,
  ]);
}
