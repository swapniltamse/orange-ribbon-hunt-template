-- Doors the organizer took off the list. Neighbors cannot add these back; the resident can still sign up.
CREATE TABLE door_blocks (
  tower INTEGER NOT NULL,
  apt TEXT NOT NULL,
  PRIMARY KEY (tower, apt)
);
