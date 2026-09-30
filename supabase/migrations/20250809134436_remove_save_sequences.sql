UPDATE scores
SET keys = (
    WITH expanded AS (
        SELECT idx, elem,
               CASE
                   WHEN elem = CHR(27) AND lead(elem, 1) OVER w = ':' AND lead(elem, 2) OVER w = 'w' AND lead(elem, 3) OVER w = CHR(13) THEN 4
                   WHEN elem = CHR(27) AND lead(elem, 1) OVER w = ':' AND lead(elem, 2) OVER w = 'x' AND lead(elem, 3) OVER w = CHR(13) THEN 4
                   WHEN elem = ':'  AND lead(elem, 1) OVER w = 'w' AND lead(elem, 2) OVER w = CHR(13) THEN 3
                   WHEN elem = ':'  AND lead(elem, 1) OVER w = 'x' AND lead(elem, 2) OVER w = CHR(13) THEN 3
                   ELSE 0
               END AS match_len
        FROM unnest(keys) WITH ORDINALITY AS u(elem, idx)
        WINDOW w AS (ORDER BY idx)
    ),
    matched_positions AS (
        SELECT idx
        FROM expanded e
        WHERE e.match_len > 0
        UNION ALL
        SELECT idx + 1 FROM expanded e WHERE e.match_len > 1
        UNION ALL
        SELECT idx + 2 FROM expanded e WHERE e.match_len > 2
        UNION ALL
        SELECT idx + 3 FROM expanded e WHERE e.match_len > 3
    ),
    filtered AS (
        SELECT elem, idx
        FROM expanded
        WHERE idx NOT IN (SELECT idx FROM matched_positions)
        ORDER BY idx
    )
    SELECT array_agg(elem)
    FROM filtered
)
WHERE keys IS NOT NULL;

