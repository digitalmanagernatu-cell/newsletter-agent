import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  q, registrarEvento, notificar, verAprobacion, consumirAprobacion, liberarAprobacion, revocarAprobaciones,
  madridAUtc, formatoMadrid, ErrorAprobacion,
} from '@natu/shared';
import { Mailrelay, MARGEN_MINIMO_MIN } from './plataformas/mailrelay.js';
import { regenerar } from './servicio.js';
import { cargarKit } from './brand.js';

/**
 * Acciones que requieren a una persona: aprobar y programar, pedir cambios.
 * Programar consume un token de un solo uso emitido al crear los borradores.
 */
const AGENTE = 'newsletter';
const recurso = (id: string) => `newsletter.peticion:${id}`;
const peticionDe = (rec: string) => rec.replace('newsletter.peticion:', '');
let mr: Mailrelay | undefined;
const mailrelay = () => (mr ??= new Mailrelay());

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
  const p = a.parametros as { version_id: string; enfoque: string; ronda: number; fecha_envio: string | null };
  const [v] = await q<{ asunto: string; preheader: string; captura_url: string; marca: string; estado: string; objetivo: string }>(
    `SELECT v.composicion->>'asunto' AS asunto, v.composicion->>'preheader' AS preheader, v.captura_url, pe.marca, pe.estado, pe.peticion->>'objetivo' AS objetivo
     FROM newsletter.versiones v JOIN newsletter.peticiones pe ON pe.id = v.peticion_id WHERE v.id = $1`, [p.version_id]);
  if (!v) throw new ErrorAprobacion('Versión no encontrada');
  const grupos = cargarKit(v.marca as 'betreson').raw.destino;
  return { ...p, ...v, destino: grupos.nombre, caduca: a.caduca };
}

/** Aprueba una propuesta y la programa en Mailrelay. */
export async function aprobarYProgramar(token: string, aprobadorEmail: string, fechaLocal?: string) {
  const aprobador = validarAprobador(aprobadorEmail);
  const previa = await verAprobacion(token, 'programar_campana');
  const par = previa.parametros as { version_id: string; enfoque: string; ronda: number; campana_mailrelay: number; fecha_envio: string | null };
  const peticionId = peticionDe(previa.recurso);
  const [pet] = await q<{ estado: string; marca: string; solicitante: string | null; peticion: any }>('SELECT estado, marca, solicitante, peticion FROM newsletter.peticiones WHERE id = $1', [peticionId]);
  if (!pet) throw new ErrorAprobacion('Petición no encontrada');
  if (['programada', 'enviada'].includes(pet.estado)) throw new ErrorAprobacion('Esta newsletter ya está programada');
  if (pet.estado === 'cancelada') throw new ErrorAprobacion('Esta newsletter está cancelada');

  const local = fechaLocal || par.fecha_envio;
  if (!local) throw new ErrorAprobacion('Indica la fecha y hora de envío');
  const fecha = madridAUtc(local);
  if (fecha.getTime() < Date.now() + MARGEN_MINIMO_MIN * 60_000)
    throw new ErrorAprobacion(`La fecha de envío (${formatoMadrid(fecha)}) ya ha pasado o está a menos de ${MARGEN_MINIMO_MIN} minutos. Elige otra.`);

  const kit = cargarKit(pet.marca as 'betreson');
  const grupos: number[] = kit.raw.destino.mailrelay_group_ids;
  const a = await consumirAprobacion(token, 'programar_campana', aprobador);
  let envio;
  try {
    const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
    envio = await mailrelay().programar(par.campana_mailrelay, {
      grupos, fecha, aprobacion: { aprobacionId: a.id, aprobadoPor: aprobador },
      callbackUrl: base.startsWith('https://') ? `${base}/callbacks/mailrelay/${firmaCallback(peticionId)}/${peticionId}` : undefined,
    });
  } catch (e) {
    await liberarAprobacion(a.id);
    await registrarEvento({ agente: AGENTE, recurso: recurso(peticionId), tipo: 'error_programar', actor: aprobador, datos: { mensaje: String(e) } });
    throw e;
  }

  await q(`UPDATE newsletter.campanas SET estado = 'programada', programada_para = $2, id_envio = $3, actualizado = now()
           WHERE plataforma = 'mailrelay' AND id_externo = $1`, [String(par.campana_mailrelay), fecha, String(envio.envioId)]);
  await q(`UPDATE newsletter.campanas c SET estado = 'descartada', actualizado = now() FROM newsletter.versiones v
           WHERE c.version_id = v.id AND v.peticion_id = $1 AND c.estado = 'borrador'`, [peticionId]);
  await q(`UPDATE newsletter.peticiones SET estado = 'programada', envio_previsto = $2, actualizado = now() WHERE id = $1`, [peticionId, fecha]);
  await revocarAprobaciones(recurso(peticionId));
  const datos = { enfoque: par.enfoque, ronda: par.ronda, campana: par.campana_mailrelay, envio: envio.envioId, fecha_utc: envio.programadaUtc, grupos };
  await registrarEvento({ agente: AGENTE, recurso: recurso(peticionId), tipo: 'aprobada_y_programada', actor: aprobador, datos });
  const url = mailrelay().urlPanel(par.campana_mailrelay);
  await notificar({
    tipo: 'programada', peticion_id: peticionId, marca: pet.marca, solicitante: pet.solicitante, aprobador, objetivo: pet.peticion?.objetivo,
    enfoque: par.enfoque, fecha: formatoMadrid(fecha), destino: kit.raw.destino.nombre, url_campana: url,
  });
  return { ...datos, fecha: formatoMadrid(fecha), url_campana: url, aprobador };
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

/** Cancela un envío programado (requiere clave de servicio; lo usa n8n o el orquestador a petición de una persona). */
export async function cancelarProgramacion(peticionId: string, actorEmail: string, motivo?: string) {
  const actor = validarAprobador(actorEmail);
  const [c] = await q<{ id_envio: string; id_externo: string }>(
    `SELECT c.id_envio, c.id_externo FROM newsletter.campanas c JOIN newsletter.versiones v ON v.id = c.version_id
     WHERE v.peticion_id = $1 AND c.estado = 'programada' LIMIT 1`, [peticionId]);
  if (!c) throw new Error('No hay ningún envío programado para esta petición');
  await mailrelay().cancelarEnvio(Number(c.id_envio));
  await q(`UPDATE newsletter.campanas SET estado = 'cancelada', actualizado = now() WHERE plataforma = 'mailrelay' AND id_externo = $1`, [c.id_externo]);
  await q(`UPDATE newsletter.peticiones SET estado = 'cancelada', actualizado = now() WHERE id = $1`, [peticionId]);
  await registrarEvento({ agente: AGENTE, recurso: recurso(peticionId), tipo: 'programacion_cancelada', actor, datos: { motivo, envio: c.id_envio } });
  await notificar({ tipo: 'cancelada', peticion_id: peticionId, actor, motivo: motivo ?? null });
  return { cancelada: true, envio: Number(c.id_envio) };
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
