CREATE TRIGGER IF NOT EXISTS intent_reservation_insert BEFORE INSERT ON upload_intents
WHEN EXISTS (SELECT 1 FROM media WHERE id = NEW.media_id OR storage_path = NEW.storage_path)
BEGIN SELECT RAISE(ABORT, 'Media already reserved'); END;
-- statement-breakpoint
CREATE TRIGGER IF NOT EXISTS intent_identity_immutable BEFORE UPDATE OF operation_id, media_id, post_id, storage_path ON upload_intents
WHEN NEW.operation_id != OLD.operation_id OR NEW.media_id != OLD.media_id OR NEW.post_id != OLD.post_id OR NEW.storage_path != OLD.storage_path
BEGIN SELECT RAISE(ABORT, 'Intent identity immutable'); END;
-- statement-breakpoint
CREATE TRIGGER IF NOT EXISTS media_reservation_insert BEFORE INSERT ON media
WHEN EXISTS (SELECT 1 FROM upload_intents WHERE (media_id = NEW.id OR storage_path = NEW.storage_path) AND NOT (state = 'registered' AND media_id = NEW.id AND post_id = NEW.post_id AND storage_path = NEW.storage_path))
BEGIN SELECT RAISE(ABORT, 'Media reserved by intent'); END;
-- statement-breakpoint
CREATE TRIGGER IF NOT EXISTS media_reservation_update BEFORE UPDATE OF id, post_id, storage_path ON media
WHEN EXISTS (SELECT 1 FROM upload_intents WHERE (media_id = NEW.id OR storage_path = NEW.storage_path OR media_id = OLD.id OR storage_path = OLD.storage_path) AND NOT (state = 'registered' AND media_id = NEW.id AND post_id = NEW.post_id AND storage_path = NEW.storage_path AND media_id = OLD.id AND post_id = OLD.post_id AND storage_path = OLD.storage_path))
BEGIN SELECT RAISE(ABORT, 'Media reserved by intent'); END;
