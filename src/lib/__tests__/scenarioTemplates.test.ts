import { describe, it, expect } from "vitest";
import {
  SCENARIO_TEMPLATES,
  getSingleScenario,
  isSingleAgent,
  isMultiAgent,
  getScenarioTemplate,
  getLocalizedScenarioTemplate,
  getSingleAgentTemplates,
  localizeScenario,
  getAllTags,
} from "../scenarioTemplates";

describe("scenarioTemplates", () => {
  describe("SCENARIO_TEMPLATES", () => {
    it("contains at least one scenario", () => {
      expect(SCENARIO_TEMPLATES.length).toBeGreaterThan(0);
    });

    it("every scenario has required fields", () => {
      for (const tpl of SCENARIO_TEMPLATES) {
        expect(tpl.id).toBeTruthy();
        expect(tpl.name).toBeTruthy();
        expect(tpl.emoji).toBeTruthy();
        expect(tpl.version).toBe(1);
        expect(tpl.tags).toBeInstanceOf(Array);
        expect(["single", "multi"]).toContain(tpl.scenario.type);
      }
    });

    it("all ids are unique", () => {
      const ids = SCENARIO_TEMPLATES.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe("getSingleScenario()", () => {
    it("returns scenario data for single-agent template", () => {
      const single = SCENARIO_TEMPLATES.find((t) => t.scenario.type === "single");
      if (!single) return; // skip if no single-agent scenarios
      const result = getSingleScenario(single);
      expect(result).toBeDefined();
      expect(result!.type).toBe("single");
      expect(result!.soul).toBeDefined();
    });

    it("returns undefined for multi-agent template", () => {
      const multi = SCENARIO_TEMPLATES.find((t) => t.scenario.type === "multi");
      if (!multi) return;
      expect(getSingleScenario(multi)).toBeUndefined();
    });
  });

  describe("isSingleAgent() / isMultiAgent()", () => {
    it("correctly identifies single-agent templates", () => {
      const single = SCENARIO_TEMPLATES.find((t) => t.scenario.type === "single");
      if (single) {
        expect(isSingleAgent(single)).toBe(true);
        expect(isMultiAgent(single)).toBe(false);
      }
    });

    it("correctly identifies multi-agent templates", () => {
      const multi = SCENARIO_TEMPLATES.find((t) => t.scenario.type === "multi");
      if (multi) {
        expect(isSingleAgent(multi)).toBe(false);
        expect(isMultiAgent(multi)).toBe(true);
      }
    });
  });

  describe("getScenarioTemplate()", () => {
    it("finds template by id", () => {
      const first = SCENARIO_TEMPLATES[0];
      expect(getScenarioTemplate(first.id)).toBe(first);
    });

    it("returns undefined for unknown id", () => {
      expect(getScenarioTemplate("nonexistent-id")).toBeUndefined();
    });
  });

  describe("getLocalizedScenarioTemplate()", () => {
    it("returns localized template for valid id", () => {
      const first = SCENARIO_TEMPLATES[0];
      const result = getLocalizedScenarioTemplate(first.id, "zh-CN");
      expect(result).toBeDefined();
      expect(result!.id).toBe(first.id);
    });

    it("returns undefined for unknown id", () => {
      expect(getLocalizedScenarioTemplate("nope", "zh-CN")).toBeUndefined();
    });
  });

  describe("getSingleAgentTemplates()", () => {
    it("returns only single-agent templates", () => {
      const singles = getSingleAgentTemplates();
      for (const s of singles) {
        expect(s.scenario.type).toBe("single");
      }
    });

    it("excludes multi-agent templates", () => {
      const singles = getSingleAgentTemplates();
      const multiCount = SCENARIO_TEMPLATES.filter(
        (t) => t.scenario.type === "multi",
      ).length;
      expect(singles.length).toBe(SCENARIO_TEMPLATES.length - multiCount);
    });
  });

  describe("localizeScenario()", () => {
    it("returns original for zh-CN locale", () => {
      const tpl = SCENARIO_TEMPLATES[0];
      const result = localizeScenario(tpl, "zh-CN");
      expect(result).toBe(tpl); // same reference, no copy
    });

    it("returns original when locale has no overrides", () => {
      const tpl = SCENARIO_TEMPLATES[0];
      const result = localizeScenario(tpl, "ja-JP");
      expect(result).toBe(tpl);
    });

    it("applies en-US overrides when available", () => {
      const withLocales = SCENARIO_TEMPLATES.find(
        (t) => t.locales?.["en-US"],
      );
      if (!withLocales) return;

      const localized = localizeScenario(withLocales, "en-US");
      const enOverrides = withLocales.locales!["en-US"];

      if (enOverrides.name) {
        expect(localized.name).toBe(enOverrides.name);
      }
      if (enOverrides.description) {
        expect(localized.description).toBe(enOverrides.description);
      }
      // id should remain unchanged
      expect(localized.id).toBe(withLocales.id);
    });

    it("preserves untranslatable fields in single-agent scenario", () => {
      const single = SCENARIO_TEMPLATES.find(
        (t) => t.scenario.type === "single" && t.locales?.["en-US"],
      );
      if (!single) return;

      const localized = localizeScenario(single, "en-US");
      // skills, toolsProfile should be unchanged
      expect(localized.skills).toEqual(single.skills);
      expect(localized.toolsProfile).toBe(single.toolsProfile);
    });

    it("applies en-US overrides to multi-agent scenarios", () => {
      const multi = SCENARIO_TEMPLATES.find(
        (t) => t.scenario.type === "multi" && t.locales?.["en-US"],
      );
      if (!multi) return;

      const localized = localizeScenario(multi, "en-US");
      expect(localized.scenario.type).toBe("multi");
      // Should have same number of agents
      if (localized.scenario.type === "multi" && multi.scenario.type === "multi") {
        expect(localized.scenario.agents.length).toBe(
          multi.scenario.agents.length,
        );
      }
    });
  });

  describe("getAllTags()", () => {
    it("returns unique tags", () => {
      const tags = getAllTags();
      expect(new Set(tags).size).toBe(tags.length);
    });

    it("returns non-empty list", () => {
      expect(getAllTags().length).toBeGreaterThan(0);
    });

    it("returns localized tags when locale is provided", () => {
      const zhTags = getAllTags("zh-CN");
      const enTags = getAllTags("en-US");
      // Both should return tags (may or may not differ depending on locale data)
      expect(zhTags.length).toBeGreaterThan(0);
      expect(enTags.length).toBeGreaterThan(0);
    });
  });
});
