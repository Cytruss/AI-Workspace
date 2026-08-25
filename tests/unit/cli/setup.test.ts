import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { readSecret } from "../../../src/cli/setup.js";

describe("readSecret", () => {
  test("reads a token without writing it to the terminal output", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const rendered: Buffer[] = [];
    output.on("data", (chunk: Buffer) => rendered.push(chunk));
    const reading = readSecret(input, output, "Discord token: ");
    input.end("secret-token\n");

    await expect(reading).resolves.toBe("secret-token");
    expect(Buffer.concat(rendered).toString("utf8")).not.toContain(
      "secret-token",
    );
  });
});
