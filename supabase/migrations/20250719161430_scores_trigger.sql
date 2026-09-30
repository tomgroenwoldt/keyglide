BEGIN;

DROP
  PUBLICATION IF EXISTS supabase_realtime;

CREATE PUBLICATION supabase_realtime;

COMMIT;

ALTER
  PUBLICATION supabase_realtime ADD TABLE scores;

