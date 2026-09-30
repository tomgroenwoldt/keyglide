import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "./ui/alert-dialog";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem } from "./ui/pagination";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { useAppStore } from "@/store";
import { QueryData } from "@supabase/supabase-js";
import { ChevronLeft, ChevronRight, Trash, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { formatDate, formatDuration, intervalToDuration } from "date-fns";
import { TableSkeleton } from "./table-skeleton";
import { Skeleton } from "./ui/skeleton";
import UserProfile from "./user-profile";

export interface ScoresProps {
    solutionId: number;
}

export function Scores(props: ScoresProps): JSX.Element {
    const { user, supabase } = useAppStore();
    const [currentPage, setCurrentPage] = useState(1);
    const [open, setOpen] = useState(false);
    const scoreQuery = supabase
        .from("scores")
        .select("*, profiles(full_name, user_name, avatar_url, streak)")
        .eq("solution_id", props.solutionId)
        .order("stop_time")
        .range(5 * (currentPage - 1), 5 * currentPage - 1);

    const scoreCountQuery = supabase
        .from("scores")
        .select("*", { count: "exact", head: true })
        .eq("solution_id", props.solutionId);

    type ScoreQuery = QueryData<typeof scoreQuery>;
    const [scores, setScores] = useState<ScoreQuery | null>(null);
    const [scoreCount, setScoreCount] = useState<number | null>(null);

    useEffect(() => {
        // Subscribe to database events for scores.
        const scoreChannel = supabase
            .channel(`score-changes-${props.solutionId}`)
            .on(
                "postgres_changes",
                {
                    event: "DELETE",
                    schema: "public",
                    table: "scores",
                },
                () => {
                    scoreQuery.then((res) => {
                        if (res.data) setScores(res.data);
                    });
                    scoreCountQuery.then((res) => {
                        if (res.count) setScoreCount(res.count);
                    });
                },
            )
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "scores",
                    filter: `solution_id=eq.${props.solutionId}`,
                },
                () => {
                    scoreQuery.then((res) => {
                        if (res.data) setScores(res.data);
                    });
                    scoreCountQuery.then((res) => {
                        if (res.count) setScoreCount(res.count);
                    });
                },
            )
            .subscribe();

        if (open) {
            scoreQuery.then((res) => setScores(res.data));
        }
        return () => {
            supabase.removeChannel(scoreChannel);
        };
    }, [open, currentPage]);

    useEffect(() => {
        scoreCountQuery.then((res) => {
            if (res.count !== null) setScoreCount(res.count);
        });
    }, []);

    if (scoreCount === null) {
        return (
            <Button variant="outline" onClick={() => setOpen(true)}>
                <Users />
                <Skeleton className="h-4 w-[80px]" />
            </Button>
        );
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" onClick={() => setOpen(true)}>
                    <Users />
                    <span className="w-[80px]">
                        {`${scoreCount} ${scoreCount === 1 ? "User" : "Users"}`}
                    </span>
                </Button>
            </DialogTrigger>
            <DialogContent className="!max-w-fit">
                <DialogHeader>
                    <DialogTitle>{"Users"}</DialogTitle>
                    <DialogDescription>
                        {"Users who used this solution will show up here."}
                    </DialogDescription>
                </DialogHeader>
                <Table className="border rounded-lg">
                    <TableCaption>
                        {"A list of users that used this solution."}
                    </TableCaption>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[300px]">
                                {"User"}
                            </TableHead>
                            <TableHead className="w-[200px]">
                                {"Duration"}
                            </TableHead>
                            <TableHead className="w-[200px]">
                                {"Finished at"}
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    {scores === null ? (
                        <TableSkeleton
                            className="h-8 w-[150x]"
                            rows={Math.min(scoreCount, 5)}
                            columns={3}
                        />
                    ) : (
                        <TableBody>
                            {scores.map((score) => {
                                const duration = formatDuration(
                                    intervalToDuration({
                                        start: score.start_time!,
                                        end: score.stop_time!,
                                    }),
                                );
                                const utcStopTime = new Date(
                                    score.stop_time
                                        .replace(" ", "T")
                                        .slice(0, 23) + "Z",
                                );
                                return (
                                    <TableRow key={score.id}>
                                        <TableCell>
                                            <UserProfile
                                                // Each score has a user ID
                                                userId={score.user_id!}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            {duration === ""
                                                ? "< 1 second"
                                                : duration}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex gap-4 items-center">
                                                {formatDate(
                                                    new Date(utcStopTime),
                                                    "MMMM d, yyyy HH:mm",
                                                )}
                                                {score.user_id === user?.id && (
                                                    <AlertDialog>
                                                        <AlertDialogTrigger
                                                            asChild
                                                        >
                                                            <Button
                                                                variant="destructive"
                                                                size="sm"
                                                            >
                                                                <Trash />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>
                                                                    {
                                                                        "Are you absolutely sure?"
                                                                    }
                                                                </AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    {
                                                                        "This action cannot be undone. This will permanently delete your score."
                                                                    }
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>
                                                                    {"Cancel"}
                                                                </AlertDialogCancel>
                                                                <AlertDialogAction
                                                                    onClick={async () => {
                                                                        if (
                                                                            score.id
                                                                        ) {
                                                                            await supabase
                                                                                .from(
                                                                                    "scores",
                                                                                )
                                                                                .delete()
                                                                                .eq(
                                                                                    "id",
                                                                                    score.id,
                                                                                );
                                                                        }
                                                                    }}
                                                                >
                                                                    {"Delete"}
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    )}
                </Table>
                <Pagination className="flex justify-end">
                    <PaginationContent>
                        <PaginationItem>
                            <Button
                                size="sm"
                                onClick={() => setCurrentPage(currentPage - 1)}
                                disabled={currentPage <= 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                        </PaginationItem>
                        <PaginationItem>
                            <div className="h-10 w-10 flex justify-center items-center">
                                {currentPage}
                                {"/"}
                                {Math.max(1, Math.ceil(scoreCount / 5))}
                            </div>
                        </PaginationItem>
                        <PaginationItem>
                            <Button
                                size="sm"
                                disabled={currentPage * 5 >= scoreCount}
                                onClick={() => setCurrentPage(currentPage + 1)}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>
            </DialogContent>
        </Dialog>
    );
}
