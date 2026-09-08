-- SpeedType — D1 schema
-- Run once with: wrangler d1 execute speedtype-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,      -- stored lowercase; original casing kept in display_name
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  pin_salt TEXT,
  pin_hash TEXT,
  settings TEXT NOT NULL,          -- JSON string
  best_wpm INTEGER NOT NULL DEFAULT 0,
  history TEXT NOT NULL DEFAULT '[]', -- JSON array string, capped at 100 client-side on read
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  admin_token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS announcement (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  text TEXT,
  ts INTEGER,
  by TEXT
);
