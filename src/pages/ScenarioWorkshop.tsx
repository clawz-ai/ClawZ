import { useState, useEffect, useMemo } from "react";
import { Search, Upload, ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { isTauriEnv } from "../lib/env";
import Header from "../components/layout/Header";
import ThemePackCard from "../components/shared/ThemePackCard";
import ThemePackDetail from "./ThemePackDetail";
import MultiAgentDetail from "./MultiAgentDetail";
import { listSkills } from "../lib/tauri";
import {
  isMultiAgent,
  useLocalizedScenarios,
  useLocalizedTags,
} from "../lib/scenarioTemplates";
import type { ScenarioPackage } from "../lib/scenarioTemplates";
import { useSettingsStore } from "../stores/settingsStore";
import { useT } from "../lib/i18n";

/** Estimated monthly cost range per scenario (USD). UI-only metadata. */
const COST_RANGES: Record<string, [number, number]> = {
  default: [0.7, 1.5],
  morning: [1.5, 3],
  email: [2, 5],
  writer: [2, 4.5],
  ops: [1.5, 3.5],
  debate: [1.5, 4],
};

/** Recommended model per scenario. UI-only metadata. */
const RECOMMENDED_MODELS: Record<string, string> = {
  default: "Claude Sonnet",
  morning: "DeepSeek Chat",
  email: "Claude Sonnet",
  writer: "Claude Sonnet",
  ops: "DeepSeek Chat",
  debate: "Claude Sonnet",
};

function formatCostRange(
  range: [number, number],
  currency: "USD" | "CNY",
  exchangeRate: number,
  perMonth: string,
): string {
  const m = currency === "CNY" ? exchangeRate : 1;
  const symbol = currency === "CNY" ? "\u00A5" : "$";
  const lo = Math.round(range[0] * m);
  const hi = Math.round(range[1] * m);
  return `${symbol}${lo}-${hi}${perMonth}`;
}

const PUBLISH_URL =
  "https://github.com/clawz-ai/scenarios/issues/new?template=submit-scenario.yml";

export default function ScenarioWorkshop() {
  const t = useT();
  const localizedScenarios = useLocalizedScenarios();
  const allTags = useLocalizedTags();
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Reverse map: templateId -> agentId (derived from settingsStore.appliedScenarios)
  const appliedScenarios = useSettingsStore((s) => s.appliedScenarios);
  const appliedMap: Record<string, string> = {};
  for (const [agentId, templateId] of Object.entries(appliedScenarios)) {
    if (!appliedMap[templateId]) appliedMap[templateId] = agentId;
  }
  // Set of skill names that are ready on this system
  const [readySkillNames, setReadySkillNames] = useState<Set<string>>(
    new Set(),
  );
  const [selectedScenario, setSelectedScenario] =
    useState<ScenarioPackage | null>(null);
  const currency = useSettingsStore((s) => s.currency);
  const exchangeRate = useSettingsStore((s) => s.exchangeRate);

  useEffect(() => {
    listSkills()
      .then((skills) => {
        setReadySkillNames(
          new Set(skills.filter((s) => s.ready).map((s) => s.name)),
        );
      })
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => localizedScenarios.filter((scenario) => {
    if (activeTag && !scenario.tags.includes(activeTag)) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (
        !scenario.name.toLowerCase().includes(q) &&
        !scenario.description.toLowerCase().includes(q) &&
        !scenario.tags.some((tag) => tag.toLowerCase().includes(q))
      )
        return false;
    }
    return true;
  }), [localizedScenarios, activeTag, searchQuery]);

  return (
    <div className="flex h-full flex-col">
      <Header title={t("workshop.title")} />

      <div className="flex flex-1 flex-col gap-5 overflow-auto p-6">
        {/* Search + Publish */}
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center gap-2.5 rounded-[10px] border border-[var(--border)] bg-[var(--bg-main)] px-4 py-2.5">
            <Search size={18} className="text-[var(--text-secondary)]" />
            <input
              type="text"
              placeholder={t("workshop.search")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
            />
          </div>
          <button
            onClick={() => {
              if (isTauriEnv()) {
                open(PUBLISH_URL).catch(() => window.open(PUBLISH_URL, "_blank"));
              } else {
                window.open(PUBLISH_URL, "_blank");
              }
            }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-main)] px-3 py-2.5 text-[13px] text-[var(--text-secondary)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
          >
            <Upload size={14} />
            {t("workshop.publish")}
            <ExternalLink size={11} className="opacity-50" />
          </button>
        </div>

        {/* Tag filters */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveTag(null)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
              activeTag === null
                ? "bg-[var(--primary)] text-white"
                : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--primary)]"
            }`}
          >
            {t("workshop.catAll")}
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                activeTag === tag
                  ? "bg-[var(--primary)] text-white"
                  : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--primary)]"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Card Grid */}
        <div className="grid grid-cols-3 gap-4">
          {filtered.map((scenario) => {
            const isMulti = isMultiAgent(scenario);
            const readyCount = scenario.skills.filter((id) =>
              readySkillNames.has(id),
            ).length;
            const skillStatus =
              readyCount > 0
                ? t("skill.skillsReady", {
                    count: readyCount,
                    total: scenario.skills.length,
                  })
                : undefined;
            return (
              <ThemePackCard
                key={scenario.id}
                emoji={scenario.emoji}
                name={scenario.name}
                desc={scenario.description}
                tags={scenario.tags}
                badge={
                  appliedMap[scenario.id]
                    ? t("themepack.applied")
                    : isMulti
                      ? t("themepack.multiAgentBadge")
                      : undefined
                }
                skillStatus={skillStatus}
                onClick={() => setSelectedScenario(scenario)}
              />
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <span className="text-sm text-[var(--text-secondary)]">
              {t("workshop.noMatch")}
            </span>
          </div>
        )}

        {/* Coming soon banner */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-center py-8">
            <span className="text-lg font-semibold text-[var(--text-secondary)]">
              {t("workshop.comingSoon")}
            </span>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      {selectedScenario &&
        (() => {
          const isMulti = isMultiAgent(selectedScenario);
          const costRange = COST_RANGES[selectedScenario.id] ?? [0, 0];
          const packData = {
            id: selectedScenario.id,
            emoji: selectedScenario.emoji,
            name: selectedScenario.name,
            desc: selectedScenario.description,
            fullDesc: selectedScenario.description,
            tags: selectedScenario.tags,
            skills: selectedScenario.skills,
            recommendedModel:
              RECOMMENDED_MODELS[selectedScenario.id] ?? "Claude Sonnet",
            estimatedCost: formatCostRange(
              costRange,
              currency,
              exchangeRate,
              t("workshop.perMonth"),
            ),
          };
          return isMulti ? (
            <MultiAgentDetail
              pack={packData}
              template={selectedScenario}
              onClose={() => setSelectedScenario(null)}
            />
          ) : (
            <ThemePackDetail
              pack={packData}
              onApplied={() => {}}
              onClose={() => setSelectedScenario(null)}
            />
          );
        })()}
    </div>
  );
}
