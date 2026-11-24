import type { Kit } from '../brand.js';
import type { Bloque } from '../schema.js';
import { esc, inline } from './html.js';

/**
 * Biblioteca de patrones. Cada función devuelve una o varias <mj-section>.
 * Son punto de partida: el compositor puede usar `custom` con MJML propio.
 */
type Ctx = { kit: Kit; acento: string; indice: number };

const pad = (k: Kit) => `0 ${k.margen}px`;

export function renderBloque(b: Bloque, ctx: Ctx): string {
  const { kit } = ctx;
  const k = { ...kit, c: { ...kit.c, acento: ctx.acento } };
  switch (b.block) {
    case 'hero':
      return `<mj-section padding="0"><mj-column><mj-image padding="0" src="${b.src}" alt="${esc(b.alt)}"${b.link ? ` href="${b.link}"` : ''} /></mj-column></mj-section>`;
    case 'image':
      return `<mj-section padding="16px 0"><mj-column><mj-image src="${b.src}" alt="${esc(b.alt)}"${b.width ? ` width="${b.width}px"` : ''}${b.link ? ` href="${b.link}"` : ''} /></mj-column></mj-section>`;
    case 'title': {
      const ff = b.style === 'serif' ? k.fuenteSerif : k.fuente;
      const peso = b.style === 'serif' ? 'normal' : 'bold';
      return `<mj-section padding="32px 0 8px"><mj-column>
${b.eyebrow ? `<mj-text align="${b.align}" padding="${pad(k)}" font-size="12px" letter-spacing="3px" color="${k.c.acento}" font-weight="bold" text-transform="uppercase">${esc(b.eyebrow)}</mj-text>` : ''}
<mj-text align="${b.align}" padding="8px ${k.margen}px 0" font-family="${ff}" font-size="${b.style === 'serif' ? 34 : 24}px" line-height="1.3" font-weight="${peso}" color="${k.c.titular}">${inline(b.title_html, k).replace(/<em>/g, `<em style="color:${k.c.acento};">`)}</mj-text>
${b.subtitle ? `<mj-text align="${b.align}" padding="8px ${k.margen}px 0" font-size="15px" letter-spacing="1px" text-transform="uppercase" color="${k.c.titular}">${esc(b.subtitle)}</mj-text>` : ''}
</mj-column></mj-section>`;
    }
    case 'text':
      return `<mj-section padding="16px 0"><mj-column><mj-text align="${b.align}" padding="${pad(k)}">${inline(b.html, k)}</mj-text></mj-column></mj-section>`;
    case 'bullets':
      return `<mj-section padding="8px 0"><mj-column><mj-text padding="${pad(k)}"><table role="presentation" cellpadding="0" cellspacing="0">${b.items_html
        .map((i) => `<tr><td valign="top" style="color:${k.c.acento};padding:0 10px 10px 0;">&#10022;</td><td style="padding-bottom:10px;">${inline(i, k)}</td></tr>`)
        .join('')}</table></mj-text></mj-column></mj-section>`;
    case 'highlight_box':
      return `<mj-section padding="16px ${k.margen}px"><mj-column background-color="${k.c.fondoPie}" border-left="4px solid ${k.c.acento}"><mj-text padding="20px 24px" align="left">${inline(b.html, k)}</mj-text></mj-column></mj-section>`;
    case 'quote':
      return `<mj-section padding="24px 0"><mj-column><mj-text align="center" padding="${pad(k)}" font-family="${k.fuenteSerif}" font-style="italic" font-size="22px" line-height="1.4" color="${k.c.titular}">“${esc(b.text)}”</mj-text>${b.author ? `<mj-text align="center" padding="8px ${k.margen}px 0" font-size="12px" letter-spacing="2px" text-transform="uppercase" color="${k.c.suave}">${esc(b.author)}</mj-text>` : ''}</mj-column></mj-section>`;
    case 'offer': {
      const fondo = b.background ?? k.c.titular;
      return `<mj-section padding="8px 0 32px" background-color="${fondo}"><mj-column>
${b.eyebrow ? `<mj-text align="center" color="#FFFFFF" font-size="13px" font-weight="700" letter-spacing="4px" text-transform="uppercase" padding="0 ${k.margen}px">${esc(b.eyebrow)}</mj-text>` : ''}
<mj-text align="center" color="${k.c.acento}" font-size="88px" line-height="1" font-weight="800" padding="8px ${k.margen}px 0">${esc(b.value)}</mj-text>
${b.caption ? `<mj-text align="center" color="#FFFFFF" font-size="18px" font-weight="600" padding="10px ${k.margen}px 0">${esc(b.caption)}</mj-text>` : ''}
${b.dates ? `<mj-text align="center" padding="20px ${k.margen}px 0"><span style="display:inline-block;border:1px solid ${k.c.acento};color:${k.c.acento};padding:12px 20px;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">${esc(b.dates)}</span></mj-text>` : ''}
</mj-column></mj-section>`;
    }
    case 'banner':
      return `<mj-section padding="0" background-color="${b.background ?? k.c.acento}"><mj-column><mj-text align="center" padding="12px ${k.margen}px" font-size="13px" letter-spacing="3px" font-weight="bold" text-transform="uppercase" color="${b.color ?? '#ffffff'}">${esc(b.text)}</mj-text></mj-column></mj-section>`;
    case 'product_rows':
      return b.items
        .map((it, i) => {
          if (!it.image) {
            // Sin foto: fila de texto a todo el ancho, para no dejar un hueco.
            return `<mj-section padding="12px 0"><mj-column>
<mj-text align="center" padding="0 ${k.margen}px" font-size="19px" font-weight="bold" color="${k.c.titular}">${esc(it.name)}</mj-text>
${it.description_html ? `<mj-text align="center" padding="8px ${k.margen}px 0">${inline(it.description_html, k)}</mj-text>` : ''}
${it.price ? `<mj-text align="center" padding="8px ${k.margen}px 0" font-size="17px" font-weight="bold" color="${k.c.acento}">${esc(it.price)}</mj-text>` : ''}
</mj-column></mj-section>`;
          }
          const imgIzq = b.image_side === 'left' || (b.image_side === 'alternate' && i % 2 === 0);
          const img = `<mj-column width="45%" vertical-align="middle">${it.image ? `<mj-image src="${it.image}" alt="${esc(it.alt ?? it.name)}"${it.link ? ` href="${it.link}"` : ''} padding="0 12px" width="190px" css-class="foto-producto" />` : ''}</mj-column>`;
          const txt = `<mj-column width="55%" vertical-align="middle">
<mj-text padding="12px ${k.margen}px 0" font-size="19px" font-weight="bold" color="${k.c.titular}" line-height="1.4">${esc(it.name)}</mj-text>
${it.description_html ? `<mj-text align="left" padding="10px ${k.margen}px 0">${inline(it.description_html, k)}</mj-text>` : ''}
${it.price ? `<mj-text padding="10px ${k.margen}px 0" font-size="17px" font-weight="bold" color="${k.c.acento}">${esc(it.price)}</mj-text>` : ''}
${it.link ? `<mj-text padding="10px ${k.margen}px 0"><a href="${it.link}" style="color:${k.c.titular};font-weight:bold;">Ver producto →</a></mj-text>` : ''}
</mj-column>`;
          return `<mj-section padding="12px 0"${imgIzq ? '' : ' direction="rtl"'}>${img}${txt}</mj-section>`;
        })
        .join('\n');
    case 'product_grid': {
      const w = b.columns === 3 ? '33.33%' : '50%';
      const filas: string[] = [];
      for (let i = 0; i < b.items.length; i += b.columns) {
        filas.push(
          `<mj-section padding="12px ${k.margen - 12}px">${b.items
            .slice(i, i + b.columns)
            .map(
              (it) => `<mj-column width="${w}" padding="0 6px">
${it.image ? `<mj-image src="${it.image}" alt="${esc(it.alt ?? it.name)}"${it.link ? ` href="${it.link}"` : ''} padding="0 0 10px" />` : ''}
<mj-text align="center" padding="0 4px" font-size="15px" font-weight="bold" color="${k.c.titular}">${esc(it.name)}</mj-text>
${it.description_html ? `<mj-text align="center" padding="6px 4px 0" font-size="13px">${inline(it.description_html, k)}</mj-text>` : ''}
${it.price ? `<mj-text align="center" padding="6px 4px 0" font-weight="bold" color="${k.c.acento}">${esc(it.price)}</mj-text>` : ''}
</mj-column>`,
            )
            .join('')}</mj-section>`,
        );
      }
      return filas.join('\n');
    }
    case 'price_table':
      return `<mj-section padding="24px 0 8px"><mj-column>
${b.title ? `<mj-text align="center" padding="14px ${k.margen}px" container-background-color="${k.c.fondoPie}" font-size="16px" letter-spacing="1px" text-transform="uppercase" color="${k.c.titular}">${esc(b.title)}</mj-text>` : ''}
<mj-table padding="16px ${k.margen + 16}px" font-size="15px" color="${k.c.texto}">${b.rows
        .map((r) => `<tr style="border-bottom:1px solid ${k.c.separador};"><td style="padding:10px 0;">${esc(r.label)}</td><td style="padding:10px 0;text-align:right;font-weight:bold;">${esc(r.value)}</td></tr>`)
        .join('')}</mj-table>
${b.note_html ? `<mj-text align="center" padding="0 ${k.margen}px" font-size="13px">${inline(b.note_html, k)}</mj-text>` : ''}
</mj-column></mj-section>`;
    case 'cta':
      return b.style === 'button' && b.link
        ? `<mj-section padding="24px 0"><mj-column><mj-button href="${b.link}" background-color="${k.c.boton}" color="${k.c.botonTexto}" font-weight="bold" letter-spacing="2px" text-transform="uppercase" border-radius="0" inner-padding="14px 28px">${inline(b.text_html, k)}</mj-button></mj-column></mj-section>`
        : `<mj-section padding="28px 0"><mj-column><mj-text align="center" padding="${pad(k)}" font-size="18px" color="${k.c.titular}">${inline(b.text_html, k)}</mj-text></mj-column></mj-section>`;
    case 'divider':
      return `<mj-section padding="8px 0"><mj-column><mj-divider border-width="1px" border-color="${k.c.separador}" padding="8px 0" /></mj-column></mj-section>`;
    case 'spacer':
      return `<mj-section padding="0"><mj-column><mj-spacer height="${b.height}px" /></mj-column></mj-section>`;
    case 'custom':
      return b.mjml.replace(/<\s*script[\s\S]*?<\/\s*script\s*>/gi, '');
  }
}
