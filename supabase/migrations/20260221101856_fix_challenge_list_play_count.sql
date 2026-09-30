create or replace function public.get_challenges(
    filter_type public.challenge_filter default 'most_recent'
)
returns table (
    id int,
    date date,
    start text,
    goal text,
    extension prog_extension,
    play_count bigint,
    like_count bigint,
    played_by_me boolean
)
language sql
as $$
with challenge_stats as (
    select
        c.id,
        c.date,
        c.start,
        c.goal,
        c.extension,

        count(distinct sc.id) as play_count,
        count(distinct cl.id) as like_count,

        (
            exists (
                select 1
                from solutions s2
                where s2.challenge_id = c.id
                and s2.user_id = auth.uid()
            )
            or
            exists (
                select 1
                from scores sc
                join solutions s3 on s3.id = sc.solution_id
                where s3.challenge_id = c.id
                and sc.user_id = auth.uid()
            )
        ) as played_by_me

    from challenges c
    left join solutions s on s.challenge_id = c.id
    left join scores sc on sc.solution_id = s.id
    left join challenge_likes cl on cl.challenge_id = c.id
    where c.date <= current_date  -- exclude future challenges
    group by c.id
)

select *
from challenge_stats cs
where
    case
        when filter_type = 'played_by_me' then cs.played_by_me = true
        when filter_type = 'not_played_by_me' then cs.played_by_me = false
        else true
    end

order by
    case when filter_type = 'most_played' then cs.play_count end desc,
    case when filter_type = 'most_liked' then cs.like_count end desc,
    case when filter_type = 'most_recent' then cs.date end desc,
    cs.date desc
$$;
