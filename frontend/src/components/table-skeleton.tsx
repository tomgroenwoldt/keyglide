import { Skeleton } from "./ui/skeleton";
import { TableBody, TableCell, TableRow } from "./ui/table";

export interface TableSkeletonProps {
    className: string;
    columns: number;
    rows: number;
}

export function TableSkeleton(props: TableSkeletonProps): JSX.Element {
    return (
        <TableBody>
            {[...Array(props.rows)].map((_, index) => (
                <TableRow key={index}>
                    {[...Array(props.columns)].map((_, index) => (
                        <TableCell key={index}>
                            <Skeleton className={props.className} />
                        </TableCell>
                    ))}
                </TableRow>
            ))}
        </TableBody>
    );
}
