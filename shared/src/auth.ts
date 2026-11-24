import { timingSafeEqual } from 'node:crypto';

/**
 * Autenticación servicio a servicio (n8n, orquestador): cabecera
 * `Authorization: Bearer <clave>`. Varias claves separadas por comas en AGENT_API_KEYS,
 * para poder rotarlas sin cortar el servicio.
 */
export function claveValida(cabecera: string | undefined): boolean {
  const claves = (process.env.AGENT_API_KEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const dada = cabecera?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!dada || claves.length === 0) return false;
  return claves.some((c) => c.length === dada.length && timingSafeEqual(Buffer.from(c), Buffer.from(dada)));
}
