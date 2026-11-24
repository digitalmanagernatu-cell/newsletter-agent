import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PeticionSchema } from './schema.js';
import { crearNewsletter } from './pipeline.js';

const archivo = process.argv[2];
if (!archivo) {
  console.error('Uso: npm run render -- <peticion.json> [carpeta-salida]');
  process.exit(1);
}
const peticion = PeticionSchema.parse(JSON.parse(readFileSync(archivo, 'utf8')));
const salida = process.argv[3] ?? path.join('out', `${new Date().toISOString().replace(/[:.]/g, '-')}-${peticion.marca}`);
const t0 = Date.now();
const { propuestas, usos } = await crearNewsletter(peticion, { salida, log: (s) => console.log(s) });
for (const p of propuestas) {
  const errores = p.avisos.filter((a) => a.nivel === 'error');
  console.log(`\n== ${p.enfoque.toUpperCase()} · ${p.idioma} ==\nAsunto: ${p.composicion.asunto}\nPreheader: ${p.composicion.preheader}\nBloques: ${p.composicion.bloques.map((b) => b.block).join(' → ')}\nErrores: ${errores.length}  Avisos: ${p.avisos.length - errores.length}\nRevisión final: ${p.revisiones.at(-1)?.puntuacion}/10`);
}
const tokens = usos.reduce((a, u) => ({ e: a.e + u.entrada, s: a.s + u.salida }), { e: 0, s: 0 });
console.log(`\nSalida: ${salida}\nTiempo: ${Math.round((Date.now() - t0) / 1000)} s · tokens entrada ${tokens.e}, salida ${tokens.s}`);
