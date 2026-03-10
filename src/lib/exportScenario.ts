import { isTauriEnv } from "./env";
import type { ScenarioPackage } from "../data/scenarios/schema";

/**
 * Export a scenario package as a downloadable JSON file.
 * In Tauri: opens a native save dialog.
 * In browser: triggers a blob download.
 */
export async function exportScenarioJSON(scenario: ScenarioPackage): Promise<void> {
  const json = JSON.stringify(scenario, null, 2);
  const filename = `${scenario.id}.json`;

  if (isTauriEnv()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const filePath = await save({
      defaultPath: filename,
      filters: [{ name: "Scenario Package", extensions: ["json"] }],
    });
    if (filePath) {
      await writeTextFile(filePath, json);
    }
  } else {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
