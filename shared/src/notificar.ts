import { createHmac } from 'node:crypto';

/**
 * Avisa a n8n de un evento (borradores listos, programada, error…) para que
 * envíe los emails. Firma el cuerpo con HMAC (cabecera X-Natu-Firma) y añade
 * la clave en X-Natu-Clave para el Header Auth del webhook de n8n.
 */
export async function notificar(evento: { tipo: string; [k: string]: unknown }) {
  const url = process.env.N8N_EVENTS_URL;
  if (!url) { console.warn(`N8N_EVENTS_URL no configurada; evento ${evento.tipo} sin enviar`); return false; }
  const cuerpo = JSON.stringify({ ...evento, enviado: new Date().toISOString() });
  const clave = process.env.N8N_EVENTS_KEY ?? '';
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Natu-Clave': clave, 'X-Natu-Firma': createHmac('sha256', clave).update(cuerpo).digest('hex') },
        body: cuerpo,
      });
      if (r.ok) return true;
      console.warn(`n8n respondió ${r.status} al evento ${evento.tipo}`);
    } catch (e) {
      console.warn(`No se pudo avisar a n8n (${evento.tipo}): ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  return false;
}
