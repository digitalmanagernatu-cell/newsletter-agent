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
import { sistemaComposicion, sistemaRevision } from './prompts.js';

const RevisionSchema = z.object({
  aprobado: z.boolean(),
  puntuacion: z.number().min(1).max(10),
  problemas: z.array(z.string()).default([]),
  composicion_corregida: ComposicionSchema.optional(),
});

export interface Propuesta {
  enfoque: 'editorial' | 'comercial';
  composicion: Composicion;
  mjml: string;
  html: string;
  avisos: Aviso[];
  revisiones: z.infer<typeof RevisionSchema>[];
  capturas: { escritorio: Buffer; movil: Buffer };
}

const MAX_CORRECCIONES = Number(process.env.MAX_CORRECCIONES ?? 2);

function maquetar(kit: Kit, comp: Composicion) {
  const mjml = componerMjml(kit, comp);
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

async function generarPropuesta(kit: Kit, p: Peticion, enfoque: 'editorial' | 'comercial', usos: Uso[], log: (s: string) => void, anterior?: Composicion): Promise<Propuesta> {
  log(`[${enfoque}] componiendo…`);
  let comp = await pedirJson({ sistema: sistemaComposicion(kit), usuario: describirPeticion(p, enfoque, anterior), esquema: ComposicionSchema, usos });
  comp.enfoque = enfoque;
  const revisiones: Propuesta['revisiones'] = [];

  for (let ronda = 0; ; ronda++) {
    let m = maquetar(kit, comp);
    // Errores deterministas (MJML, baja, palabras prohibidas…) se corrigen antes de gastar una revisión visual.
    if (m.avisos.some((a) => a.nivel === 'error') && ronda < MAX_CORRECCIONES) {
      log(`[${enfoque}] errores automáticos: ${m.avisos.filter((a) => a.nivel === 'error').map((a) => a.detalle).join(' | ')}`);
    }
    log(`[${enfoque}] capturas (ronda ${ronda + 1})…`);
    const caps = await capturar(m.html);
    const rev = await pedirJson({
      sistema: sistemaRevision(kit),
      usuario: `Petición original:\n${JSON.stringify(p)}\n\nComposición:\n${JSON.stringify(comp)}\n\nAvisos automáticos:\n${JSON.stringify(m.avisos)}\n\nImagen 1: escritorio. Imagen 2: móvil.`,
      imagenes: [caps.escritorio, caps.movil],
      esquema: RevisionSchema,
      esfuerzo: 'medium',
      usos,
    });
    revisiones.push(rev);
    log(`[${enfoque}] revisión: ${rev.puntuacion}/10 ${rev.aprobado ? 'aprobada' : 'con cambios'}${rev.problemas.length ? ' — ' + rev.problemas.join(' | ') : ''}`);
    if (rev.aprobado || !rev.composicion_corregida) {
      return { enfoque, composicion: comp, ...m, revisiones, capturas: caps };
    }
    if (ronda >= MAX_CORRECCIONES) {
      // Última corrección sin nueva revisión visual: se aplica solo si no introduce errores automáticos.
      const final = { ...rev.composicion_corregida, enfoque };
      const mf = maquetar(kit, final);
      if (mf.avisos.some((a) => a.nivel === 'error')) return { enfoque, composicion: comp, ...m, revisiones, capturas: caps };
      log(`[${enfoque}] aplicada la última corrección (sin nueva revisión)`);
      return { enfoque, composicion: final, ...mf, revisiones, capturas: await capturar(mf.html) };
    }
    comp = { ...rev.composicion_corregida, enfoque };
  }
}

export async function crearNewsletter(p: Peticion, opts: { salida?: string; log?: (s: string) => void; anteriores?: Partial<Record<'editorial' | 'comercial', Composicion>>; enfoques?: ('editorial' | 'comercial')[] } = {}) {
  const log = opts.log ?? (() => {});
  const kit = cargarKit(p.marca);
  const usos: Uso[] = [];
  const enfoques: ('editorial' | 'comercial')[] = opts.enfoques?.length ? opts.enfoques : p.propuestas === 2 ? ['editorial', 'comercial'] : [p.tipo_campana === 'informativa' ? 'editorial' : 'comercial'];
  const propuestas = await Promise.all(enfoques.map((e) => generarPropuesta(kit, p, e, usos, log, opts.anteriores?.[e])));

  if (opts.salida) {
    for (const pr of propuestas) {
      const dir = path.join(opts.salida, pr.enfoque);
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
