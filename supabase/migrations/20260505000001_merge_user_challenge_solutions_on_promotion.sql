-- When a user_challenge is promoted to a daily challenge, re-attach any
-- preview-play solutions to the new challenges row so they appear on the
-- normal daily leaderboard. Their scores follow automatically (scores
-- reference solutions by id).

CREATE OR REPLACE FUNCTION public.promote_user_challenge_for_date(target_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    selected RECORD;
    new_challenge_id INTEGER;
BEGIN
    SELECT
        uc.id,
        uc.start,
        uc.goal,
        uc.extension,
        uc.title,
        uc.description
    INTO selected
    FROM public.user_challenges uc
    LEFT JOIN public.user_challenge_likes l ON l.user_challenge_id = uc.id
    WHERE uc.promoted_at IS NULL
    GROUP BY uc.id
    ORDER BY (
        COUNT(*) FILTER (WHERE l.reaction = 'up')
        - COUNT(*) FILTER (WHERE l.reaction = 'down')
    ) DESC,
    uc.created_at ASC
    LIMIT 1;

    IF selected.id IS NULL THEN
        RETURN NULL;
    END IF;

    INSERT INTO public.challenges (date, start, goal, extension, title, description)
    VALUES (
        target_date,
        selected.start,
        selected.goal,
        selected.extension,
        selected.title,
        selected.description
    )
    ON CONFLICT (date) DO NOTHING
    RETURNING id INTO new_challenge_id;

    IF new_challenge_id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE public.user_challenges
    SET promoted_at = now(),
        promoted_challenge_id = new_challenge_id
    WHERE id = selected.id;

    UPDATE public.solutions
    SET challenge_id = new_challenge_id,
        user_challenge_id = NULL
    WHERE user_challenge_id = selected.id;

    RETURN new_challenge_id;
END;
$$;

-- Backfill: any user_challenge that was already promoted before this migration
-- still has its preview-play solutions stranded on the user_challenge. Skip
-- rows that would collide with an existing daily solution (same keys against
-- the same challenge); those duplicates stay parked on the user_challenge.
UPDATE public.solutions sol
SET challenge_id = uc.promoted_challenge_id,
    user_challenge_id = NULL
FROM public.user_challenges uc
WHERE sol.user_challenge_id = uc.id
  AND uc.promoted_challenge_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.solutions existing
      WHERE existing.challenge_id = uc.promoted_challenge_id
        AND existing.keys = sol.keys
  );
