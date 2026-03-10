interface TagProps {
  children: React.ReactNode;
  className?: string;
}

export default function Tag({ children, className = "" }: TagProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-[#EBF5FB] px-2.5 py-1 text-xs font-medium text-[var(--primary)] ${className}`}
    >
      {children}
    </span>
  );
}
