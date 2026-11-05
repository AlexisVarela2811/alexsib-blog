CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES posts(id),
  storage_path TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS published_media (
  post_id TEXT NOT NULL REFERENCES posts(id),
  media_id TEXT NOT NULL REFERENCES media(id),
  PRIMARY KEY (post_id, media_id)
);
