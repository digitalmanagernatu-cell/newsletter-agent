/**
 * Cliente de la API v1 de Mailrelay (https://apidocs.mailrelay.com/openapi.json).
 *
 * SEGURIDAD: `POST /campaigns/{id}/send_all` sin `scheduled_at` envía al instante
 * a toda la lista. Por eso el único método que lo usa (`programar`) exige siempre
 * una fecha futura con margen y una prueba de aprobación consumida, y nunca
 * llama a send_all sin `scheduled_at`.
 */
export const MARGEN_MINIMO_MIN = 10;

/** Marca que solo puede fabricar la capa de servicio tras consumir un token de aprobación. */
export interface AprobacionConsumida { readonly aprobacionId: string; readonly aprobadoPor: string }
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

  /**
   * Mailrelay descarta en silencio los envíos (también las pruebas) a direcciones
   * dadas de baja, rebotadas o bloqueadas. Devuelve el motivo si no llegará.
   */
  async motivoNoEntregable(email: string): Promise<string | null> {
    const r = await this.pedir<{ status: string; unsubscribed: boolean; unsubscribed_at: string | null; bounced: boolean; reported_spam: boolean; local_ban: boolean; global_ban: boolean }[]>(
      'GET', `/subscribers?q%5Bemail_eq%5D=${encodeURIComponent(email)}`,
    );
    const s = r[0];
    if (!s) return null;
    if (s.unsubscribed) return `dada de baja en Mailrelay${s.unsubscribed_at ? ` el ${s.unsubscribed_at.slice(0, 10)}` : ''}`;
    if (s.bounced) return 'rebotada en Mailrelay';
    if (s.reported_spam) return 'marcó un envío como spam';
    if (s.local_ban || s.global_ban) return 'bloqueada en Mailrelay';
    if (s.status && s.status !== 'active') return `estado "${s.status}" en Mailrelay`;
    return null;
  }

  /**
   * Programa el envío a los grupos en `fecha` (instante UTC). Devuelve el id del envío
   * (sent_campaign), necesario para cancelarlo.
   */
  async programar(id: number, opts: { grupos: number[]; fecha: Date; aprobacion: AprobacionConsumida; callbackUrl?: string }): Promise<{ envioId: number; programadaUtc: string }> {
    if (!opts.aprobacion?.aprobacionId || !opts.aprobacion?.aprobadoPor) throw new Error('Programar exige una aprobación consumida');
    if (!(opts.fecha instanceof Date) || Number.isNaN(opts.fecha.getTime())) throw new Error('Programar exige una fecha válida');
    if (opts.fecha.getTime() < Date.now() + MARGEN_MINIMO_MIN * 60_000)
      throw new Error(`La fecha de envío debe ser al menos ${MARGEN_MINIMO_MIN} minutos en el futuro`);
    if (!opts.grupos.length) throw new Error('Sin grupos de destino');
    const programadaUtc = opts.fecha.toISOString().slice(0, 19).replace('T', ' '); // "YYYY-MM-DD HH:MM:SS" en UTC
    const r = await this.pedir<{ id: number; scheduled_at?: string; status?: string }>('POST', `/campaigns/${id}/send_all`, {
      target: 'groups',
      group_ids: opts.grupos,
      scheduled_at: programadaUtc,
      callback_url: opts.callbackUrl,
    });
    return { envioId: r.id, programadaUtc };
  }

  /** Cancela un envío programado (definitivo: no se puede reanudar). */
  async cancelarEnvio(envioId: number): Promise<void> {
    await this.pedir('PATCH', `/sent_campaigns/${envioId}/cancel`);
  }

  leerEnvio = (envioId: number) => this.pedir<{ id: number; status: string; scheduled_at?: string }>('GET', `/sent_campaigns/${envioId}`);

  urlPanel = (id: number) => `https://${this.cuenta}/admin/campaigns/${id}/edit`;
}
