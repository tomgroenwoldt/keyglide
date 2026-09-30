import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { useAppStore } from "@/store";
import { ChallengePlayer } from "@/components/challenge-player";

type Challenge = {
    id: number;
    title: string | null;
    description: string | null;
    date: string | null;
};

/**
 * Plays a single challenge by id. This id is stable for the challenge's whole
 * life, so a link keeps working after it is promoted from the queue to a day.
 */
export function Challenge() {
    const { supabase } = useAppStore();
    const { id } = useParams();
    const challengeId = id ? Number(id) : NaN;

    const [challenge, setChallenge] = useState<Challenge | null | undefined>(
        undefined,
    );

    useEffect(() => {
        if (!Number.isFinite(challengeId)) {
            setChallenge(null);
            return;
        }
        supabase
            .from("challenges")
            .select("id, title, description, date")
            .eq("id", challengeId)
            .single<Challenge>()
            .then((res) => setChallenge(res.data ?? null));
    }, [challengeId]);

    if (challenge === undefined) {
        return (
            <div className="container-wrapper flex-auto">
                <div className="container py-6">{"Loading..."}</div>
            </div>
        );
    }

    if (challenge === null) {
        return (
            <div className="container-wrapper flex-auto">
                <div className="container py-6">
                    {"This challenge does not exist."}
                </div>
            </div>
        );
    }

    return (
        <ChallengePlayer
            challengeId={challenge.id}
            title={challenge.title}
            description={challenge.description}
        />
    );
}
