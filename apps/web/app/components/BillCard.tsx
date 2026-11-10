import { Card, CardHeader, CardContent, CardFooter, CardTitle } from "./ui/card";

type BillCardProps = {
    restaurant: string;
    paidTo: string;
    partyCount: number;
    total: string;
    date: string;
}

export function BillCard({ restaurant, paidTo, partyCount, total, date }: BillCardProps){
    return(
        <Card>
            <CardHeader>
                <CardTitle>{restaurant}</CardTitle>
            </CardHeader>

            <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                    <dt className="text-ink-muted">Paid to</dt>
                    <dd>{paidTo}</dd>
                    <dt className="text-ink-muted">People</dt>
                    <dd>{partyCount}</dd>
                    <dt className="text-ink-muted">You owe</dt>
                    <dd className="text-lg font-semibold tabular-nums">{total}</dd>
                </dl>
            </CardContent>

            <CardFooter className="border-t text-sm text-ink-muted">
                <span>Date Created: {date}</span>
            </CardFooter>
        </Card>
    );
}
