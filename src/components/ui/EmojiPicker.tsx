import { useState, useRef, useEffect } from "react";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Common",
    emojis: [
      "\u2728", "\uD83E\uDD16", "\uD83D\uDC7E", "\uD83D\uDE80", "\uD83C\uDF1F", "\uD83D\uDD25", "\uD83D\uDCA1", "\uD83C\uDFAF",
      "\uD83D\uDCDA", "\uD83D\uDCAC", "\uD83D\uDEE0\uFE0F", "\uD83C\uDF10", "\uD83D\uDD12", "\uD83C\uDFA8", "\uD83C\uDFB5", "\uD83D\uDCAB",
      "\uD83C\uDF89", "\uD83D\uDC8E", "\uD83D\uDD2E", "\uD83E\uDDE0", "\uD83E\uDDEA", "\uD83D\uDCA0", "\uD83D\uDCCC", "\uD83C\uDF1A",
    ],
  },
  {
    label: "People",
    emojis: [
      "\uD83D\uDE00", "\uD83D\uDE0E", "\uD83E\uDD13", "\uD83E\uDD14", "\uD83D\uDE0D", "\uD83D\uDE02", "\uD83E\uDD29", "\uD83E\uDD2F",
      "\uD83D\uDE4B", "\uD83D\uDC68\u200D\uD83D\uDCBB", "\uD83D\uDC69\u200D\uD83D\uDCBB", "\uD83E\uDDD1\u200D\uD83D\uDD2C", "\uD83D\uDC68\u200D\uD83C\uDFEB", "\uD83E\uDDD9", "\uD83E\uDDB8", "\uD83E\uDDD1\u200D\uD83C\uDFA8",
      "\uD83D\uDC77", "\uD83D\uDC68\u200D\uD83C\uDF73", "\uD83D\uDC68\u200D\uD83D\uDE80", "\uD83D\uDC69\u200D\uD83D\uDD2C", "\uD83E\uDDD1\u200D\uD83D\uDCBC", "\uD83E\uDDD1\u200D\uD83C\uDFED", "\uD83E\uDDD1\u200D\u2695\uFE0F", "\uD83E\uDD77",
    ],
  },
  {
    label: "Animals",
    emojis: [
      "\uD83D\uDC31", "\uD83D\uDC36", "\uD83E\uDD8A", "\uD83D\uDC3B", "\uD83D\uDC3C", "\uD83E\uDD89", "\uD83E\uDD85", "\uD83D\uDC1D",
      "\uD83D\uDC19", "\uD83E\uDD8B", "\uD83D\uDC22", "\uD83D\uDC0D", "\uD83E\uDD96", "\uD83E\uDD84", "\uD83D\uDC09", "\uD83D\uDC27",
      "\uD83D\uDC26", "\uD83D\uDC3A", "\uD83E\uDD81", "\uD83D\uDC2F", "\uD83D\uDC33", "\uD83D\uDC20", "\uD83E\uDD9E", "\uD83D\uDC0C",
    ],
  },
  {
    label: "Nature",
    emojis: [
      "\uD83C\uDF1E", "\uD83C\uDF19", "\u26A1", "\uD83C\uDF08", "\u2744\uFE0F", "\uD83C\uDF3F", "\uD83C\uDF3B", "\uD83C\uDF3A",
      "\uD83C\uDF0A", "\uD83C\uDF0B", "\u26F0\uFE0F", "\uD83C\uDF0C", "\uD83C\uDF43", "\uD83C\uDF38", "\uD83C\uDF40", "\uD83C\uDF35",
      "\uD83C\uDF34", "\uD83C\uDF3E", "\uD83C\uDF1C", "\uD83C\uDF24\uFE0F", "\u2B50", "\uD83C\uDF0D", "\uD83C\uDF2A\uFE0F", "\uD83C\uDF0E",
    ],
  },
  {
    label: "Food",
    emojis: [
      "\uD83C\uDF55", "\uD83C\uDF54", "\uD83C\uDF63", "\uD83C\uDF70", "\uD83C\uDF7A", "\u2615", "\uD83C\uDF75", "\uD83E\uDD64",
      "\uD83C\uDF4E", "\uD83C\uDF53", "\uD83C\uDF47", "\uD83C\uDF4A", "\uD83C\uDF52", "\uD83E\uDD51", "\uD83C\uDF69", "\uD83C\uDF66",
      "\uD83C\uDF82", "\uD83C\uDF6A", "\uD83C\uDF6B", "\uD83C\uDF6D", "\uD83E\uDD6E", "\uD83C\uDF5C", "\uD83C\uDF73", "\uD83E\uDD5A",
    ],
  },
  {
    label: "Objects",
    emojis: [
      "\u2699\uFE0F", "\uD83D\uDCBB", "\uD83D\uDCF1", "\uD83C\uDF93", "\uD83D\uDCC8", "\uD83D\uDCC5", "\uD83D\uDCE7", "\uD83D\uDCCE",
      "\uD83D\uDD0D", "\uD83D\uDCA3", "\uD83C\uDFC6", "\uD83C\uDF81", "\uD83C\uDFAD", "\uD83C\uDFAE", "\uD83E\uDDE9", "\uD83D\uDCF7",
      "\uD83C\uDFA5", "\uD83D\uDD2D", "\uD83D\uDD2C", "\uD83D\uDCE1", "\uD83D\uDEF0\uFE0F", "\uD83D\uDD0B", "\uD83D\uDCBE", "\uD83D\uDDA5\uFE0F",
    ],
  },
  {
    label: "Symbols",
    emojis: [
      "\u2764\uFE0F", "\uD83D\uDC9C", "\uD83D\uDC99", "\uD83D\uDC9A", "\uD83D\uDC9B", "\uD83E\uDDE1", "\uD83D\uDDA4", "\uD83E\uDD0D",
      "\u2705", "\u274C", "\u26A0\uFE0F", "\u267B\uFE0F", "\uD83D\uDD36", "\uD83D\uDD35", "\uD83D\uDFE2", "\uD83D\uDFE3",
      "\u2B55", "\uD83D\uDCAF", "\u2757", "\u2753", "\uD83C\uDD95", "\uD83C\uDD99", "\u267E\uFE0F", "\uD83C\uDFF4",
    ],
  },
];

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  placeholder?: string;
}

export default function EmojiPicker({ value, onChange, placeholder = "\u2728" }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-12 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-lg transition-colors hover:border-[var(--primary)] focus:border-[var(--primary)] focus:outline-none"
      >
        {value || <span className="opacity-40">{placeholder}</span>}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 flex max-h-72 w-72 flex-col gap-2 overflow-y-auto overscroll-contain rounded-xl border border-[var(--border)] bg-[var(--bg-main)] p-3 shadow-lg">
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label}>
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                {group.label}
              </span>
              <div className="flex flex-wrap gap-0.5">
                {group.emojis.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => {
                      onChange(em);
                      setOpen(false);
                    }}
                    className={`flex h-8 w-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-[var(--primary)]/10 ${
                      value === em ? "bg-[var(--primary)]/15 ring-1 ring-[var(--primary)]" : ""
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
