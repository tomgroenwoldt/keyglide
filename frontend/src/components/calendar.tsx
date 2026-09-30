import { useEffect, useState } from "react";
import { formatDate, parse } from "date-fns";
import { useNavigate } from "react-router-dom";

import { useAppStore } from "@/store";
import { Calendar } from "./ui/calendar";

/** Earliest challenge in the archive; nothing before this is selectable. */
const ARCHIVE_START = new Date(2025, 6, 20);

function monthBounds(month: Date): [string, string] {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    return [formatDate(first, "yyyy-MM-dd"), formatDate(last, "yyyy-MM-dd")];
}

/**
 * Which days the signed-in user has solved, as a way into the archive.
 * Selecting a day opens that day's challenge.
 */
export default function ScoreCalendar() {
    const { user, supabase } = useAppStore();
    const navigate = useNavigate();

    const [month, setMonth] = useState(new Date());
    const [solved, setSolved] = useState<Date[]>([]);

    useEffect(() => {
        if (!user) {
            setSolved([]);
            return;
        }
        const [from, to] = monthBounds(month);

        // Bounded to the visible month: the archive spans well over a year,
        // and every score would otherwise come down on each render.
        const fetchSolved = async () => {
            const { data } = await supabase
                .from("scores")
                .select("solutions!inner(challenges!inner(date))")
                .eq("user_id", user.id)
                .gte("solutions.challenges.date", from)
                .lte("solutions.challenges.date", to);
            const dates = (data ?? [])
                .map((row) => row.solutions?.challenges?.date)
                .filter((d): d is string => Boolean(d))
                .map((d) => parse(d, "yyyy-MM-dd", new Date()));
            setSolved(dates);
        };
        fetchSolved();

        // Scoped to this user, so another player finishing a challenge does
        // not trigger a refetch here.
        const channel = supabase
            .channel(`calendar-scores-${user.id}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "scores",
                    filter: `user_id=eq.${user.id}`,
                },
                fetchSolved,
            )
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [user, month]);

    if (!user) return null;

    return (
        <Calendar
            autoFocus={false}
            className="rounded-md border p-4"
            mode="single"
            month={month}
            onMonthChange={setMonth}
            onSelect={(date) => {
                if (date) navigate(`/${formatDate(date, "yyyy-MM-dd")}`);
            }}
            modifiers={{ marked: solved, everything: true }}
            modifiersClassNames={{
                marked: "dark:bg-green-800 bg-green-400 rounded-md",
                everything: "mx-0.5 -my-0.5",
            }}
            disabled={{ before: ARCHIVE_START, after: new Date() }}
        />
    );
}
