/**
 * Cliente de la API de Marketing v3 de Mailchimp.
 *
 * SEGURIDAD: igual que en Mailrelay, el único método que puede llegar a la lista
 * real es `programar`, que exige una aprobación consumida y una fecha futura.
 * No existe ningún método para `actions/send` (envío inmediato).
 */
import type { AprobacionConsumida } from './mailrelay.js';

export const MARGEN_MINIMO_MIN = 15;

export class MailchimpError extends Error {
  constructor(public estado: number, public cuerpo: string, ruta: string) {
    super(`Mailchimp ${estado} en ${ruta}: ${cuerpo.slice(0, 400)}`);
  }
}

/** Mailchimp solo programa en :00, :15, :30 y :45. Redondea al cuarto más cercano. */
export function redondearCuarto(fecha: Date): { fecha: Date; ajustada: boolean } {
  const ms = 15 * 60_000;
  const r = new Date(Math.round(fecha.getTime() / ms) * ms);
  r.setUTCSeconds(0, 0);
  return { fecha: r, ajustada: r.getTime() !== fecha.getTime() };
}

export class Mailchimp {
  private base: string;
  constructor(dc = process.env.MAILCHIMP_DC ?? 'us13', private clave = process.env.MAILCHIMP_API_KEY ?? '') {
    this.base = `https://${dc}.api.mailchimp.com/3.0`;
    this.dc = dc;
  }
  private dc: string;

  private async pedir<T>(metodo: string, ruta: string, cuerpo?: unknown, intento = 0): Promise<T> {
    const r = await fetch(this.base + ruta, {
      method: metodo,
      headers: { Authorization: `Basic ${Buffer.from(`natu:${this.clave}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    if (r.status === 429 && intento < 3) {
      await new Promise((res) => setTimeout(res, 5000 * (intento + 1)));
      return this.pedir(metodo, ruta, cuerpo, intento + 1);
    }
    const texto = await r.text();
    if (!r.ok) throw new MailchimpError(r.status, texto, `${metodo} ${ruta}`);
    return (texto ? JSON.parse(texto) : undefined) as T;
  }

  ping = () => this.pedir<{ health_status: string }>('GET', '/ping');

  private async carpeta(tipo: 'file-manager/folders' | 'campaign-folders', nombre: string): Promise<string> {
    const clave = tipo === 'campaign-folders' ? 'folders' : 'folders';
    const r = await this.pedir<Record<string, { id: string | number; name: string }[]>>('GET', `/${tipo}?count=1000`);
    const existente = r[clave]?.find((c) => c.name === nombre);
    if (existente) return String(existente.id);
    return String((await this.pedir<{ id: string | number }>('POST', `/${tipo}`, { name: nombre })).id);
  }
  carpetaArchivos = (nombre: string) => this.carpeta('file-manager/folders', nombre);
  carpetaCampanas = (nombre: string) => this.carpeta('campaign-folders', nombre);

  /** Sube una imagen al File Manager y devuelve su URL pública (mcusercontent.com). */
  async subirImagen(nombre: string, datos: Buffer, carpetaId?: string): Promise<{ id: number; url: string }> {
    const r = await this.pedir<{ id: number; full_size_url: string }>('POST', '/file-manager/files', {
      name: nombre, file_data: datos.toString('base64'), folder_id: carpetaId ? Number(carpetaId) : undefined,
    });
    return { id: r.id, url: r.full_size_url };
  }

  async crearBorrador(c: { lista: string; segmento: number; asunto: string; preheader: string; html: string; titulo: string; deNombre: string; responderA: string; carpetaId?: string }) {
    const camp = await this.pedir<{ id: string; web_id: number }>('POST', '/campaigns', {
      type: 'regular',
      recipients: { list_id: c.lista, segment_opts: { saved_segment_id: c.segmento } },
      settings: { subject_line: c.asunto, preview_text: c.preheader, title: c.titulo, from_name: c.deNombre, reply_to: c.responderA, folder_id: c.carpetaId, inline_css: true },
      tracking: { opens: true, html_clicks: true },
    });
    await this.pedir('PUT', `/campaigns/${camp.id}/content`, { html: c.html });
    return camp;
  }

  async actualizarBorrador(id: string, c: { asunto: string; preheader: string; html: string }) {
    await this.pedir('PATCH', `/campaigns/${id}`, { settings: { subject_line: c.asunto, preview_text: c.preheader } });
    await this.pedir('PUT', `/campaigns/${id}/content`, { html: c.html });
  }

  leerCampana = (id: string) => this.pedir<{ id: string; web_id: number; status: string; send_time?: string; settings: { subject_line: string }; recipients: { list_id: string; segment_opts?: { saved_segment_id?: number } } }>('GET', `/campaigns/${id}`);

  /** Lista de comprobación de Mailchimp antes de enviar (pie, enlace de baja, remitente…). */
  checklist = (id: string) => this.pedir<{ is_ready: boolean; items: { type: string; heading: string; details: string }[] }>('GET', `/campaigns/${id}/send-checklist`);

  async enviarPrueba(id: string, emails: string[]) {
    if (!emails.length) throw new Error('Sin destinatarios de prueba');
    await this.pedir('POST', `/campaigns/${id}/actions/test`, { test_emails: emails, send_type: 'html' });
  }

  /** Programa el envío. Redondea al cuarto de hora y devuelve la hora real y si se ha ajustado. */
  async programar(id: string, opts: { fecha: Date; aprobacion: AprobacionConsumida }): Promise<{ fecha: Date; ajustada: boolean }> {
    if (!opts.aprobacion?.aprobacionId || !opts.aprobacion?.aprobadoPor) throw new Error('Programar exige una aprobación consumida');
    if (!(opts.fecha instanceof Date) || Number.isNaN(opts.fecha.getTime())) throw new Error('Programar exige una fecha válida');
    let { fecha, ajustada } = redondearCuarto(opts.fecha);
    if (fecha.getTime() < Date.now() + MARGEN_MINIMO_MIN * 60_000) {
      if (opts.fecha.getTime() < Date.now() + MARGEN_MINIMO_MIN * 60_000) throw new Error(`La fecha de envío debe ser al menos ${MARGEN_MINIMO_MIN} minutos en el futuro`);
      fecha = new Date(fecha.getTime() + 15 * 60_000); // el redondeo la acercó demasiado: siguiente cuarto
      ajustada = true;
    }
    await this.pedir('POST', `/campaigns/${id}/actions/schedule`, { schedule_time: fecha.toISOString() });
    return { fecha, ajustada };
  }

  desprogramar = (id: string) => this.pedir('POST', `/campaigns/${id}/actions/unschedule`);
  borrar = (id: string) => this.pedir('DELETE', `/campaigns/${id}`);

  urlPanel = (webId: number) => `https://${this.dc}.admin.mailchimp.com/campaigns/edit?id=${webId}`;
}
