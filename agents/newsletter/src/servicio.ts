import { q, crearTarea, actualizarTarea, leerTarea, registrarEvento, registrarCoste, emitirAprobacion, revocarAprobaciones, notificar, madridAUtc, formatoMadrid } from '@natu/shared';
import { PeticionSchema, type Peticion, type Composicion } from './schema.js';
import { crearNewsletter, idiomasDe, type Propuesta } from './pipeline.js';
import { plataformaDe, type Plataforma } from './plataformas/index.js';
import { filtrarPruebas } from './seguridad.js';

/**
 * Capa de servicio: lo que exponen MCP y HTTP. Las operaciones largas
 * (crear y regenerar) devuelven un id de tarea y siguen en segundo plano.
 * BetrésON → Mailrelay (un borrador por propuesta). NATU → Mailchimp (un borrador por propuesta e idioma).
 */
const AGENTE = 'newsletter';
export const recurso = (id: string) => `newsletter.peticion:${id}`;
const log = (tareaId: string) => (s: string) => console.log(`[${tareaId.slice(0, 8)}] ${s}`);
const ETIQUETAS: Record<string, string> = { editorial: 'A', comercial: 'B' };

/** En los emails solo van URLs públicas de la plataforma: lo demás se descarga y se sube. */
async function alojarImagenes(p: Peticion, plat: Plataforma): Promise<Peticion> {
  const cache = new Map<string, string>();
  const alojar = async (url?: string) => {
    if (!url || plat.esUrlPropia(url)) return url;
    if (cache.has(url)) return cache.get(url);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`No se pudo descargar la imagen ${url} (${r.status})`);
    const tipo = r.headers.get('content-type') ?? '';
    if (!/^image\/(png|jpe?g|gif|webp)/.test(tipo)) throw new Error(`${url} no es una imagen (${tipo})`);
    const nombre = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'imagen').replace(/[^\w.\-]+/g, '_');
    const publica = await plat.subirImagen(nombre, Buffer.from(await r.arrayBuffer()));
    cache.set(url, publica);
    return publica;
  };
  const subidas = [];
  for (const a of p.adjuntos) {
    const datos = Buffer.from(a.contenido_base64, 'base64');
    if (datos.length > 10 * 1024 * 1024) throw new Error(`La imagen ${a.nombre} supera 10 MB`);
    subidas.push({ url: await plat.subirImagen(a.nombre.replace(/[^\w.\-]+/g, '_'), datos), descripcion: a.descripcion ?? a.nombre });
  }
  return {
    ...p,
    adjuntos: [],
    imagenes: [...subidas, ...(await Promise.all(p.imagenes.map(async (i) => ({ ...i, url: (await alojar(i.url))! }))))],
    productos: await Promise.all(p.productos.map(async (pr) => ({ ...pr, imagen: await alojar(pr.imagen) }))),
  };
}

async function guardarVersion(peticionId: string, numero: number, pr: Propuesta, feedback?: string, capturaUrl?: string) {
  const [v] = await q<{ id: string }>(
    `INSERT INTO newsletter.versiones (peticion_id, numero, enfoque, idioma, composicion, mjml, html, avisos, revisiones, captura_url, feedback)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [peticionId, numero, pr.enfoque, pr.idioma, JSON.stringify(pr.composicion), pr.mjml, pr.html, JSON.stringify(pr.avisos), JSON.stringify(pr.revisiones), capturaUrl ?? null, feedback ?? null],
  );
  return v.id;
}

/** Genera, guarda, crea o actualiza los borradores, manda la prueba y emite los enlaces de aprobación. */
async function procesar(tareaId: string, peticionId: string, p: Peticion, numero: number, anteriores?: Partial<Record<'editorial' | 'comercial', Composicion>>, enfoques?: ('editorial' | 'comercial')[]) {
  const l = log(tareaId);
  try {
    await actualizarTarea(tareaId, { estado: 'en_curso' });
    const plat = plataformaDe(p.marca);
    for (const i of idiomasDe(p)) plat.destino(i); // falla pronto si falta un segmento
    const pAlojada = await alojarImagenes(p, plat);
    // Se guarda con las URLs definitivas: así "pedir cambios" conserva las imágenes subidas en el formulario.
    await q('UPDATE newsletter.peticiones SET peticion = $2 WHERE id = $1', [peticionId, JSON.stringify(pAlojada)]);

    const { propuestas, usos } = await crearNewsletter(pAlojada, { log: l, anteriores, enfoques });
    for (const u of usos) await registrarCoste({ agente: AGENTE, tareaId, proveedor: 'openai', modelo: u.modelo, entrada: u.entrada, salida: u.salida });

    const bloqueantes = propuestas.flatMap((pr) => pr.avisos.filter((a) => a.nivel === 'error').map((a) => `${pr.enfoque}/${pr.idioma}: ${a.detalle}`));
    if (bloqueantes.length) throw new Error(`La newsletter tiene errores que impiden crear el borrador: ${bloqueantes.join(' | ')}`);

    const filtrados = filtrarPruebas([p.solicitante_email, p.destinatarios_prueba]);
    const no_entregables = await plat.noEntregables(filtrados.validos);
    const validos = filtrados.validos.filter((e) => !no_entregables.some((n) => n.email === e));
    const destinatarios = { validos, rechazados: filtrados.rechazados, no_entregables };
    if (no_entregables.length) l(`no llegará a: ${no_entregables.map((n) => `${n.email} (${n.motivo})`).join(', ')}`);

    const versiones: any[] = [];
    for (const pr of propuestas) {
      const captura = await plat.subirImagen(`captura-${peticionId.slice(0, 8)}-v${numero}-${pr.enfoque}-${pr.idioma}.png`, pr.capturas.escritorio);
      const versionId = await guardarVersion(peticionId, numero, pr, p.feedback, captura);
      const [previa] = await q<{ id: string; id_externo: string; url: string }>(
        `SELECT c.id, c.id_externo, c.url FROM newsletter.campanas c JOIN newsletter.versiones v ON v.id = c.version_id
         WHERE v.peticion_id = $1 AND v.enfoque = $2 AND v.idioma = $3 AND c.plataforma = $4 AND c.estado = 'borrador' ORDER BY c.creado DESC LIMIT 1`,
        [peticionId, pr.enfoque, pr.idioma, plat.nombre],
      );
      const contenido = { asunto: pr.composicion.asunto, preheader: pr.composicion.preheader, html: pr.html };
      let campana: { id: string; url: string };
      if (previa) {
        await plat.actualizarBorrador(previa.id_externo, contenido);
        await q('UPDATE newsletter.campanas SET version_id = $2, actualizado = now() WHERE id = $1', [previa.id, versionId]);
        campana = { id: previa.id_externo, url: previa.url };
      } else {
        const titulo = `[Agente] ${p.objetivo.slice(0, 50)} · ${pr.enfoque} · ${pr.idioma} · ${peticionId.slice(0, 8)}`;
        campana = await plat.crearBorrador({ ...contenido, idioma: pr.idioma, titulo });
        await q(`INSERT INTO newsletter.campanas (version_id, plataforma, id_externo, destino, url) VALUES ($1,$2,$3,$4,$5)`, [
          versionId, plat.nombre, campana.id, JSON.stringify(plat.destino(pr.idioma).datos), campana.url,
        ]);
      }
      if (validos.length) {
        await plat.enviarPrueba(campana.id, validos);
        await q(`UPDATE newsletter.campanas SET pruebas = pruebas || $3::jsonb WHERE plataforma = $1 AND id_externo = $2`, [
          plat.nombre, campana.id, JSON.stringify([{ a: validos, fecha: new Date().toISOString(), version: numero }]),
        ]);
      }
      l(`${pr.enfoque}/${pr.idioma}: borrador ${plat.nombre} ${campana.id}${validos.length ? `, prueba a ${validos.join(', ')}` : ''}`);
      versiones.push({
        enfoque: pr.enfoque, idioma: pr.idioma, version_id: versionId, asunto: pr.composicion.asunto, preheader: pr.composicion.preheader,
        captura_url: captura, campana: campana.id, url_panel: campana.url, destino: plat.destino(pr.idioma).descripcion,
        puntuacion_revision: pr.revisiones.at(-1)?.puntuacion, avisos: pr.avisos,
      });
    }
    const estado = validos.length ? 'prueba_enviada' : 'borrador';
    await q('UPDATE newsletter.peticiones SET estado = $2, actualizado = now() WHERE id = $1', [peticionId, estado]);

    // Enlaces de aprobación: uno por propuesta (cubre todos sus idiomas) y uno para pedir cambios. Los anteriores dejan de valer.
    await revocarAprobaciones(recurso(peticionId));
    const base = (process.env.PUBLIC_URL ?? 'http://localhost:3002').replace(/\/$/, '');
    const grupos = [...new Set(versiones.map((v) => v.enfoque))].map((enfoque) => ({ enfoque, versiones: versiones.filter((v) => v.enfoque === enfoque) }));
    const propuestasSalida = [];
    for (const g of grupos) {
      const { token } = await emitirAprobacion({
        agente: AGENTE, accion: 'programar_campana', recurso: recurso(peticionId),
        parametros: { enfoque: g.enfoque, ronda: numero, plataforma: plat.nombre, fecha_envio: p.fecha_envio ?? null,
          campanas: g.versiones.map((v) => ({ id: v.campana, idioma: v.idioma, version_id: v.version_id })) },
      });
      const primera = g.versiones[0];
      propuestasSalida.push({
        etiqueta: grupos.length > 1 ? ETIQUETAS[g.enfoque] : 'única', enfoque: g.enfoque, enlace_aprobar: `${base}/aprobar?t=${token}`,
        asunto: primera.asunto, preheader: primera.preheader, captura_url: primera.captura_url, url_panel: primera.url_panel,
        versiones: g.versiones,
      });
    }
    const cambios = await emitirAprobacion({ agente: AGENTE, accion: 'pedir_cambios', recurso: recurso(peticionId), parametros: { ronda: numero } });
    const enlaceCambios = `${base}/cambios?t=${cambios.token}`;
    const destinoTexto = [...new Set(versiones.map((v) => v.destino))].join(' · ');

    const salida = { peticion_id: peticionId, ronda: numero, estado, propuestas: propuestasSalida, pruebas: destinatarios, enlace_cambios: enlaceCambios };
    await actualizarTarea(tareaId, { estado: 'completada', salida });
    await registrarEvento({ agente: AGENTE, tareaId, recurso: recurso(peticionId), tipo: numero === 1 ? 'borradores_creados' : 'borradores_regenerados', datos: salida });
    await notificar({
      tipo: 'borradores_listos', marca: p.marca, peticion_id: peticionId, ronda: numero, solicitante: p.solicitante_email ?? null,
      destinatarios: validos, no_entregables, objetivo: p.objetivo, destino: destinoTexto, idiomas: idiomasDe(p),
      fecha_envio: p.fecha_envio ? formatoMadrid(madridAUtc(p.fecha_envio)) : null,
      propuestas: propuestasSalida.map((r) => ({ ...r, versiones: r.versiones.map((v: any) => ({ idioma: v.idioma, asunto: v.asunto, preheader: v.preheader, captura_url: v.captura_url, url_panel: v.url_panel })) })),
      enlace_cambios: enlaceCambios,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    l(`ERROR ${msg}`);
    await actualizarTarea(tareaId, { estado: 'error', error: msg }).catch(() => {});
    await q('UPDATE newsletter.peticiones SET estado = $2, actualizado = now() WHERE id = $1', [peticionId, 'error']).catch(() => {});
    await registrarEvento({ agente: AGENTE, tareaId, recurso: recurso(peticionId), tipo: 'error', datos: { mensaje: msg } }).catch(() => {});
    await notificar({ tipo: 'error', peticion_id: peticionId, solicitante: p.solicitante_email ?? null, objetivo: p.objetivo, mensaje: msg }).catch(() => {});
  }
}

// ───────────── Operaciones públicas (herramientas MCP / endpoints HTTP) ─────────────

export async function crear(entrada: unknown, origen = 'http') {
  const p = PeticionSchema.parse(entrada);
  const tareaId = await crearTarea({ agente: AGENTE, tipo: 'crear_newsletter', entrada: { ...p, adjuntos: p.adjuntos.map((a) => ({ nombre: a.nombre })) }, solicitante: p.solicitante_email, origen });
  const [r] = await q<{ id: string }>(
    'INSERT INTO newsletter.peticiones (tarea_id, marca, peticion, solicitante, envio_previsto) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [tareaId, p.marca, JSON.stringify({ ...p, adjuntos: [] }), p.solicitante_email ?? null, p.fecha_envio ? madridAUtc(p.fecha_envio) : null],
  );
  await registrarEvento({ agente: AGENTE, tareaId, recurso: recurso(r.id), tipo: 'peticion_recibida', actor: p.solicitante_email, datos: { origen } });
  void procesar(tareaId, r.id, p, 1);
  return { tarea_id: tareaId, peticion_id: r.id, estado: 'en_curso' };
}

export async function regenerar(peticionId: string, feedback: string, actor?: string, origen = 'http', enfoque?: 'editorial' | 'comercial') {
  const [pet] = await q<{ peticion: Peticion; estado: string }>('SELECT peticion, estado FROM newsletter.peticiones WHERE id = $1', [peticionId]);
  if (!pet) throw new Error('Petición no encontrada');
  if (['programada', 'enviada', 'cancelada'].includes(pet.estado)) throw new Error(`No se puede regenerar una newsletter ${pet.estado}`);
  const [{ max }] = await q<{ max: number }>('SELECT COALESCE(MAX(numero), 0) AS max FROM newsletter.versiones WHERE peticion_id = $1', [peticionId]);
  const maestras = await q<{ enfoque: 'editorial' | 'comercial'; composicion: Composicion }>(
    `SELECT DISTINCT ON (enfoque) enfoque, composicion FROM newsletter.versiones WHERE peticion_id = $1 AND numero = $2 ORDER BY enfoque, (idioma = 'es') DESC`, [peticionId, max],
  );
  if (enfoque && !maestras.some((u) => u.enfoque === enfoque)) throw new Error(`No hay propuesta ${enfoque} en esta petición`);
  const p: Peticion = { ...PeticionSchema.parse(pet.peticion), feedback };
  const tareaId = await crearTarea({ agente: AGENTE, tipo: 'regenerar', entrada: { peticion_id: peticionId, feedback, enfoque }, solicitante: actor, origen });
  await q("UPDATE newsletter.peticiones SET estado = 'cambios_pedidos', tarea_id = $2, peticion = $3, actualizado = now() WHERE id = $1", [peticionId, tareaId, JSON.stringify(p)]);
  await registrarEvento({ agente: AGENTE, tareaId, recurso: recurso(peticionId), tipo: 'cambios_pedidos', actor, datos: { feedback, enfoque } });
  const elegidas = enfoque ? [enfoque] : maestras.map((u) => u.enfoque);
  void procesar(tareaId, peticionId, p, max + 1, Object.fromEntries(maestras.map((u) => [u.enfoque, u.composicion])), elegidas);
  return { tarea_id: tareaId, peticion_id: peticionId, ronda: max + 1, estado: 'en_curso' };
}

export async function enviarPrueba(peticionId: string, emails: string, actor?: string) {
  const [pet] = await q<{ marca: 'betreson' | 'natu' }>('SELECT marca FROM newsletter.peticiones WHERE id = $1', [peticionId]);
  if (!pet) throw new Error('Petición no encontrada');
  const plat = plataformaDe(pet.marca);
  const filtrados = filtrarPruebas([emails]);
  if (!filtrados.validos.length) throw new Error(`Ninguna dirección válida. Solo se admiten los dominios de la empresa. Rechazadas: ${filtrados.rechazados.join(', ')}`);
  const no_entregables = await plat.noEntregables(filtrados.validos);
  const validos = filtrados.validos.filter((e) => !no_entregables.some((n) => n.email === e));
  if (!validos.length) throw new Error(`La plataforma no entregará a ninguna dirección: ${no_entregables.map((n) => `${n.email} (${n.motivo})`).join(', ')}`);
  const camps = await q<{ id_externo: string; numero: number }>(
    `SELECT c.id_externo, v.numero FROM newsletter.campanas c JOIN newsletter.versiones v ON v.id = c.version_id
     WHERE v.peticion_id = $1 AND c.plataforma = $2 AND c.estado = 'borrador'`, [peticionId, plat.nombre],
  );
  if (!camps.length) throw new Error('Esta petición no tiene borradores');
  for (const c of camps) {
    await plat.enviarPrueba(c.id_externo, validos);
    await q(`UPDATE newsletter.campanas SET pruebas = pruebas || $3::jsonb WHERE plataforma = $1 AND id_externo = $2`, [
      plat.nombre, c.id_externo, JSON.stringify([{ a: validos, fecha: new Date().toISOString(), version: c.numero }]),
    ]);
  }
  await q("UPDATE newsletter.peticiones SET estado = 'prueba_enviada', actualizado = now() WHERE id = $1 AND estado IN ('borrador','prueba_enviada')", [peticionId]);
  const dest = { validos, rechazados: filtrados.rechazados, no_entregables };
  await registrarEvento({ agente: AGENTE, recurso: recurso(peticionId), tipo: 'prueba_enviada', actor, datos: dest });
  return { enviada_a: validos, rechazadas: filtrados.rechazados, no_entregables, campanas: camps.map((c) => c.id_externo) };
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
    `SELECT v.numero, v.enfoque, v.idioma, v.composicion->>'asunto' AS asunto, v.composicion->>'preheader' AS preheader, v.captura_url,
            c.plataforma, c.id_externo AS campana, c.estado AS estado_campana, c.programada_para, c.url, c.pruebas, v.creado
     FROM newsletter.versiones v LEFT JOIN newsletter.campanas c ON c.version_id = v.id
     WHERE v.peticion_id = $1 ORDER BY v.numero DESC, v.enfoque, v.idioma`, [peticionId]);
  const ultimaTarea = tarea ?? (await leerTarea(pet.tarea_id));
  const historial = await q('SELECT tipo, actor, creado FROM shared.eventos WHERE recurso = $1 ORDER BY creado', [recurso(peticionId)]);
  return { peticion: pet, tarea: ultimaTarea && { id: ultimaTarea.id, tipo: ultimaTarea.tipo, estado: ultimaTarea.estado, error: ultimaTarea.error }, versiones, historial };
}

/** Últimas peticiones (opcionalmente de una persona), para que un asistente pueda decir "cómo va lo mío". */
export async function listar(opts: { solicitante?: string; limite?: number }) {
  const limite = Math.min(Math.max(opts.limite ?? 5, 1), 20);
  return q(
    `SELECT p.id AS peticion_id, p.marca, p.estado, p.peticion->>'objetivo' AS objetivo, p.peticion->'idiomas' AS idiomas,
            p.envio_previsto, p.solicitante, p.creado, p.actualizado,
            (SELECT max(numero) FROM newsletter.versiones v WHERE v.peticion_id = p.id) AS ronda
     FROM newsletter.peticiones p WHERE ($1::text IS NULL OR lower(p.solicitante) = lower($1)) AND p.estado <> 'cancelada'
     ORDER BY p.creado DESC LIMIT $2`, [opts.solicitante ?? null, limite]);
}

/** Al arrancar, las tareas que quedaron a medias por un reinicio se marcan como error. */
export async function limpiarTareasHuérfanas() {
  await q(`UPDATE shared.tareas SET estado = 'error', error = 'Interrumpida por reinicio del servicio', actualizado = now()
           WHERE agente = $1 AND estado IN ('pendiente','en_curso')`, [AGENTE]);
}
