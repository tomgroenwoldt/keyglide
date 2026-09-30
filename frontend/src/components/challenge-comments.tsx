import { useEffect, useState } from "react";
import {
    ArrowBigDown,
    ArrowBigUp,
    Pencil,
    Trash2,
    X,
    Check,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore } from "@/store";

interface Comment {
    id: number;
    content: string;
    created_at: string;
    updated_at: string | null;
    user_id: string;
    user_name: string;
    avatar_url: string | null;
    net_score: number;
    my_vote: number | null;
}

interface ChallengeCommentsProps {
    challengeId: number;
    isOpen: boolean;
    onToggle: () => void;
    onCommentCountChange?: (count: number) => void;
}

export function ChallengeComments({
    challengeId,
    isOpen,
    onToggle,
    onCommentCountChange,
}: ChallengeCommentsProps) {
    const { supabase, user } = useAppStore();

    const [comments, setComments] = useState<Comment[]>([]);
    const [sortBy, setSortBy] = useState<"recent" | "liked">("recent");
    const [newComment, setNewComment] = useState("");
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editContent, setEditContent] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const fetchComments = async () => {
        const { data, error } = await supabase.rpc("get_challenge_comments", {
            p_challenge_id: challengeId,
        });
        if (error || !data) return;
        setComments(data);
        onCommentCountChange?.(data.length);
    };

    useEffect(() => {
        fetchComments();

        const channel = supabase
            .channel(`challenge-comments-${challengeId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "challenge_comments",
                },
                fetchComments,
            )
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "challenge_comment_votes",
                },
                fetchComments,
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [challengeId]);

    const handleSubmit = async () => {
        if (!newComment.trim() || submitting) return;
        setSubmitting(true);
        const { error } = await supabase.from("challenge_comments").insert({
            challenge_id: challengeId,
            content: newComment.trim(),
        });
        if (!error) {
            setNewComment("");
        }
        setSubmitting(false);
    };

    const handleVote = async (commentId: number, vote: number) => {
        await supabase.rpc("toggle_comment_vote", {
            p_comment_id: commentId,
            p_vote: vote,
        });
    };

    const handleUpdate = async (commentId: number) => {
        if (!editContent.trim()) return;
        await supabase.rpc("update_comment", {
            p_comment_id: commentId,
            p_content: editContent.trim(),
        });
        setEditingId(null);
        setEditContent("");
    };

    const handleDelete = async (commentId: number) => {
        await supabase.rpc("delete_comment", {
            p_comment_id: commentId,
        });
    };

    const sortedComments = [...comments].sort((a, b) => {
        if (sortBy === "liked") return b.net_score - a.net_score;
        return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
    });

    if (!isOpen) return null;

    return (
        <section className="border-grid border-b">
            <div className="container-wrapper">
                <div className="container py-6 flex flex-col gap-4 max-h-[500px] overflow-y-auto">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <h2 className="text-2xl font-bold leading-tight tracking-tighter md:text-3xl lg:leading-[1.1]">
                                {"Comments"}
                            </h2>
                            <div className="flex gap-1">
                                <Button
                                    variant={
                                        sortBy === "recent"
                                            ? "default"
                                            : "outline"
                                    }
                                    size="sm"
                                    onClick={() => setSortBy("recent")}
                                >
                                    {"Recent"}
                                </Button>
                                <Button
                                    variant={
                                        sortBy === "liked"
                                            ? "default"
                                            : "outline"
                                    }
                                    size="sm"
                                    onClick={() => setSortBy("liked")}
                                >
                                    {"Most liked"}
                                </Button>
                            </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={onToggle}>
                            <X className="h-4 w-4" />
                            {"Close"}
                        </Button>
                    </div>

                    {user && (
                        <div className="flex flex-col gap-2">
                            <Textarea
                                placeholder="Write a comment..."
                                value={newComment}
                                onChange={(e) => setNewComment(e.target.value)}
                                onKeyDown={(e) => {
                                    if (
                                        e.key === "Enter" &&
                                        (e.ctrlKey || e.metaKey)
                                    ) {
                                        e.preventDefault();
                                        handleSubmit();
                                    }
                                }}
                                maxLength={500}
                                className="resize-none"
                            />
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">
                                    {`${newComment.length}/500`}
                                </span>
                                <Button
                                    size="sm"
                                    onClick={handleSubmit}
                                    disabled={
                                        !newComment.trim() ||
                                        submitting ||
                                        newComment.length > 500
                                    }
                                >
                                    {"Post"}
                                </Button>
                            </div>
                        </div>
                    )}

                    {comments.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                            {"No comments yet. Be the first!"}
                        </p>
                    )}

                    {sortedComments.map((comment) => (
                        <div
                            key={comment.id}
                            className="flex gap-3 py-3 border-b last:border-b-0"
                        >
                            <Avatar className="h-8 w-8">
                                <AvatarImage
                                    src={comment.avatar_url ?? undefined}
                                />
                                <AvatarFallback>
                                    {comment.user_name
                                        .slice(0, 2)
                                        .toUpperCase()}
                                </AvatarFallback>
                            </Avatar>

                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="font-medium">
                                        {comment.user_name}
                                    </span>
                                    <span className="text-muted-foreground">
                                        {formatDistanceToNow(
                                            new Date(comment.created_at),
                                            { addSuffix: true },
                                        )}
                                    </span>
                                    {comment.updated_at && (
                                        <span className="text-muted-foreground">
                                            {"(edited)"}
                                        </span>
                                    )}
                                </div>

                                {editingId === comment.id ? (
                                    <div className="flex flex-col gap-2 mt-1">
                                        <Textarea
                                            value={editContent}
                                            onChange={(e) =>
                                                setEditContent(e.target.value)
                                            }
                                            maxLength={500}
                                            className="resize-none min-h-[60px]"
                                        />
                                        <div className="flex gap-1">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() =>
                                                    handleUpdate(comment.id)
                                                }
                                                disabled={
                                                    !editContent.trim() ||
                                                    editContent.length > 500
                                                }
                                            >
                                                <Check className="h-3 w-3" />
                                                {"Save"}
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    setEditingId(null);
                                                    setEditContent("");
                                                }}
                                            >
                                                <X className="h-3 w-3" />
                                                {"Cancel"}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-sm mt-1 whitespace-pre-wrap">
                                        {comment.content}
                                    </p>
                                )}

                                <div className="flex items-center gap-1 mt-2">
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div>
                                                    <Button
                                                        variant={
                                                            comment.my_vote ===
                                                            1
                                                                ? "default"
                                                                : "ghost"
                                                        }
                                                        size="sm"
                                                        className="h-7 w-7 p-0"
                                                        onClick={() =>
                                                            handleVote(
                                                                comment.id,
                                                                1,
                                                            )
                                                        }
                                                        disabled={user === null}
                                                    >
                                                        <ArrowBigUp className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TooltipTrigger>
                                            {!user && (
                                                <TooltipContent>
                                                    <span>
                                                        {
                                                            "You need to login to vote."
                                                        }
                                                    </span>
                                                </TooltipContent>
                                            )}
                                        </Tooltip>
                                    </TooltipProvider>

                                    <span className="text-sm font-medium min-w-[2ch] text-center">
                                        {comment.net_score}
                                    </span>

                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <div>
                                                    <Button
                                                        variant={
                                                            comment.my_vote ===
                                                            -1
                                                                ? "destructive"
                                                                : "ghost"
                                                        }
                                                        size="sm"
                                                        className="h-7 w-7 p-0"
                                                        onClick={() =>
                                                            handleVote(
                                                                comment.id,
                                                                -1,
                                                            )
                                                        }
                                                        disabled={user === null}
                                                    >
                                                        <ArrowBigDown className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TooltipTrigger>
                                            {!user && (
                                                <TooltipContent>
                                                    <span>
                                                        {
                                                            "You need to login to vote."
                                                        }
                                                    </span>
                                                </TooltipContent>
                                            )}
                                        </Tooltip>
                                    </TooltipProvider>

                                    {user && user.id === comment.user_id && (
                                        <>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 w-7 p-0 ml-2"
                                                onClick={() => {
                                                    setEditingId(comment.id);
                                                    setEditContent(
                                                        comment.content,
                                                    );
                                                }}
                                            >
                                                <Pencil className="h-3 w-3" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 w-7 p-0"
                                                onClick={() =>
                                                    handleDelete(comment.id)
                                                }
                                            >
                                                <Trash2 className="h-3 w-3" />
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
