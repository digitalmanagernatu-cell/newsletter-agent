import pg from 'pg';

let pool: pg.Pool | undefined;

/** Pool de Postgres (Neon en producción). Conexiones cortas para que Neon pueda dormir la base de datos. */
export function db(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Falta DATABASE_URL');
    const conSsl = /sslmode=(require|verify-full)|neon\.tech/.test(url);
    // El SSL se configura aquí (verificando el certificado); se quita sslmode de la URL para evitar el aviso de pg.
    const limpia = url.replace(/([?&])(sslmode|channel_binding)=[^&]*&?/g, '$1').replace(/[?&]$/, '');
    pool = new pg.Pool({ connectionString: limpia, max: 5, idleTimeoutMillis: 10_000, ssl: conSsl ? { rejectUnauthorized: true } : undefined });
  }
  return pool;
}

export async function q<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db().query<T>(sql, params)).rows;
}

export async function cerrarDb() {
  await pool?.end();
  pool = undefined;
}
