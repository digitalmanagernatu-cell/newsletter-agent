# Agente de newsletters (NATU / BetrésON)

Fase 1: servicio de maquetación. A partir de una petición del equipo genera 1 o 2 propuestas (editorial y comercial), las maqueta en MJML con el kit de marca de `/brand/<marca>`, hace capturas de escritorio y móvil, las revisa visualmente y se corrige hasta 2 veces.

## Cómo funciona

1. **Composición libre** (`src/prompts.ts`): el modelo decide la estructura del cuerpo según el tipo de campaña, los productos, las fotos y la cantidad de texto. La biblioteca de bloques (`src/blocks/`) es inspiración: puede combinarlos o escribir MJML propio (`custom`).
2. **Fijo por marca** (`src/layout.ts`): cabecera con logo, pie con redes, contacto, texto legal y enlace de baja, colores y tipografías.
3. **Reglas automáticas** (`src/lint.ts`): enlace de baja presente y sin codificar, palabras prohibidas ("higiene corporal"), mención a farmacia en BetrésON, imágenes https con alt, enlaces seguros, peso < 102 KB (recorte de Gmail), longitud de asunto y preheader.
4. **Revisión visual** (`src/pipeline.ts`): capturas a 680 px y 375 px → el modelo puntúa y devuelve una composición corregida si hace falta.

## Uso

```bash
npm install
OPENAI_API_KEY=... npm run render -- examples/betreson-pets-navidad.json out/prueba
npm test
```

Salida por propuesta: `email.mjml`, `email.html`, `composicion.json`, `revision.json`, `escritorio.png`, `movil.png`; y `uso.json` con los tokens consumidos.

Volver a maquetar una composición sin llamar al modelo:

```bash
npx tsx src/rerender.ts betreson out/prueba/comercial/composicion.json
```

Ejemplo de resultado: `examples/salida-pets-navidad/` (datos ficticios).
