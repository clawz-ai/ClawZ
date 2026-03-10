import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  LayoutDashboard,
  Box,
  Bot,
  Cpu,
  Radio,
  ScrollText,
  BarChart3,
  Settings,
  Loader2,
} from "lucide-react";
import { APP_VERSION, VERSION_DISPLAY } from "../../lib/buildInfo";
import { open } from "@tauri-apps/plugin-shell";
import NavItem from "./NavItem";
import { isTauriEnv } from "../../lib/env";
import { appLog } from "../../lib/tauri";
import { useT } from "../../lib/i18n";
import logoIcon from "../../assets/logo-icon.png";

const GITHUB_REPO = "clawz-ai/ClawZ";

const navItems = [
  { path: "/", labelKey: "nav.home", icon: LayoutDashboard },
  { path: "/workshop", labelKey: "nav.workshop", icon: Box },
  { path: "/agents", labelKey: "nav.agents", icon: Bot },
  { path: "/models", labelKey: "nav.models", icon: Cpu },
  { path: "/channels", labelKey: "nav.channels", icon: Radio },
  { path: "/cost", labelKey: "nav.cost", icon: BarChart3 },
  { path: "/logs", labelKey: "nav.logs", icon: ScrollText },
  { path: "/settings", labelKey: "nav.settings", icon: Settings },
];

type UpdateStatus = "idle" | "checking" | "latest" | "available" | "error";

function compareVersions(current: string, latest: string): number {
  const a = current.split(".").map(Number);
  const b = latest.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] || 0) - (a[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [latestVersion, setLatestVersion] = useState("");

  const [updateError, setUpdateError] = useState("");

  const checkForUpdate = async () => {
    setUpdateStatus("checking");
    setUpdateError("");
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      );
      if (res.status === 404) {
        appLog("info", "[checkForUpdate] No release found (404)");
        setUpdateStatus("latest");
        return;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const msg = `GitHub API ${res.status}: ${body.slice(0, 200)}`;
        appLog("error", `[checkForUpdate] ${msg}`);
        setUpdateError(msg);
        setUpdateStatus("error");
        return;
      }
      const data = await res.json();
      const tag: string = data.tag_name || "";
      if (!tag) {
        const msg = "GitHub API returned no tag_name, possibly no Release yet";
        appLog("warn", `[checkForUpdate] ${msg}`);
        setUpdateError(msg);
        setUpdateStatus("error");
        return;
      }
      const remote = tag.replace(/^v/, "");
      setLatestVersion(remote);
      setUpdateStatus(compareVersions(APP_VERSION, remote) > 0 ? "available" : "latest");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      appLog("error", `[checkForUpdate] network error: ${msg}`);
      setUpdateError(msg);
      setUpdateStatus("error");
    }
  };

  const t = useT();

  const updateLabel = (() => {
    switch (updateStatus) {
      case "checking": return null;
      case "latest": return t("sidebar.latest");
      case "available": return t("sidebar.newVersion", { version: latestVersion });
      case "error": return t("sidebar.checkFailed");
      default: return t("sidebar.checkUpdate");
    }
  })();

  const updateColor = updateStatus === "available"
    ? "text-[var(--success)]"
    : updateStatus === "error"
      ? "text-[var(--danger)]"
      : updateStatus === "latest"
        ? "text-[#566573]"
        : "text-[var(--primary-light)]";

  const canClick = updateStatus !== "checking" && updateStatus !== "latest";

  const handleClick = () => {
    if (updateStatus === "available") {
      const url = `https://github.com/${GITHUB_REPO}/releases/latest`;
      if (isTauriEnv()) {
        open(url).catch(() => window.open(url, "_blank"));
      } else {
        window.open(url, "_blank");
      }
    } else if (canClick) {
      checkForUpdate();
    }
  };

  return (
    <aside className="flex w-60 flex-col bg-[var(--bg-sidebar)] px-4 py-5">
      {/* Logo */}
      <div className="flex items-center gap-2.5 pb-5">
        <img src={logoIcon} alt="ClawZ" className="h-7 w-7" />
        <span className="text-lg font-bold text-[var(--text-white)]">
          ClawZ
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map((item) => (
          <NavItem
            key={item.path}
            icon={item.icon}
            label={t(item.labelKey)}
            active={location.pathname === item.path}
            onClick={() => navigate(item.path)}
          />
        ))}
      </nav>

      {/* Bottom */}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-[#566573]">
          ClawZ {VERSION_DISPLAY}
        </span>
        <span
          onClick={handleClick}
          title={updateError || undefined}
          className={`text-[11px] ${updateColor} ${canClick ? "cursor-pointer hover:underline" : ""} flex items-center gap-1`}
        >
          {updateStatus === "checking" && <Loader2 size={10} className="animate-spin" />}
          {updateLabel}
        </span>
      </div>
    </aside>
  );
}
