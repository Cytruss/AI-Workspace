import type { RegisteredProject } from "../projects/project-service.js";
import type { SqliteDatabase } from "./database.js";

export interface ProjectScope {
  guildId: string;
  channelId: string;
  userId: string;
}

interface ProjectRow {
  id: string;
  name: string;
  root: string;
}

export class ProjectRepository {
  constructor(private readonly database: SqliteDatabase) {}

  upsert(project: RegisteredProject): void {
    this.database
      .prepare(
        `INSERT INTO projects (id, name, root) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, root = excluded.root`,
      )
      .run(project.id, project.name, project.root);
  }

  setActive(scope: ProjectScope, projectId: string): void {
    this.database
      .prepare(
        `INSERT INTO active_projects (guild_id, channel_id, user_id, project_id) VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, channel_id, user_id) DO UPDATE SET project_id = excluded.project_id`,
      )
      .run(scope.guildId, scope.channelId, scope.userId, projectId);
  }

  getActive(scope: ProjectScope): RegisteredProject | undefined {
    const row = this.database
      .prepare(
        `SELECT p.id, p.name, p.root FROM active_projects a JOIN projects p ON p.id = a.project_id
      WHERE a.guild_id = ? AND a.channel_id = ? AND a.user_id = ?`,
      )
      .get(scope.guildId, scope.channelId, scope.userId) as
      ProjectRow | undefined;
    return row === undefined ? undefined : Object.freeze({ ...row });
  }
}
