#!/usr/bin/env bash
# Crea /opt/natu-agentes/.env pidiendo las claves por teclado (no se muestran ni quedan en el historial).
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then echo ".env ya existe. Bórralo antes si quieres regenerarlo."; exit 1; fi
leer() { local v; read -r -s -p "$1: " v; echo >&2; printf '%s' "$v"; }
OPENAI=$(leer "Clave de OpenAI (sk-...)")
MAILRELAY=$(leer "Clave de API de Mailrelay")
DBURL=$(leer "Cadena de conexión de Neon (postgresql://...)")
read -r -p "URL del webhook de eventos de n8n (https://.../webhook/natu-newsletter-eventos): " N8NURL
umask 077
cat > .env <<ENV
PORT=3002
PUBLIC_URL=https://news.agentes.natulaboratories.es
OPENAI_API_KEY=${OPENAI}
LLM_MODEL=gpt-5.4
MAILRELAY_ACCOUNT=betreson.ipzmarketing.com
MAILRELAY_API_KEY=${MAILRELAY}
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
