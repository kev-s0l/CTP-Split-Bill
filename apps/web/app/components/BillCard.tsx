import { Card, CardHeader, CardBody, CardFooter } from "./Card";

type BillCardProps = {
    restaurant: string;
    paidTo:string;
    partyCount: number;
    total: number;
    date: string;
 }

 export function BillCard({ restaurant, paidTo, partyCount, total, date }: BillCardProps){
    return(
        <Card>
            <CardHeader>
                <div className="">
                    <span className="">{restaraunt}</span>
                </div>
            </CardHeader>

            <CardBody>
                <div className="">
                    <p className=""> {paidTo} </p>
                    <p className=""> {partyCount} </p>
                    <p className=""> {total}</p>
                </div>
            </CardBody>

            <CardFooter>
                <div className="">
                    <span className=""> Date Created: {date}</span>
                </div>
            </CardFooter>
        </Card>
    );
 }
 
