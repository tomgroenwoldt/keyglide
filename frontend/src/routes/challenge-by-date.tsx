import { useEffect, useState } from "react";
import { formatDate } from "date-fns";
import { useNavigate, useParams } from "react-router-dom";

import { useAppStore } from "@/store";

/**
 * Resolves `/:date` to that day's challenge and hands over to `/c/:id`, which
 * is the canonical URL. Keeps the shareable date links working.
 */
export function ChallengeByDate() {
    const { supabase } = useAppStore();
    const { date } = useParams();
    const navigate = useNavigate();
    const [missing, setMissing] = useState(false);

    useEffect(() => {
        const parsed = date ? new Date(date) : new Date();
        if (Number.isNaN(parsed.getTime())) {
            setMissing(true);
            return;
        }
        supabase
            .from("challenges")
            .select("id")
            .eq("date", formatDate(parsed, "yyyy-MM-dd"))
            .maybeSingle()
            .then(({ data }) => {
                if (data) navigate(`/c/${data.id}`, { replace: true });
                else setMissing(true);
            });
    }, [date]);

    return (
        <div className="container-wrapper flex-auto">
            <div className="container py-6">
                {missing ? "No challenge for that day." : "Loading..."}
            </div>
        </div>
    );
}
