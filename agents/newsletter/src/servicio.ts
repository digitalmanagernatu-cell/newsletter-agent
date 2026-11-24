import { q, crearTarea, actualizarTarea, leerTarea, registrarEvento, registrarCoste } from '@natu/shared';
import { PeticionSchema, type Peticion, type Composicion } from './schema.js';
import { crearNewsletter, type Propuesta } from './pipeline.js';
import { Mailrelay } from './plataformas/mailrelay.js';
import { filtrarPruebas } from './seguridad.js';
import { cargarKit } from './brand.js';

/**
 * Capa de servicio: lo que exponen MCP y HTTP. Las operaciones largas
 * (crear y regenerar) devuelven un id de tarea y siguen en segundo plano.
 */
const AGENTE = 'newsletter';
const CARPETA = 'Agente newsletters';
const recurso = (id: string) => `newsletter.peticion:${id}`;

let mr: Mailrelay | undefined;
const mailrelay = () => (mr ??= new Mailrelay());

const log = (tareaId: string) => (s: string) => console.log(`[${tareaId.slice(0, 8)}] ${s}`);

/** Lleva a Mailrelay las imágenes que no estén ya allí: en los emails solo van URLs públicas de la plataforma. */
async function alojarImagenes(p: Peticion, carpetaId: number): Promise<Peticion> {
  const cache = new Map<string, string>();
  const alojar = async (url?: string) => {
    if (!url || /^https:\/\/assets\.ipzmarketing\.com\//.test(url)) return url;
    if (cache.has(url)) return cache.get(url);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`No se pudo descargar la imagen ${url} (${r.status})`);
    const tipo = r.headers.get('content-type') ?? '';
    if (!/^image\/(png|jpe?g|gif|webp)/.test(tipo)) throw new Error(`${url} no es una imagen (${tipo})`);
    const nombre = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'imagen') .replace(/[^\w.\-]+/g, '_');
    const { url: publica } = await mailrelay().subirImagen(nombre, Buffer.from(await r.arrayBuffer()), carpetaId);
    cache.set(url, publica);
    return publica;
  };
  return {
    ...p,
    imagenes: await Promise.all(p.imagenes.map(async (i) => ({ ...i, url: (await alojar(i.url))! }))),
    productos: await Promise.all(p.productos.map(async (pr) => ({ ...pr, imagen: await alojar(pr.imagen) }))),
  };
}

async function guardarVersion(peticionId: string, numero: number, pr: Propuesta, feedback?: string, capturaUrl?: string) {
  const [v] = await q<{ id: string }>(
    `INSERT INTO newsletter.versiones (peticion_id, numero, enfoque, composicion, mjml, html, avisos, revisiones, captura_url, feedback)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [peticionId, numero, pr.enfoque, JSON.stringify(pr.composicion), pr.mjml, pr.html, JSON.stringify(pr.avisos), JSON.stringify(pr.revisiones), capturaUrl ?? null, feedback ?? null],
  );
  return v.id;
}

/** Genera, guarda, crea o actualiza los borradores y manda la prueba. */
async function procesar(tareaId: string, peticionId: string, p: Peticion, numero: number, anteriores?: Partial<Record<'editorial' | 'comercial', Composicion>>, enfoques?: ('editorial' | 'comercial')[]) {
  const l = log(tareaId);
  try {
    await actualizarTarea(tareaId, { estado: 'en_curso' });
    if (p.marca !== 'betreson') throw new Error('NATU (Mailchimp) se activa en la fase 4');
    const kit = cargarKit(p.marca);
    const carpetaMedios = await mailrelay().carpetaMedios(CARPETA);
    const carpetaCampanas = await mailrelay().carpetaCampanas(CARPETA);
    const pAlojada = await alojarImagenes(p, carpetaMedios);

    const { propuestas, usos } = await crearNewsletter(pAlojada, { log: l, anteriores, enfoques });
    for (const u of usos) await registrarCoste({ agente: AGENTE, tareaId, proveedor: 'openai', modelo: u.modelo, entrada: u.entrada, salida: u.salida });

    const bloqueantes = propuestas.flatMap((pr) => pr.avisos.filter((a) => a.nivel === 'error').map((a) => `${pr.enfoque}: ${a.detalle}`));
    if (bloqueantes.length) throw new Error(`La newsletter tiene errores que impiden crear el borrador: ${bloqueantes.join(' | ')}`);

    const destinatarios = filtrarPruebas([p.solicitante_email, p.destinatarios_prueba]);
    const resultado = [];
    for (const pr of propuestas) {
      const captura = await mailrelay().subirImagen(`captura-${peticionId.slice(0, 8)}-v${numero}-${pr.enfoque}.png`, pr.capturas.escritorio, carpetaMedios);
      const versionId = await guardarVersion(peticionId, numero, pr, p.feedback, captura.url);
      const [previa] = await q<{ id: string; id_externo: string }>(
        `SELECT c.id, c.id_externo FROM newsletter.campanas c JOIN newsletter.versiones v ON v.id = c.version_id
         WHERE v.peticion_id = $1 AND v.enfoque = $2 AND c.plataforma = 'mailrelay' AND c.estado = 'borrador' ORDER BY c.creado DESC LIMIT 1`,
        [peticionId, pr.enfoque],
      );
      const prefijo = propuestas.length > 1 ? `[${pr.enfoque === 'editorial' ? 'A' : 'B'}] ` : '';
      let campanaId: number;
      if (previa) {
        campanaId = Number(previa.id_externo);
        await mailrelay().actualizarBorrador(campanaId, { asunto: pr.composicion.asunto, preheader: pr.composicion.preheader, html: pr.html });
        await q('UPDATE newsletter.campanas SET version_id = $2, actualizado = now() WHERE id = $1', [previa.id, versionId]);
      } else {
        const c = await mailrelay().crearBorrador({
          asunto: pr.composicion.asunto, preheader: pr.composicion.preheader, html: pr.html,
          senderId: kit.raw.remitente.mailrelay_sender_id, grupos: kit.raw.destino.mailrelay_group_ids, carpetaId: carpetaCampanas,
          utm: `agente-${peticionId.slice(0, 8)}`,
        });
        campanaId = c.id;
        await q(`INSERT INTO newsletter.campanas (version_id, plataforma, id_externo, destino, url) VALUES ($1,'mailrelay',$2,$3,$4)`, [
          versionId, String(c.id), JSON.stringify({ grupos: kit.raw.destino.mailrelay_group_ids }), mailrelay().urlPanel(c.id),
        ]);
      }
      if (destinatarios.validos.length) {
        await mailrelay().enviarPrueba(campanaId, destinatarios.validos);
        await q(`UPDATE newsletter.campanas SET pruebas = pruebas || $2::jsonb WHERE plataforma = 'mailrelay' AND id_externo = $1`, [
          String(campanaId), JSON.stringify([{ a: destinatarios.validos, fecha: new Date().toISOString(), version: numero }]),
        ]);
      }
      l(`${pr.enfoque}: borrador Mailrelay ${campanaId}${destinatarios.validos.length ? `, prueba a ${destinatarios.validos.join(', ')}` : ''}`);
      resultado.push({
        propuesta: prefijo.replace(/\W/g, '') || 'única', enfoque: pr.enfoque, version_id: versionId,
        asunto: pr.composicion.asunto, preheader: pr.composicion.preheader, captura_url: captura.url,
        campana_mailrelay: campanaId, url_panel: mailrelay().urlPanel(campanaId),
        puntuacion_revision: pr.revisiones.at(-1)?.puntuacion, avisos: pr.avisos,
      });
    }
    const estado = destinatarios.validos.length ? 'prueba_enviada' : 'borrador';
    await q('UPDATE newsletter.peticiones SET estado = $2, actualizado = now() WHERE id = $1', [peticionId, estado]);
    const salida = { peticion_id: peticionId, ronda: numero, estado, propuestas: resultado, pruebas: destinatarios };
    await actualizarTarea(tareaId, { estado: 'completada', salida });
    await registrarEvento({ agente: AGENTE, tareaId, recurso: recurso(peticionId), tipo: numero === 1 ? 'borradores_creados' : 'borradores_regenerados', datos: salida });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    l(`ERROR ${msg}`);
    await actualizarTarea(tareaId, { estado: 'error', error: msg }).catch(() => {});
    await q('UPDATE newsletter.peticiones SET estado = $2, actualizado = now() WHERE id = $1', [peticionId, 'error']).catch(() => {});
    await registrarEvento({ agente: AGENTE, tareaId, recurso: recurso(peticionId), tipo: 'error', datos: { mensaje: msg } }).catch(() => {});
  }
}

// ───────────── Operaciones públicas (herramientas MCP / endpoints HTTP) ─────────────

export async function crear(entrada: unknown, origen = 'http') {
  const p = PeticionSchema.parse(entrada);
  const tareaId = await crearTarea({ agente: AGENTE, tipo: 'crear_newsletter', entrada: p, solicitante: p.solicitante_email, origen });
  const [r] = await q<{ id: string }>(
    'INSERT INTO newsletter.peticiones (tarea_id, marca, peticion, solicitante, envio_previsto) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [tareaId, p.marca, JSON.stringify(p), p.solicitante_email ?? null, p.fecha_envio ?? null],
  );
  await registrarEvento({ agente: AGENTE, tareaId, recurso: recurso(r.id), tipo: 'peticion_recibida', actor: p.solicitante_email, datos: { origen } });
  void procesar(tareaId, r.id, p, 1);
  return { tarea_id: tareaId, peticion_id: r.id, estado: 'en_curso' };
}

export async function regenerar(peticionId: string, feedback: string, actor?: string, origen = 'http', enfoque?: 'editorial' | 'comercial') {
  const [pet] = await q<{ peticion: Peticion; estado: string }>('SELECT peticion, estado FROM newsletter.peticiones WHERE id = $1', [peticionId]);
  if (!pet) throw new Error('Petición no encontrada');
  if (['programada', 'enviada'].includes(pet.estado)) throw new Error(`No se puede regenerar una newsletter ${pet.estado}`);
  const [{ max }] = await q<{ max: number }>('SELECT COALESCE(MAX(numero), 0) AS max FROM newsletter.versiones WHERE peticion_id = $1', [peticionId]);
  const ultimas = await q<{ enfoque: 'editorial' | 'comercial'; composicion: Composicion }>(
    'SELECT enfoque, composicion FROM newsletter.versiones WHERE peticion_id = $1 AND numero = $2', [peticionId, max],
  );
  if (enfoque && !ultimas.some((u) => u.enfoque === enfoque)) throw new Error(`No hay propuesta ${enfoque} en esta petición`);
  const p: Peticion = { ...pet.peticion, feedback };
  const tareaId = await crearTarea({ agente: AGENTE, tipo: 'regenerar', entrada: { peticion_id: peticionId, feedback, enfoque }, solicitante: actor, origen });
  await q("UPDATE newsletter.peticiones SET estado = 'cambios_pedidos', tarea_id = $2, peticion = $3, actualizado = now() WHERE id = $1", [peticionId, tareaId, JSON.stringify(p)]);
  await registrarEvento({ agente: AGENTE, tareaId, recurso: recurso(peticionId), tipo: 'cambios_pedidos', actor, datos: { feedback, enfoque } });
  const elegidas = enfoque ? [enfoque] : ultimas.map((u) => u.enfoque);
  void procesar(tareaId, peticionId, p, max + 1, Object.fromEntries(ultimas.map((u) => [u.enfoque, u.composicion])), elegidas);
  return { tarea_id: tareaId, peticion_id: peticionId, ronda: max + 1, estado: 'en_curso' };
}

export async function enviarPrueba(peticionId: string, emails: string, actor?: string) {
  const dest = filtrarPruebas([emails]);
  if (!dest.validos.length) throw new Error(`Ninguna dirección válida. Solo se admiten los dominios de la empresa. Rechazadas: ${dest.rechazados.join(', ')}`);
  const camps = await q<{ id_externo: string; numero: number }>(
    `SELECT c.id_externo, v.numero FROM newsletter.campanas c JOIN newsletter.versiones v ON v.id = c.version_id
     WHERE v.peticion_id = $1 AND c.plataforma = 'mailrelay' AND c.estado = 'borrador'`, [peticionId],
  );
  if (!camps.length) throw new Error('Esta petición no tiene borradores');
  for (const c of camps) {
    await mailrelay().enviarPrueba(Number(c.id_externo), dest.validos);
    await q(`UPDATE newsletter.campanas SET pruebas = pruebas || $2::jsonb WHERE plataforma = 'mailrelay' AND id_externo = $1`, [
      c.id_externo, JSON.stringify([{ a: dest.validos, fecha: new Date().toISOString(), version: c.numero }]),
    ]);
  }
  await q("UPDATE newsletter.peticiones SET estado = 'prueba_enviada', actualizado = now() WHERE id = $1 AND estado IN ('borrador','prueba_enviada')", [peticionId]);
  await registrarEvento({ agente: AGENTE, recurso: recurso(peticionId), tipo: 'prueba_enviada', actor, datos: dest });
  return { enviada_a: dest.validos, rechazadas: dest.rechazados, campanas: camps.map((c) => Number(c.id_externo)) };
}

export async function estado(opts: { peticion_id?: string; tarea_id?: string }) {
  let peticionId = opts.peticion_id;
  const tarea = opts.tarea_id ? await leerTarea(opts.tarea_id) : undefined;
  if (!peticionId && opts.tarea_id) {
    const [r] = await q<{ id: string }>(
      `SELECT id FROM newsletter.peticiones WHERE tarea_id = $1
       UNION SELECT (entrada->>'peticion_id')::uuid FROM shared.tareas WHERE id = $1 AND tipo = 'regenerar' LIMIT 1`, [opts.tarea_id]);
    peticionId = r?.id;
  }
  if (!peticionId) throw new Error('Indica peticion_id o tarea_id');
  const [pet] = await q('SELECT id, marca, estado, solicitante, envio_previsto, creado, actualizado, tarea_id FROM newsletter.peticiones WHERE id = $1', [peticionId]);
  if (!pet) throw new Error('Petición no encontrada');
  const versiones = await q(
    `SELECT v.numero, v.enfoque, v.composicion->>'asunto' AS asunto, v.composicion->>'preheader' AS preheader, v.captura_url,
            c.id_externo AS campana, c.estado AS estado_campana, c.url, c.pruebas, v.creado
     FROM newsletter.versiones v LEFT JOIN newsletter.campanas c ON c.version_id = v.id
     WHERE v.peticion_id = $1 ORDER BY v.numero DESC, v.enfoque`, [peticionId]);
  const ultimaTarea = tarea ?? (await leerTarea(pet.tarea_id));
  const historial = await q('SELECT tipo, actor, creado FROM shared.eventos WHERE recurso = $1 ORDER BY creado', [recurso(peticionId)]);
  return { peticion: pet, tarea: ultimaTarea && { id: ultimaTarea.id, tipo: ultimaTarea.tipo, estado: ultimaTarea.estado, error: ultimaTarea.error }, versiones, historial };
}

/** Al arrancar, las tareas que quedaron a medias por un reinicio se marcan como error. */
export async function limpiarTareasHuérfanas() {
  await q(`UPDATE shared.tareas SET estado = 'error', error = 'Interrumpida por reinicio del servicio', actualizado = now()
           WHERE agente = $1 AND estado IN ('pendiente','en_curso')`, [AGENTE]);
}
