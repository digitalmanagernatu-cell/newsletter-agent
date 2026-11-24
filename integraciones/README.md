# Integraciones

## Alexia (plataforma NPD)

`alexia-npd-platform.patch` añade a Alexia (`NATU-Laboratories/npd-platform`) las herramientas `crear_newsletter`, `estado_newsletter`, `pedir_cambios_newsletter` y `reenviar_prueba_newsletter`, disponibles para Marketing / NPD, Diseño y administradores. Alexia nunca puede programar envíos.

Aplicar en una rama de npd-platform:

```bash
git checkout -b claude/alexia-agente-newsletters && git am /ruta/alexia-npd-platform.patch
```

Variables en Vercel: `NEWSLETTER_AGENT_URL=https://news.agentes.natulaboratories.es` y `NEWSLETTER_AGENT_KEY` (clave propia de Alexia, añadida a `AGENT_API_KEYS` del agente).
