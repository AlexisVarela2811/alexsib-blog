CREATE TABLE IF NOT EXISTS login_throttle (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 0 AND 5)
);
INSERT OR IGNORE INTO login_throttle (id, window_start, attempts) VALUES (1, 0, 0);
