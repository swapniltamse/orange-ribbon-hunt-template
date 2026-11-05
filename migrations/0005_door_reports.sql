CREATE TABLE door_reports (
  door_id TEXT NOT NULL,
  visitor TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (door_id, visitor)
);
