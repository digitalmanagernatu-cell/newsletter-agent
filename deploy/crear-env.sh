#!/usr/bin/env bash
# Crea /opt/natu-agentes/.env pidiendo las claves por teclado (no se muestran ni quedan en el historial).
# El webhook de eventos apunta al n8n de NATU (natulab.app.n8n.cloud).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then echo ".env ya existe. Bórralo antes si quieres regenerarlo."; exit 1; fi
leer() { local v; read -r -s -p "$1: " v; echo >&2; printf '%s' "$v"; }
OPENAI=$(leer "Clave de OpenAI (sk-...)")
MAILRELAY=$(leer "Clave de API de Mailrelay")
MAILCHIMP=$(leer "Clave de API de Mailchimp (termina en -us13)")
DBURL=$(leer "Cadena de conexión de Neon (postgresql://...)")
N8NURL=https://natulab.app.n8n.cloud/webhook/natu-newsletter-eventos
umask 077
cat > .env <<ENV
PORT=3002
PUBLIC_URL=https://news.agentes.natulaboratories.es
OPENAI_API_KEY=${OPENAI}
LLM_MODEL=gpt-5.4
MAILRELAY_ACCOUNT=betreson.ipzmarketing.com
MAILRELAY_API_KEY=${MAILRELAY}
MAILCHIMP_DC=us13
MAILCHIMP_API_KEY=${MAILCHIMP}
DATABASE_URL=${DBURL}
AGENT_API_KEYS=$(openssl rand -hex 32)
APPROVAL_SECRET=$(openssl rand -hex 48)
APPROVAL_TTL_HOURS=72
N8N_EVENTS_URL=${N8NURL}
N8N_EVENTS_KEY=$(openssl rand -hex 24)
TEST_EMAIL_DOMAINS=natulaboratories.es,natuaromatic.com,betreson.com
ENV
echo ".env creado. Claves para configurar en n8n:"
echo "  Agente (cabecera Authorization):  Bearer $(grep ^AGENT_API_KEYS= .env | cut -d= -f2)"
echo "  Webhook de eventos (cabecera X-Natu-Clave):  $(grep ^N8N_EVENTS_KEY= .env | cut -d= -f2)"
