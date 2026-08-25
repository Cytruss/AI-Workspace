import type { ProjectScope } from "../../storage/project-repository.js";

export interface AuthorizationConfig {
  guildIds: readonly string[];
  allowedUserIds: readonly string[];
}

export interface AuthorizationScope {
  guildId?: string;
  channelId: string;
  userId: string;
}

export class DiscordAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscordAuthorizationError";
  }
}

export function authorize(
  scope: AuthorizationScope,
  config: AuthorizationConfig,
): ProjectScope {
  if (scope.guildId === undefined)
    throw new DiscordAuthorizationError(
      "This command is available only in an authorized server",
    );
  if (!config.guildIds.includes(scope.guildId))
    throw new DiscordAuthorizationError("This server is not authorized");
  if (!config.allowedUserIds.includes(scope.userId))
    throw new DiscordAuthorizationError(
      "You are not authorized to use this command",
    );
  return Object.freeze({
    guildId: scope.guildId,
    channelId: scope.channelId,
    userId: scope.userId,
  });
}
