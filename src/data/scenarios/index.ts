/**
 * Scenario package registry.
 *
 * Each scenario lives in its own JSON file under this directory.
 * `builtinScenarios` re-exports them as a typed array so the rest of
 * the app never needs to touch individual files.
 *
 * To add a new built-in scenario:
 *   1. Create `<id>.json` following the ScenarioPackage schema
 *   2. Import it below and append to the array
 */

import type { ScenarioPackage } from "./schema";

import defaultScenario from "./default.json";
import morning from "./morning.json";
import email from "./email.json";
import writer from "./writer.json";
import ops from "./ops.json";
import debate from "./debate.json";

export const builtinScenarios: ScenarioPackage[] = [
  defaultScenario as ScenarioPackage,
  morning as ScenarioPackage,
  email as ScenarioPackage,
  writer as ScenarioPackage,
  ops as ScenarioPackage,
  debate as ScenarioPackage,
];

export type { ScenarioPackage } from "./schema";
