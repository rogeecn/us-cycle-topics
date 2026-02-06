import { Pool, PoolClient } from "pg";
import { getEnv } from "./env.js";

let cachedPool: Pool | null = null;

export function getPool(): Pool {
  if (cachedPool) {
    return cachedPool;
  }

  const env = getEnv();
  cachedPool = new Pool({ connectionString: env.DATABASE_URL });
  return cachedPool;
}

export async function withTransaction<T>(
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
