/** Utilidades de fecha con la zona horaria de la empresa (Europe/Madrid). */
export const ZONA = 'Europe/Madrid';

/** Desfase en minutos de una zona en un instante dado (p. ej. +60 en invierno en Madrid). */
function desfase(instante: Date, zona: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(instante).map((x) => [x.type, x.value]));
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((comoUtc - instante.getTime()) / 60000);
}

/**
 * Convierte una fecha/hora local de Madrid ("2026-12-01T09:30" o "2026-12-01 09:30")
 * a un Date UTC. Si la cadena ya trae zona (Z o ±hh:mm), se respeta.
 */
export function madridAUtc(local: string): Date {
  const s = local.trim().replace(' ', 'T');
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return new Date(s);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) throw new Error(`Fecha no válida: ${local}`);
  const ingenua = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  let utc = ingenua - desfase(new Date(ingenua), ZONA) * 60000;
  utc = ingenua - desfase(new Date(utc), ZONA) * 60000; // segunda pasada para los cambios de hora
  return new Date(utc);
}

export function formatoMadrid(d: Date): string {
  return new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, dateStyle: 'full', timeStyle: 'short' }).format(d);
}
