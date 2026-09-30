-- Keep the daily worker's functions to the service role.
--
-- `promote_challenge_for_date` and `reset_streaks_for_missed_day` are called
-- once a day by the backend worker. Both are SECURITY DEFINER, and PostgREST
-- exposes every function in `public` with EXECUTE granted to PUBLIC by
-- default, so anyone holding the publishable key could call them:
--
--   POST /rest/v1/rpc/promote_challenge_for_date {"target_date": "..."}
--
-- That let an anonymous caller schedule challenges on any date, drain the
-- voting queue, and reset every player's streak. Revoke EXECUTE from the
-- client roles; `service_role` keeps it, which is what the worker uses.

REVOKE EXECUTE ON FUNCTION public.promote_challenge_for_date(DATE)
    FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.reset_streaks_for_missed_day(DATE)
    FROM PUBLIC, anon, authenticated;
