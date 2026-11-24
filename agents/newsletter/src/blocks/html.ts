import type { Kit } from '../brand.js';

/** Escapa texto plano para MJML/HTML. */
export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PERMITIDAS = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'mark', 'span', 'ul', 'li', 'small']);

/**
 * HTML en línea que escribe el modelo: solo etiquetas de formato, sin scripts
 * ni atributos de evento. <mark> se convierte en el destacado de marca.
 */
export function inline(html: string, kit: Kit): string {
  let h = html
    .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
  h = h.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (m, tag: string, attrs: string) => {
    const t = tag.toLowerCase();
    if (!PERMITIDAS.has(t)) return '';
    if (m.startsWith('</')) return t === 'mark' ? '</span>' : `</${t}>`;
    if (t === 'mark')
      return `<span style="background:${kit.c.acento};color:#ffffff;padding:1px 6px;font-weight:bold;">`;
    if (t === 'a') {
      const href = /href\s*=\s*"([^"]+)"/i.exec(attrs)?.[1];
      return href ? `<a href="${href}" style="color:inherit;text-decoration:underline;">` : '<a>';
    }
    if (t === 'span') {
      const style = /style\s*=\s*"([^"]+)"/i.exec(attrs)?.[1];
      return style ? `<span style="${style}">` : '<span>';
    }
    return `<${t}>`;
  });
  return h;
}
