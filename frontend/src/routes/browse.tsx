import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAppStore } from "@/store";
import { Database } from "@/database.types";
import { Button } from "@/components/ui/button";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
} from "@/components/ui/pagination";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ChallengeList, ChallengeRow } from "@/components/challenge-list";
import ScoreCalendar from "@/components/calendar";

type Filter = Database["public"]["Enums"]["challenge_filter"];
type Status = Database["public"]["Enums"]["challenge_status"];
type Extension = Database["public"]["Enums"]["prog_extension"];

const PAGE_SIZE = 10;
const EXTENSIONS: Extension[] = [
    "js",
    "ts",
    "py",
    "cpp",
    "java",
    "rb",
    "go",
    "rs",
    "php",
    "swift",
];

export function Browse() {
    const { supabase, user } = useAppStore();
    const navigate = useNavigate();

    const [page, setPage] = useState(1);
    const [filter, setFilter] = useState<Filter>("most_recent");
    const [status, setStatus] = useState<Status>("all");
    const [extension, setExtension] = useState<Extension | "all">("all");

    const [rows, setRows] = useState<ChallengeRow[] | null>(null);
    const [totalCount, setTotalCount] = useState(0);

    const fetchPage = async () => {
        setRows(null);
        const args = {
            filter_type: filter,
            status_filter: status,
            extension_filter: extension === "all" ? undefined : extension,
        };
        const [dataRes, countRes] = await Promise.all([
            supabase
                .rpc("get_challenges", args)
                .range(PAGE_SIZE * (page - 1), PAGE_SIZE * page - 1),
            supabase.rpc("get_challenges", args, { count: "exact" }),
        ]);
        setRows((dataRes.data ?? []) as ChallengeRow[]);
        setTotalCount(countRes.count ?? 0);
    };

    useEffect(() => {
        fetchPage();
    }, [page, filter, status, extension]);

    useEffect(() => {
        setPage(1);
    }, [filter, status, extension]);

    // The file contents are not in the list payload; fetch them on demand.
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

    return (
        <div className="container-wrapper flex-auto">
            <div className="container py-6 flex flex-col gap-4">
                <div className="flex flex-wrap justify-between items-end gap-3">
                    <div>
                        <h1 className="text-2xl font-bold leading-tight tracking-tighter md:text-3xl lg:leading-[1.1]">
                            {"Browse challenges"}
                        </h1>
                        <p className="max-w-2xl pt-2 pb-2 text-foreground">
                            {
                                "Every challenge, past and upcoming. Queued ones are waiting on votes — the highest voted becomes the next daily challenge."
                            }
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {user && (
                            <Button onClick={() => navigate("/submit")}>
                                {"Submit a challenge"}
                            </Button>
                        )}
                        <Select
                            value={status}
                            onValueChange={(v) => setStatus(v as Status)}
                        >
                            <SelectTrigger className="w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{"All"}</SelectItem>
                                <SelectItem value="queued">
                                    {"Queued"}
                                </SelectItem>
                                <SelectItem value="live">{"Today"}</SelectItem>
                                <SelectItem value="past">{"Past"}</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select
                            value={filter}
                            onValueChange={(v) => setFilter(v as Filter)}
                        >
                            <SelectTrigger className="w-44">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="most_recent">
                                    {"Most recent"}
                                </SelectItem>
                                <SelectItem value="most_played">
                                    {"Most played"}
                                </SelectItem>
                                <SelectItem value="most_liked">
                                    {"Most liked"}
                                </SelectItem>
                                <SelectItem value="played_by_me">
                                    {"Played by me"}
                                </SelectItem>
                                <SelectItem value="not_played_by_me">
                                    {"Not played by me"}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <Select
                            value={extension}
                            onValueChange={(v) =>
                                setExtension(v as Extension | "all")
                            }
                        >
                            <SelectTrigger className="w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">
                                    {"Any language"}
                                </SelectItem>
                                {EXTENSIONS.map((e) => (
                                    <SelectItem key={e} value={e}>
                                        {e}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row gap-6 items-start">
                    <div className="flex-1 min-w-0 w-full">
                        <ChallengeList
                            rows={rows}
                            showAuthor={true}
                            showVotes={true}
                            showDelete={false}
                            caption="Every challenge, queued and published."
                            onPreview={handlePreview}
                        />
                    </div>
                    {/* Only renders for a signed-in user. */}
                    <ScoreCalendar />
                </div>

                <Pagination className="flex justify-end">
                    <PaginationContent>
                        <PaginationItem>
                            <Button
                                size="sm"
                                onClick={() => setPage(page - 1)}
                                disabled={page <= 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                        </PaginationItem>
                        <PaginationItem>
                            <div className="h-10 w-10 flex justify-center items-center">
                                {page}
                                {"/"}
                                {Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}
                            </div>
                        </PaginationItem>
                        <PaginationItem>
                            <Button
                                size="sm"
                                disabled={page * PAGE_SIZE >= totalCount}
                                onClick={() => setPage(page + 1)}
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
