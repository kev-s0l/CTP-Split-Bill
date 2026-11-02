import { Card, CardHeader, CardBody, CardFooter } from "./Card";

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
                <span className="text-base font-semibold">{restaurant}</span>
            </CardHeader>

            <CardBody>
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                    <dt className="text-ink-muted">Paid to</dt>
                    <dd>{paidTo}</dd>
                    <dt className="text-ink-muted">People</dt>
                    <dd>{partyCount}</dd>
                    <dt className="text-ink-muted">You owe</dt>
                    <dd className="text-lg font-semibold tabular-nums">{total}</dd>
                </dl>
            </CardBody>

            <CardFooter>
                <span>Date Created: {date}</span>
            </CardFooter>
        </Card>
    );
}
