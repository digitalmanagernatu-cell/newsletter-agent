import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { cargarKit, type Kit } from './brand.js';
import { ComposicionSchema, type Composicion, type Peticion } from './schema.js';
import { componerMjml } from './layout.js';
import { compilar } from './render.js';
import { revisarReglas, type Aviso } from './lint.js';
import { capturar } from './capturas.js';
import { pedirJson, type Uso } from './llm.js';
import { sistemaComposicion, sistemaRevision, sistemaAdaptacion } from './prompts.js';

const RevisionSchema = z.object({
  aprobado: z.boolean(),
  puntuacion: z.number().min(1).max(10),
  problemas: z.array(z.string()).default([]),
  composicion_corregida: ComposicionSchema.optional(),
});

export type Idioma = 'es' | 'it' | 'fr' | 'ro' | 'en';

export interface Propuesta {
  enfoque: 'editorial' | 'comercial';
  idioma: Idioma;
  composicion: Composicion;
  mjml: string;
  html: string;
  avisos: Aviso[];
  revisiones: z.infer<typeof RevisionSchema>[];
  capturas: { escritorio: Buffer; movil: Buffer };
}

const MAX_CORRECCIONES = Number(process.env.MAX_CORRECCIONES ?? 2);

function maquetar(kit: Kit, comp: Composicion, idioma: Idioma = 'es') {
  const mjml = componerMjml(kit, comp, idioma);
  const { html, errores } = compilar(mjml);
  return { mjml, html, avisos: revisarReglas(kit, comp, html, errores) };
}

function describirPeticion(p: Peticion, enfoque: string, anterior?: Composicion): string {
  const previa = anterior
    ? `\n\nVersión anterior que el equipo ha revisado (mantén lo que funciona y aplica el feedback):\n${JSON.stringify(anterior)}`
    : '';
  return `Diseña una newsletter con enfoque ${enfoque.toUpperCase()}${enfoque === 'editorial' ? ' (más relato, aire y tono de marca)' : ' (beneficio claro, producto y condiciones al frente)'}.

Petición del equipo (JSON):
${JSON.stringify({ ...p, propuestas: undefined, solicitante_email: undefined, destinatarios_prueba: undefined, fecha_envio: undefined }, null, 2)}${previa}`;
}

/** Bucle de maquetación, capturas y revisión visual con correcciones. */
async function revisarYCorregir(kit: Kit, p: Peticion, comp: Composicion, enfoque: 'editorial' | 'comercial', idioma: Idioma, usos: Uso[], log: (s: string) => void): Promise<Propuesta> {
  const tag = `[${enfoque}/${idioma}]`;
  const revisiones: Propuesta['revisiones'] = [];
  for (let ronda = 0; ; ronda++) {
    const m = maquetar(kit, comp, idioma);
    if (m.avisos.some((a) => a.nivel === 'error')) log(`${tag} errores automáticos: ${m.avisos.filter((a) => a.nivel === 'error').map((a) => a.detalle).join(' | ')}`);
    log(`${tag} capturas (ronda ${ronda + 1})…`);
    const caps = await capturar(m.html);
    const rev = await pedirJson({
      sistema: sistemaRevision(kit),
      usuario: `Idioma de esta versión: ${idioma}.\n\nPetición original:\n${JSON.stringify({ ...p, adjuntos: undefined })}\n\nComposición:\n${JSON.stringify(comp)}\n\nAvisos automáticos:\n${JSON.stringify(m.avisos)}\n\nImagen 1: escritorio. Imagen 2: móvil.`,
      imagenes: [caps.escritorio, caps.movil],
      esquema: RevisionSchema,
      esfuerzo: 'medium',
      usos,
    });
    revisiones.push(rev);
    log(`${tag} revisión: ${rev.puntuacion}/10 ${rev.aprobado ? 'aprobada' : 'con cambios'}${rev.problemas.length ? ' — ' + rev.problemas.join(' | ') : ''}`);
    const base = { enfoque, idioma, revisiones };
    if (rev.aprobado || !rev.composicion_corregida) return { ...base, composicion: comp, ...m, capturas: caps };
    if (ronda >= MAX_CORRECCIONES) {
      // Última corrección sin nueva revisión visual: se aplica solo si no introduce errores automáticos.
      const final = { ...rev.composicion_corregida, enfoque };
      const mf = maquetar(kit, final, idioma);
      if (mf.avisos.some((a) => a.nivel === 'error')) return { ...base, composicion: comp, ...m, capturas: caps };
      log(`${tag} aplicada la última corrección (sin nueva revisión)`);
      return { ...base, composicion: final, ...mf, capturas: await capturar(mf.html) };
    }
    comp = { ...rev.composicion_corregida, enfoque };
  }
}

async function generarPropuesta(kit: Kit, p: Peticion, enfoque: 'editorial' | 'comercial', usos: Uso[], log: (s: string) => void, anterior?: Composicion): Promise<Propuesta> {
  log(`[${enfoque}/es] componiendo…`);
  const comp = await pedirJson({ sistema: sistemaComposicion(kit), usuario: describirPeticion(p, enfoque, anterior), esquema: ComposicionSchema, usos });
  return revisarYCorregir(kit, p, { ...comp, enfoque }, enfoque, 'es', usos, log);
}

/** Adapta (no traduce) la versión maestra a otro idioma, conservando estructura, imágenes y datos. */
async function adaptarPropuesta(kit: Kit, p: Peticion, base: Propuesta, idioma: Idioma, usos: Uso[], log: (s: string) => void): Promise<Propuesta> {
  log(`[${base.enfoque}/${idioma}] adaptando…`);
  const comp = await pedirJson({
    sistema: sistemaAdaptacion(kit, idioma),
    usuario: `Versión maestra en español:\n${JSON.stringify(base.composicion)}${p.feedback ? `\n\nFeedback del equipo que ya se ha aplicado a la maestra (tenlo en cuenta): ${p.feedback}` : ''}`,
    esquema: ComposicionSchema,
    usos,
  });
  return revisarYCorregir(kit, p, { ...comp, enfoque: base.enfoque, acento: comp.acento ?? base.composicion.acento }, base.enfoque, idioma, usos, log);
}

export function idiomasDe(p: Peticion): Idioma[] {
  return p.marca === 'natu' ? (p.idiomas?.length ? p.idiomas : ['es', 'it', 'fr', 'ro']) : ['es'];
}

export async function crearNewsletter(p: Peticion, opts: { salida?: string; log?: (s: string) => void; anteriores?: Partial<Record<'editorial' | 'comercial', Composicion>>; enfoques?: ('editorial' | 'comercial')[] } = {}) {
  const log = opts.log ?? (() => {});
  const kit = cargarKit(p.marca);
  const usos: Uso[] = [];
  const enfoques: ('editorial' | 'comercial')[] = opts.enfoques?.length ? opts.enfoques : p.propuestas === 2 ? ['editorial', 'comercial'] : [p.tipo_campana === 'informativa' ? 'editorial' : 'comercial'];
  const idiomas = idiomasDe(p);
  const porEnfoque = await Promise.all(enfoques.map(async (e) => {
    const maestra = await generarPropuesta(kit, p, e, usos, log, opts.anteriores?.[e]);
    const otras = await Promise.all(idiomas.filter((i) => i !== 'es').map((i) => adaptarPropuesta(kit, p, maestra, i, usos, log)));
    return [...(idiomas.includes('es') ? [maestra] : []), ...otras];
  }));
  const propuestas = porEnfoque.flat();

  if (opts.salida) {
    for (const pr of propuestas) {
      const dir = path.join(opts.salida, pr.enfoque, pr.idioma);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'email.mjml'), pr.mjml);
      writeFileSync(path.join(dir, 'email.html'), pr.html);
      writeFileSync(path.join(dir, 'composicion.json'), JSON.stringify(pr.composicion, null, 2));
      writeFileSync(path.join(dir, 'revision.json'), JSON.stringify({ avisos: pr.avisos, revisiones: pr.revisiones }, null, 2));
      writeFileSync(path.join(dir, 'escritorio.png'), pr.capturas.escritorio);
      writeFileSync(path.join(dir, 'movil.png'), pr.capturas.movil);
    }
    writeFileSync(path.join(opts.salida, 'uso.json'), JSON.stringify(usos, null, 2));
  }
  return { propuestas, usos };
}
