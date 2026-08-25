import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { AppConfig } from "../../config/schema.js";
import type {
  CommandHandlerDependencies,
  InteractionPort,
} from "./command-handler.js";
import {
  createCommandHandler,
  createSlashCommands,
} from "./command-handler.js";

function port(interaction: ChatInputCommandInteraction): InteractionPort {
  const guildId = interaction.guildId ?? undefined;
  return {
    interactionId: interaction.id,
    commandName: interaction.commandName,
    ...(guildId === undefined ? {} : { guildId }),
    channelId: interaction.channelId,
    userId: interaction.user.id,
    getString: (name, required) =>
      interaction.options.getString(name, required) ?? undefined,
    deferReply: async () => {
      await interaction.deferReply();
    },
    reply: async (content) => {
      await interaction.reply(content);
    },
    editReply: async (content) => {
      await interaction.editReply(content);
    },
  };
}

export interface DiscordRuntimeDependencies extends Omit<
  CommandHandlerDependencies,
  "config"
> {
  config: AppConfig;
  readEnvironment?: (name: string) => string | undefined;
}

export class DiscordRuntime {
  private readonly client = new Client({ intents: [GatewayIntentBits.Guilds] });

  constructor(private readonly dependencies: DiscordRuntimeDependencies) {}

  async start(): Promise<void> {
    const { config } = this.dependencies;
    const handler = createCommandHandler({
      ...this.dependencies,
      config: {
        guildIds: config.discord.guildIds,
        allowedUserIds: config.discord.allowedUserIds,
        models: {
          codex: config.agents.codex.models,
          claude: config.agents.claude.models,
        },
        debate: config.debate,
      },
    });
    this.client.on(Events.InteractionCreate, (interaction) => {
      if (interaction.isChatInputCommand()) void handler(port(interaction));
    });
    this.client.once(Events.ClientReady, () => undefined);
    const readEnvironment =
      this.dependencies.readEnvironment ??
      ((name: string) => process.env[name]);
    const registrationToken = readEnvironment(config.discord.tokenEnv);
    if (registrationToken === undefined || registrationToken.length === 0)
      throw new Error("Discord token is not configured");
    const rest = new REST({ version: "10" }).setToken(registrationToken);
    const body = createSlashCommands({
      codex: config.agents.codex.models,
      claude: config.agents.claude.models,
    }).map((command) => command.toJSON());
    await Promise.all(
      config.discord.guildIds.map((guildId) =>
        rest.put(
          Routes.applicationGuildCommands(
            config.discord.applicationId,
            guildId,
          ),
          { body },
        ),
      ),
    );
    const token = readEnvironment(config.discord.tokenEnv);
    if (token === undefined || token.length === 0)
      throw new Error("Discord token is not configured");
    await this.client.login(token);
  }

  stop(): void {
    void this.client.destroy();
  }
}
