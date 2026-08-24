import { describe, expect, test } from "vitest";
import { DebateServiceError } from "../../../src/debate/debate-service.js";

describe("DebateService", () => {
  test("exposes stable boundary error codes", () => {
    expect(
      new DebateServiceError("PROJECT_REQUIRED", "Select a project"),
    ).toMatchObject({ code: "PROJECT_REQUIRED" });
  });
});
