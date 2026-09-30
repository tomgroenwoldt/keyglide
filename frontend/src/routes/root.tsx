import { useEffect, useState } from "react";
import { formatDate } from "date-fns";

import { ChallengePlayer } from "@/components/challenge-player";
import { useAppStore } from "@/store";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";

type TodayChallenge = {
    id: number;
    title: string | null;
    description: string | null;
};

/** Today's challenge. The editor is the first thing on the page. */
export default function Root() {
    const { supabase } = useAppStore();
    const { ready: authReady } = useSession();

    const [challenge, setChallenge] = useState<
        TodayChallenge | null | undefined
    >(undefined);

    useEffect(() => {
        if (!authReady) return;
        supabase
            .from("challenges")
            .select("id, title, description")
            .eq("date", formatDate(new Date(), "yyyy-MM-dd"))
            .maybeSingle<TodayChallenge>()
            .then((res) => setChallenge(res.data ?? null));
    }, [authReady]);

    return (
        <>
            {challenge === undefined ? (
                <div className="container-wrapper flex-auto">
                    <div className="container py-6">{"Loading..."}</div>
                </div>
            ) : challenge === null ? (
                <div className="container-wrapper flex-auto">
                    <div className="container py-10 flex flex-col gap-3">
                        <h1 className="text-2xl font-bold leading-tight tracking-tighter">
                            {"No challenge today"}
                        </h1>
                        <p className="max-w-2xl text-foreground">
                            {
                                "Nothing has been scheduled for today yet. Browse the archive, or submit one and vote it to the front of the queue."
                            }
                        </p>
                        <div className="flex gap-2">
                            <Button asChild>
                                <a href="/browse">{"Browse challenges"}</a>
                            </Button>
                            <Button asChild variant="outline">
                                <a href="/submit">{"Submit a challenge"}</a>
                            </Button>
                        </div>
                    </div>
                </div>
            ) : (
                <ChallengePlayer
                    challengeId={challenge.id}
                    title={challenge.title}
                    description={challenge.description}
                />
            )}

            <section className="border-grid border-t">
                <div className="container-wrapper">
                    <div className="container py-4">
                        <details className="group">
                            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground list-none inline-flex items-center gap-1">
                                {"How it works"}
                                <span className="transition-transform group-open:rotate-180">
                                    {"\u25be"}
                                </span>
                            </summary>
                            <div>
                                <p className="max-w-3xl pt-3 text-foreground">
                                    {`You get two editors: an editable start file on the left and a
                                    read-only goal file on the right. Transform the start file until
                                    it matches the goal exactly, in as few keystrokes as you can.
                                    Keystrokes and time are tracked as you edit, and the file saves
                                    automatically on every buffer change. Switch to the right editor
                                    any time to read through the goal.`}
                                </p>
                                <p className="max-w-3xl pt-3 text-foreground">
                                    {
                                        "Everyone's solutions stay hidden until the day is over, so nobody can copy today's answer. Your own is always visible to you."
                                    }
                                </p>
                            </div>
                        </details>
                    </div>
                </div>
            </section>
        </>
    );
}
