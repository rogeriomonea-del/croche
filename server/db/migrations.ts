// Schema history. Entry i takes the database from `user_version` i to i + 1. Never edit an entry
// that has shipped: append a new one. Times are epoch milliseconds; IDs are UUID v4 strings.
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user_id ON sessions(user_id);
  CREATE INDEX sessions_expires_at ON sessions(expires_at);

  CREATE TABLE patterns (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rows INTEGER NOT NULL,
    cols INTEGER NOT NULL,
    document TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX patterns_owner_updated ON patterns(owner_id, updated_at DESC);
  `,
  `
  CREATE TABLE user_aliases (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    login_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL
  );
  `,
]
