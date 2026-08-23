import { describe, expect, it } from "vitest";
import { getBuildInfo } from "../../src/build-info.js";

describe("getBuildInfo", () => {
  it("returns portable runtime metadata", () => {
    expect(getBuildInfo()).toEqual({
      name: "ai-workspace",
      version: "0.1.0",
      node: process.version,
    });
  });
});
