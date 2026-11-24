/** Páginas mínimas para aprobar o pedir cambios desde el email (móvil primero, sin dependencias). */
const e = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function marco(titulo: string, cuerpo: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${e(titulo)}</title>
<style>
:root{--t:#1e1e1e;--s:#6b6b6b;--f:#f5f4ee;--b:#d9d6cf;--a:#000;--ok:#1d6b3a;--ko:#9b1c1c}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 Arial,Helvetica,sans-serif;color:var(--t);background:var(--f)}
main{max-width:640px;margin:0 auto;padding:24px 16px 48px}h1{font-size:22px;margin:8px 0 16px}
.card{background:#fff;border:1px solid var(--b);padding:20px;margin:16px 0}.meta{color:var(--s);font-size:14px}
label{display:block;font-weight:bold;margin:16px 0 6px}input,textarea,select{width:100%;padding:12px;border:1px solid var(--b);font:inherit;background:#fff}
textarea{min-height:140px}button{margin-top:20px;width:100%;padding:14px;border:0;background:var(--a);color:#fff;font-weight:bold;letter-spacing:1px;text-transform:uppercase;font-size:15px;cursor:pointer}
img{max-width:100%;height:auto;display:block;border:1px solid var(--b)}.ok{color:var(--ok)}.ko{color:var(--ko)}
</style></head><body><main>${cuerpo}</main></body></html>`;
}

export function paginaAprobar(t: string, d: { asunto: string; preheader: string; enfoque: string; captura_url: string; destino: string; fecha_envio: string | null; objetivo: string }) {
  const fecha = (d.fecha_envio ?? '').replace(' ', 'T').slice(0, 16);
  return marco('Aprobar y programar', `
<h1>Aprobar y programar newsletter</h1>
<div class="card"><div class="meta">Propuesta ${e(d.enfoque)} · Destino: <strong>${e(d.destino)}</strong></div>
<p><strong>${e(d.asunto)}</strong><br><span class="meta">${e(d.preheader)}</span></p>
<p class="meta">${e(d.objetivo)}</p></div>
<form method="post" action="/aprobar">
<input type="hidden" name="t" value="${e(t)}">
<label for="fecha">Fecha y hora de envío (hora de Madrid)</label>
<input id="fecha" name="fecha" type="datetime-local" value="${e(fecha)}" required>
<label for="email">Tu email de la empresa</label>
<input id="email" name="email" type="email" autocomplete="email" required placeholder="nombre@natuaromatic.com">
<button type="submit">Aprobar y programar</button>
<p class="meta">Al confirmar se programa el envío real a ${e(d.destino)}. Este enlace solo se puede usar una vez.</p>
</form>
<p><img src="${e(d.captura_url)}" alt="Vista previa de la newsletter"></p>`);
}

export function paginaCambios(t: string, dosPropuestas: boolean) {
  return marco('Pedir cambios', `
<h1>Pedir cambios</h1>
<form method="post" action="/cambios">
<input type="hidden" name="t" value="${e(t)}">
${dosPropuestas ? `<label for="enfoque">¿Qué propuesta quieres cambiar?</label>
<select id="enfoque" name="enfoque"><option value="">Las dos</option><option value="editorial">A · Editorial</option><option value="comercial">B · Comercial</option></select>` : ''}
<label for="feedback">¿Qué cambiamos?</label>
<textarea id="feedback" name="feedback" required placeholder="Ej.: titular más corto, quitar el banner rojo, añadir el precio del mikado…"></textarea>
<label for="email">Tu email de la empresa</label>
<input id="email" name="email" type="email" autocomplete="email" required placeholder="nombre@natuaromatic.com">
<button type="submit">Enviar cambios</button>
<p class="meta">Recibirás una nueva prueba en unos minutos.</p>
</form>`);
}

export const paginaResultado = (titulo: string, mensaje: string, ok = true) =>
  marco(titulo, `<h1 class="${ok ? 'ok' : 'ko'}">${e(titulo)}</h1><div class="card">${mensaje}</div>`);
export { e as escaparHtml };
