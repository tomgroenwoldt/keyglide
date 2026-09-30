import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppStore } from "@/store";
import { Button } from "@/components/ui/button";
import { ChallengeList, ChallengeRow } from "@/components/challenge-list";

export function Mine() {
    const { supabase, user, authLoaded } = useAppStore();
    const navigate = useNavigate();

    const [rows, setRows] = useState<ChallengeRow[] | null>(null);

    const fetchMine = async () => {
        if (!user) return;
        const { data } = await supabase.rpc("get_challenges", {
            author_filter: user.id,
        });
        setRows((data ?? []) as ChallengeRow[]);
    };

    useEffect(() => {
        if (!authLoaded) return;
        if (user === null) {
            navigate("/login");
            return;
        }
        fetchMine();
    }, [user, authLoaded]);

    const handleDelete = async (id: number) => {
        // RLS only permits deleting a challenge that is still queued.
        const { error } = await supabase
            .from("challenges")
            .delete()
            .eq("id", id);
        if (error) {
            alert("Could not delete: " + error.message);
            return;
        }
        await fetchMine();
    };

    const handlePreview = async (row: ChallengeRow) => {
        if (row.start !== undefined && row.goal !== undefined) return;
        const { data } = await supabase
            .from("challenges")
            .select("start, goal")
            .eq("id", row.id)
            .single();
        if (data) {
            row.start = data.start;
            row.goal = data.goal;
        }
    };

    if (!authLoaded) return null;
    if (user === null) return null;

    return (
        <div className="container-wrapper flex-auto">
            <div className="container py-6 flex flex-col gap-4">
                <div className="flex justify-between items-end gap-3">
                    <div>
                        <h1 className="text-2xl font-bold leading-tight tracking-tighter md:text-3xl lg:leading-[1.1]">
                            {"My challenges"}
                        </h1>
                        <p className="max-w-2xl pt-2 pb-2 text-foreground">
                            {
                                "Challenges you have submitted. You can withdraw one while it is still queued, but not once it has been given a day."
                            }
                        </p>
                    </div>
                    <Button onClick={() => navigate("/submit")}>
                        {"Submit a challenge"}
                    </Button>
                </div>

                <ChallengeList
                    rows={rows}
                    showAuthor={false}
                    showVotes={true}
                    showDelete={true}
                    caption="Your submissions."
                    onDelete={handleDelete}
                    onPreview={handlePreview}
                />
            </div>
        </div>
    );
}
