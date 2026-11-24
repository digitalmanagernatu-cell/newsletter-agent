-- Esquema común del sistema de agentes NATU.
-- "shared": tareas, historial, coste y aprobaciones de cualquier agente.
-- "newsletter": datos propios del agente de newsletters.

CREATE SCHEMA IF NOT EXISTS shared;
CREATE SCHEMA IF NOT EXISTS newsletter;

CREATE TABLE IF NOT EXISTS shared.tareas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente        text NOT NULL,
  tipo          text NOT NULL,                       -- p. ej. crear_newsletter, regenerar
  estado        text NOT NULL DEFAULT 'pendiente',   -- pendiente | en_curso | completada | error
  entrada       jsonb NOT NULL DEFAULT '{}',
  salida        jsonb,
  error         text,
  solicitante   text,
  origen        text,                                -- n8n | mcp | cli
  creado        timestamptz NOT NULL DEFAULT now(),
  actualizado   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tareas_agente_estado ON shared.tareas (agente, estado, creado DESC);

-- Historial: cada cosa que pasa (quién, qué, cuándo).
CREATE TABLE IF NOT EXISTS shared.eventos (
  id         bigserial PRIMARY KEY,
  agente     text NOT NULL,
  tarea_id   uuid REFERENCES shared.tareas(id) ON DELETE SET NULL,
  recurso    text,                                   -- p. ej. newsletter.peticion:<uuid>
  tipo       text NOT NULL,
  actor      text,
  datos      jsonb NOT NULL DEFAULT '{}',
  creado     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventos_recurso ON shared.eventos (recurso, creado);

-- Coste por agente y tarea.
CREATE TABLE IF NOT EXISTS shared.costes (
  id              bigserial PRIMARY KEY,
  agente          text NOT NULL,
  tarea_id        uuid REFERENCES shared.tareas(id) ON DELETE SET NULL,
  proveedor       text NOT NULL,
  modelo          text NOT NULL,
  tokens_entrada  integer NOT NULL DEFAULT 0,
  tokens_salida   integer NOT NULL DEFAULT 0,
  coste_usd       numeric(10,5),
  creado          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS costes_agente_fecha ON shared.costes (agente, creado);

-- Aprobaciones de acciones irreversibles (se usa desde la fase 3).
CREATE TABLE IF NOT EXISTS shared.aprobaciones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente       text NOT NULL,
  accion       text NOT NULL,                        -- p. ej. programar_campana
  recurso      text NOT NULL,
  parametros   jsonb NOT NULL DEFAULT '{}',          -- lo que se aprueba exactamente (versión, fecha…)
  estado       text NOT NULL DEFAULT 'emitida',      -- emitida | usada | revocada | caducada
  emitida      timestamptz NOT NULL DEFAULT now(),
  caduca       timestamptz NOT NULL,
  usada        timestamptz,
  usada_por    text
);
CREATE INDEX IF NOT EXISTS aprobaciones_recurso ON shared.aprobaciones (recurso, estado);

CREATE TABLE IF NOT EXISTS newsletter.peticiones (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarea_id       uuid REFERENCES shared.tareas(id) ON DELETE SET NULL,
  marca          text NOT NULL CHECK (marca IN ('betreson', 'natu')),
  peticion       jsonb NOT NULL,
  solicitante    text,
  -- generando | borrador | prueba_enviada | cambios_pedidos | aprobada | programada | enviada | cancelada | error
  estado         text NOT NULL DEFAULT 'generando',
  envio_previsto timestamptz,
  creado         timestamptz NOT NULL DEFAULT now(),
  actualizado    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter.versiones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peticion_id   uuid NOT NULL REFERENCES newsletter.peticiones(id) ON DELETE CASCADE,
  numero        integer NOT NULL,                    -- ronda: 1, 2… (sube con cada "pedir cambios")
  enfoque       text NOT NULL,                       -- editorial | comercial
  idioma        text NOT NULL DEFAULT 'es',
  composicion   jsonb NOT NULL,
  mjml          text NOT NULL,
  html          text NOT NULL,
  avisos        jsonb NOT NULL DEFAULT '[]',
  revisiones    jsonb NOT NULL DEFAULT '[]',
  captura_url   text,
  feedback      text,
  creado        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (peticion_id, numero, enfoque, idioma)
);

CREATE TABLE IF NOT EXISTS newsletter.campanas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id       uuid NOT NULL REFERENCES newsletter.versiones(id) ON DELETE CASCADE,
  plataforma       text NOT NULL CHECK (plataforma IN ('mailrelay', 'mailchimp')),
  id_externo       text NOT NULL,
  destino          jsonb NOT NULL,                   -- grupos o segmento
  estado           text NOT NULL DEFAULT 'borrador', -- borrador | programada | enviada | cancelada
  pruebas          jsonb NOT NULL DEFAULT '[]',      -- [{a:[...], fecha}]
  programada_para  timestamptz,
  id_envio         text,                             -- id del envío programado (Mailrelay sent_campaign)
  url              text,
  creado           timestamptz NOT NULL DEFAULT now(),
  actualizado      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plataforma, id_externo)
);

CREATE TABLE IF NOT EXISTS shared.migraciones (nombre text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now());
INSERT INTO shared.migraciones (nombre) VALUES ('001_inicial') ON CONFLICT DO NOTHING;
