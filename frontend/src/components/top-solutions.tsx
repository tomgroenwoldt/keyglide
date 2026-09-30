import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import UserProfile from "./user-profile";
import { useState } from "react";
import { Search, Zap } from "lucide-react";

export interface TopSolutionsProps {
    userId: string;
    fullName?: string;
    username: string;
    solutionDates: string[];
    period: string;
}

export function TopSolutions(props: TopSolutionsProps): JSX.Element {
    const [open, setOpen] = useState(false);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" onClick={() => setOpen(true)}>
                    <Zap />
                    <span className="w-[80px]">
                        {`${props.solutionDates.length} ${props.solutionDates.length > 1 ? "Solutions" : "Solution"}`}
                    </span>
                </Button>
            </DialogTrigger>
            <DialogContent className="!max-w-fit">
                <DialogHeader>
                    <DialogTitle>
                        <UserProfile userId={props.userId} />
                    </DialogTitle>
                    <DialogDescription>
                        {`This ${props.period}’s top-ranked #1 solutions by ${props.fullName ?? props.username}.`}
                    </DialogDescription>
                </DialogHeader>
                <Table className="border rounded-lg">
                    <TableCaption>
                        {`Top solutions submitted by ${props.fullName ?? props.username}.`}
                    </TableCaption>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[200px]">
                                {"Challenge Date"}
                            </TableHead>
                            <TableHead className="text-right">
                                {"Inspect"}
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {props.solutionDates.map((date) => {
                            return (
                                <TableRow key={date}>
                                    <TableCell>{date}</TableCell>
                                    <TableCell className="text-right">
                                        <Button asChild variant="outline">
                                            <a
                                                href={`/${date}`}
                                                target="_blank"
                                            >
                                                <Search />
                                                <span>{"Show"}</span>
                                            </a>
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </DialogContent>
        </Dialog>
    );
}
