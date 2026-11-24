import { z } from 'zod';

/** Petición que llega desde el formulario de n8n (o del orquestador). */
export const ProductoSchema = z.object({
  nombre: z.string().min(1),
  descripcion: z.string().optional(),
  url: z.string().url().optional(),
  imagen: z.string().url().optional(),
  precio: z.string().optional(),
});

export const PeticionSchema = z.object({
  marca: z.enum(['betreson', 'natu']),
  tipo_campana: z.enum(['lanzamiento', 'promo', 'estacional', 'informativa', 'comunicado', 'cierre', 'felicitacion']),
  objetivo: z.string().min(1),
  asunto_sugerido: z.string().optional(),
  mensaje: z.string().min(1),
  textos_clave: z.array(z.string()).default([]),
  productos: z.array(ProductoSchema).default([]),
  imagenes: z.array(z.object({ url: z.string().url(), descripcion: z.string().optional() })).default([]),
  /** Imágenes subidas en el formulario de n8n (base64). Se suben a la plataforma y pasan a `imagenes`. */
  adjuntos: z.array(z.object({ nombre: z.string(), contenido_base64: z.string().max(14_000_000), descripcion: z.string().optional() })).default([]),
  idioma: z.enum(['es', 'it', 'fr', 'ro', 'en']).default('es'),
  /** NATU: idiomas en los que sale (una campaña por idioma, cada una a su segmento). BetrésON: siempre español. */
  idiomas: z.array(z.enum(['es', 'it', 'fr', 'ro', 'en'])).min(1).optional(),
  propuestas: z.union([z.literal(1), z.literal(2)]).default(1),
  solicitante_email: z.string().email().optional(),
  /** Direcciones extra para la prueba (campo libre del formulario). Solo se aceptan dominios de la empresa. */
  destinatarios_prueba: z.string().optional(),
  /** Fecha y hora de envío deseada (hora de Madrid, ISO 8601). Se usa al programar (fase 3). */
  fecha_envio: z.string().optional(),
  feedback: z.string().optional(),
});
export type Peticion = z.infer<typeof PeticionSchema>;

/**
 * Composición que decide el modelo. Los bloques son una biblioteca de
 * inspiración: `custom` permite MJML libre cuando ningún bloque encaja.
 */
const Img = z.object({ src: z.string().url(), alt: z.string().min(1), link: z.string().url().optional() });
const Item = z.object({
  image: z.string().url().optional(),
  alt: z.string().optional(),
  name: z.string(),
  description_html: z.string().optional(),
  price: z.string().optional(),
  link: z.string().url().optional(),
});

export const BloqueSchema = z.discriminatedUnion('block', [
  z.object({ block: z.literal('hero'), ...Img.shape }),
  z.object({ block: z.literal('image'), ...Img.shape, width: z.number().int().min(100).max(600).optional() }),
  z.object({
    block: z.literal('title'),
    eyebrow: z.string().optional(),
    title_html: z.string(),
    subtitle: z.string().optional(),
    style: z.enum(['sans', 'serif']).default('sans'),
    align: z.enum(['center', 'left']).default('center'),
  }),
  z.object({ block: z.literal('text'), html: z.string(), align: z.enum(['center', 'left']).default('center') }),
  z.object({ block: z.literal('bullets'), items_html: z.array(z.string()).min(1) }),
  z.object({ block: z.literal('highlight_box'), html: z.string() }),
  z.object({ block: z.literal('quote'), text: z.string(), author: z.string().optional() }),
  z.object({
    block: z.literal('offer'),
    eyebrow: z.string().optional(),
    value: z.string().max(12),
    caption: z.string().optional(),
    dates: z.string().optional(),
    background: z.string().optional(),
  }),
  z.object({ block: z.literal('banner'), text: z.string(), background: z.string().optional(), color: z.string().optional() }),
  z.object({
    block: z.literal('product_rows'),
    items: z.array(Item).min(1),
    image_side: z.enum(['alternate', 'left', 'right']).default('alternate'),
  }),
  z.object({ block: z.literal('product_grid'), columns: z.union([z.literal(2), z.literal(3)]).default(2), items: z.array(Item).min(2) }),
  z.object({
    block: z.literal('price_table'),
    title: z.string().optional(),
    rows: z.array(z.object({ label: z.string(), value: z.string() })).min(1),
    note_html: z.string().optional(),
  }),
  z.object({ block: z.literal('cta'), text_html: z.string(), link: z.string().url().optional(), style: z.enum(['button', 'text']).default('text') }),
  z.object({ block: z.literal('divider') }),
  z.object({ block: z.literal('spacer'), height: z.number().int().min(8).max(80).default(24) }),
  z.object({ block: z.literal('custom'), mjml: z.string().min(1), reason: z.string().optional() }),
]);
export type Bloque = z.infer<typeof BloqueSchema>;

export const ComposicionSchema = z.object({
  enfoque: z.enum(['editorial', 'comercial']).default('comercial'),
  asunto: z.string().min(5).max(120),
  preheader: z.string().min(10).max(150),
  acento: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  bloques: z.array(BloqueSchema).min(2),
  razonamiento: z.string().optional(),
});
export type Composicion = z.infer<typeof ComposicionSchema>;
