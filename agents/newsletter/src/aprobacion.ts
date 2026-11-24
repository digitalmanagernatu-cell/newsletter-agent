import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  q, registrarEvento, notificar, verAprobacion, consumirAprobacion, liberarAprobacion, revocarAprobaciones,
  madridAUtc, formatoMadrid, ErrorAprobacion,
} from '@natu/shared';
import { plataformaDe } from './plataformas/index.js';
import { regenerar, recurso } from './servicio.js';

/**
 * Acciones que requieren a una persona: aprobar y programar, pedir cambios.
 * Programar consume un token de un solo uso emitido al crear los borradores.
 * Una aprobación cubre todos los idiomas de una propuesta: o se programan todos o ninguno.
 */
const AGENTE = 'newsletter';
const MARGEN_MIN = 15;
const peticionDe = (rec: string) => rec.replace('newsletter.peticion:', '');

interface ParametrosAprobacion {
  enfoque: string; ronda: number; plataforma: 'mailrelay' | 'mailchimp'; fecha_envio: string | null;
  campanas: { id: string; idioma: string; version_id: string }[];
}

const dominiosAprobadores = () =>
  (process.env.APPROVER_DOMAINS ?? process.env.TEST_EMAIL_DOMAINS ?? 'natulaboratories.es,natuaromatic.com,betreson.com').split(',').map((d) => d.trim().toLowerCase());

export function validarAprobador(email: string): string {
  const e = email.trim().toLowerCase();
  const dominio = /^[^@\s]+@([^@\s]+)$/.exec(e)?.[1];
  if (!dominio || !dominiosAprobadores().includes(dominio)) throw new ErrorAprobacion('Escribe tu email de la empresa');
  return e;
}

/** Datos para pintar la página de confirmación (no consume el token). */
export async function datosAprobacion(token: string) {
  const a = await verAprobacion(token, 'programar_campana');
  const par = a.parametros as unknown as ParametrosAprobacion;
  const [pet] = await q<{ marca: 'betreson' | 'natu'; objetivo: string }>(`SELECT marca, peticion->>'objetivo' AS objetivo FROM newsletter.peticiones WHERE id = $1`, [peticionDe(a.recurso)]);
  if (!pet) throw new ErrorAprobacion('Petición no encontrada');
  const versiones = await q<{ idioma: string; asunto: string; preheader: string; captura_url: string }>(
    `SELECT idioma, composicion->>'asunto' AS asunto, composicion->>'preheader' AS preheader, captura_url FROM newsletter.versiones
     WHERE id = ANY($1::uuid[]) ORDER BY (idioma = 'es') DESC, idioma`, [par.campanas.map((c) => c.version_id)]);
  const plat = plataformaDe(pet.marca);
  return {
    enfoque: par.enfoque, fecha_envio: par.fecha_envio, objetivo: pet.objetivo, plataforma: plat.nombre,
    destino: [...new Set(versiones.map((v) => plat.destino(v.idioma).descripcion))].join(' · '),
    versiones,
  };
}

/** Aprueba una propuesta y la programa (en todos sus idiomas). */
export async function aprobarYProgramar(token: string, aprobadorEmail: string, fechaLocal?: string) {
  const aprobador = validarAprobador(aprobadorEmail);
  const previa = await verAprobacion(token, 'programar_campana');
  const par = previa.parametros as unknown as ParametrosAprobacion;
  const peticionId = peticionDe(previa.recurso);
  const [pet] = await q<{ estado: string; marca: 'betreson' | 'natu'; solicitante: string | null; peticion: any }>('SELECT estado, marca, solicitante, peticion FROM newsletter.peticiones WHERE id = $1', [peticionId]);
  if (!pet) throw new ErrorAprobacion('Petición no encontrada');
  if (['programada', 'enviada'].includes(pet.estado)) throw new ErrorAprobacion('Esta newsletter ya está programada');
  if (pet.estado === 'cancelada') throw new ErrorAprobacion('Esta newsletter está cancelada');

  const local = fechaLocal || par.fecha_envio;
  if (!local) throw new ErrorAprobacion('Indica la fecha y hora de envío');
  const fecha = madridAUtc(local);
  if (fecha.getTime() < Date.now() + MARGEN_MIN * 60_000)
    throw new ErrorAprobacion(`La fecha de envío (${formatoMadrid(fecha)}) ya ha pasado o está a menos de ${MARGEN_MIN} minutos. Elige otra.`);

  const plat = plataformaDe(pet.marca);
  for (const c of par.campanas) await plat.comprobarAntesDeProgramar(c.id); // Mailchimp: send-checklist

  const a = await consumirAprobacion(token, 'programar_campana', aprobador);
  const hechas: { id: string; idioma: string; envioId: string | null; fecha: Date; ajustada: boolean }[] = [];
  try {
    const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
    for (const c of par.campanas) {
      const r = await plat.programar(c.id, c.idioma, fecha, { aprobacionId: a.id, aprobadoPor: aprobador },
        plat.nombre === 'mailrelay' && base.startsWith('https://') ? `${base}/callbacks/mailrelay/${firmaCallback(peticionId)}/${peticionId}` : undefined);
      hechas.push({ ...c, ...r });
    }
  } catch (e) {
    // Todo o nada: se deshace lo ya programado y el enlace vuelve a servir.
    for (const h of hechas) await plat.cancelar(h.id, h.envioId).catch(() => {});
    await liberarAprobacion(a.id);
    await registrarEvento({ agente: AGENTE, recurso: recurso(peticionId), tipo: 'error_programar', actor: aprobador, datos: { mensaje: String(e), deshechas: hechas.map((h) => h.id) } });
    throw e;
  }

  for (const h of hechas)
    await q(`UPDATE newsletter.campanas SET estado = 'programada', programada_para = $3, id_envio = $4, actualizado = now() WHERE plataforma = $1 AND id_externo = $2`,
      [plat.nombre, h.id, h.fecha, h.envioId]);
  await q(`UPDATE newsletter.campanas c SET estado = 'descartada', actualizado = now() FROM newsletter.versiones v
           WHERE c.version_id = v.id AND v.peticion_id = $1 AND c.estado = 'borrador'`, [peticionId]);
  const fechaReal = hechas[0].fecha;
  await q(`UPDATE newsletter.peticiones SET estado = 'programada', envio_previsto = $2, actualizado = now() WHERE id = $1`, [peticionId, fechaReal]);
  await revocarAprobaciones(recurso(peticionId));
  const ajustada = hechas.some((h) => h.ajustada);
  const aviso = ajustada ? `Mailchimp solo programa en cuartos de hora: se ha ajustado de ${formatoMadrid(fecha)} a ${formatoMadrid(fechaReal)}.` : null;
  const campanas = hechas.map((h) => ({ idioma: h.idioma, campana: h.id, envio: h.envioId }));
  const [u] = await q<{ url: string }>(`SELECT url FROM newsletter.campanas WHERE plataforma = $1 AND id_externo = $2`, [plat.nombre, hechas[0].id]);
  const datos = { enfoque: par.enfoque, ronda: par.ronda, plataforma: plat.nombre, campanas, fecha_utc: fechaReal.toISOString(), aviso };
  await registrarEvento({ agente: AGENTE, recurso: recurso(peticionId), tipo: 'aprobada_y_programada', actor: aprobador, datos });
  const destino = [...new Set(hechas.map((h) => plat.destino(h.idioma).descripcion))].join(' · ');
  await notificar({
    tipo: 'programada', peticion_id: peticionId, marca: pet.marca, solicitante: pet.solicitante, aprobador, objetivo: pet.peticion?.objetivo,
    enfoque: par.enfoque, fecha: formatoMadrid(fechaReal), destino, url_campana: u?.url, aviso, idiomas: hechas.map((h) => h.idioma),
  });
  return { ...datos, fecha: formatoMadrid(fechaReal), destino, url_campana: u?.url, aprobador };
}

/** "Pedir cambios": consume el enlace y lanza una nueva ronda. */
export async function pedirCambios(token: string, actorEmail: string, feedback: string, enfoque?: 'editorial' | 'comercial') {
  const actor = validarAprobador(actorEmail);
  if (feedback.trim().length < 5) throw new ErrorAprobacion('Describe los cambios que quieres');
  const a = await verAprobacion(token, 'pedir_cambios');
  const peticionId = peticionDe(a.recurso);
  await consumirAprobacion(token, 'pedir_cambios', actor);
  try {
    return await regenerar(peticionId, feedback.trim(), actor, 'aprobacion', enfoque);
  } catch (e) {
    await liberarAprobacion(a.id);
    throw e;
  }
}

/** Cancela los envíos programados de una petición (requiere clave de servicio; a petición de una persona). */
export async function cancelarProgramacion(peticionId: string, actorEmail: string, motivo?: string) {
  const actor = validarAprobador(actorEmail);
  const [pet] = await q<{ marca: 'betreson' | 'natu' }>('SELECT marca FROM newsletter.peticiones WHERE id = $1', [peticionId]);
  if (!pet) throw new Error('Petición no encontrada');
  const plat = plataformaDe(pet.marca);
  const camps = await q<{ id_envio: string | null; id_externo: string }>(
    `SELECT c.id_envio, c.id_externo FROM newsletter.campanas c JOIN newsletter.versiones v ON v.id = c.version_id
     WHERE v.peticion_id = $1 AND c.estado = 'programada'`, [peticionId]);
  if (!camps.length) throw new Error('No hay ningún envío programado para esta petición');
  for (const c of camps) {
    await plat.cancelar(c.id_externo, c.id_envio);
    await q(`UPDATE newsletter.campanas SET estado = 'cancelada', actualizado = now() WHERE plataforma = $1 AND id_externo = $2`, [plat.nombre, c.id_externo]);
  }
  await q(`UPDATE newsletter.peticiones SET estado = 'cancelada', actualizado = now() WHERE id = $1`, [peticionId]);
  await registrarEvento({ agente: AGENTE, recurso: recurso(peticionId), tipo: 'programacion_cancelada', actor, datos: { motivo, campanas: camps.map((c) => c.id_externo) } });
  await notificar({ tipo: 'cancelada', peticion_id: peticionId, actor, motivo: motivo ?? null });
  return { cancelada: true, campanas: camps.map((c) => c.id_externo) };
}

// ── Aviso de Mailrelay cuando termina el envío ──
export const firmaCallback = (peticionId: string) =>
  createHmac('sha256', process.env.APPROVAL_SECRET ?? '').update(`callback:${peticionId}`).digest('base64url').slice(0, 32);

export async function callbackMailrelay(firma: string, peticionId: string, cuerpo: { type?: string; id?: number }) {
  const esperada = firmaCallback(peticionId);
  if (firma.length !== esperada.length || !timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) throw new Error('Firma no válida');
  if (cuerpo.type !== 'sent_campaign_finished') return { ignorado: true };
  await q(`UPDATE newsletter.campanas SET estado = 'enviada', actualizado = now() WHERE plataforma = 'mailrelay' AND id_envio = $1`, [String(cuerpo.id)]);
  await q(`UPDATE newsletter.peticiones SET estado = 'enviada', actualizado = now() WHERE id = $1`, [peticionId]);
  await registrarEvento({ agente: AGENTE, recurso: recurso(peticionId), tipo: 'enviada', actor: 'mailrelay', datos: cuerpo });
  await notificar({ tipo: 'enviada', peticion_id: peticionId, envio: cuerpo.id });
  return { ok: true };
}
