CREATE TABLE IF NOT EXISTS upload_intents (
  operation_id TEXT PRIMARY KEY NOT NULL,
  media_id TEXT NOT NULL UNIQUE,
  post_id TEXT NOT NULL REFERENCES posts(id),
  storage_path TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'uploaded', 'registered'))
);
