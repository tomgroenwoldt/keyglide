import { Check, Clock, Play, Search, Trash2 } from "lucide-react";
import { useState } from "react";

import { Database } from "@/database.types";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/table-skeleton";
import { ChallengeLikes } from "@/components/challenge-likes";
import { ChallengePreview } from "@/components/challenge-preview";

type Extension = Database["public"]["Enums"]["prog_extension"];

/** A row of `get_challenges`, plus the file contents once previewed. */
export interface ChallengeRow {
    id: number;
    /** `null` while the challenge is queued for votes. */
    date: string | null;
    title: string | null;
    description: string | null;
    extension: Extension;
    created_at: string;
    author_name: string | null;
    up_count: number;
    down_count: number;
    play_count: number;
    /** Position in the voting queue; only set while queued. */
    queue_place: number | null;
    start?: string;
    goal?: string;
}

interface ChallengeListProps {
    rows: ChallengeRow[] | null;
    showAuthor: boolean;
    showVotes: boolean;
    showDelete: boolean;
    caption: string;
    onDelete?: (id: number) => Promise<void> | void;
    onPreview: (row: ChallengeRow) => Promise<void> | void;
}

function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
}

/** Queued challenges can still be withdrawn; scheduled ones are committed. */
function isQueued(row: ChallengeRow): boolean {
    return row.date === null;
}

function Status({ row }: { row: ChallengeRow }) {
    if (isQueued(row)) {
        return (
            <span className="text-muted-foreground inline-flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {row.queue_place ? `Queued #${row.queue_place}` : "Queued"}
            </span>
        );
    }
    if (row.date === todayUtc()) {
        return (
            <span className="text-primary inline-flex items-center gap-1">
                <Check className="h-4 w-4" />
                {"Today"}
            </span>
        );
    }
    return <span>{row.date}</span>;
}

export function ChallengeList(props: ChallengeListProps) {
    const [previewRow, setPreviewRow] = useState<ChallengeRow | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);

    const openPreview = async (row: ChallengeRow) => {
        await props.onPreview(row);
        setPreviewRow(row);
        setPreviewOpen(true);
    };

    const columns = 6 + (props.showAuthor ? 1 : 0) + (props.showVotes ? 2 : 0);

    return (
        <>
            <ChallengePreview
                open={previewOpen}
                onOpenChange={setPreviewOpen}
                start={previewRow?.start ?? ""}
                goal={previewRow?.goal ?? ""}
                extension={previewRow?.extension ?? "unknown"}
                title={previewRow?.title}
            />

            <Table className="border rounded-lg">
                <TableCaption>{props.caption}</TableCaption>
                <TableHeader>
                    <TableRow>
                        <TableHead>{"Title"}</TableHead>
                        {props.showAuthor && <TableHead>{"Author"}</TableHead>}
                        <TableHead className="w-[80px]">{"Ext"}</TableHead>
                        <TableHead className="w-[90px]">{"Plays"}</TableHead>
                        {props.showVotes && (
                            <>
                                <TableHead className="w-[70px]">
                                    {"Up"}
                                </TableHead>
                                <TableHead className="w-[70px]">
                                    {"Down"}
                                </TableHead>
                            </>
                        )}
                        <TableHead className="w-[150px]">{"Status"}</TableHead>
                        <TableHead className="w-[280px]">{"Actions"}</TableHead>
                    </TableRow>
                </TableHeader>
                {props.rows === null ? (
                    <TableSkeleton
                        className="h-8 w-[150px]"
                        rows={5}
                        columns={columns}
                    />
                ) : (
                    <TableBody>
                        {props.rows.map((row) => (
                            <TableRow key={row.id}>
                                <TableCell>
                                    {row.title ?? (
                                        <span className="text-muted-foreground">
                                            {"—"}
                                        </span>
                                    )}
                                </TableCell>
                                {props.showAuthor && (
                                    <TableCell>
                                        {row.author_name ?? "—"}
                                    </TableCell>
                                )}
                                <TableCell>{row.extension}</TableCell>
                                <TableCell>{row.play_count}</TableCell>
                                {props.showVotes && (
                                    <>
                                        <TableCell>{row.up_count}</TableCell>
                                        <TableCell>{row.down_count}</TableCell>
                                    </>
                                )}
                                <TableCell>
                                    <Status row={row} />
                                </TableCell>
                                <TableCell>
                                    <div className="flex gap-2 items-center">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => openPreview(row)}
                                        >
                                            <Search />
                                            <span>{"Preview"}</span>
                                        </Button>
                                        {props.showVotes && (
                                            <ChallengeLikes
                                                challengeId={row.id}
                                            />
                                        )}
                                        <Button
                                            asChild
                                            variant="outline"
                                            size="sm"
                                        >
                                            <a href={`/c/${row.id}`}>
                                                <Play />
                                                <span>{"Play"}</span>
                                            </a>
                                        </Button>
                                        {props.showDelete && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled={!isQueued(row)}
                                                onClick={() =>
                                                    props.onDelete?.(row.id)
                                                }
                                            >
                                                <Trash2 />
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                )}
            </Table>
        </>
    );
}
