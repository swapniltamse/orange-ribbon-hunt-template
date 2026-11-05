CREATE TABLE doors (
  id TEXT PRIMARY KEY,
  tower INTEGER NOT NULL,
  floor INTEGER NOT NULL,
  apt TEXT NOT NULL,
  alias TEXT NOT NULL UNIQUE,
  word TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  owner_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (tower, apt)
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE stamps (
  team_id TEXT NOT NULL,
  door_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, door_id)
);

CREATE TABLE misses (
  key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX misses_key ON misses (key, created_at);
