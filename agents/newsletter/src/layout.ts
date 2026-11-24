import type { Kit } from './brand.js';
import type { Composicion } from './schema.js';
import { renderBloque } from './blocks/index.js';
import { esc } from './blocks/html.js';

/** Partes fijas por marca: cabecera y pie. El cuerpo es libre. */
function cabecera(kit: Kit): string {
  return `<mj-section padding="20px 0 16px" background-color="${kit.c.fondo}"><mj-column>
<mj-image src="${kit.logo.url}" alt="${esc(kit.logo.alt)}" width="${kit.logo.ancho}px" padding="0" />
</mj-column></mj-section>`;
}

const ICONOS: Record<string, string> = {
  instagram: 'https://assets.ipzmarketing.com/assets/social-buttons/instagram.png',
  facebook: 'https://assets.ipzmarketing.com/assets/social-buttons/facebook.png',
  tiktok: 'https://assets.ipzmarketing.com/assets/social-buttons/tiktok.png',
};

function pie(kit: Kit): string {
  if (kit.marca !== 'betreson') {
    return `<mj-section background-color="${kit.c.fondoPie}" padding="24px 0"><mj-column>
<mj-text align="center" font-size="11px" color="${kit.c.suave}">[PIE LEGAL NATU PENDIENTE] · <a href="${kit.etiquetaBaja}" style="color:inherit;">Darse de baja</a></mj-text>
</mj-column></mj-section>`;
  }
  const p = kit.raw.pie;
  const redes = (['instagram', 'facebook', 'tiktok'] as const)
    .map((r) => `<mj-social-element src="${ICONOS[r]}" href="${p.rrss[r]}" alt="${r}" background-color="transparent" />`)
    .join('');
  return `<mj-section background-color="${kit.c.fondoPie}" padding="32px 0 8px"><mj-column>
<mj-divider border-width="1px" border-color="${kit.c.titular}" padding="0 ${kit.margen}px 20px" />
<mj-text align="center" font-size="24px" font-weight="bold" color="${kit.c.titular}" padding="0">¡Síguenos en RRSS!</mj-text>
<mj-social mode="horizontal" icon-size="28px" padding="16px 0" border-radius="14px">${redes}</mj-social>
<mj-divider border-width="1px" border-color="${kit.c.titular}" padding="4px ${kit.margen}px 20px" />
<mj-text align="center" font-size="13px" font-weight="bold" letter-spacing="1px" color="${kit.c.titular}" padding="0">DATOS DE CONTACTO</mj-text>
<mj-text align="center" font-size="14px" padding="8px 0 0"><a href="mailto:${p.contacto.email}" style="color:${kit.c.titular};">${p.contacto.email}</a><br/><a href="tel:${p.contacto.telefono.replace(/\s/g, '')}" style="color:${kit.c.titular};font-size:12px;">${p.contacto.telefono}</a></mj-text>
<mj-text align="center" font-size="11px" line-height="1.5" color="${kit.c.suave}" padding="24px ${kit.margen}px 0"><strong style="color:${kit.c.titular};">En cumplimiento de lo dispuesto en la Protección de Datos</strong><br/>${p.legal.replace(/^En cumplimiento de lo dispuesto en la Protección de Datos\.\s*/, '')}</mj-text>
<mj-text align="center" font-size="11px" color="${kit.c.suave}" padding="10px ${kit.margen}px 24px">${p.baja}</mj-text>
</mj-column></mj-section>`;
}

export function componerMjml(kit: Kit, comp: Composicion): string {
  const acento = comp.acento ?? kit.c.acento;
  const cuerpo = comp.bloques.map((b, i) => `<!-- bloque ${i + 1}: ${b.block} -->\n${renderBloque(b, { kit, acento, indice: i })}`).join('\n');
  return `<mjml lang="es">
<mj-head>
  <mj-title>${esc(comp.asunto)}</mj-title>
  <mj-preview>${esc(comp.preheader)}</mj-preview>
  <mj-attributes>
    <mj-all font-family="${kit.fuente}" />
    <mj-text font-size="15px" line-height="1.6" color="${kit.c.texto}" />
    <mj-section background-color="${kit.c.fondo}" />
  </mj-attributes>
  <mj-style>a { color: ${kit.c.titular}; } p { margin: 0 0 14px; } @media (max-width:480px){ .foto-producto img { max-width:220px !important; margin:0 auto; } }</mj-style>
</mj-head>
<mj-body width="${kit.ancho}px" background-color="#ffffff">
${cabecera(kit)}
${cuerpo}
${pie(kit)}
</mj-body>
</mjml>`;
}
