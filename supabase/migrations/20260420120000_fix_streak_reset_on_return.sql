-- The previous trigger only ever incremented the streak and relied on a
-- background worker to reset it. If that worker skipped a day (server down,
-- no challenge yesterday, etc.), a user returning after a gap would get
-- `old_streak + 1` instead of having their streak reset.
--
-- Make the trigger self-sufficient: on the user's first play of today's
-- challenge, increment only if they also played yesterday, otherwise reset
-- to 1.

CREATE OR REPLACE FUNCTION public.increment_streak_on_score()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  challenge_date DATE;
  already_played BOOLEAN;
  played_yesterday BOOLEAN;
BEGIN
  SELECT c.date INTO challenge_date
  FROM public.challenges c
  JOIN public.solutions sol ON sol.challenge_id = c.id
  WHERE sol.id = NEW.solution_id;

  IF challenge_date = CURRENT_DATE THEN

    SELECT EXISTS (
      SELECT 1
      FROM public.scores s
      JOIN public.solutions sol2 ON sol2.id = s.solution_id
      JOIN public.challenges c2 ON c2.id = sol2.challenge_id
      WHERE s.user_id = NEW.user_id
        AND c2.date = CURRENT_DATE
        AND s.id <> NEW.id
    ) INTO already_played;

    IF NOT already_played THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.scores s
        JOIN public.solutions sol3 ON sol3.id = s.solution_id
        JOIN public.challenges c3 ON c3.id = sol3.challenge_id
        WHERE s.user_id = NEW.user_id
          AND c3.date = CURRENT_DATE - INTERVAL '1 day'
      ) INTO played_yesterday;

      UPDATE public.profiles
      SET streak = CASE WHEN played_yesterday THEN COALESCE(streak, 0) + 1 ELSE 1 END
      WHERE id = NEW.user_id;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- Bulk streak reset used by the daily background worker. For a given target
-- date, if a challenge exists on that date, reset `streak` to 0 for every
-- profile that did not play it. Returns the number of rows updated.

CREATE OR REPLACE FUNCTION public.reset_streaks_for_missed_day(target_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.challenges WHERE date = target_date) THEN
    RETURN 0;
  END IF;

  WITH played AS (
    SELECT DISTINCT s.user_id
    FROM public.scores s
    JOIN public.solutions sol ON sol.id = s.solution_id
    JOIN public.challenges c ON c.id = sol.challenge_id
    WHERE c.date = target_date
      AND s.user_id IS NOT NULL
  ),
  updated AS (
    UPDATE public.profiles p
    SET streak = 0
    WHERE COALESCE(p.streak, 0) > 0
      AND NOT EXISTS (SELECT 1 FROM played pl WHERE pl.user_id = p.id)
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO updated_count FROM updated;

  RETURN updated_count;
END;
$$;
