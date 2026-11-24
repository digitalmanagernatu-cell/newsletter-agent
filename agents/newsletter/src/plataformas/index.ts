import { cargarKit, type Marca } from '../brand.js';
import { Mailrelay, type AprobacionConsumida } from './mailrelay.js';
import { Mailchimp } from './mailchimp.js';

/** Interfaz común: el servicio no sabe si habla con Mailrelay o con Mailchimp. */
export interface Plataforma {
  nombre: 'mailrelay' | 'mailchimp';
  esUrlPropia(url: string): boolean;
  subirImagen(nombre: string, datos: Buffer): Promise<string>;
  destino(idioma: string): { descripcion: string; datos: Record<string, unknown> };
  crearBorrador(c: { asunto: string; preheader: string; html: string; idioma: string; titulo: string }): Promise<{ id: string; url: string }>;
  actualizarBorrador(id: string, c: { asunto: string; preheader: string; html: string }): Promise<void>;
  noEntregables(emails: string[]): Promise<{ email: string; motivo: string }[]>;
  enviarPrueba(id: string, emails: string[]): Promise<void>;
  comprobarAntesDeProgramar(id: string): Promise<void>;
  programar(id: string, idioma: string, fecha: Date, aprobacion: AprobacionConsumida, callbackUrl?: string): Promise<{ envioId: string | null; fecha: Date; ajustada: boolean }>;
  cancelar(id: string, envioId: string | null): Promise<void>;
}

const CARPETA = 'Agente newsletters';
const cache = new Map<Marca, Plataforma>();

export function plataformaDe(marca: Marca): Plataforma {
  if (!cache.has(marca)) cache.set(marca, marca === 'betreson' ? mailrelay() : mailchimp());
  return cache.get(marca)!;
}

function mailrelay(): Plataforma {
  const kit = cargarKit('betreson');
  const mr = new Mailrelay();
  let carpetaMedios: Promise<number> | undefined;
  let carpetaCampanas: Promise<number> | undefined;
  const grupos: number[] = process.env.MAILRELAY_GROUP_IDS ? process.env.MAILRELAY_GROUP_IDS.split(',').map(Number) : kit.raw.destino.mailrelay_group_ids;
  return {
    nombre: 'mailrelay',
    esUrlPropia: (u) => u.startsWith('https://assets.ipzmarketing.com/'),
    subirImagen: async (n, d) => (await mr.subirImagen(n, d, await (carpetaMedios ??= mr.carpetaMedios(CARPETA)))).url,
    destino: () => ({ descripcion: process.env.MAILRELAY_GROUP_IDS ? `grupos ${grupos.join(', ')}` : kit.raw.destino.nombre, datos: { grupos } }),
    async crearBorrador(c) {
      const camp = await mr.crearBorrador({
        asunto: c.asunto, preheader: c.preheader, html: c.html, senderId: kit.raw.remitente.mailrelay_sender_id, grupos,
        carpetaId: await (carpetaCampanas ??= mr.carpetaCampanas(CARPETA)), utm: c.titulo.slice(0, 50),
      });
      return { id: String(camp.id), url: mr.urlPanel(camp.id) };
    },
    actualizarBorrador: async (id, c) => { await mr.actualizarBorrador(Number(id), c); },
    async noEntregables(emails) {
      const out = [];
      for (const e of emails) { const m = await mr.motivoNoEntregable(e); if (m) out.push({ email: e, motivo: m }); }
      return out;
    },
    enviarPrueba: (id, emails) => mr.enviarPrueba(Number(id), emails),
    comprobarAntesDeProgramar: async () => {},
    async programar(id, _idioma, fecha, aprobacion, callbackUrl) {
      const r = await mr.programar(Number(id), { grupos, fecha, aprobacion, callbackUrl });
      return { envioId: String(r.envioId), fecha, ajustada: false };
    },
    cancelar: async (_id, envioId) => { if (envioId) await mr.cancelarEnvio(Number(envioId)); },
  };
}

function mailchimp(): Plataforma {
  const kit = cargarKit('natu');
  const mc = new Mailchimp();
  const cfg = kit.raw.mailchimp;
  let carpetaArchivos: Promise<string> | undefined;
  let carpetaCampanas: Promise<string> | undefined;
  const segmentoDe = (idioma: string): number => {
    const forzado = process.env.MAILCHIMP_SEGMENT_OVERRIDE; // solo para pruebas: un segmento con direcciones internas
    if (forzado) return Number(forzado);
    const s = cfg.segmentos_por_idioma[idioma];
    if (!s) throw new Error(`No hay segmento de Mailchimp para el idioma "${idioma}" (${cfg.nombres_segmento[idioma] ?? idioma}). Créalo y añádelo a brand/natu/brand.json.`);
    return s;
  };
  return {
    nombre: 'mailchimp',
    esUrlPropia: (u) => u.startsWith('https://mcusercontent.com/'),
    subirImagen: async (n, d) => (await mc.subirImagen(n, d, await (carpetaArchivos ??= mc.carpetaArchivos(CARPETA)))).url,
    destino: (idioma) => ({
      descripcion: process.env.MAILCHIMP_SEGMENT_OVERRIDE ? `segmento de prueba ${process.env.MAILCHIMP_SEGMENT_OVERRIDE}` : `${cfg.nombres_segmento[idioma]} (audiencia NATU)`,
      datos: { lista: cfg.list_id, segmento: segmentoDe(idioma) },
    }),
    async crearBorrador(c) {
      const camp = await mc.crearBorrador({
        lista: cfg.list_id, segmento: segmentoDe(c.idioma), asunto: c.asunto, preheader: c.preheader, html: c.html,
        titulo: c.titulo, deNombre: cfg.from_name, responderA: cfg.reply_to, carpetaId: await (carpetaCampanas ??= mc.carpetaCampanas(CARPETA)),
      });
      return { id: camp.id, url: mc.urlPanel(camp.web_id) };
    },
    actualizarBorrador: (id, c) => mc.actualizarBorrador(id, c),
    noEntregables: async () => [], // las pruebas de Mailchimp no dependen de la audiencia
    enviarPrueba: (id, emails) => mc.enviarPrueba(id, emails),
    async comprobarAntesDeProgramar(id) {
      const c = await mc.checklist(id);
      const errores = c.items.filter((i) => i.type === 'error');
      if (!c.is_ready || errores.length) throw new Error(`Mailchimp no deja programar la campaña ${id}: ${errores.map((e) => `${e.heading}: ${e.details}`).join(' | ') || 'no está lista'}`);
    },
    async programar(id, idioma, fecha, aprobacion) {
      const camp = await mc.leerCampana(id);
      if (camp.recipients.segment_opts?.saved_segment_id !== segmentoDe(idioma)) throw new Error(`La campaña ${id} no apunta al segmento esperado para ${idioma}`);
      const r = await mc.programar(id, { fecha, aprobacion });
      return { envioId: null, ...r };
    },
    cancelar: async (id) => { await mc.desprogramar(id); },
  };
}
