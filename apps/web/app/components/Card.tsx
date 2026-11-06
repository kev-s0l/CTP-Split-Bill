type CardProps = {
    children: React.ReactNode;
}

export function Card({ children }: CardProps) {
    return (
        <div className="overflow-hidden rounded-card border border-line bg-surface text-ink shadow-sm">
            {children}
        </div>
    );
}

export function CardHeader({ children }: CardProps){
    return <div className="border-b border-line px-5 py-4">{children}</div>;
}

export function CardBody({ children }: CardProps){
    return <div className="px-5 py-4">{children}</div>;
}

export function CardFooter({ children }: CardProps){
    return <div className="border-t border-line px-5 py-3 text-sm text-ink-muted">{children}</div>;
}
