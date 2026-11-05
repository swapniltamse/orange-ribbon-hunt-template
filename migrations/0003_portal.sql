CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Anonymous usage counts. No names, IP addresses, apartments or team links.
CREATE TABLE events (
  name TEXT NOT NULL,
  visitor TEXT,
  mode TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX events_at ON events (at);
