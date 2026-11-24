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

El script pide (sin mostrarlas) la clave de OpenAI, la de Mailrelay y la cadena de conexión de Neon (consola de Neon → proyecto **natu-agentes** → Connect → base `natu_agentes`), y la URL del webhook de eventos de n8n. Genera el resto de claves y muestra las dos que hay que poner en n8n.

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
   - **SMTP** (o cambiar los nodos de email por Outlook/Gmail) → nodos *Enviar email* y *Avisar del error*. Ajustar el remitente.
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
