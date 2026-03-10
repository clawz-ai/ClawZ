interface HeaderProps {
  title: string;
}

export default function Header({ title }: HeaderProps) {
  return (
    <header className="flex h-16 items-center border-b border-[var(--border)] px-8">
      <h1 className="font-display text-xl font-semibold text-[var(--text-primary)]">
        {title}
      </h1>
    </header>
  );
}
