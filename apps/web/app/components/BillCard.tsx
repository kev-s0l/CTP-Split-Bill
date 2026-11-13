import type { ReactNode } from "react";
import { Card, CardHeader, CardContent, CardFooter, CardTitle } from "./ui/card";

export type BillCardProps = {
    restaurant: string;
    paidTo: string;
    partyCount: number;
    total: string;
    date: string;
    status?: ReactNode;
}


export function BillCard({ restaurant, paidTo, partyCount, total, date, status }: BillCardProps){
    return(
        <Card>
            <CardHeader>
                <div className="flex items-start justify-between gap-3">
                    <CardTitle>{restaurant}</CardTitle>
                    {status}
                </div>
            </CardHeader>

            <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                    <dt className="text-ink-muted">Paid to</dt>
                    <dd>{paidTo}</dd>
                    <dt className="text-ink-muted">People</dt>
                    <dd>{partyCount}</dd>
                    <dt className="text-ink-muted">Total</dt>
                    <dd className="text-lg font-semibold tabular-nums">{total}</dd>
                </dl>
            </CardContent>

            <CardFooter className="border-t text-sm text-ink-muted">
                <span>Date Created: {date}</span>
            </CardFooter>
        </Card>
    );
}
