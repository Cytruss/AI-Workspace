import { describe, expect, test } from "vitest";
import { authorize } from "../../../../src/transport/discord/authorization.js";

const config = {
  guildIds: ["allowed-guild"],
  allowedUserIds: ["allowed-user"],
};

describe("Discord authorization", () => {
  test("rejects a direct message before accessing application state", () => {
    expect(() =>
      authorize({ channelId: "c", userId: "allowed-user" }, config),
    ).toThrow("This command is available only in an authorized server");
  });

  test("rejects an unauthorized guild", () => {
    expect(() =>
      authorize(
        { guildId: "other-guild", channelId: "c", userId: "allowed-user" },
        config,
      ),
    ).toThrow("This server is not authorized");
  });

  test("rejects an unauthorized user", () => {
    expect(() =>
      authorize(
        { guildId: "allowed-guild", channelId: "c", userId: "other-user" },
        config,
      ),
    ).toThrow("You are not authorized");
  });

  test("returns a project scope for an authorized guild user", () => {
    expect(
      authorize(
        { guildId: "allowed-guild", channelId: "c", userId: "allowed-user" },
        config,
      ),
    ).toEqual({
      guildId: "allowed-guild",
      channelId: "c",
      userId: "allowed-user",
    });
  });
});
