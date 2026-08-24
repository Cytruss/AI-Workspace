import { describe, expect, expectTypeOf, test } from "vitest";
import type { z } from "zod";
import {
  CanonicalClaimSchema,
  CanonicalEvidenceSchema,
  ClaimBoardSchema,
  DebateRoundSchema,
  FinalPositionSchema,
  InitialPhaseResponseSchema,
  VerdictSchema,
  createCrossExaminationPhaseResponseSchema,
  createFinalPhaseResponseSchema,
} from "../../../src/agents/structured-response.js";
import type {
  CanonicalEvidence,
  ClaimOrigin,
  DebateRound,
  StanceRecord,
  Verdict,
  VerdictCounts,
} from "../../../src/agents/structured-response.js";

type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

const evidence = {
  localId: "ev-local",
  trackedPath: "src/index.ts",
  lineStart: 1,
  lineEnd: 2,
};
const stance = {
  claimId: "claim-0001",
  value: "ACCEPT",
  reasoning: "The tracked implementation supports it.",
  existingEvidenceIds: ["evidence-0001"],
  newEvidenceLocalIds: ["ev-new"],
};

describe("InitialPhaseResponseSchema", () => {
  test("accepts unique local IDs, resolved evidence links, and future fields", () => {
    expect(
      InitialPhaseResponseSchema.parse({
        phase: "initial",
        claims: [
          {
            localId: "claim-local",
            text: "A claim",
            material: true,
            evidenceLocalIds: ["ev-local"],
          },
        ],
        evidence: [evidence],
        futureMetadata: { version: 2 },
      }),
    ).toMatchObject({
      phase: "initial",
      futureMetadata: { version: 2 },
    });
  });

  test.each([
    ["wrong discriminant", { phase: "final", claims: [], evidence: [] }],
    [
      "reserved stances",
      { phase: "initial", claims: [], evidence: [], stances: [] },
    ],
    [
      "duplicate claim",
      {
        phase: "initial",
        claims: [
          { localId: "c", text: "one", material: true, evidenceLocalIds: [] },
          { localId: "c", text: "two", material: true, evidenceLocalIds: [] },
        ],
        evidence: [],
      },
    ],
    [
      "duplicate evidence",
      { phase: "initial", claims: [], evidence: [evidence, evidence] },
    ],
    [
      "dangling evidence",
      {
        phase: "initial",
        claims: [
          {
            localId: "c",
            text: "one",
            material: true,
            evidenceLocalIds: ["missing"],
          },
        ],
        evidence: [],
      },
    ],
    [
      "duplicate evidence link",
      {
        phase: "initial",
        claims: [
          {
            localId: "c",
            text: "one",
            material: true,
            evidenceLocalIds: ["ev-local", "ev-local"],
          },
        ],
        evidence: [evidence],
      },
    ],
    [
      "canonical local claim ID",
      {
        phase: "initial",
        claims: [
          {
            localId: "claim-0001",
            text: "one",
            material: true,
            evidenceLocalIds: [],
          },
        ],
        evidence: [],
      },
    ],
  ])("rejects %s", (_name, value) => {
    expect(() => InitialPhaseResponseSchema.parse(value)).toThrow();
  });
});

describe("later phase response schemas", () => {
  const otherProviderBoard = ClaimBoardSchema.parse({
    version: 1,
    claims: [
      {
        id: "claim-0001",
        text: "A claim originating from Claude",
        material: true,
        evidenceIds: ["evidence-0001"],
        origins: [
          {
            agentId: "claude",
            agentRunId: "claude-initial-run",
            providerLocalId: "claude-local-claim",
          },
        ],
      },
    ],
    evidence: [
      {
        id: "evidence-0001",
        status: "VERIFIED",
        trackedPath: "src/index.ts",
        origins: [
          {
            agentId: "claude",
            agentRunId: "claude-initial-run",
            providerLocalId: "claude-local-evidence",
          },
        ],
      },
    ],
  });
  const crossSchema = createCrossExaminationPhaseResponseSchema(
    otherProviderBoard.claims.map((claim) => claim.id),
    otherProviderBoard.evidence.map((entry) => entry.id),
  );
  const finalSchema = createFinalPhaseResponseSchema(
    ["claim-0001", "claim-0002"],
    ["evidence-0001"],
  );
  const finalSecondStance = {
    ...stance,
    claimId: "claim-0002",
    newEvidenceLocalIds: [],
  };

  test("cross-examination accepts a claim originating from the other provider", () => {
    expect(
      crossSchema.parse({
        phase: "cross-examination",
        stances: [stance],
        newEvidence: [{ ...evidence, localId: "ev-new" }],
        future: true,
      }),
    ).toMatchObject({ phase: "cross-examination", future: true });
    expect(otherProviderBoard.claims[0]?.origins[0]?.agentId).toBe("claude");
  });

  test.each([
    [
      "another phase",
      {
        phase: "final",
        stances: [stance],
        newEvidence: [{ ...evidence, localId: "ev-new" }],
      },
    ],
    [
      "reserved claims",
      {
        phase: "cross-examination",
        claims: [],
        stances: [stance],
        newEvidence: [{ ...evidence, localId: "ev-new" }],
      },
    ],
    [
      "unknown claim",
      {
        phase: "cross-examination",
        stances: [{ ...stance, claimId: "claim-9999" }],
        newEvidence: [{ ...evidence, localId: "ev-new" }],
      },
    ],
    [
      "missing claim",
      { phase: "cross-examination", stances: [], newEvidence: [] },
    ],
    [
      "duplicate claim",
      {
        phase: "cross-examination",
        stances: [stance, stance],
        newEvidence: [{ ...evidence, localId: "ev-new" }],
      },
    ],
    [
      "local claim namespace",
      {
        phase: "cross-examination",
        stances: [{ ...stance, claimId: "local-claim" }],
        newEvidence: [{ ...evidence, localId: "ev-new" }],
      },
    ],
    [
      "unknown existing evidence",
      {
        phase: "cross-examination",
        stances: [{ ...stance, existingEvidenceIds: ["evidence-9999"] }],
        newEvidence: [{ ...evidence, localId: "ev-new" }],
      },
    ],
    [
      "duplicate existing evidence",
      {
        phase: "cross-examination",
        stances: [
          {
            ...stance,
            existingEvidenceIds: ["evidence-0001", "evidence-0001"],
          },
        ],
        newEvidence: [{ ...evidence, localId: "ev-new" }],
      },
    ],
    [
      "duplicate new declaration",
      {
        phase: "cross-examination",
        stances: [{ ...stance, newEvidenceLocalIds: [] }],
        newEvidence: [
          { ...evidence, localId: "ev-new" },
          { ...evidence, localId: "ev-new" },
        ],
      },
    ],
    [
      "canonical new evidence ID",
      {
        phase: "cross-examination",
        stances: [{ ...stance, newEvidenceLocalIds: ["evidence-0002"] }],
        newEvidence: [{ ...evidence, localId: "evidence-0002" }],
      },
    ],
    [
      "dangling or cross-run new evidence",
      {
        phase: "cross-examination",
        stances: [{ ...stance, newEvidenceLocalIds: ["other-run-evidence"] }],
        newEvidence: [{ ...evidence, localId: "ev-new" }],
      },
    ],
  ])("rejects %s", (_name, value) => {
    expect(() => crossSchema.parse(value)).toThrow();
  });

  test("final requires exactly one stance for every board claim", () => {
    const newEvidence = [{ ...evidence, localId: "ev-new" }];
    expect(
      finalSchema.parse({
        phase: "final",
        stances: [stance, finalSecondStance],
        newEvidence,
      }),
    ).toMatchObject({ phase: "final" });
    expect(() =>
      finalSchema.parse({ phase: "final", stances: [stance], newEvidence }),
    ).toThrow();
    expect(() =>
      finalSchema.parse({
        phase: "final",
        stances: [
          stance,
          finalSecondStance,
          { ...stance, claimId: "claim-0003" },
        ],
        newEvidence,
      }),
    ).toThrow();
    expect(() =>
      finalSchema.parse({
        phase: "final",
        stances: [stance, stance],
        newEvidence,
      }),
    ).toThrow();
  });

  test.each([
    ["reserved claims", { claims: [] }],
    ["reserved initial evidence", { evidence: [] }],
    [
      "local claim namespace",
      {
        stances: [{ ...stance, claimId: "local-claim" }, finalSecondStance],
      },
    ],
    [
      "unknown existing evidence",
      {
        stances: [
          { ...stance, existingEvidenceIds: ["evidence-9999"] },
          finalSecondStance,
        ],
      },
    ],
    [
      "local ID in canonical evidence namespace",
      {
        stances: [
          { ...stance, existingEvidenceIds: ["local-evidence"] },
          finalSecondStance,
        ],
      },
    ],
    [
      "duplicate existing evidence",
      {
        stances: [
          {
            ...stance,
            existingEvidenceIds: ["evidence-0001", "evidence-0001"],
          },
          finalSecondStance,
        ],
      },
    ],
    [
      "duplicate new evidence declaration",
      {
        stances: [{ ...stance, newEvidenceLocalIds: [] }, finalSecondStance],
        newEvidence: [
          { ...evidence, localId: "ev-new" },
          { ...evidence, localId: "ev-new" },
        ],
      },
    ],
    [
      "canonical ID in local evidence namespace",
      {
        stances: [
          { ...stance, newEvidenceLocalIds: ["evidence-0002"] },
          finalSecondStance,
        ],
        newEvidence: [{ ...evidence, localId: "evidence-0002" }],
      },
    ],
    [
      "dangling or cross-run new evidence",
      {
        stances: [
          { ...stance, newEvidenceLocalIds: ["other-run-evidence"] },
          finalSecondStance,
        ],
      },
    ],
  ])("final rejects %s", (_name, overrides) => {
    expect(() =>
      finalSchema.parse({
        phase: "final",
        stances: [stance, finalSecondStance],
        newEvidence: [{ ...evidence, localId: "ev-new" }],
        ...overrides,
      }),
    ).toThrow();
  });
});

describe("normalized host records", () => {
  const origin = {
    agentId: "claude",
    agentRunId: "run-1",
    providerLocalId: "local-1",
  };
  const canonicalEvidence = CanonicalEvidenceSchema.parse({
    id: "evidence-0001",
    status: "VERIFIED",
    trackedPath: "src/index.ts",
    lineStart: 1,
    lineEnd: 1,
    expectedHash: "abc",
    resolvedHash: "abc",
    origins: [origin],
  });
  const canonicalClaim = CanonicalClaimSchema.parse({
    id: "claim-0001",
    text: "A claim",
    material: true,
    evidenceIds: ["evidence-0001"],
    origins: [origin],
  });

  test("parses canonical claims, evidence, boards, and final positions", () => {
    expect(
      ClaimBoardSchema.parse({
        version: 1,
        claims: [canonicalClaim],
        evidence: [canonicalEvidence],
      }),
    ).toMatchObject({ version: 1 });
    expect(
      FinalPositionSchema.parse({
        agentId: "claude",
        agentRunId: "run-1",
        roundId: "round-1",
        stances: [
          {
            claimId: "claim-0001",
            value: "ACCEPT",
            reasoning: "supported",
            evidenceIds: ["evidence-0001"],
          },
        ],
      }),
    ).toMatchObject({ roundId: "round-1" });
  });

  test("normalizes a round with exact board references and stable ordering", () => {
    type ParsedRound = z.output<typeof DebateRoundSchema>;
    expectTypeOf<ParsedRound>().toEqualTypeOf<DebateRound>();
    expect(
      DebateRoundSchema.parse({
        id: "round-2",
        sessionId: "session-1",
        roundNumber: 2,
        phase: "cross-examination",
        status: "completed",
        inputBoardId: "board-1",
        outputBoardId: "board-2",
        createdAt: "2026-08-24T20:00:00.000Z",
        finishedAt: "2026-08-24T20:01:00.000Z",
        ignoredProviderField: true,
      }),
    ).toEqual({
      id: "round-2",
      sessionId: "session-1",
      roundNumber: 2,
      phase: "cross-examination",
      status: "completed",
      inputBoardId: "board-1",
      outputBoardId: "board-2",
      createdAt: "2026-08-24T20:00:00.000Z",
      finishedAt: "2026-08-24T20:01:00.000Z",
    });
  });

  test.each([
    ["zero ordering", { roundNumber: 0 }],
    ["unknown phase", { phase: "cross_examination" }],
    ["unknown status", { status: "pending" }],
    ["malformed timestamp", { createdAt: "today" }],
    ["running output board", { outputBoardId: "board-2" }],
    ["running finish timestamp", { finishedAt: "2026-08-24T20:01:00.000Z" }],
    ["terminal status without finish timestamp", { status: "completed" }],
  ])("rejects a round with %s", (_name, override) => {
    expect(() =>
      DebateRoundSchema.parse({
        id: "round-1",
        sessionId: "session-1",
        roundNumber: 1,
        phase: "initial",
        status: "running",
        createdAt: "2026-08-24T20:00:00.000Z",
        ...override,
      }),
    ).toThrow();
  });

  test("constructs deeply immutable verdicts", () => {
    const verdict = VerdictSchema.parse({
      claimId: "claim-0001",
      classification: "CONSENSUS",
      support: "VERIFIED",
      finalStances: [
        {
          agentId: "codex",
          agentRunId: "run-c",
          roundId: "round-1",
          claimId: "claim-0001",
          value: "ACCEPT",
          reasoning: "yes",
          evidenceIds: ["evidence-0001"],
        },
        {
          agentId: "claude",
          agentRunId: "run-a",
          roundId: "round-1",
          claimId: "claim-0001",
          value: "ACCEPT",
          reasoning: "yes",
          evidenceIds: ["evidence-0001"],
        },
      ],
      evidence: [canonicalEvidence],
      provenance: [origin],
      counts: { accept: 2, dispute: 0, uncertain: 0 },
    });
    expect(Object.isFrozen(verdict)).toBe(true);
    expect(Object.isFrozen(verdict.finalStances)).toBe(true);
    expect(Object.isFrozen(verdict.evidence[0]?.origins)).toBe(true);
    expect(Object.isFrozen(verdict.counts)).toBe(true);
  });

  test("exposes deeply readonly verdict output types", () => {
    type ParsedVerdict = z.output<typeof VerdictSchema>;
    type ReadonlyStances = readonly DeepReadonly<StanceRecord>[];
    type ReadonlyEvidence = readonly DeepReadonly<CanonicalEvidence>[];
    type ReadonlyOrigins = readonly DeepReadonly<ClaimOrigin>[];

    expectTypeOf<Verdict["finalStances"]>().toEqualTypeOf<ReadonlyStances>();
    expectTypeOf<Verdict["evidence"]>().toEqualTypeOf<ReadonlyEvidence>();
    expectTypeOf<Verdict["provenance"]>().toEqualTypeOf<ReadonlyOrigins>();
    expectTypeOf<Verdict["counts"]>().toEqualTypeOf<
      DeepReadonly<VerdictCounts>
    >();
    expectTypeOf<ParsedVerdict>().toEqualTypeOf<Verdict>();
  });
});
