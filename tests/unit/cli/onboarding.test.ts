import { describe, expect, test, vi } from "vitest";
import type { AppPaths } from "../../../src/config/app-paths.js";
import { AppConfigSchema } from "../../../src/config/schema.js";
import {
  runOnboarding,
  type OnboardingDependencies,
} from "../../../src/cli/onboarding.js";
import type { SetupDraft, SetupIo } from "../../../src/cli/setup.js";
import type { WindowsPrerequisiteStatus } from "../../../src/cli/onboarding-windows.js";

const paths: AppPaths = {
  dataDir: "C:/Users/test/AppData/Roaming/ai-workspace",
  configFile: "C:/Users/test/AppData/Roaming/ai-workspace/config.json",
  databaseFile:
    "C:/Users/test/AppData/Roaming/ai-workspace/ai-workspace.sqlite",
  logDir: "C:/Users/test/AppData/Roaming/ai-workspace/logs",
};

const token = "never-render-this-token";
const draft: SetupDraft = {
  token,
  config: AppConfigSchema.parse({
    version: 1,
    mode: "observe",
    discord: {
      applicationId: "application-id",
      guildIds: ["guild-id"],
      allowedUserIds: ["user-id"],
      tokenEnv: "AI_WORKSPACE_DISCORD_TOKEN",
    },
    projects: [{ id: "workspace", name: "Workspace", root: process.cwd() }],
    agents: {
      codex: { command: "C:/tools/codex.exe", models: { selections: [] } },
      claude: {
        command: "C:/tools/claude.exe",
        models: { selections: [] },
      },
    },
  }),
};

type Event =
  | { kind: "ask"; text: string; answer: string }
  | { kind: "write"; text: string }
  | { kind: "open"; url: string };

function scriptedIo(answers: string[]): {
  io: SetupIo;
  events: Event[];
  rendered: string[];
} {
  const events: Event[] = [];
  const rendered: string[] = [];
  return {
    io: {
      ask: (text) => {
        const answer = answers.shift();
        if (answer === undefined)
          throw new Error(`Unexpected onboarding prompt: ${text}`);
        events.push({ kind: "ask", text, answer });
        return Promise.resolve(answer);
      },
      readSecret: () => Promise.resolve(token),
      write: (text) => {
        events.push({ kind: "write", text });
        rendered.push(text);
      },
    },
    events,
    rendered,
  };
}

function statuses(
  unavailable: WindowsPrerequisiteStatus["name"][] = [],
): WindowsPrerequisiteStatus[] {
  return (["node", "git", "pnpm", "codex", "claude", "winget"] as const).map(
    (name) => ({
      name,
      available: !unavailable.includes(name),
      detail: unavailable.includes(name)
        ? `${name} is missing from this test machine.`
        : `${name} is available on this test machine.`,
    }),
  );
}

function fakeDependencies(
  io: SetupIo,
  events: Event[],
  prerequisiteStatuses: WindowsPrerequisiteStatus[],
  doctorHealthy = true,
  platform: NodeJS.Platform = "win32",
) {
  const install = vi.fn((name: WindowsPrerequisiteStatus["name"]) =>
    Promise.resolve({
      name,
      available: true,
      detail: `${name} installed by the scripted fake.`,
    }),
  );
  const writeDraft = vi.fn(() => Promise.resolve());
  const loadConfiguration = vi.fn(() => Promise.resolve(draft.config));
  const doctor = vi.fn(() => Promise.resolve(doctorHealthy));
  const collectDraft = vi.fn<OnboardingDependencies["collectSetupDraft"]>(() =>
    Promise.resolve(draft),
  );
  const providerRequest = vi.fn(() => {
    throw new Error("Provider requests are forbidden during onboarding tests");
  });
  const readBrowserSession = vi.fn(() => {
    throw new Error(
      "Browser session reads are forbidden during onboarding tests",
    );
  });
  const dependencies = {
    io,
    cwd: "C:/workspace",
    platform,
    windowsRunner: vi.fn(() =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    ),
    resolveAgentCommand: vi.fn(() =>
      Promise.resolve({
        source: "unresolved" as const,
        diagnostic: "No provider executable is available in the scripted fake.",
      }),
    ),
    inspectWindowsPrerequisites: vi.fn(() =>
      Promise.resolve(prerequisiteStatuses),
    ),
    installWindowsPrerequisite: install,
    openOfficialUrl: vi.fn((url: string) => {
      events.push({ kind: "open", url });
      return Promise.resolve();
    }),
    collectSetupDraft: collectDraft,
    writeSetupDraft: writeDraft,
    loadConfiguration,
    runDoctor: doctor,
    providerRequest,
    readBrowserSession,
  } satisfies OnboardingDependencies & {
    providerRequest: typeof providerRequest;
    readBrowserSession: typeof readBrowserSession;
  };
  return {
    dependencies,
    install,
    collectDraft,
    writeDraft,
    loadConfiguration,
    doctor,
    providerRequest,
    readBrowserSession,
  };
}

describe("runOnboarding Guided mode", () => {
  test("reports missing prerequisites and opens a fixed official page only after confirmation", async () => {
    const { io, events, rendered } = scriptedIo(["guided", "yes", "no"]);
    const { dependencies, install, writeDraft } = fakeDependencies(
      io,
      events,
      statuses(["git"]),
    );

    const result = await runOnboarding(paths, dependencies);

    expect(result.stage).toBe("needs_operator_action");
    expect(result.nextAction).toContain("Git");
    expect(rendered.join("\n")).toContain("git is missing");
    expect(install).not.toHaveBeenCalled();
    expect(writeDraft).not.toHaveBeenCalled();
    const openIndex = events.findIndex((event) => event.kind === "open");
    expect(events[openIndex]).toEqual({
      kind: "open",
      url: "https://git-scm.com/downloads/win",
    });
    const precedingEvent = events[openIndex - 1];
    expect(precedingEvent?.kind).toBe("ask");
    if (precedingEvent?.kind === "ask")
      expect(precedingEvent.answer).toBe("yes");
    expect(rendered.join("\n")).not.toContain(token);
  });

  test("returns cancelled without writing when configuration collection is cancelled", async () => {
    const { io, events, rendered } = scriptedIo(["guided", "no", "yes"]);
    const { dependencies, collectDraft, writeDraft, doctor } = fakeDependencies(
      io,
      events,
      statuses(),
    );
    collectDraft.mockImplementation(async (setupIo) => {
      await setupIo.readSecret("Discord token: ");
      throw new Error("Setup cancelled before writing local files");
    });

    const result = await runOnboarding(paths, dependencies);

    expect(result).toEqual({
      stage: "cancelled",
      nextAction: "Run pnpm onboarding when you are ready to continue.",
    });
    expect(writeDraft).not.toHaveBeenCalled();
    expect(doctor).not.toHaveBeenCalled();
    expect(rendered.join("\n")).not.toContain(token);
  });

  test.each([
    {
      label: "mode cancellation",
      answers: ["cancel"],
      unavailable: [],
      expectedStage: "cancelled",
    },
    {
      label: "bootstrap cancellation",
      answers: ["semi-automatic", "cancel"],
      unavailable: ["node"],
      expectedStage: "cancelled",
    },
    {
      label: "manual prerequisite page cancellation",
      answers: ["guided", "cancel"],
      unavailable: ["git"],
      expectedStage: "cancelled",
    },
    {
      label: "provider page cancellation",
      answers: ["guided", "cancel"],
      unavailable: ["codex"],
      expectedStage: "cancelled",
    },
    {
      label: "missing-prerequisite continuation cancellation",
      answers: ["guided", "no", "cancel"],
      unavailable: ["git"],
      expectedStage: "cancelled",
    },
    {
      label: "Discord page cancellation",
      answers: ["guided", "cancel"],
      unavailable: [],
      expectedStage: "cancelled",
    },
    {
      label: "Discord readiness cancellation after declining the optional page",
      answers: ["guided", "no", "cancel"],
      unavailable: [],
      expectedStage: "cancelled",
    },
    {
      label: "declined bootstrap followed by manual cancellation",
      answers: ["semi-automatic", "no", "cancel"],
      unavailable: ["node"],
      expectedStage: "cancelled",
    },
    {
      label: "declined optional prerequisite page",
      answers: ["guided", "no", "no"],
      unavailable: ["git"],
      expectedStage: "needs_operator_action",
    },
    {
      label: "declined optional Discord page and unfinished manual tasks",
      answers: ["guided", "no", "no"],
      unavailable: [],
      expectedStage: "needs_operator_action",
    },
  ] as const)(
    "performs no write after $label",
    async ({ answers, unavailable, expectedStage }) => {
      const { io, events } = scriptedIo([...answers]);
      const { dependencies, writeDraft, loadConfiguration, doctor } =
        fakeDependencies(io, events, statuses([...unavailable]));

      const result = await runOnboarding(paths, dependencies);

      expect(result.stage).toBe(expectedStage);
      expect(writeDraft).not.toHaveBeenCalled();
      expect(loadConfiguration).not.toHaveBeenCalled();
      expect(doctor).not.toHaveBeenCalled();
    },
  );

  test("recognizes a coded setup cancellation without writing", async () => {
    const { io, events } = scriptedIo(["guided", "no", "yes"]);
    const { dependencies, collectDraft, writeDraft, doctor } = fakeDependencies(
      io,
      events,
      statuses(),
    );
    collectDraft.mockRejectedValue(
      Object.assign(new Error("Executable path was declined"), {
        code: "SETUP_CANCELLED",
      }),
    );

    const result = await runOnboarding(paths, dependencies);

    expect(result.stage).toBe("cancelled");
    expect(writeDraft).not.toHaveBeenCalled();
    expect(doctor).not.toHaveBeenCalled();
  });
});

describe("runOnboarding Semi-automatic mode", () => {
  test("forces Guided mode and runs no installer outside Windows", async () => {
    const { io, events, rendered } = scriptedIo([
      "semi-automatic",
      "yes",
      "no",
    ]);
    const { dependencies, install, writeDraft } = fakeDependencies(
      io,
      events,
      statuses(["node"]),
      true,
      "linux",
    );

    const result = await runOnboarding(paths, dependencies);

    expect(result.stage).toBe("needs_operator_action");
    expect(install).not.toHaveBeenCalled();
    expect(writeDraft).not.toHaveBeenCalled();
    expect(rendered.join("\n")).toMatch(/only on Windows.*Guided/i);
  });

  test("shows each public action immediately before consent and falls back to Guided mode after a decline", async () => {
    const { io, events, rendered } = scriptedIo([
      "semi-automatic",
      "yes",
      "no",
      "no",
      "no",
      "no",
      "no",
      "yes",
      "no",
      "yes",
    ]);
    const {
      dependencies,
      install,
      writeDraft,
      providerRequest,
      readBrowserSession,
    } = fakeDependencies(
      io,
      events,
      statuses(["node", "git", "pnpm", "codex", "claude"]),
    );

    const result = await runOnboarding(paths, dependencies);

    expect(result.stage).toBe("complete");
    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith("node", dependencies.windowsRunner);
    expect(dependencies.openOfficialUrl).not.toHaveBeenCalled();
    expect(
      events
        .filter(
          (event): event is Extract<Event, { kind: "write" }> =>
            event.kind === "write" && event.text.startsWith("Proposed action:"),
        )
        .map(({ text }) => text),
    ).toEqual([
      "Proposed action: winget install --id OpenJS.NodeJS.22 --exact --version 22.23.2 --source winget\n",
      "Proposed action: winget install --id Git.Git --exact --source winget\n",
    ]);
    const installConfirmations = events.filter(
      (event): event is Extract<Event, { kind: "ask" }> =>
        event.kind === "ask" && event.text.includes("Run this action now"),
    );
    expect(installConfirmations.map(({ answer }) => answer)).toEqual([
      "yes",
      "no",
    ]);
    for (const confirmation of installConfirmations) {
      const index = events.indexOf(confirmation);
      const actionEvent = events[index - 1];
      expect(actionEvent?.kind).toBe("write");
      if (actionEvent?.kind === "write")
        expect(actionEvent.text).toContain("Proposed action:");
    }
    expect(rendered.join("\n")).toContain("Continuing in Guided mode");
    expect(rendered.join("\n")).toContain(
      "Codex sign-in must be completed manually outside AI Workspace",
    );
    expect(rendered.join("\n")).toContain(
      "Claude sign-in must be completed manually outside AI Workspace",
    );
    expect(providerRequest).not.toHaveBeenCalled();
    expect(readBrowserSession).not.toHaveBeenCalled();
    expect(writeDraft).toHaveBeenCalledOnce();
    expect(rendered.join("\n")).not.toContain(token);
  });

  test("loads the confirmed configuration and runs doctor exactly once as capability preflight", async () => {
    const { io, events, rendered } = scriptedIo([
      "semi-automatic",
      "no",
      "yes",
    ]);
    const { dependencies, loadConfiguration, doctor } = fakeDependencies(
      io,
      events,
      statuses(),
      false,
    );

    const result = await runOnboarding(paths, dependencies);

    expect(loadConfiguration).toHaveBeenCalledOnce();
    expect(doctor).toHaveBeenCalledOnce();
    expect(result.stage).toBe("needs_operator_action");
    expect(result.nextAction).toContain("pnpm run doctor");
    expect(rendered.join("\n")).toContain("capability preflight");
    expect(rendered.join("\n")).not.toMatch(
      /(authentication|entitlement|real-request readiness) (verified|ready|available)/i,
    );
  });
});
