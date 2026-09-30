-- Challenge comments table
CREATE TABLE public.challenge_comments (
    id SERIAL PRIMARY KEY,
    challenge_id INTEGER NOT NULL REFERENCES public.challenges(id),
    user_id UUID NOT NULL REFERENCES public.profiles(id) DEFAULT auth.uid(),
    content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ
);

-- Comment votes table
CREATE TABLE public.challenge_comment_votes (
    id SERIAL PRIMARY KEY,
    comment_id INTEGER NOT NULL REFERENCES public.challenge_comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) DEFAULT auth.uid(),
    vote SMALLINT NOT NULL CHECK (vote IN (1, -1)),
    CONSTRAINT challenge_comment_votes_unique UNIQUE (comment_id, user_id)
);

ALTER TABLE public.challenge_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_comment_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can view comments"
ON public.challenge_comments FOR SELECT USING (TRUE);

CREATE POLICY "authenticated users can create comments"
ON public.challenge_comments FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can update own comments"
ON public.challenge_comments FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can delete own comments"
ON public.challenge_comments FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "anyone can view comment votes"
ON public.challenge_comment_votes FOR SELECT USING (TRUE);

CREATE POLICY "authenticated users can vote"
ON public.challenge_comment_votes FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can update own votes"
ON public.challenge_comment_votes FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users can delete own votes"
ON public.challenge_comment_votes FOR DELETE
USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.get_challenge_comments(p_challenge_id INTEGER)
RETURNS TABLE (
    id INTEGER,
    content TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    user_id UUID,
    user_name TEXT,
    avatar_url TEXT,
    net_score BIGINT,
    my_vote SMALLINT
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
    SELECT
        c.id,
        c.content,
        c.created_at,
        c.updated_at,
        c.user_id,
        p.user_name,
        p.avatar_url,
        COALESCE(SUM(v.vote), 0)::BIGINT AS net_score,
        MAX(CASE WHEN v.user_id = auth.uid() THEN v.vote ELSE NULL END)::SMALLINT AS my_vote
    FROM public.challenge_comments c
    JOIN public.profiles p ON p.id = c.user_id
    LEFT JOIN public.challenge_comment_votes v ON v.comment_id = c.id
    WHERE c.challenge_id = p_challenge_id
    GROUP BY c.id, c.content, c.created_at, c.updated_at, c.user_id, p.user_name, p.avatar_url
    ORDER BY c.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.toggle_comment_vote(p_comment_id INTEGER, p_vote SMALLINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM public.challenge_comment_votes
    WHERE comment_id = p_comment_id
      AND user_id = auth.uid()
      AND vote = p_vote;

    IF FOUND THEN
        RETURN;
    END IF;

    INSERT INTO public.challenge_comment_votes (comment_id, user_id, vote)
    VALUES (p_comment_id, auth.uid(), p_vote)
    ON CONFLICT (comment_id, user_id)
    DO UPDATE SET vote = EXCLUDED.vote;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_comment(p_comment_id INTEGER, p_content TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF char_length(p_content) < 1 OR char_length(p_content) > 500 THEN
        RAISE EXCEPTION 'Comment must be between 1 and 500 characters';
    END IF;

    UPDATE public.challenge_comments
    SET content = p_content, updated_at = now()
    WHERE id = p_comment_id AND user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Comment not found or permission denied';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_comment(p_comment_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM public.challenge_comments
    WHERE id = p_comment_id AND user_id = auth.uid();
END;
$$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.challenge_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.challenge_comment_votes;
