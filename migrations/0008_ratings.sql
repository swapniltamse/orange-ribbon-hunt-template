-- A family rates a door it visited. The public lists show only averages, never who rated.
CREATE TABLE ratings (
  team_id TEXT NOT NULL,
  door_id TEXT NOT NULL,
  candy INTEGER,
  costume INTEGER,
  at INTEGER NOT NULL,
  PRIMARY KEY (team_id, door_id)
);

-- A host gives a visiting team one star. Children's costumes only ever get good news.
CREATE TABLE costume_stars (
  door_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (door_id, team_id)
);
