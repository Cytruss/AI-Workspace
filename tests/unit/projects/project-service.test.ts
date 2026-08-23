import { execFile } from "node:child_process";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { ProjectService } from "../../../src/projects/project-service.js";

const execute = promisify(execFile);

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ai-workspace-service-"));
  await execute("git", ["init", "--quiet", root]);
  return root;
}

describe("ProjectService", () => {
  it("validates configured projects and exposes canonical immutable copies", async () => {
    const root = await createRepository();
    const service = await ProjectService.create([
      { id: "demo", name: "Demo", root },
    ]);
    const listed = service.list();

    expect(listed).toEqual([
      { id: "demo", name: "Demo", root: await realpath(root) },
    ]);
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.isFrozen(listed[0])).toBe(true);
    expect(service.get("demo")).not.toBe(listed[0]);
  });

  it("rejects invalid configured roots with a stable code", async () => {
    const root = await mkdtemp(join(tmpdir(), "ai-workspace-invalid-"));

    await expect(
      ProjectService.create([{ id: "demo", name: "Demo", root }]),
    ).rejects.toMatchObject({ code: "PROJECT_ROOT_INVALID" });
  });

  it("reports an unknown project with a stable code", async () => {
    const service = await ProjectService.create([]);

    expect(() => service.get("missing")).toThrow(
      expect.objectContaining({ code: "PROJECT_NOT_FOUND" }),
    );
  });
});
