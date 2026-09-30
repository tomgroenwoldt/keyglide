import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import { useAppStore } from "@/store";
import { QueryData } from "@supabase/supabase-js";
import { Button } from "../components/ui/button";
import { ChevronLeft, ChevronRight, InfoIcon } from "lucide-react";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
} from "../components/ui/pagination";
import { TableSkeleton } from "../components/table-skeleton";
import { TopSolutions } from "@/components/top-solutions";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import UserProfile from "@/components/user-profile";

type LeaderboardPeriod = "week" | "month" | "year";

export function LeaderBoard() {
    const { supabase } = useAppStore();
    const [currentPage, setCurrentPage] = useState(1);
    const [period, setPeriod] = useState<LeaderboardPeriod>("week");

    // Create typed query.
    const solutionQuery = supabase
        .rpc("get_leaderboard", { period })
        .select("*")
        .range(20 * (currentPage - 1), 20 * currentPage - 1);
    const solutionCountQuery = supabase.rpc(
        "get_leaderboard",
        {
            period,
        },
        { count: "exact" },
    );
    type LeaderBoardQuery = QueryData<typeof solutionQuery>;

    const [leaderBoard, setLeaderBoard] = useState<LeaderBoardQuery | null>(
        null,
    );
    const [leaderBoardCount, setLeaderBoardCount] = useState(0);

    useEffect(() => {
        solutionCountQuery.then((res) => setLeaderBoardCount(res.count ?? 0));
        solutionQuery.then((res) => setLeaderBoard(res.data));
    }, [currentPage, period]);

    return (
        <div className="container-wrapper flex-auto">
            <div className="container py-6">
                <div className="flex justify-between items-center">
                    <div>
                        <h1 className="text-2xl font-bold leading-tight tracking-tighter md:text-3xl lg:leading-[1.1]">
                            {"Leaderboard"}
                        </h1>
                        <p className="max-w-2xl pt-2 pb-2 text-foreground">
                            {`This leaderboard displays top users for the selected period: weekly, monthly, or yearly (all in UTC). Rankings are based on the number of challenges where users submitted the best solution. The leaderboard resets automatically at the start of each period.`}
                        </p>
                    </div>
                    <Select
                        value={period}
                        onValueChange={(val) =>
                            setPeriod(val as LeaderboardPeriod)
                        }
                    >
                        <SelectTrigger className="w-40">
                            <SelectValue placeholder="Select period" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="week">Weekly</SelectItem>
                            <SelectItem value="month">Monthly</SelectItem>
                            <SelectItem value="year">Yearly</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <Table className="border rounded-lg">
                    <TableCaption>{`The ${period}ly leaderboard.`}</TableCaption>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px] text-center">
                                {"Rank"}
                            </TableHead>
                            <TableHead>{"User"}</TableHead>
                            <TableHead className="flex gap-1 justify-end items-center">
                                {"Challenges with best solution"}
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <InfoIcon className="h-4 w-4" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {
                                                "Only one top solution for each challenge is taken into account."
                                            }
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    {leaderBoard === null ? (
                        <TableSkeleton
                            className="h-8 w-[150px]"
                            rows={5}
                            columns={4}
                        />
                    ) : (
                        <TableBody>
                            {leaderBoard.map((profile) => {
                                return (
                                    <TableRow key={profile.user_id}>
                                        <TableCell className="font-semibold text-center">
                                            {profile.rank}
                                        </TableCell>
                                        <TableCell>
                                            <UserProfile
                                                userId={profile.user_id}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap justify-end items-center gap-1 overflow-auto">
                                                <TopSolutions
                                                    userId={profile.user_id}
                                                    fullName={profile.full_name}
                                                    username={profile.user_name}
                                                    solutionDates={
                                                        profile.best_dates
                                                    }
                                                    period={period}
                                                />
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
                                {Math.max(1, Math.ceil(leaderBoardCount / 20))}
                            </div>
                        </PaginationItem>
                        <PaginationItem>
                            <Button
                                size="sm"
                                disabled={currentPage * 20 >= leaderBoardCount}
                                onClick={() => setCurrentPage(currentPage + 1)}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>
            </div>
        </div>
    );
}
