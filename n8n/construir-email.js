// Construye el email para cada evento que avisa el agente de newsletters.
// ── Configuración ──
const EQUIPO = ['digitalmanager@natuaromatic.com'];   // quién recibe los emails de aprobación (cualquiera puede aprobar)
const AVISOS_ERROR = ['digitalmanager@natuaromatic.com'];
// ───────────────────
const ev = $input.first().json.body ?? $input.first().json;
const e = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const destinatarios = (...listas) => [...new Set(listas.flat().filter(Boolean).map((x) => x.toLowerCase()))].join(',');
const IDIOMAS = { es: 'Español', it: 'Italiano', fr: 'Francés', ro: 'Rumano', en: 'Inglés' };
const boton = (url, texto, fondo = '#000') => `<a href="${e(url)}" style="display:inline-block;background:${fondo};color:#fff;text-decoration:none;font-weight:bold;letter-spacing:1px;padding:14px 22px;margin:6px 6px 6px 0;font-family:Arial,sans-serif;font-size:14px;text-transform:uppercase">${e(texto)}</a>`;
const marco = (contenido) => `<div style="font-family:Arial,Helvetica,sans-serif;color:#1e1e1e;max-width:640px;margin:0 auto;font-size:15px;line-height:1.5">${contenido}<p style="color:#888;font-size:12px;margin-top:32px">Agente de newsletters · NATU Laboratories</p></div>`;

if (ev.tipo === 'borradores_listos') {
  const varias = (ev.propuestas ?? []).length > 1;
  const bloques = (ev.propuestas ?? []).map((p) => {
    const versiones = p.versiones?.length ? p.versiones : [{ idioma: 'es', asunto: p.asunto, preheader: p.preheader, captura_url: p.captura_url }];
    const multi = versiones.length > 1;
    return `
    <div style="border:1px solid #ddd;padding:16px;margin:16px 0">
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:2px;color:#888;text-transform:uppercase">${varias ? `Propuesta ${e(p.etiqueta)} · ` : ''}${e(p.enfoque)}${multi ? ` · ${versiones.length} idiomas` : ''}</p>
      ${versiones.map((v) => `<p style="margin:0 0 8px">${multi ? `<span style="font-size:12px;color:#888">${e(IDIOMAS[v.idioma] ?? v.idioma)}</span><br>` : ''}<strong>${e(v.asunto)}</strong><br><span style="color:#666">${e(v.preheader)}</span></p>`).join('')}
      <p>${boton(p.enlace_aprobar, (varias ? `Aprobar ${p.etiqueta}` : 'Aprobar') + (multi ? ' (todos los idiomas)' : '') + ' y programar')}</p>
      ${versiones.map((v) => `${multi ? `<p style="margin:16px 0 6px;font-weight:bold">${e(IDIOMAS[v.idioma] ?? v.idioma)}</p>` : ''}<a href="${e(p.enlace_aprobar)}"><img src="${e(v.captura_url)}" alt="Vista previa ${e(v.idioma)}" width="560" style="max-width:100%;border:1px solid #eee"></a>`).join('')}
    </div>`;
  }).join('');
  const avisos = (ev.no_entregables ?? []).length ? `<p style="color:#9b1c1c">⚠️ La prueba no llegará a: ${ev.no_entregables.map((n) => `${e(n.email)} (${e(n.motivo)})`).join(', ')}</p>` : '';
  return [{ json: {
    para: destinatarios(EQUIPO, ev.solicitante),
    asunto: `[Aprobación ${ev.marca === 'natu' ? 'NATU' : 'BetrésON'}] ${ev.ronda > 1 ? `Ronda ${ev.ronda} · ` : ''}${(ev.propuestas?.[0]?.asunto) ?? 'Newsletter'}`,
    html: marco(`<h2 style="margin:0 0 8px">Newsletter lista para revisar</h2>
      <p>${e(ev.objetivo)}</p>
      <p>Envío previsto: <strong>${e(ev.fecha_envio ?? 'sin fecha')}</strong> · Destino: ${e(ev.destino ?? '')}</p>
      <p>Se ha enviado la prueba a: ${e((ev.destinatarios ?? []).join(', ') || 'nadie')}</p>${avisos}
      ${bloques}
      <p>${boton(ev.enlace_cambios, 'Pedir cambios', '#6b6b6b')}</p>
      <p style="color:#888;font-size:13px">Cualquier persona del equipo puede aprobar. Al pulsar se abre una página para confirmar con tu email; los enlaces caducan en 72 horas y solo sirven una vez.</p>`),
  } }];
}
if (ev.tipo === 'programada') {
  return [{ json: {
    para: destinatarios(EQUIPO, ev.solicitante, ev.aprobador),
    asunto: `✅ Newsletter programada: ${ev.fecha}`,
    html: marco(`<h2>Newsletter programada</h2><p>${e(ev.objetivo)}</p>
      <p>Se enviará a <strong>${e(ev.destino)}</strong> el <strong>${e(ev.fecha)}</strong>.</p>
      ${ev.aviso ? `<p style="color:#9b6b00">⚠️ ${e(ev.aviso)}</p>` : ''}
      ${(ev.idiomas ?? []).length > 1 ? `<p>Idiomas: ${ev.idiomas.map((i) => e(IDIOMAS[i] ?? i)).join(', ')}</p>` : ''}
      <p>Aprobada por ${e(ev.aprobador)} (propuesta ${e(ev.enfoque)}).</p>
      <p>${boton(ev.url_campana, ev.marca === 'natu' ? 'Ver la campaña en Mailchimp' : 'Ver la campaña en Mailrelay')}</p>`),
  } }];
}
if (ev.tipo === 'error') {
  return [{ json: {
    para: destinatarios(AVISOS_ERROR, ev.solicitante),
    asunto: '⚠️ No se ha podido preparar la newsletter',
    html: marco(`<h2>No se ha podido preparar la newsletter</h2><p>${e(ev.objetivo)}</p><p><strong>Motivo:</strong> ${e(ev.mensaje)}</p><p>Revisa la petición o avisa a Digital.</p>`),
  } }];
}
if (ev.tipo === 'cancelada') {
  return [{ json: { para: destinatarios(EQUIPO), asunto: 'Envío de newsletter cancelado', html: marco(`<p>${e(ev.actor)} ha cancelado el envío programado.${ev.motivo ? ` Motivo: ${e(ev.motivo)}` : ''}</p>`) } }];
}
return []; // otros eventos (p. ej. "enviada") no generan email
