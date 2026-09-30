-- Remove the duels table.
--
-- Duel mode shipped a backend and a frontend, then the UI was deleted in
-- `7b094c1` and the backend was left behind unreachable. The table never held
-- a row in production. Git history keeps the implementation if it is ever
-- wanted again.

DROP TABLE IF EXISTS public.duels;
