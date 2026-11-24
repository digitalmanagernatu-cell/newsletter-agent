import { createHmac, timingSafeEqual } from 'node:crypto';
import { q } from './db.js';

/**
 * Tokens de aprobación para acciones irreversibles (programar un envío, etc.).
 *
 *  - Firmados con HMAC-SHA256 (APPROVAL_SECRET): no se pueden fabricar ni alterar.
 *  - Caducan (por defecto 72 h).
 *  - Son de un solo uso: el consumo es atómico en la base de datos.
 *  - Van atados a una acción, un recurso y unos parámetros concretos
 *    (p. ej. la versión exacta y la fecha de envío que se aprueban).
 *
 * Ningún agente ni el orquestador tiene una herramienta para emitirlos a petición
 * propia: los emite el flujo de aprobación y solo los consume una persona.
 */
const secreto = () => {
  const s = process.env.APPROVAL_SECRET ?? '';
  if (s.length < 32) throw new Error('APPROVAL_SECRET debe tener al menos 32 caracteres');
  return s;
};
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const firmar = (datos: string) => b64(createHmac('sha256', secreto()).update(datos).digest());

export interface Aprobacion {
  id: string;
  agente: string;
  accion: string;
  recurso: string;
  parametros: Record<string, unknown>;
  estado: 'emitida' | 'usada' | 'revocada' | 'caducada';
  caduca: Date;
}

export async function emitirAprobacion(a: { agente: string; accion: string; recurso: string; parametros?: Record<string, unknown>; horas?: number }) {
  const horas = a.horas ?? Number(process.env.APPROVAL_TTL_HOURS ?? 72);
  const [r] = await q<{ id: string; caduca: Date }>(
    `INSERT INTO shared.aprobaciones (agente, accion, recurso, parametros, caduca)
     VALUES ($1,$2,$3,$4, now() + make_interval(hours => $5)) RETURNING id, caduca`,
    [a.agente, a.accion, a.recurso, JSON.stringify(a.parametros ?? {}), horas],
  );
  const carga = b64(JSON.stringify({ i: r.id, a: a.accion, e: Math.floor(new Date(r.caduca).getTime() / 1000) }));
  return { id: r.id, token: `${carga}.${firmar(carga)}`, caduca: r.caduca };
}

/** Comprueba firma, caducidad y estado sin consumir el token (para mostrar la página de confirmación). */
export async function verAprobacion(token: string, accion: string): Promise<Aprobacion> {
  const [carga, firma] = token.split('.');
  if (!carga || !firma) throw new ErrorAprobacion('Enlace no válido');
  const esperada = firmar(carga);
  if (esperada.length !== firma.length || !timingSafeEqual(Buffer.from(esperada), Buffer.from(firma))) throw new ErrorAprobacion('Enlace no válido');
  const d = JSON.parse(Buffer.from(carga, 'base64url').toString()) as { i: string; a: string; e: number };
  if (d.a !== accion) throw new ErrorAprobacion('Enlace no válido para esta acción');
  if (d.e * 1000 < Date.now()) throw new ErrorAprobacion('El enlace ha caducado');
  const [r] = await q<Aprobacion>('SELECT id, agente, accion, recurso, parametros, estado, caduca FROM shared.aprobaciones WHERE id = $1', [d.i]);
  if (!r) throw new ErrorAprobacion('Enlace no válido');
  if (r.estado === 'usada') throw new ErrorAprobacion('Este enlace ya se ha usado');
  if (r.estado === 'revocada') throw new ErrorAprobacion('Este enlace ya no es válido: hay una versión más reciente');
  if (r.estado !== 'emitida' || new Date(r.caduca).getTime() < Date.now()) throw new ErrorAprobacion('El enlace ha caducado');
  return r;
}

/** Consume el token de forma atómica: solo una petición puede usarlo. */
export async function consumirAprobacion(token: string, accion: string, actor: string): Promise<Aprobacion> {
  const a = await verAprobacion(token, accion);
  const [r] = await q<Aprobacion>(
    `UPDATE shared.aprobaciones SET estado = 'usada', usada = now(), usada_por = $2
     WHERE id = $1 AND estado = 'emitida' AND caduca > now() RETURNING id, agente, accion, recurso, parametros, estado, caduca`,
    [a.id, actor],
  );
  if (!r) throw new ErrorAprobacion('Este enlace ya se ha usado');
  return r;
}

/** Invalida los tokens pendientes de un recurso (p. ej. al generar una versión nueva). */
export async function revocarAprobaciones(recurso: string, excepto: string[] = []) {
  await q(`UPDATE shared.aprobaciones SET estado = 'revocada' WHERE recurso = $1 AND estado = 'emitida' AND NOT (id = ANY($2::uuid[]))`, [recurso, excepto]);
}

/** Devuelve el token a "emitida" si la acción falla después de consumirlo (p. ej. la plataforma rechaza la programación). */
export async function liberarAprobacion(id: string) {
  await q(`UPDATE shared.aprobaciones SET estado = 'emitida', usada = NULL, usada_por = NULL WHERE id = $1 AND estado = 'usada'`, [id]);
}

export class ErrorAprobacion extends Error {}
