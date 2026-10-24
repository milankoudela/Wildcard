import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { commands } from "./commands.js";

const { DISCORD_TOKEN, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !GUILD_ID) {
  throw new Error("Set DISCORD_TOKEN and GUILD_ID in your .env file.");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const commandByName = new Map(
  commands.map((command) => [command.data.name, command]),
);

client.once(Events.ClientReady, async (readyClient) => {
  try {
    await readyClient.guilds.fetch(GUILD_ID);
    console.log(`Ready as ${readyClient.user.tag} in guild ${GUILD_ID}.`);
  } catch (error) {
    console.error(`Bot cannot access configured guild ${GUILD_ID}:`, error);
    readyClient.destroy();
    process.exitCode = 1;
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.guildId !== GUILD_ID) {
    await interaction.reply({
      content: "This bot is only available in its configured server.",
      ephemeral: true,
    });
    return;
  }

  const command = commandByName.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Command /${interaction.commandName} failed:`, error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "There was an error while running this command.",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "There was an error while running this command.",
        ephemeral: true,
      });
    }
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

try {
  await client.login(DISCORD_TOKEN);
} catch (error) {
  console.error("Failed to log in to Discord:", error);
  process.exitCode = 1;
}
