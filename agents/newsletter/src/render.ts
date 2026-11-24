import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mjml2html = require('mjml') as (s: string, o?: object) => { html: string; errors: { formattedMessage: string; tagName: string }[] };

export interface Render { html: string; errores: string[] }

/** Compila MJML a HTML para email. Los errores de validación se devuelven para que el agente los corrija. */
export function compilar(mjml: string): Render {
  const r = mjml2html(mjml, { validationLevel: 'soft', keepComments: false, minify: false });
  return { html: r.html, errores: r.errors.map((e) => e.formattedMessage) };
}
