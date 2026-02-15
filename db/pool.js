let poolInstance = null;

function shouldUseSsl(connectionString) {
  const disableFromMode = String(process.env.PGSSLMODE || '').toLowerCase() === 'disable';
  const disableFromFlag = String(process.env.DATABASE_SSL || '').toLowerCase() === 'false';
  if (disableFromMode || disableFromFlag) return false;
  const local = /localhost|127\.0\.0\.1/i.test(connectionString || '');
  return !local;
}

export function hasDatabaseUrl() {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

export async function getPool() {
  if (poolInstance) return poolInstance;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing DATABASE_URL. Configure your Postgres connection string.');
  }
  let Pool;
  try {
    ({ Pool } = await import('pg'));
  } catch (error) {
    throw new Error(`Postgres driver not installed. Run npm install (missing "pg"): ${error?.message || error}`);
  }
  const poolConfig = { connectionString };
  if (shouldUseSsl(connectionString)) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  poolInstance = new Pool(poolConfig);
  return poolInstance;
}
