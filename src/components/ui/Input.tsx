import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface InputProps {
  label?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  type?: string;
  className?: string;
}

export default function Input({
  label,
  placeholder = "",
  value,
  onChange,
  type = "text",
  className = "",
}: InputProps) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label className="text-xs font-medium text-[var(--text-secondary)]">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          type={isPassword && showPassword ? "text" : type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className={`w-full rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--primary)] ${isPassword ? "pr-10" : ""}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
