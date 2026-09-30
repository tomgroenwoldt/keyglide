CREATE TYPE public.challenge_like AS ENUM (
  'up',
  'down'
);

CREATE TABLE public.challenge_likes (
    id SERIAL PRIMARY KEY,
    challenge_id INTEGER NOT NULL REFERENCES public.challenges,
    user_id UUID REFERENCES profiles(id) DEFAULT auth.uid() NOT NULL,
    reaction public.challenge_like NOT NULL,

    -- A user can only like a challenge once.
    CONSTRAINT challenge_likes_unique UNIQUE (challenge_id, user_id)
);

ALTER TABLE public.challenge_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can like challenges"
ON public.challenge_likes
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can unlike their own likes"
ON public.challenge_likes
FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "anyone can view likes"
ON public.challenge_likes
FOR SELECT
USING (TRUE);

CREATE OR REPLACE FUNCTION public.toggle_challenge_reaction(
  p_challenge_id INTEGER,
  p_reaction public.challenge_like
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- same reaction → delete (toggle off)
  DELETE FROM public.challenge_likes
  WHERE challenge_id = p_challenge_id
    AND user_id = auth.uid()
    AND reaction = p_reaction;

  IF FOUND THEN
    RETURN;
  END IF;

  -- opposite or none → upsert
  INSERT INTO public.challenge_likes (challenge_id, reaction)
  VALUES (p_challenge_id, p_reaction)
  ON CONFLICT (challenge_id, user_id)
  DO UPDATE
  SET reaction = EXCLUDED.reaction;
END;
$$;

-- Enable realtime on the duels table
ALTER PUBLICATION supabase_realtime ADD TABLE public.challenge_likes;

CREATE OR REPLACE FUNCTION public.get_challenge_reaction_state(
  p_challenge_id INTEGER
)
RETURNS TABLE (
  up_count BIGINT,
  down_count BIGINT,
  my_reaction public.challenge_like
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT
    COUNT(*) FILTER (WHERE reaction = 'up')   AS up_count,
    COUNT(*) FILTER (WHERE reaction = 'down') AS down_count,
    MAX(
      CASE
        WHEN user_id = auth.uid() THEN reaction
        ELSE NULL
      END
    ) AS my_reaction
  FROM public.challenge_likes
  WHERE challenge_id = p_challenge_id;
$$;

