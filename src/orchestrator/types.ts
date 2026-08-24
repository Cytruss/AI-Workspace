import type { AgentResult, AgentSelection } from "../agents/types.js";
import type { RegisteredProject } from "../projects/project-service.js";
import type { ProjectScope } from "../storage/project-repository.js";

export interface AskInput {
  scope: ProjectScope;
  interactionId: string;
  projectId?: string;
  selection: AgentSelection;
  codexModel?: string;
  claudeModel?: string;
  question: string;
}

export interface AskReport {
  sessionId: string;
  status: "completed" | "partial" | "failed" | "cancelled";
  project: RegisteredProject;
  results: AgentResult[];
}
