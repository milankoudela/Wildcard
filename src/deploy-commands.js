import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  throw new Error("Set DISCORD_TOKEN, CLIENT_ID, and GUILD_ID in your .env file.");
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

try {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands.map((command) => command.data.toJSON()),
  });
  console.log(`Registered ${commands.length} command(s) for guild ${GUILD_ID}.`);
} catch (error) {
  console.error("Failed to register slash commands:", error);
  process.exitCode = 1;
}
