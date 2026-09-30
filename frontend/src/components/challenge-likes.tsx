import { useEffect, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { useAppStore } from "@/store";
import { Database } from "@/database.types";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./ui/tooltip";

type Reaction = Database["public"]["Enums"]["challenge_like"];

interface ChallengeLikesProps {
    challengeId: number;
}

export function ChallengeLikes({ challengeId }: ChallengeLikesProps) {
    const { supabase, user } = useAppStore();

    const [likes, setLikes] = useState<number>(0);
    const [dislikes, setDislikes] = useState<number>(0);
    const [userReaction, setUserReaction] = useState<Reaction | null>(null);

    const fetchState = async () => {
        const { data, error } = await supabase.rpc(
            "get_challenge_reaction_state",
            { p_challenge_id: challengeId },
        );

        if (error || !data?.[0]) return;

        setLikes(data[0].up_count);
        setDislikes(data[0].down_count);
        setUserReaction(data[0].my_reaction);
    };

    useEffect(() => {
        fetchState();

        const channel = supabase
            .channel(`challenge-likes-${challengeId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "challenge_likes",
                },
                fetchState,
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [challengeId]);

    const toggle = async (reaction: Reaction) => {
        await supabase.rpc("toggle_challenge_reaction", {
            p_challenge_id: challengeId,
            p_reaction: reaction,
        });
    };

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div>
                        <ButtonGroup
                            orientation="horizontal"
                            aria-label="Challenge reactions"
                        >
                            <Button
                                variant={
                                    userReaction === "up"
                                        ? "default"
                                        : "outline"
                                }
                                size="sm"
                                onClick={() => toggle("up")}
                                disabled={user === null}
                            >
                                <ThumbsUp />
                                {likes}
                            </Button>

                            <Button
                                variant={
                                    userReaction === "down"
                                        ? "destructive"
                                        : "outline"
                                }
                                size="sm"
                                onClick={() => toggle("down")}
                                disabled={user === null}
                            >
                                <ThumbsDown />
                                {dislikes}
                            </Button>
                        </ButtonGroup>
                    </div>
                </TooltipTrigger>
                {!user && (
                    <TooltipContent>
                        <span>{"You need to login to vote."}</span>
                    </TooltipContent>
                )}
            </Tooltip>
        </TooltipProvider>
    );
}
