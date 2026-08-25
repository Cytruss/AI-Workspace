import { describe, expect, test, vi } from "vitest";
import { ActiveRuns } from "../../../../src/orchestrator/active-runs.js";
import {
  createCommandHandler,
  createSlashCommands,
  type InteractionPort,
} from "../../../../src/transport/discord/command-handler.js";

function interaction(
  commandName: string,
  values: Record<string, string | undefined> = {},
): InteractionPort & {
  replies: unknown[];
  edits: unknown[];
  deferred: number;
} {
  const fake = {
    interactionId: "interaction-1",
    commandName,
    guildId: "guild",
    channelId: "channel",
    userId: "user",
    replies: [] as unknown[],
    edits: [] as unknown[],
    deferred: 0,
    getString: (name: string) => values[name],
    deferReply: () =>
      Promise.resolve().then(() => {
        fake.deferred += 1;
      }),
    reply: (content: unknown) =>
      Promise.resolve().then(() => {
        fake.replies.push(content);
      }),
    editReply: (content: unknown) =>
      Promise.resolve().then(() => {
        fake.edits.push(content);
      }),
  };
  return fake;
}

const config = {
  guildIds: ["guild"],
  allowedUserIds: ["user"],
  models: {
    codex: {
      defaultModel: "sol",
      selections: [
        {
          class: "sol",
          cliModelId: "gpt-sol",
          acceptedObservedModels: { exactIds: [], literalPrefixes: ["gpt-"] },
        },
      ],
    },
    claude: {
      selections: [
        {
          class: "opus",
          cliModelId: "claude-opus",
          acceptedObservedModels: {
            exactIds: [],
            literalPrefixes: ["claude-"],
          },
        },
      ],
    },
  },
};

describe("Discord command handler", () => {
  test("builds only configured concrete model-class choices", () => {
    const commands = createSlashCommands(config.models).map((command) =>
      command.toJSON(),
    );
    const ask = commands.find((command) => command.name === "ask");
    expect(
      ask?.options?.find(
        (option: { name: string }) => option.name === "codex_model",
      ),
    ).toMatchObject({ choices: [{ name: "sol", value: "sol" }] });
    expect(JSON.stringify(ask)).not.toContain("gpt-sol");
  });

  test("asks a selected agent after immediate defer and passes concrete classes", async () => {
    const ask = vi.fn().mockResolvedValue({
      sessionId: "s",
      status: "completed",
      project: { id: "demo", name: "Demo", root: "x" },
      results: [],
    });
    const handler = createCommandHandler({
      config,
      projects: {
        list: () => [{ id: "demo", name: "Demo", root: "x" }],
        get: vi.fn(),
      },
      projectRepository: {
        getActive: () => ({ id: "demo", name: "Demo", root: "x" }),
        setActive: vi.fn(),
      },
      askService: { ask },
      debateService: { debate: vi.fn() },
      activeRuns: new ActiveRuns(),
      sessions: { agentRuns: () => [] },
    });
    const port = interaction("ask", {
      agent: "codex",
      question: "Question",
      codex_model: "sol",
    });
    await handler(port);
    expect(port.deferred).toBe(1);
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        interactionId: "interaction-1",
        selection: "codex",
        codexModel: "sol",
      }),
    );
    expect(port.edits).toHaveLength(1);
  });

  test("rejects forged model classes before orchestration", async () => {
    const ask = vi.fn();
    const handler = createCommandHandler({
      config,
      projects: { list: () => [], get: vi.fn() },
      projectRepository: {
        getActive: () => ({ id: "demo", name: "Demo", root: "x" }),
        setActive: vi.fn(),
      },
      askService: { ask },
      debateService: { debate: vi.fn() },
      activeRuns: new ActiveRuns(),
      sessions: { agentRuns: () => [] },
    });
    const port = interaction("ask", {
      agent: "codex",
      question: "Question",
      codex_model: "raw-cli-id",
    });
    await handler(port);
    expect(ask).not.toHaveBeenCalled();
    expect(JSON.stringify(port.edits)).toContain("not configured");
  });

  test("lists and switches projects, and reports a missing active project", async () => {
    const repository = { getActive: () => undefined, setActive: vi.fn() };
    const handler = createCommandHandler({
      config,
      projects: {
        list: () => [{ id: "demo", name: "Demo", root: "x" }],
        get: (id: string) => ({ id, name: "Demo", root: "x" }),
      },
      projectRepository: repository,
      askService: { ask: vi.fn() },
      debateService: { debate: vi.fn() },
      activeRuns: new ActiveRuns(),
      sessions: { agentRuns: () => [] },
    });
    const projects = interaction("projects");
    await handler(projects);
    const switcher = interaction("switch", { project: "demo" });
    await handler(switcher);
    const ask = interaction("ask", { agent: "codex", question: "Question" });
    await handler(ask);
    expect(repository.setActive).toHaveBeenCalled();
    expect(JSON.stringify(ask.edits)).toContain("No active project");
  });

  test("debates explicit projects with provider defaults and maps known failures", async () => {
    const debate = vi
      .fn()
      .mockRejectedValue({ code: "PROJECT_REQUIRED", message: "ignored" });
    const handler = createCommandHandler({
      config,
      projects: {
        list: () => [{ id: "demo", name: "Demo", root: "x" }],
        get: vi.fn(),
      },
      projectRepository: {
        getActive: () => ({ id: "active", name: "Active", root: "x" }),
        setActive: vi.fn(),
      },
      askService: { ask: vi.fn() },
      debateService: { debate },
      activeRuns: new ActiveRuns(),
      sessions: { agentRuns: () => [] },
    });
    const port = interaction("debate", { topic: "Topic", project: "demo" });
    await handler(port);
    expect(debate).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "Topic", projectId: "demo" }),
      expect.anything(),
    );
    expect(JSON.stringify(port.edits)).toContain("Select a project");
  });

  test("shows persisted status details and only cancels the requester's current run", async () => {
    const activeRuns = new ActiveRuns();
    const owner = new AbortController();
    const other = new AbortController();
    activeRuns.register("owner-run", "user", owner);
    activeRuns.register("other-run", "other", other);
    const handler = createCommandHandler({
      config,
      projects: {
        list: () => [],
        get: (id: string) => ({ id, name: "Demo", root: "x" }),
      },
      projectRepository: { getActive: () => undefined, setActive: vi.fn() },
      askService: { ask: vi.fn() },
      debateService: { debate: vi.fn() },
      activeRuns,
      sessions: {
        get: (id: string) =>
          ({
            id,
            projectId: "demo",
            status: id === "owner-run" ? "running" : "completed",
            guildId: "guild",
            channelId: "channel",
            userId: id === "other-run" ? "other" : "user",
          }) as never,
        recentForScope: () =>
          [
            {
              id: "persisted-session",
              projectId: "demo",
              status: "completed",
            },
            {
              id: "older-session",
              projectId: "demo",
              status: "failed",
            },
          ] as never,
        agentRuns: () =>
          [
            {
              agentId: "codex",
              status: "completed",
              modelExecution: {
                requestedClass: "sol",
                requestedCliModelId: "gpt-sol",
                observedModelIds: ["gpt-sol"],
                verification: "verified",
              },
            },
          ] as never,
      },
    });
    const status = interaction("status");
    await handler(status);
    const stop = interaction("stop");
    await handler(stop);
    expect(JSON.stringify(status.replies)).toContain("persisted-session");
    expect(JSON.stringify(status.replies)).toContain("owner-run");
    expect(JSON.stringify(status.replies)).toContain("older-session");
    expect(JSON.stringify(status.replies)).not.toContain("other-run");
    expect(JSON.stringify(status.replies)).toContain("## Codex");
    expect(JSON.stringify(status.replies)).toContain("Requested class: sol");
    expect(owner.signal.aborted).toBe(true);
    expect(other.signal.aborted).toBe(false);
  });

  test("contains Discord defer and delivery rejections at the transport boundary", async () => {
    const ask = vi.fn();
    const handler = createCommandHandler({
      config,
      projects: { list: () => [], get: vi.fn() },
      projectRepository: {
        getActive: () => ({ id: "demo", name: "Demo", root: "x" }),
        setActive: vi.fn(),
      },
      askService: { ask },
      debateService: { debate: vi.fn() },
      activeRuns: new ActiveRuns(),
      sessions: { agentRuns: () => [] },
    });
    const deferFailure = interaction("ask", {
      agent: "codex",
      question: "Question",
    });
    deferFailure.deferReply = () => Promise.reject(new Error("expired"));
    await expect(handler(deferFailure)).resolves.toBeUndefined();
    expect(ask).not.toHaveBeenCalled();

    const deliveryFailure = interaction("models");
    deliveryFailure.reply = () => Promise.reject(new Error("delivery failed"));
    await expect(handler(deliveryFailure)).resolves.toBeUndefined();
  });

  test("returns a persisted terminal debate report without another provider call", async () => {
    const debate = vi.fn();
    const persistedReport = {
      sessionId: "persisted-debate",
      projectId: "demo",
      status: "completed",
      classification: "DEBATE",
      rounds: [],
      analyses: [],
      verdicts: [],
      consensus: [],
      disagreements: [],
      rejected: [],
      unresolved: [],
    } as const;
    const handler = createCommandHandler({
      config,
      projects: { list: () => [], get: vi.fn() },
      projectRepository: {
        getActive: () => ({ id: "demo", name: "Demo", root: "x" }),
        setActive: vi.fn(),
      },
      askService: { ask: vi.fn() },
      debateService: { debate, persistedReport: () => persistedReport },
      activeRuns: new ActiveRuns(),
      sessions: { agentRuns: () => [] },
    });
    const port = interaction("debate", { topic: "Repeat" });
    await handler(port);
    expect(debate).not.toHaveBeenCalled();
    expect(JSON.stringify(port.edits)).toContain("persisted-debate");
  });

  test("uses a generic safe fallback for unexpected errors", async () => {
    const ask = vi
      .fn()
      .mockRejectedValue(new Error("C:\\private\\provider-secret"));
    const handler = createCommandHandler({
      config,
      projects: { list: () => [], get: vi.fn() },
      projectRepository: {
        getActive: () => ({ id: "demo", name: "Demo", root: "x" }),
        setActive: vi.fn(),
      },
      askService: { ask },
      debateService: { debate: vi.fn() },
      activeRuns: new ActiveRuns(),
      sessions: { agentRuns: () => [] },
    });
    const port = interaction("ask", { agent: "codex", question: "Question" });
    await handler(port);
    expect(JSON.stringify(port.edits)).toContain("could not be completed");
    expect(JSON.stringify(port.edits)).not.toContain("provider-secret");
  });
});
