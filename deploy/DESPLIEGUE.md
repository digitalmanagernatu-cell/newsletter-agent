# Despliegue del agente de newsletters en agentes.natulaboratories.es

Servidor: Plesk (AlmaLinux) con Docker. El agente corre en un contenedor que solo escucha en `127.0.0.1:3002`; Apache de Plesk lo publica en `https://news.agentes.natulaboratories.es`. No toca `natu-agents` (puerto 3000) ni `natu-kb-mcp` (3001).

## 1. DNS
Crear un registro **A** `news.agentes` → la IP del servidor (la misma que `agentes.natulaboratories.es`) en el proveedor DNS de `natulaboratories.es`. Comprobar desde la terminal del servidor:

```bash
getent hosts agentes.natulaboratories.es news.agentes.natulaboratories.es
```

## 2. Certificado
Plesk → Sitios web y dominios → `news.agentes.natulaboratories.es` → SSL/TLS → Let's Encrypt (cuando el DNS ya resuelva).

## 3. Código y configuración (terminal SSH de Plesk, como root)

```bash
git clone -b claude/natu-newsletter-agent-ttzg1l https://github.com/digitalmanagernatu-cell/newsletter-agent.git /opt/natu-agentes
```
```bash
/opt/natu-agentes/deploy/crear-env.sh
```

El script pide (sin mostrarlas) la clave de OpenAI, la de Mailrelay y la cadena de conexión de Neon (consola de Neon → proyecto **natu-agentes** → Connect → base `natu_agentes`). El webhook de eventos ya apunta a `https://natulab.app.n8n.cloud/webhook/natu-newsletter-eventos`. Genera el resto de claves y muestra las dos que hay que poner en n8n.

## 4. Arrancar

```bash
cd /opt/natu-agentes && docker compose up -d --build
```
```bash
curl -s http://127.0.0.1:3002/health
```

## 5. Proxy en Plesk
Plesk → `news.agentes.natulaboratories.es` → Configuración de Apache y nginx → pegar `deploy/plesk-apache.conf` en "Directivas adicionales" para HTTP y HTTPS. Comprobar:

```bash
curl -s https://news.agentes.natulaboratories.es/health
```

## 6. n8n (nube)
1. Importar `n8n/newsletter-eventos.json` y `n8n/newsletter-betreson-peticion.json`.
2. Credenciales:
   - **Header Auth "Agente newsletter"**: nombre `Authorization`, valor `Bearer <AGENT_API_KEYS>` → nodo *Enviar al agente*.
   - **Header Auth "Eventos agente"**: nombre `X-Natu-Clave`, valor `<N8N_EVENTS_KEY>` → nodo *Evento del agente*.
   - **Email**: el SMTP de Microsoft 365 no funciona (Microsoft lo está retirando). Sustituir los nodos *Enviar email* y *Avisar del error* por **Microsoft Outlook → Send a message** con credencial OAuth ("Connect my account"), con To `{{ $json.para }}`, Subject `{{ $json.asunto }}`, Message `{{ $json.html }}` y tipo de contenido **HTML**.
3. En *Construir email*, revisar la lista `EQUIPO` (quién recibe los emails de aprobación).
4. Activar los dos flujos. La URL de producción del webhook es la que va en `N8N_EVENTS_URL`.

## Actualizar

```bash
cd /opt/natu-agentes && git pull && docker compose up -d --build
```

## Registros

```bash
docker logs --tail 100 natu-agent-newsletter
```

## Prueba de programación realizada (24/11/2026)

En Mailrelay existe el grupo **"Prueba agente"** (id 12) con una sola dirección (digitalmanager@natuaromatic.com). Se creó el borrador 85 solo para ese grupo, se programó a 3 días (`pending` a la hora UTC esperada) y se canceló (`cancelled`). El grupo puede reutilizarse para pruebas.

## Estado en producción (24/11/2026)

- Agente desplegado en `https://news.agentes.natulaboratories.es` (contenedor `natu-agent-newsletter`).
- Formulario del equipo: https://natulab.app.n8n.cloud/form/9fa52642-3a57-412d-82da-3bdcb96aaf70 (n8n cambia la ruta al importar).
- Prueba completa: formulario → borrador 86 en Mailrelay → prueba → email de aprobación (Outlook) → "Pedir cambios" → ronda 2 con el mismo borrador actualizado.

## Fase 4 (NATU / Mailchimp)

1. Añadir la clave de Mailchimp al `.env` del servidor (se escribe sin que se vea):

```bash
read -r -s -p "Clave de Mailchimp: " K; echo; printf 'MAILCHIMP_DC=us13\nMAILCHIMP_API_KEY=%s\n' "$K" >> /opt/natu-agentes/.env; unset K
```

2. Actualizar y reiniciar:

```bash
cd /opt/natu-agentes && git pull && docker compose up -d --build
```

3. n8n:
   - En *Newsletter – Eventos del agente*, sustituir el código del nodo **Construir email** por `n8n/construir-email.js`.
   - Importar `n8n/newsletter-natu-peticion.json`, elegir la credencial "Agente newsletter" en *Enviar al agente*, guardar y activar.
