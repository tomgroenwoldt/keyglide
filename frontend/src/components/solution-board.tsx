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
import { Keycap } from "./keycap";
import { useEffect, useState } from "react";
import { useAppStore } from "@/store";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import { ChevronLeft, ChevronRight, Trash } from "lucide-react";
import { Pagination, PaginationContent, PaginationItem } from "./ui/pagination";
import { Scores } from "./scores";
import { TableSkeleton } from "./table-skeleton";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "./ui/tooltip";
import UserProfile from "./user-profile";

const PAGE_SIZE = 5;

interface RankedRow {
    id: number;
    user_id: string;
    keys: string[];
    place: number;
    hidden_today?: boolean;
}

export interface SolutionBoardProps {
    challengeId: number;
}

export function SolutionBoard(props: SolutionBoardProps) {
    const { user, supabase } = useAppStore();
    const [currentPage, setCurrentPage] = useState(1);
    const [filter, setFilter] = useState<"all" | "mine">("all");

    const [solutions, setSolutions] = useState<RankedRow[] | null>(null);
    const [solutionCount, setSolutionCount] = useState(0);

    const fetchSolutions = async () => {
        let query = supabase
            .from("ranked_solutions")
            .select("*")
            .eq("challenge_id", props.challengeId);
        let countQuery = supabase
            .from("ranked_solutions")
            .select("*", { count: "exact", head: true })
            .eq("challenge_id", props.challengeId);
        if (filter === "mine" && user) {
            query = query.eq("user_id", user.id);
            countQuery = countQuery.eq("user_id", user.id);
        }
        query = query.range(
            PAGE_SIZE * (currentPage - 1),
            PAGE_SIZE * currentPage - 1,
        );
        const [{ data }, { count }] = await Promise.all([query, countQuery]);
        setSolutions(
            (data ?? []).map((r) => ({
                id: r.id!,
                user_id: r.user_id!,
                keys: r.keys ?? [],
                place: r.place!,
                hidden_today: r.hidden_today ?? false,
            })),
        );
        setSolutionCount(count ?? 0);
    };

    useEffect(() => {
        fetchSolutions();

        const solutionChannel = supabase
            .channel(`solution-changes-${props.challengeId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "solutions" },
                fetchSolutions,
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "scores" },
                fetchSolutions,
            )
            .subscribe();
        return () => {
            supabase.removeChannel(solutionChannel);
        };
    }, [props.challengeId, currentPage, filter]);

    useEffect(() => {
        setCurrentPage(1);
    }, [props.challengeId, filter]);

    useEffect(() => {
        setFilter("all");
    }, [props.challengeId]);

    return (
        <>
            <div>
                <h1 className="text-2xl font-bold leading-tight tracking-tighter md:text-3xl lg:leading-[1.1]">
                    {"Solutions"}
                </h1>
                <p className="max-w-2xl pt-2 pb-2 text-foreground">
                    {`Explore solutions to this challenge ranked by efficiency based on the number of keystrokes. You can also view the users who have implemented each solution. Solutions will be visible one day after challenge release.`}
                </p>
            </div>
            {user && (
                <ButtonGroup className="mb-2">
                    <Button
                        variant={filter === "all" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setFilter("all")}
                    >
                        {"All Solutions"}
                    </Button>
                    <Button
                        variant={filter === "mine" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setFilter("mine")}
                    >
                        {"My Solutions"}
                    </Button>
                </ButtonGroup>
            )}
            <Table className="border rounded-lg">
                <TableCaption>
                    {"A list of the solutions of the challenge."}
                </TableCaption>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[50px] text-center">
                            {"Rank"}
                        </TableHead>
                        <TableHead className="w-[300px]">{"User"}</TableHead>
                        <TableHead>{"Sequence"}</TableHead>
                        <TableHead className="w-[50px]">
                            {"Keystrokes"}
                        </TableHead>
                        <TableHead className="w-[220px]">{"Used by"}</TableHead>
                    </TableRow>
                </TableHeader>
                {solutions === null ? (
                    <TableSkeleton
                        rows={5}
                        columns={5}
                        className="h-8 w-[150px]"
                    />
                ) : (
                    <TableBody>
                        {solutions.map((solution) => {
                            const keys = solution.keys.map((key, index) => (
                                <Keycap input={key} key={index} />
                            ));
                            const cell = solution.hidden_today ? (
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div className="inline-flex flex-wrap items-center gap-1 overflow-auto">
                                                {keys}
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>
                                                {
                                                    "This solution is hidden until tomorrow."
                                                }
                                            </p>
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            ) : (
                                <div className="inline-flex flex-wrap items-center gap-1 overflow-auto">
                                    {keys}
                                </div>
                            );
                            return (
                                <TableRow key={solution.id}>
                                    <TableCell className="font-semibold text-center">
                                        {solution.place}
                                    </TableCell>
                                    <TableCell>
                                        <UserProfile
                                            userId={solution.user_id}
                                        />
                                    </TableCell>
                                    <TableCell>{cell}</TableCell>
                                    <TableCell>
                                        {solution.keys.length}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex justify-between items-center">
                                            <Scores solutionId={solution.id} />
                                            {solution.user_id === user?.id && (
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
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
                                                                    "This action cannot be undone. This will permanently delete your solution and all scores connected to it."
                                                                }
                                                            </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                            <AlertDialogCancel>
                                                                {"Cancel"}
                                                            </AlertDialogCancel>
                                                            <AlertDialogAction
                                                                onClick={async () => {
                                                                    await supabase
                                                                        .from(
                                                                            "solutions",
                                                                        )
                                                                        .delete()
                                                                        .eq(
                                                                            "id",
                                                                            solution.id,
                                                                        );
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
                            {Math.max(1, Math.ceil(solutionCount / PAGE_SIZE))}
                        </div>
                    </PaginationItem>
                    <PaginationItem>
                        <Button
                            size="sm"
                            disabled={currentPage * PAGE_SIZE >= solutionCount}
                            onClick={() => setCurrentPage(currentPage + 1)}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </PaginationItem>
                </PaginationContent>
            </Pagination>
        </>
    );
}
