import type { Kit } from './brand.js';
import type { Composicion } from './schema.js';

export interface Aviso { nivel: 'error' | 'aviso'; regla: string; detalle: string }

const LIMITE_GMAIL = 102 * 1024; // Gmail recorta los mensajes de más de ~102 KB

/** Comprobaciones deterministas antes de enseñar nada a nadie. */
export function revisarReglas(kit: Kit, comp: Composicion, html: string, erroresMjml: string[]): Aviso[] {
  const a: Aviso[] = [];
  const add = (nivel: Aviso['nivel'], regla: string, detalle: string) => a.push({ nivel, regla, detalle });

  for (const e of erroresMjml) add('error', 'mjml', e);

  // Enlace de baja: obligatorio, exacto y sin codificar (ver campaña 82 de Mailrelay).
  if (!html.includes(kit.etiquetaBaja)) add('error', 'baja', `Falta la etiqueta de baja ${kit.etiquetaBaja}`);
  if (/%5Bunsubscribe|\{\{%20|%7B%7B|\*%7C/i.test(html)) add('error', 'baja', 'Etiqueta de baja codificada en URL: no se sustituirá');

  const texto = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  const visible = `${comp.asunto} ${comp.preheader} ${texto}`.toLowerCase();
  for (const [prohibida, alternativa] of Object.entries(kit.palabrasProhibidas)) {
    if (visible.includes(prohibida.toLowerCase())) add('error', 'tono', `Aparece "${prohibida}": usar "${alternativa}"`);
  }
  if (kit.marca === 'betreson' && !/farmacia/i.test(texto)) add('aviso', 'farmacia', 'BetrésON debe presentarse como venta exclusiva en farmacia y no se menciona la farmacia');

  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /src="([^"]*)"/i.exec(tag)?.[1] ?? '';
    const alt = /alt="([^"]*)"/i.exec(tag)?.[1];
    if (!src.startsWith('https://')) add('error', 'imagen', `Imagen sin URL https pública: ${src.slice(0, 80)}`);
    if (!alt || !alt.trim()) add('aviso', 'alt', `Imagen sin texto alternativo: ${src.slice(-50)}`);
  }
  for (const m of html.matchAll(/href="([^"]*)"/gi)) {
    const h = m[1];
    if (h === kit.etiquetaBaja || /^(https:|mailto:|tel:)/.test(h)) continue;
    add(h.startsWith('http:') ? 'aviso' : 'error', 'enlace', `Enlace no válido o inseguro: ${h.slice(0, 80)}`);
  }

  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > LIMITE_GMAIL) add('error', 'peso', `HTML de ${Math.round(bytes / 1024)} KB: Gmail lo recortará (límite ~102 KB)`);
  if (comp.asunto.length > 60) add('aviso', 'asunto', `Asunto de ${comp.asunto.length} caracteres; mejor ≤ 60`);
  if (comp.preheader.length < 35 || comp.preheader.length > 110) add('aviso', 'preheader', `Preheader de ${comp.preheader.length} caracteres; mejor entre 35 y 110`);
  if ((comp.asunto.match(/\p{Extended_Pictographic}/gu) ?? []).length > 1) add('aviso', 'asunto', 'Más de un emoji en el asunto');
  return a;
}
