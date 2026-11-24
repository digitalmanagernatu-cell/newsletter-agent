/** Normas de seguridad comunes a todas las plataformas. */
const dominios = () =>
  (process.env.TEST_EMAIL_DOMAINS ?? 'natulaboratories.es,natuaromatic.com,betreson.com')
    .split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);

export interface Destinatarios { validos: string[]; rechazados: string[] }

/** Solo direcciones de los dominios de la empresa reciben pruebas; el resto se rechaza (nunca a clientes). */
export function filtrarPruebas(emails: (string | undefined)[]): Destinatarios {
  const permitidos = dominios();
  const out: Destinatarios = { validos: [], rechazados: [] };
  for (const e of new Set(emails.flatMap((x) => (x ?? '').split(/[,;\s]+/)).map((x) => x.trim().toLowerCase()).filter(Boolean))) {
    const ok = /^[^@\s]+@([^@\s]+)$/.exec(e);
    if (ok && permitidos.includes(ok[1])) out.validos.push(e);
    else out.rechazados.push(e);
  }
  return out;
}
