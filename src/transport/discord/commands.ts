import {
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import type { AgentConfig } from "../../config/schema.js";

type ProviderModels = Readonly<
  Record<"codex" | "claude", Pick<AgentConfig, "models">["models"]>
>;

function addModelOption(
  name: "codex_model" | "claude_model",
  label: string,
  selections: readonly { class: string }[],
  command: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder,
): void {
  if (selections.length === 0) return;
  command.addStringOption((option) =>
    option
      .setName(name)
      .setDescription(`${label} configured model class`)
      .setRequired(false)
      .addChoices(
        ...selections.map((selection) => ({
          name: selection.class,
          value: selection.class,
        })),
      ),
  );
}

export function createSlashCommands(models: ProviderModels) {
  const ask = new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask one or both agents")
    .addStringOption((option) =>
      option
        .setName("agent")
        .setDescription("Agent selection")
        .setRequired(true)
        .addChoices(
          { name: "Codex", value: "codex" },
          { name: "Claude", value: "claude" },
          { name: "Both", value: "both" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("question")
        .setDescription("Question to ask")
        .setRequired(true),
    );
  addModelOption("codex_model", "Codex", models.codex.selections, ask);
  addModelOption("claude_model", "Claude", models.claude.selections, ask);
  const debate = new SlashCommandBuilder()
    .setName("debate")
    .setDescription("Ask both agents to deliberate")
    .addStringOption((option) =>
      option.setName("topic").setDescription("Debate topic").setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("project")
        .setDescription("Registered project ID")
        .setRequired(false),
    );
  addModelOption("codex_model", "Codex", models.codex.selections, debate);
  addModelOption("claude_model", "Claude", models.claude.selections, debate);
  return [
    new SlashCommandBuilder()
      .setName("projects")
      .setDescription("List registered projects"),
    new SlashCommandBuilder()
      .setName("models")
      .setDescription("List configured model classes"),
    new SlashCommandBuilder()
      .setName("switch")
      .setDescription("Switch the active project")
      .addStringOption((option) =>
        option
          .setName("project")
          .setDescription("Registered project ID")
          .setRequired(true),
      ),
    ask,
    debate,
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Show your active runs"),
    new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Stop your current run")
      .addStringOption((option) =>
        option.setName("run").setDescription("Run ID").setRequired(false),
      ),
  ];
}
