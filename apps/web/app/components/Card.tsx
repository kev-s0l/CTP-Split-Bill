type CardProps = {
    children: React.ReactNode;
}

export function Card({ children }: CardProps) {
    return (
        <div className="">
            {children}
        </div>
    );
}

export function CardHeader({ children }: CardProps){
    return <div className=""> {children} </div>;
}

export function CardBody({ children }: CardProps){
    return <div className=""> {children} </div>;
}

export function CardFooter({ children }: CardProps){
    return <div className=""> {children} </div>;
}
