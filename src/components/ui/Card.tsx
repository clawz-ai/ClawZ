interface CardProps {
  title?: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function Card({
  title,
  description,
  children,
  className = "",
  onClick,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 ${onClick ? "cursor-pointer hover:shadow-md" : ""} ${className}`}
    >
      {title && (
        <h3 className="text-base font-semibold text-[var(--text-primary)]">
          {title}
        </h3>
      )}
      {description && (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {description}
        </p>
      )}
      {children}
    </div>
  );
}
