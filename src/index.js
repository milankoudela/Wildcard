import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";
import { commands } from "./commands.js";
import {
  ONBOARDING_BUTTON_ID,
  ONBOARDING_MODAL_ID,
  handleOnboardingButton,
  handleOnboardingModal,
} from "./onboarding.js";

const { DISCORD_TOKEN, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !GUILD_ID) {
  throw new Error("Set DISCORD_TOKEN and GUILD_ID in your .env file.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});
const commandByName = new Map(
  commands.map((command) => [command.data.name, command]),
);

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  try {
    const channel = await client.channels.fetch("1563620140749430894");
    if (!channel?.isTextBased() || channel.isDMBased()) {
      throw new Error("Configured greeting channel is not a server text channel.");
    }

    await channel.send(
      `Welcome to Wildcard, <@${member.id}>! Head to <#1563620042841661644> and click **Start onboarding** to register for campaigns.`,
    );
  } catch (error) {
    console.error("Failed to send the new-member greeting:", error);
  }
});

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
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.guildId !== GUILD_ID) {
        await interaction.reply({
          content: "This bot is only available in its configured server.",
          ephemeral: true,
        });
        return;
      }

      const command = commandByName.get(interaction.commandName);
      if (command) await command.execute(interaction);
      return;
    }

    if (
      interaction.isButton() &&
      interaction.customId === ONBOARDING_BUTTON_ID
    ) {
      await handleOnboardingButton(interaction, GUILD_ID);
      return;
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId === ONBOARDING_MODAL_ID
    ) {
      await handleOnboardingModal(interaction, GUILD_ID);
    }
  } catch (error) {
    console.error("Failed to handle Discord interaction:", error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "There was an error while handling this interaction.",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "There was an error while handling this interaction.",
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
