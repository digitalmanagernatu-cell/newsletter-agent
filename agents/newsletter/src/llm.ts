import OpenAI from 'openai';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Cliente de modelo intercambiable. Hoy OpenAI; el orquestador futuro
 * (Claude Agent SDK) llamará a este agente por MCP sin depender de este detalle.
 */
export interface Uso { modelo: string; entrada: number; salida: number }

const modelo = () => process.env.LLM_MODEL ?? 'gpt-5.4';
let cliente: OpenAI | undefined;
const api = () => (cliente ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, fetch: globalThis.fetch as any, timeout: 180_000 }));

export async function pedirJson<T>(opts: {
  sistema: string;
  usuario: string;
  imagenes?: Buffer[];
  esquema: ZodType<T, ZodTypeDef, unknown>;
  esfuerzo?: 'low' | 'medium' | 'high';
  usos?: Uso[];
}): Promise<T> {
  const contenido: OpenAI.Chat.ChatCompletionContentPart[] = [{ type: 'text', text: opts.usuario }];
  for (const img of opts.imagenes ?? [])
    contenido.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${img.toString('base64')}`, detail: 'high' } });

  const mensajes: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: opts.sistema },
    { role: 'user', content: contenido },
  ];
  for (let intento = 0; intento < 3; intento++) {
    const r = await api().chat.completions.create({
      model: modelo(),
      messages: mensajes,
      response_format: { type: 'json_object' },
      reasoning_effort: opts.esfuerzo ?? 'medium',
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
    opts.usos?.push({ modelo: r.model, entrada: r.usage?.prompt_tokens ?? 0, salida: r.usage?.completion_tokens ?? 0 });
    const texto = r.choices[0]?.message?.content ?? '';
    let datos: unknown;
    try {
      datos = JSON.parse(texto);
    } catch {
      mensajes.push({ role: 'assistant', content: texto }, { role: 'user', content: 'La respuesta no es JSON válido. Devuelve solo el JSON.' });
      continue;
    }
    const v = opts.esquema.safeParse(datos);
    if (v.success) return v.data;
    mensajes.push(
      { role: 'assistant', content: texto },
      { role: 'user', content: `El JSON no cumple el esquema. Corrige estos errores y devuelve el JSON completo:\n${JSON.stringify(v.error.issues.slice(0, 15))}` },
    );
  }
  throw new Error('El modelo no devolvió un JSON válido tras 3 intentos');
}
