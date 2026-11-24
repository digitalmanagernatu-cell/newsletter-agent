import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { claveValida, ErrorAprobacion, verAprobacion, q } from '@natu/shared';
import * as apr from './aprobacion.js';
import { paginaAprobar, paginaCambios, paginaResultado, escaparHtml as h } from './paginas.js';
import { PeticionSchema } from './schema.js';
import * as svc from './servicio.js';

/**
 * El agente se expone de dos formas con la misma lógica:
 *  - MCP (Streamable HTTP) en /mcp, para el orquestador y otros agentes.
 *  - REST en /v1, para n8n.
 * Ambas exigen `Authorization: Bearer <AGENT_API_KEYS>`.
 */
const DESCRIPCION_TAREA = 'Tarda 2–4 minutos: devuelve tarea_id y peticion_id; consulta el resultado con estado_campana.';

function crearServidorMcp() {
  const s = new McpServer({ name: 'natu-agente-newsletter', version: '0.3.0' });
  const json = (o: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(o, null, 2) }] });
  const seguro = <A,>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
    try { return json(await fn(a)); } catch (e) { return { ...json({ error: e instanceof Error ? e.message : String(e) }), isError: true }; }
  };

  s.registerTool('crear_newsletter', {
    title: 'Crear newsletter',
    description: `Diseña una newsletter (1 o 2 propuestas) con el kit de marca, crea los borradores en la plataforma (BetrésON → Mailrelay) y envía la prueba al solicitante y a los destinatarios de prueba de la empresa. Nunca envía a la lista real. ${DESCRIPCION_TAREA}`,
    inputSchema: PeticionSchema.shape,
  }, seguro((a) => svc.crear(a, 'mcp')));

  s.registerTool('regenerar', {
    title: 'Regenerar con cambios',
    description: `Aplica el feedback del equipo, crea una nueva ronda, actualiza los borradores y reenvía la prueba. ${DESCRIPCION_TAREA}`,
    inputSchema: {
      peticion_id: z.string().uuid(), feedback: z.string().min(3), actor: z.string().email().optional(),
      enfoque: z.enum(['editorial', 'comercial']).optional().describe('Solo regenera esta propuesta (la que ha elegido el equipo)'),
    },
  }, seguro((a) => svc.regenerar(a.peticion_id, a.feedback, a.actor, 'mcp', a.enfoque)));

  s.registerTool('enviar_prueba', {
    title: 'Enviar prueba',
    description: 'Reenvía la prueba de los borradores actuales. Solo admite direcciones de los dominios de la empresa.',
    inputSchema: { peticion_id: z.string().uuid(), emails: z.string().describe('Direcciones separadas por comas'), actor: z.string().email().optional() },
  }, seguro((a) => svc.enviarPrueba(a.peticion_id, a.emails, a.actor)));

  s.registerTool('listar_newsletters', {
    title: 'Últimas newsletters',
    description: 'Últimas peticiones de newsletter (opcionalmente de una persona), con su estado y fecha de envío prevista.',
    inputSchema: { solicitante: z.string().email().optional(), limite: z.number().int().min(1).max(20).optional() },
    annotations: { readOnlyHint: true },
  }, seguro((a) => svc.listar(a)));

  s.registerTool('estado_campana', {
    title: 'Estado de la campaña',
    description: 'Estado de una petición: tarea en curso, versiones, borradores, pruebas enviadas e historial.',
    inputSchema: { peticion_id: z.string().uuid().optional(), tarea_id: z.string().uuid().optional() },
    annotations: { readOnlyHint: true },
  }, seguro((a) => svc.estado(a)));

  s.registerTool('programar_campana', {
    title: 'Programar campaña',
    description: 'Programa el envío real de la propuesta aprobada. Exige el token de aprobación de un solo uso que recibe una persona del equipo en el email de aprobación, y el email de esa persona. Sin token válido no hace nada.',
    inputSchema: {
      token: z.string().min(20).describe('Token de aprobación (parámetro t del enlace "Aprobar")'),
      aprobador_email: z.string().email(),
      fecha_envio: z.string().optional().describe('Hora de Madrid, p. ej. 2026-12-01T09:30. Si falta, la de la petición.'),
    },
    annotations: { destructiveHint: true },
  }, seguro((a) => apr.aprobarYProgramar(a.token, a.aprobador_email, a.fecha_envio)));

  s.registerTool('cancelar_programacion', {
    title: 'Cancelar programación',
    description: 'Cancela el envío programado de una petición. Es definitivo en Mailrelay.',
    inputSchema: { peticion_id: z.string().uuid(), actor: z.string().email(), motivo: z.string().optional() },
    annotations: { destructiveHint: true },
  }, seguro((a) => apr.cancelarProgramacion(a.peticion_id, a.actor, a.motivo)));
  return s;
}

export function crearApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => { res.json({ ok: true, agente: 'newsletter' }); });

  // ── Rutas públicas protegidas por token de un solo uso (enlaces del email) ──
  app.use(['/aprobar', '/cambios'], express.urlencoded({ extended: false, limit: '20kb' }));
  const html = (res: Response, codigo: number, cuerpo: string) => { res.status(codigo).set('Cache-Control', 'no-store').type('html').send(cuerpo); };
  const fallo = (res: Response, err: unknown) => {
    const esperado = err instanceof ErrorAprobacion;
    if (!esperado) console.error(err);
    html(res, esperado ? 400 : 500, paginaResultado('No se ha podido completar', h(esperado ? err.message : 'Error inesperado. Avisa a Digital.'), false));
  };
  // GET solo muestra la página: así los antivirus que abren enlaces no aprueban nada.
  app.get('/aprobar', async (req, res) => {
    try { html(res, 200, paginaAprobar(String(req.query.t ?? ''), await apr.datosAprobacion(String(req.query.t ?? '')))); } catch (err) { fallo(res, err); }
  });
  app.post('/aprobar', async (req, res) => {
    try {
      const r = await apr.aprobarYProgramar(String(req.body.t ?? ''), String(req.body.email ?? ''), String(req.body.fecha ?? '') || undefined);
      html(res, 200, paginaResultado('Newsletter programada', `<p>Se enviará el <strong>${h(r.fecha)}</strong> a ${h(r.destino)}.</p>${r.aviso ? `<p>⚠️ ${h(r.aviso)}</p>` : ''}<p>Aprobada por ${h(r.aprobador)}. Recibiréis la confirmación por email.</p>${r.url_campana ? `<p><a href="${h(r.url_campana)}">Ver la campaña</a></p>` : ''}`));
    } catch (err) { fallo(res, err); }
  });
  app.get('/cambios', async (req, res) => {
    try {
      const a = await verAprobacion(String(req.query.t ?? ''), 'pedir_cambios');
      const [{ n }] = await q<{ n: number }>("SELECT count(DISTINCT enfoque)::int AS n FROM newsletter.versiones WHERE peticion_id = $1", [a.recurso.replace('newsletter.peticion:', '')]);
      html(res, 200, paginaCambios(String(req.query.t), n > 1));
    } catch (err) { fallo(res, err); }
  });
  app.post('/cambios', async (req, res) => {
    try {
      const enfoque = ['editorial', 'comercial'].includes(req.body.enfoque) ? req.body.enfoque : undefined;
      await apr.pedirCambios(String(req.body.t ?? ''), String(req.body.email ?? ''), String(req.body.feedback ?? ''), enfoque);
      html(res, 200, paginaResultado('Cambios recibidos', '<p>Estamos preparando la nueva versión. Te llegará una prueba nueva y otro email de aprobación en unos minutos.</p>'));
    } catch (err) { fallo(res, err); }
  });
  app.post('/callbacks/mailrelay/:firma/:peticion', async (req, res) => {
    try { res.json(await apr.callbackMailrelay(String(req.params.firma), String(req.params.peticion), req.body ?? {})); }
    catch { res.status(403).json({ error: 'No autorizado' }); }
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!claveValida(req.headers.authorization)) { res.status(401).json({ error: 'No autorizado' }); return; }
    next();
  });

  // MCP sin estado: un transporte por petición.
  app.post('/mcp', async (req, res) => {
    const servidor = crearServidorMcp();
    const transporte = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transporte.close(); void servidor.close(); });
    await servidor.connect(transporte);
    await transporte.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => { res.status(405).json({ error: 'Usa POST' }); });

  const ruta = (fn: (req: Request) => Promise<unknown>, codigo = 200) => async (req: Request, res: Response) => {
    try { res.status(codigo).json(await fn(req)); }
    catch (e) {
      const zod = e instanceof z.ZodError;
      res.status(zod ? 400 : /no encontrada/i.test(String(e)) ? 404 : 422).json({ error: zod ? e.issues : e instanceof Error ? e.message : String(e) });
    }
  };
  app.post('/v1/newsletters', ruta((r) => svc.crear(r.body, 'n8n'), 202));
  app.post('/v1/newsletters/:id/regenerar', ruta((r) => svc.regenerar(String(r.params.id), String(r.body?.feedback ?? ''), r.body?.actor, 'n8n', r.body?.enfoque), 202));
  app.post('/v1/newsletters/:id/prueba', ruta((r) => svc.enviarPrueba(String(r.params.id), String(r.body?.emails ?? ''), r.body?.actor)));
  app.get('/v1/newsletters', ruta((r) => svc.listar({ solicitante: r.query.solicitante ? String(r.query.solicitante) : undefined, limite: r.query.limite ? Number(r.query.limite) : undefined })));
  app.get('/v1/newsletters/:id', ruta((r) => svc.estado({ peticion_id: String(r.params.id) })));
  app.get('/v1/tareas/:id', ruta((r) => svc.estado({ tarea_id: String(r.params.id) })));
  app.post('/v1/newsletters/:id/cancelar', ruta((r) => apr.cancelarProgramacion(String(r.params.id), String(r.body?.actor ?? ''), r.body?.motivo)));
  return app;
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  await svc.limpiarTareasHuérfanas();
  const puerto = Number(process.env.PORT ?? 3002);
  crearApp().listen(puerto, () => console.log(`Agente newsletter escuchando en :${puerto} (MCP en /mcp, REST en /v1)`));
}
