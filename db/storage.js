import path from 'path';
import { mkdirSync, existsSync, writeFileSync, accessSync, constants, statSync } from 'fs';
import { JSONFilePreset } from 'lowdb/node';
import { getPool, hasDatabaseUrl } from './pool.js';

const IN_PROJECT_DATA_DIR = './data';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureWritableDataDir(dir) {
  mkdirSync(dir, { recursive: true });
  accessSync(dir, constants.W_OK);
}

async function ensurePostgresSchema(pool) {
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  } catch {
    // Extension is optional for this app because IDs are generated in-app.
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      username_key TEXT NOT NULL,
      password_hash TEXT,
      pin_hash TEXT NOT NULL,
      pin TEXT,
      auth_token TEXT,
      chips INTEGER NOT NULL DEFAULT 1000,
      bankroll INTEGER NOT NULL DEFAULT 1000,
      profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS bankroll INTEGER');
  await pool.query('UPDATE users SET bankroll = COALESCE(bankroll, chips, 1000) WHERE bankroll IS NULL');
  await pool.query('ALTER TABLE users ALTER COLUMN bankroll SET DEFAULT 1000');
  await pool.query('ALTER TABLE users ALTER COLUMN bankroll SET NOT NULL');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_username_key_idx ON users (username_key)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS users_auth_token_idx ON users (auth_token) WHERE auth_token IS NOT NULL');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function extractUserCore(user, startingChips) {
  const safeUser = user && typeof user === 'object' ? user : {};
  const id = String(safeUser.id || '');
  const username = String(safeUser.username || '').trim();
  const usernameKey = String(safeUser.usernameKey || normalizeUsername(username));
  const pinHash = String(safeUser.pinHash || '');
  const passwordHash = String(safeUser.passwordHash || pinHash);
  const pin = safeUser.pin === undefined || safeUser.pin === null ? null : String(safeUser.pin);
  const authToken = safeUser.authToken ? String(safeUser.authToken) : null;
  const chips = Number.isFinite(Number(safeUser.chips)) ? Math.max(0, Math.floor(Number(safeUser.chips))) : startingChips;
  const createdAt = safeUser.createdAt ? String(safeUser.createdAt) : null;
  const profile = { ...safeUser };
  delete profile.id;
  delete profile.username;
  delete profile.usernameKey;
  delete profile.passwordHash;
  delete profile.pinHash;
  delete profile.pin;
  delete profile.authToken;
  delete profile.chips;
  delete profile.createdAt;
  return {
    id,
    username,
    usernameKey,
    pinHash,
    passwordHash,
    pin,
    authToken,
    chips,
    createdAt,
    profile
  };
}

function hydrateUser(row, startingChips) {
  const profile = row?.profile && typeof row.profile === 'object' ? row.profile : {};
  const user = {
    ...profile,
    id: row.id,
    username: row.username,
    usernameKey: row.username_key || normalizeUsername(row.username),
    passwordHash: row.password_hash || row.pin_hash,
    pinHash: row.pin_hash || row.password_hash || '',
    pin: row.pin ?? null,
    authToken: row.auth_token || null,
    chips: Number.isFinite(Number(row.bankroll ?? row.chips))
      ? Math.max(0, Math.floor(Number(row.bankroll ?? row.chips)))
      : startingChips
  };
  if (row.created_at && !user.createdAt) {
    user.createdAt = new Date(row.created_at).toISOString();
  }
  return user;
}

async function loadPostgresState(pool, emptyDb, startingChips) {
  const usersResult = await pool.query(`
    SELECT id, username, username_key, password_hash, pin_hash, pin, auth_token, chips, bankroll, profile, created_at
    FROM users
    ORDER BY created_at ASC
  `);
  const stateResult = await pool.query(`
    SELECT value, updated_at
    FROM app_state
    WHERE key = 'global'
    LIMIT 1
  `);

  const users = usersResult.rows.map((row) => hydrateUser(row, startingChips));
  const stateValue = stateResult.rows[0]?.value && typeof stateResult.rows[0].value === 'object'
    ? stateResult.rows[0].value
    : {};

  const data = {
    users,
    lobbies: ensureArray(stateValue.lobbies),
    friendInvites: ensureArray(stateValue.friendInvites),
    friendRequests: ensureArray(stateValue.friendRequests),
    friendChallenges: ensureArray(stateValue.friendChallenges),
    rankedHistory: ensureArray(stateValue.rankedHistory)
  };

  return {
    ...clone(emptyDb),
    ...data
  };
}

async function persistPostgresState(pool, data, startingChips) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
    await client.query('LOCK TABLE app_state IN SHARE ROW EXCLUSIVE MODE');

    const users = ensureArray(data.users);
    for (const user of users) {
      const core = extractUserCore(user, startingChips);
      if (!core.id || !core.username || !core.usernameKey || !core.pinHash) {
        continue;
      }
      await client.query(
        `
          INSERT INTO users (
            id, username, username_key, password_hash, pin_hash, pin, auth_token, chips, bankroll, profile, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, COALESCE($11::timestamptz, NOW()), NOW())
          ON CONFLICT (id) DO UPDATE SET
            username = EXCLUDED.username,
            username_key = EXCLUDED.username_key,
            password_hash = EXCLUDED.password_hash,
            pin_hash = EXCLUDED.pin_hash,
            pin = EXCLUDED.pin,
            auth_token = EXCLUDED.auth_token,
            chips = EXCLUDED.chips,
            bankroll = EXCLUDED.bankroll,
            profile = EXCLUDED.profile,
            updated_at = NOW()
        `,
        [
          core.id,
          core.username,
          core.usernameKey,
          core.passwordHash,
          core.pinHash,
          core.pin,
          core.authToken,
          core.chips,
          core.chips,
          JSON.stringify(core.profile),
          core.createdAt
        ]
      );
    }

    const statePayload = {
      lobbies: ensureArray(data.lobbies),
      friendInvites: ensureArray(data.friendInvites),
      friendRequests: ensureArray(data.friendRequests),
      friendChallenges: ensureArray(data.friendChallenges),
      rankedHistory: ensureArray(data.rankedHistory)
    };
    await client.query(
      `
        INSERT INTO app_state (key, value, updated_at)
        VALUES ('global', $1::jsonb, NOW())
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = NOW()
      `,
      [JSON.stringify(statePayload)]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function createQueuedWriter(writeFn, onWrite) {
  let queue = Promise.resolve();
  return () => {
    queue = queue.then(writeFn, writeFn).then((value) => {
      onWrite();
      return value;
    });
    return queue;
  };
}

async function createPostgresStorage({ emptyDb, startingChips }) {
  const pool = await getPool();
  await ensurePostgresSchema(pool);
  const data = await loadPostgresState(pool, emptyDb, startingChips);
  let lastWriteTime = null;
  const write = createQueuedWriter(
    () => persistPostgresState(pool, data, startingChips),
    () => {
      lastWriteTime = new Date().toISOString();
    }
  );
  return {
    backend: 'postgres',
    data,
    write,
    getInfo: () => ({
      backend: 'postgres',
      dataDir: null,
      dbPath: 'postgres://DATABASE_URL',
      userCount: ensureArray(data.users).length,
      lastWriteTime
    })
  };
}

async function createJsonStorage({ emptyDb, dataDir }) {
  const requestedDataDir = dataDir || IN_PROJECT_DATA_DIR;
  let activeDataDir = requestedDataDir;
  try {
    ensureWritableDataDir(activeDataDir);
  } catch (error) {
    if (activeDataDir !== IN_PROJECT_DATA_DIR) {
      activeDataDir = IN_PROJECT_DATA_DIR;
      ensureWritableDataDir(activeDataDir);
    } else {
      throw error;
    }
  }
  const dbPath = path.join(activeDataDir, 'db.json');
  const hadExistingStorage = existsSync(dbPath);
  if (!hadExistingStorage) {
    writeFileSync(dbPath, `${JSON.stringify(emptyDb, null, 2)}\n`, 'utf8');
  }
  const lowdb = await JSONFilePreset(dbPath, clone(emptyDb));
  let lastWriteTime = null;
  try {
    lastWriteTime = statSync(dbPath).mtime.toISOString();
  } catch {
    lastWriteTime = null;
  }
  const write = createQueuedWriter(
    () => lowdb.write(),
    () => {
      lastWriteTime = new Date().toISOString();
    }
  );
  return {
    backend: 'json',
    data: lowdb.data,
    write,
    getInfo: () => ({
      backend: 'json',
      dataDir: activeDataDir,
      dbPath,
      userCount: ensureArray(lowdb.data?.users).length,
      lastWriteTime,
      hadExistingStorage
    })
  };
}

export async function createStorage({
  emptyDb,
  dataDir = './data',
  nodeEnv = process.env.NODE_ENV,
  startingChips = 1000
}) {
  if (hasDatabaseUrl()) {
    return createPostgresStorage({ emptyDb, startingChips });
  }
  if (nodeEnv === 'production') {
    throw new Error('Missing DATABASE_URL in production. Configure Postgres (Neon) to persist accounts.');
  }
  return createJsonStorage({ emptyDb, dataDir });
}
