/**
 * Cliente de la API v1 de Mailrelay (https://apidocs.mailrelay.com/openapi.json).
 *
 * SEGURIDAD: este cliente NO expone `POST /campaigns/{id}/send_all`. Esa llamada
 * sin `scheduled_at` envía al instante a toda la lista. Programar se añadirá en
 * la fase 3, exigiendo un token de aprobación válido y una fecha futura.
 */
export interface Campana {
  id: number;
  subject: string;
  sender_id: number;
  target: 'groups' | 'segment';
  group_ids?: number[];
  preview_text?: string;
  campaign_folder_id?: number | null;
}

export class MailrelayError extends Error {
  constructor(public estado: number, public cuerpo: string, ruta: string) {
    super(`Mailrelay ${estado} en ${ruta}: ${cuerpo.slice(0, 300)}`);
  }
}

export class Mailrelay {
  private base: string;
  private restantes = Infinity;
  private reinicio = 0;

  constructor(private cuenta = process.env.MAILRELAY_ACCOUNT ?? 'betreson.ipzmarketing.com', private clave = process.env.MAILRELAY_API_KEY ?? '') {
    this.base = `https://${this.cuenta}/api/v1`;
  }

  /** Respeta el límite de 250 peticiones / 5 min: si quedan pocas, espera a que se reinicie la ventana. */
  private async pedir<T>(metodo: string, ruta: string, cuerpo?: unknown, intento = 0): Promise<T> {
    if (this.restantes < 5 && Date.now() < this.reinicio) await new Promise((r) => setTimeout(r, this.reinicio - Date.now() + 500));
    const r = await fetch(this.base + ruta, {
      method: metodo,
      headers: { 'X-AUTH-TOKEN': this.clave, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const rem = r.headers.get('x-ratelimit-remaining');
    const reset = r.headers.get('x-ratelimit-reset');
    if (rem) this.restantes = Number(rem);
    if (reset) this.reinicio = Number(reset) * 1000;
    if (r.status === 429 && intento < 3) {
      const espera = Number(r.headers.get('retry-after') ?? 30) * 1000;
      await new Promise((res) => setTimeout(res, espera));
      return this.pedir(metodo, ruta, cuerpo, intento + 1);
    }
    const texto = await r.text();
    if (!r.ok) throw new MailrelayError(r.status, texto, `${metodo} ${ruta}`);
    return (texto ? JSON.parse(texto) : undefined) as T;
  }

  async ping(): Promise<boolean> {
    await this.pedir('GET', '/ping');
    return true;
  }

  private async carpeta(tipo: 'media_folders' | 'campaign_folders', nombre: string): Promise<number> {
    const lista = await this.pedir<{ id: number; name: string }[]>('GET', `/${tipo}?per_page=100`);
    const existente = lista.find((c) => c.name === nombre);
    if (existente) return existente.id;
    return (await this.pedir<{ id: number }>('POST', `/${tipo}`, { name: nombre })).id;
  }
  carpetaMedios = (nombre: string) => this.carpeta('media_folders', nombre);
  carpetaCampanas = (nombre: string) => this.carpeta('campaign_folders', nombre);

  /** Sube una imagen y devuelve su URL pública en assets.ipzmarketing.com. */
  async subirImagen(nombre: string, datos: Buffer, carpetaId?: number): Promise<{ id: number; url: string }> {
    const r = await this.pedir<{ id: number; url: string }>('POST', '/media_files', {
      media_folder_id: carpetaId,
      file: { name: nombre, content: datos.toString('base64') },
    });
    return { id: r.id, url: r.url };
  }

  async crearBorrador(c: { asunto: string; preheader: string; html: string; senderId: number; grupos: number[]; carpetaId?: number; utm?: string }): Promise<Campana> {
    return this.pedir<Campana>('POST', '/campaigns', {
      subject: c.asunto,
      preview_text: c.preheader,
      html: c.html,
      sender_id: c.senderId,
      target: 'groups',
      group_ids: c.grupos,
      campaign_folder_id: c.carpetaId,
      analytics_utm_campaign: c.utm,
      use_premailer: true,
      track_opens: true,
      track_clicks: true,
    });
  }

  async actualizarBorrador(id: number, c: { asunto?: string; preheader?: string; html?: string }): Promise<Campana> {
    return this.pedir<Campana>('PATCH', `/campaigns/${id}`, { subject: c.asunto, preview_text: c.preheader, html: c.html });
  }

  leerCampana = (id: number) => this.pedir<Campana>('GET', `/campaigns/${id}`);

  /** Envío de prueba. Las direcciones deben venir ya validadas contra la lista blanca de dominios. */
  async enviarPrueba(id: number, emails: string[]): Promise<void> {
    if (emails.length === 0) throw new Error('Sin destinatarios de prueba');
    await this.pedir('POST', `/campaigns/${id}/send_test`, { test_emails: emails.join(',') });
  }

  urlPanel = (id: number) => `https://${this.cuenta}/admin/campaigns/${id}/edit`;
}
