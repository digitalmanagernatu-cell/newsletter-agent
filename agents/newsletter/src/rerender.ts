// Vuelve a maquetar una composición guardada sin llamar al modelo (útil para ajustar bloques).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cargarKit, type Marca } from './brand.js';
import { ComposicionSchema } from './schema.js';
import { componerMjml } from './layout.js';
import { compilar } from './render.js';
import { revisarReglas } from './lint.js';
import { capturar } from './capturas.js';

const [, , marca, archivo] = process.argv;
const kit = cargarKit(marca as Marca);
const comp = ComposicionSchema.parse(JSON.parse(readFileSync(archivo, 'utf8')));
const { html, errores } = compilar(componerMjml(kit, comp));
const dir = path.dirname(archivo);
writeFileSync(path.join(dir, 'email.html'), html);
const caps = await capturar(html);
writeFileSync(path.join(dir, 'escritorio.png'), caps.escritorio);
writeFileSync(path.join(dir, 'movil.png'), caps.movil);
console.log(JSON.stringify(revisarReglas(kit, comp, html, errores)));
