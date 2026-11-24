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

## Fase 2: servicio con Mailrelay (BetrésON)

`npm start` levanta el servidor (puerto `PORT`, 3002 por defecto). Todas las rutas salvo `/health` exigen `Authorization: Bearer <clave>` (lista en `AGENT_API_KEYS`).

### Herramientas MCP (`POST /mcp`, Streamable HTTP sin estado)

| Herramienta | Qué hace |
|---|---|
| `crear_newsletter` | Genera 1–2 propuestas, aloja las imágenes en Mailrelay, crea los borradores (grupo Farmacias Activas) y manda la prueba. Devuelve `tarea_id` y `peticion_id` (tarda 2–4 min). |
| `regenerar` | Aplica feedback (opcionalmente solo a la propuesta `editorial` o `comercial`), actualiza los mismos borradores y reenvía la prueba. |
| `enviar_prueba` | Reenvía la prueba de los borradores actuales. |
| `estado_campana` | Estado, versiones, borradores, pruebas e historial. |

`programar_campana` llega en la fase 3 y exigirá un token de aprobación.

### REST para n8n

| Método y ruta | Equivale a |
|---|---|
| `POST /v1/newsletters` → 202 | `crear_newsletter` |
| `POST /v1/newsletters/:id/regenerar` `{feedback, actor?, enfoque?}` → 202 | `regenerar` |
| `POST /v1/newsletters/:id/prueba` `{emails, actor?}` | `enviar_prueba` |
| `GET /v1/newsletters/:id` · `GET /v1/tareas/:id` | `estado_campana` |

### Seguridad

- El cliente de Mailrelay **no tiene** `send_all`: en esta fase es imposible enviar o programar a la lista real (lo comprueba un test).
- Pruebas solo a direcciones de `TEST_EMAIL_DOMAINS`; las demás se rechazan y se informa.
- Imágenes: las que no están en Mailrelay se descargan y se suben con `POST /media_files`; los emails solo llevan URLs de `assets.ipzmarketing.com`.
- Si las reglas automáticas detectan un error (baja ausente, MJML roto, palabra prohibida…), no se crea el borrador.

### Base de datos

Proyecto Neon `natu-agentes` (Frankfurt), base `natu_agentes`. Esquemas `shared` (tareas, eventos, costes, aprobaciones) y `newsletter` (peticiones, versiones, campañas). Migraciones en `/shared/migrations` (`npm run migrate` desde la raíz).
