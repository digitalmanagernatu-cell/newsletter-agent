import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { claveValida } from '@natu/shared';
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
  const s = new McpServer({ name: 'natu-agente-newsletter', version: '0.2.0' });
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

  s.registerTool('estado_campana', {
    title: 'Estado de la campaña',
    description: 'Estado de una petición: tarea en curso, versiones, borradores, pruebas enviadas e historial.',
    inputSchema: { peticion_id: z.string().uuid().optional(), tarea_id: z.string().uuid().optional() },
    annotations: { readOnlyHint: true },
  }, seguro((a) => svc.estado(a)));

  // programar_campana se añade en la fase 3, con token de aprobación obligatorio.
  return s;
}

export function crearApp() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => { res.json({ ok: true, agente: 'newsletter' }); });

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
  app.get('/v1/newsletters/:id', ruta((r) => svc.estado({ peticion_id: String(r.params.id) })));
  app.get('/v1/tareas/:id', ruta((r) => svc.estado({ tarea_id: String(r.params.id) })));
  return app;
}

if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  await svc.limpiarTareasHuérfanas();
  const puerto = Number(process.env.PORT ?? 3002);
  crearApp().listen(puerto, () => console.log(`Agente newsletter escuchando en :${puerto} (MCP en /mcp, REST en /v1)`));
}
