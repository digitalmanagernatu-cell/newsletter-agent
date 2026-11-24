# Fase 0 — Descubrimiento

Fecha: 2026-11-24. Todo lo de este documento se obtuvo en modo lectura; no se ha creado ni modificado nada en las plataformas.

## 1. Mailrelay (BetrésON)

- Cuenta: `https://betreson.ipzmarketing.com/api/v1/`, cabecera `X-AUTH-TOKEN`.
- Paquete: enterprise, 80.000 envíos/mes, 20.000 suscriptores.
- Límite: 250 peticiones / 5 min (endpoints generales); 300/min en `/subscribers`. Cabeceras `X-RateLimit-*` y `Retry-After` en 429.
- Especificación OpenAPI: `https://apidocs.mailrelay.com/openapi.json`.

### Grupos

| id | nombre | suscriptores |
|---|---|---|
| 2 | Farmacias | 9.830 |
| 3 | Farmacias Galicia | 1.070 |
| 4 | Natu/Betrés | 19 |
| 5 | Farmacias Zona Norte (País Vasco) | 354 |
| 6 | Farmacias Activas | 10.884 |
| 7 | Fallo Giros Duplicados Marzo 2025 | 47 |
| 9 | Farmacia no clientes pero para promos | 16 |
| 10 | Farmacias Madrid (FAR006) | 826 |
| 11 | Farmacias Valencia | 705 |

- Segmentos: ninguno.
- Remitentes: id 1, "Betrés ON" `info@betreson.com` (confirmado, por defecto).
- Carpetas de campañas: ninguna. Carpetas de medios: 3 (nombres `Zip-…`).

### Endpoints verificados en la documentación

| Paso | Endpoint | Notas |
|---|---|---|
| Subir imagen | `POST /media_files` | JSON `{file: {name, content(base64)}, media_folder_id?}` → devuelve `url` pública |
| Crear borrador | `POST /campaigns` | Obligatorios: `subject`, `sender_id`, `html`, `target` (`groups`\|`segment`). Opcionales: `preview_text`, `group_ids`, `segment_id`, `campaign_folder_id`, `reply_to`, `use_premailer`, `analytics_utm_campaign`, `track_opens`, `track_clicks` |
| Editar | `PATCH /campaigns/{id}` | |
| Prueba | `POST /campaigns/{id}/send_test` | `test_emails`: string separado por comas |
| **Programar** | `POST /campaigns/{id}/send_all` | `target`, `group_ids`/`segment_id`, **`scheduled_at` en UTC `YYYY-MM-DD HH:MM:SS`**, `callback_url` opcional |
| Cancelar programado | `PATCH /sent_campaigns/{id}/cancel` | Cancela de forma permanente |
| Estado | `GET /sent_campaigns/{id}` | |

> ⚠️ **Riesgo crítico:** `send_all` **sin** `scheduled_at` envía la campaña **inmediatamente** a toda la lista. El cliente del agente debe rechazar cualquier llamada a `send_all` sin `scheduled_at` futuro y sin token de aprobación válido.

Conversión horaria: el formulario recibe hora de Madrid → convertir a UTC (CET = UTC+1, CEST = UTC+2).

## 2. Mailchimp (NATU)

- Cuenta "Natuaromatic", data center `us13`, zona horaria `Europe/Madrid`.
- File Manager: 2.291 archivos.

### Audiencias

| id | nombre | contactos | remitente |
|---|---|---|---|
| `269aad017f` | NATU | 1.390 | Laboratorios Natuaromatic `info@natuaromatic.com` |
| `390e1a53a0` | Vintage Clientes | 477 | Antonio Fuentes |

**No hay una audiencia por idioma.** Los idiomas se separan con **segmentos guardados** dentro de la audiencia NATU, combinando la etiqueta `GRANEL` con el campo `ORIGEN CLIENTE` (`MMERGE7`) o `Country` (`MMERGE12`):

| idioma | segmento | id | contactos | condición |
|---|---|---|---|---|
| es | GRANEL ES | 7222685 | 1.322 | GRANEL **o** Country contiene "España" |
| it | GRANEL IT | 7222686 | 205 | GRANEL **y** ORIGEN CLIENTE contiene "ITALIA" |
| fr | GRANEL FR | 7222687 | 99 | GRANEL **y** ORIGEN CLIENTE contiene "FRANCIA" |
| ro | GRANEL RO | 7222688 | 18 | GRANEL **y** ORIGEN CLIENTE contiene "RUMANIA" |

> ⚠️ **Posible error en el segmento GRANEL ES:** usa "cualquiera" (OR). Incluye a **todos** los contactos con etiqueta GRANEL, también italianos, franceses y rumanos, que reciben así la versión española además de la suya. Lo previsible sería "GRANEL **y** España". Pendiente de confirmar con Irene.

Segmentos de exclusión existentes, a respetar: `NO PROMO` (7196050), `NO COMUNICACION` (7221857), `NO COMUNICACION TARIFAS` (7221858), `NO BLACK` (7149310 / 7221558), `PROVEEDORES/ACREEDORES` (7220897), `COMERCIALES NATUAROMATIC` (3685845).

Campos de fusión útiles: `MMERGE5` TIPO CLIENTE, `MMERGE6`/`MMERGE10` grupo cliente, `MMERGE7` ORIGEN CLIENTE, `MMERGE9` CÓDIGO SAP, `MMERGE12` Country.

Última campaña multiidioma (23/11/2026): 4 campañas, una por idioma, cada una con su segmento guardado y su plantilla.

### Endpoints (API Marketing v3)

| Paso | Endpoint |
|---|---|
| Subir imagen | `POST /file-manager/files` (`name`, `file_data` base64) → `full_size_url` |
| Crear borrador | `POST /campaigns` (`type: regular`, `recipients.list_id`, `recipients.segment_opts.saved_segment_id`, `settings`) |
| Contenido | `PUT /campaigns/{id}/content` (`html`) |
| Prueba | `POST /campaigns/{id}/actions/test` (`test_emails[]`, `send_type: html`) |
| Programar | `POST /campaigns/{id}/actions/schedule` (`schedule_time` en UTC, minutos 00/15/30/45) |
| Desprogramar | `POST /campaigns/{id}/actions/unschedule` |
| Estado | `GET /campaigns/{id}` |

## 3. Servidor `agentes.natulaboratories.es`

- Plesk sobre AlmaLinux/CentOS. Docker instalado. Apache/nginx de Plesk como proxy inverso.
- `natu-agents` (Node, PM2, puerto 3000) — **relanzado el 24/11** tras estar caído; ejecutar `pm2 save` y `pm2 startup` para que sobreviva a reinicios.
- `natu-kb-mcp` (Docker, `127.0.0.1:3001`, `kb-mcp.agentes…`) — **parado** el 24/11: su proyecto Neon (plan gratuito) agotó la cuota de cómputo mensual (~110 CU-h) el 19/11.
- Contenedor `natu-agents` (Python, `natu-marketing-agents`) — parado desde hace 6 meses.
- SSH: puerto público 64227; añadido `127.0.0.1:22` para la terminal de Plesk (copia en `/etc/ssh/sshd_config.bak-natu`).

**Integración propuesta:** contenedor propio para el agente de newsletters en `127.0.0.1:3002`, subdominio `newsletter.agentes.natulaboratories.es` con proxy de Plesk, sin tocar lo existente.

## 4. Decisiones

- **BetrésON** se envía solo al grupo **Farmacias Activas** (id 6).
- **NATU**: audiencia NATU (`269aad017f`). Un segmento por idioma: Natu ES, Natu IT, Natu FR, Natu RO y Natu EN (este último lo creará Irene). Si la petición indica "toda la base de datos", se envía a toda la audiencia NATU.
- **Destinatarios de prueba**: campo libre en el formulario, en el que quien hace la petición escribe a quién enviarla.

- n8n: el de la nube.
- Repositorio: `newsletter-agent`, con estructura de monorepo para renombrarlo después a `natu-agentes`.
- Postgres: proyecto Neon propio para el agente, con suspensión automática para no agotar la cuota.
