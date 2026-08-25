import { describe, expect, test } from "vitest";
import { capabilitySatisfiesConfiguredSelections } from "../../../src/cli/doctor.js";

const available = {
  available: true,
  nonInteractive: true,
  structuredOutput: true,
  readOnlyEnforcement: true,
  modelOption: { supported: true },
  effortOption: { supported: true, allowedValues: ["low", "high"] },
  observedModelReporting: { supported: true },
  diagnostics: [],
};

describe("doctor capability gate", () => {
  test("rejects configured classes when observation reporting is unavailable", () => {
    expect(
      capabilitySatisfiesConfiguredSelections(
        { ...available, observedModelReporting: { supported: false } },
        [
          {
            class: "sol",
            cliModelId: "model",
            acceptedObservedModels: {
              exactIds: ["model"],
              literalPrefixes: [],
            },
          },
        ],
      ),
    ).toBe(false);
  });

  test("allows provider-default omission without observation reporting", () => {
    expect(
      capabilitySatisfiesConfiguredSelections(
        { ...available, observedModelReporting: { supported: false } },
        [],
      ),
    ).toBe(true);
  });

  test("rejects a configured effort outside the safe allowed-values list", () => {
    expect(
      capabilitySatisfiesConfiguredSelections(available, [
        {
          class: "sol",
          cliModelId: "model",
          requestedEffort: "ultra",
          acceptedObservedModels: { exactIds: ["model"], literalPrefixes: [] },
        },
      ]),
    ).toBe(false);
  });
});
