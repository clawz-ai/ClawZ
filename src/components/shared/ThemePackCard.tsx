import Tag from "../ui/Tag";
import { useT } from "../../lib/i18n";

interface ThemePackCardProps {
  emoji: string;
  name: string;
  desc: string;
  tags: string[];
  badge?: string;
  /** e.g. "2/3 skills ready" */
  skillStatus?: string;
  onClick?: () => void;
}

export default function ThemePackCard({
  emoji,
  name,
  desc,
  tags,
  badge,
  skillStatus,
  onClick,
}: ThemePackCardProps) {
  const t = useT();
  return (
    <div
      onClick={onClick}
      className="card-hover flex cursor-pointer flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-5"
    >
      <div className="flex items-start justify-between">
        <span className="text-[32px]">{emoji}</span>
        <div className="flex flex-col items-end gap-1">
          {badge && (
            <span className="rounded-md bg-[#EBF5FB] px-2 py-0.5 text-[11px] font-medium text-[var(--primary)]">
              {badge}
            </span>
          )}
          {skillStatus && (
            <span className="text-[10px] text-[var(--text-secondary)]">
              {skillStatus}
            </span>
          )}
        </div>
      </div>
      <h3 className="text-base font-semibold text-[var(--text-primary)]">
        {name}
      </h3>
      <p className="text-[13px] text-[var(--text-secondary)]">{desc}</p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </div>
      <div className="flex items-center justify-end">
        <span className="text-xs text-[var(--primary)]">
          {t("common.viewDetails")} &rarr;
        </span>
      </div>
    </div>
  );
}
