import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type Marca = 'betreson' | 'natu';

export interface Kit {
  marca: Marca;
  raw: any;
  nombre: string;
  ancho: number;
  margen: number;
  fuente: string;
  fuenteSerif: string;
  c: { texto: string; titular: string; suave: string; fondo: string; fondoPie: string; separador: string; acento: string; boton: string; botonTexto: string };
  logo: { url: string; ancho: number; alt: string };
  etiquetaBaja: string;
  palabrasProhibidas: Record<string, string>;
}

export function cargarKit(marca: Marca): Kit {
  const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, 'brand', marca, 'brand.json'), 'utf8'));
  if (marca === 'betreson') {
    return {
      marca, raw, nombre: 'Betrés ON', ancho: raw.layout.ancho_max_px, margen: raw.layout.margen_lateral_px,
      fuente: 'Arial, Helvetica, sans-serif', fuenteSerif: "Georgia, 'Times New Roman', serif",
      c: {
        texto: raw.colores.texto.hex, titular: raw.colores.negro.hex, suave: raw.colores.texto_suave.hex,
        fondo: raw.colores.blanco.hex, fondoPie: raw.colores.fondo_pie.hex, separador: raw.colores.separador.hex,
        acento: raw.colores.dorado.hex, boton: raw.colores.negro.hex, botonTexto: '#FFFFFF',
      },
      logo: { url: raw.logo.url_publica_mailrelay, ancho: raw.logo.ancho_cabecera_px, alt: 'Betrés ON' },
      etiquetaBaja: raw.pie.etiqueta_baja_mailrelay,
      palabrasProhibidas: raw.palabras_prohibidas ?? {},
    };
  }
  return {
    marca, raw, nombre: 'NATU Laboratories', ancho: raw.layout.ancho_max_px, margen: raw.layout.margen_lateral_px,
    fuente: "Montserrat, Arial, Helvetica, sans-serif", fuenteSerif: "Georgia, 'Times New Roman', serif",
    c: {
      texto: raw.colores.principal_oscuro.hex, titular: raw.colores.principal_oscuro.hex, suave: '#6B6B6A',
      fondo: '#FFFFFF', fondoPie: raw.colores.principal_claro.hex, separador: raw.colores.principal_claro.hex,
      acento: raw.colores.rosa.hex, boton: raw.boton.fondo, botonTexto: raw.boton.texto,
    },
    logo: { url: raw.logo.url_publica ?? '', ancho: raw.logo.ancho_cabecera_px, alt: 'NATU Laboratories' },
    etiquetaBaja: raw.mailchimp.etiqueta_baja,
    palabrasProhibidas: raw.palabras_prohibidas ?? {},
  };
}
