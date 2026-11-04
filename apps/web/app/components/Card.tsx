type CardProps = {
    children: React.ReactNode;
}

export function Card({ children }: CardProps) {
    return (
        <div className="sb-card">
            {children}
        </div>
    );
}

export function CardHeader({ children }: CardProps){
    return <div className="sb-card__header"> {children} </div>;
}

export function CardBody({ children }: CardProps){
    return <div className="sb-card__body"> {children} </div>;
}

export function CardFooter({ children }: CardProps){
    return <div className="sb-card__footer"> {children} </div>;
}
