import type { ProjectConfig } from "../config/schema.js";
import {
  ProjectRootError,
  validateProjectRoot,
} from "../permissions/project-root.js";

export interface RegisteredProject {
  id: string;
  name: string;
  root: string;
}

export type ProjectServiceErrorCode =
  "PROJECT_NOT_FOUND" | "PROJECT_ROOT_INVALID" | "PROJECT_EXTERNAL_SYMLINK";

export class ProjectServiceError extends Error {
  constructor(
    public readonly code: ProjectServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectServiceError";
  }
}

function immutableCopy(project: RegisteredProject): RegisteredProject {
  return Object.freeze({ ...project });
}

export class ProjectService {
  private constructor(
    private readonly projects: ReadonlyMap<string, RegisteredProject>,
  ) {}

  static async create(configs: ProjectConfig[]): Promise<ProjectService> {
    const projects = new Map<string, RegisteredProject>();
    for (const config of configs) {
      try {
        const validated = await validateProjectRoot(config.root);
        projects.set(
          config.id,
          immutableCopy({
            id: config.id,
            name: config.name,
            root: validated.root,
          }),
        );
      } catch (error: unknown) {
        if (error instanceof ProjectRootError) {
          throw new ProjectServiceError(error.code, error.message, {
            cause: error,
          });
        }
        throw new ProjectServiceError(
          "PROJECT_ROOT_INVALID",
          "Project root validation failed",
          { cause: error },
        );
      }
    }
    return new ProjectService(projects);
  }

  list(): readonly RegisteredProject[] {
    return Object.freeze(
      [...this.projects.values()].map((project) => immutableCopy(project)),
    );
  }

  get(projectId: string): RegisteredProject {
    const project = this.projects.get(projectId);
    if (project === undefined) {
      throw new ProjectServiceError(
        "PROJECT_NOT_FOUND",
        `Project not found: ${projectId}`,
      );
    }
    return immutableCopy(project);
  }
}
