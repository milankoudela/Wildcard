import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} from "discord.js";
import { handleBriefReaction } from "./briefs.js";
import { commands } from "./commands.js";
import { EMBED_MODAL_PREFIX } from "./config.js";
import {
  clearNoticeForChannel,
  clearNoticesForUser,
  handleTicketMessage,
  startInactivityChecks,
} from "./inactivity.js";
import { CommandNotice, ERROR_COLOR, explainError, sendNotice } from "./notices.js";
import { handleEmbedModal } from "./onboarding-embed.js";
import {
  LEGACY_ONBOARDING_BUTTON_ID,
  ONBOARDING_MODAL_ID,
  TICKET_ONBOARDING_BUTTON_ID,
  handleLegacyOnboardingButton,
  handleMemberJoin,
  handleMemberLeave,
  handleOnboardingModal,
  handleTicketOnboardingButton,
} from "./onboarding.js";
import { handleReactionRoleEvent } from "./reaction-roles.js";

const { DISCORD_TOKEN, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !GUILD_ID) {
  throw new Error("Set DISCORD_TOKEN and GUILD_ID in your .env file.");
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
    // Lets an inactivity notice be lifted as soon as the owner writes.
    // Only the author is used, so the Message Content intent isn't needed.
    GatewayIntentBits.GuildMessages,
  ],
  partials: [
    Partials.Channel,
    // Lets the bot see members leaving even if they joined before a restart.
    Partials.GuildMember,
    Partials.Message,
    Partials.Reaction,
    Partials.User,
  ],
});
const commandByName = new Map(
  commands.map((command) => [command.data.name, command]),
);

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  await handleMemberJoin(member);
});

client.on(Events.GuildMemberRemove, async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  try {
    await clearNoticesForUser(member.id);
    await handleMemberLeave(member);
  } catch (error) {
    console.error(`Failed to clean up the ticket of departed member ${member.id}:`, error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.guildId !== GUILD_ID) return;
  try {
    await handleTicketMessage(message);
  } catch (error) {
    console.error("Failed to process a ticket message:", error);
  }
});

client.on(Events.ChannelDelete, async (channel) => {
  try {
    await clearNoticeForChannel(channel.id);
  } catch (error) {
    console.error(`Failed to clear the inactivity notice of deleted channel ${channel.id}:`, error);
  }
});

async function handleReaction(reaction, user, action) {
  if (user.bot) return;

  if (reaction.partial) {
    reaction = await reaction.fetch();
  }
  const message = reaction.message.partial
    ? await reaction.message.fetch()
    : reaction.message;
  if (!message?.guildId || message.guildId !== GUILD_ID) return;

  // Briefs inside tickets first; any other message may be a /reaction-role rule.
  if (await handleBriefReaction(reaction, message, user, action)) return;
  await handleReactionRoleEvent(reaction, message, user, GUILD_ID, action);
}

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    await handleReaction(reaction, user, "add");
  } catch (error) {
    console.error("Failed to assign a reaction role:", error);
  }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  try {
    await handleReaction(reaction, user, "remove");
  } catch (error) {
    console.error("Failed to remove a reaction role:", error);
  }
});

client.once(Events.ClientReady, async (readyClient) => {
  try {
    await readyClient.guilds.fetch(GUILD_ID);
    console.log(`Ready as ${readyClient.user.tag} in guild ${GUILD_ID}.`);
    startInactivityChecks(readyClient);
  } catch (error) {
    console.error(`Bot cannot access configured guild ${GUILD_ID}:`, error);
    readyClient.destroy();
    process.exitCode = 1;
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isRepliable()) return;

  try {
    if (interaction.guildId !== GUILD_ID || !interaction.guild) {
      await interaction.reply({
        content: "This bot is only available in its configured server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = commandByName.get(interaction.commandName);
      if (!command) {
        await sendNotice(interaction, {
          missing: `\`/${interaction.commandName}\` no longer exists in this version of the bot.`,
          fix: "An administrator should run `npm run deploy-commands` so Discord shows the current command list.",
        });
        return;
      }
      await command.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === TICKET_ONBOARDING_BUTTON_ID) {
        await handleTicketOnboardingButton(interaction);
      } else if (interaction.customId === LEGACY_ONBOARDING_BUTTON_ID) {
        await handleLegacyOnboardingButton(interaction);
      }
      return;
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId === ONBOARDING_MODAL_ID
    ) {
      await handleOnboardingModal(interaction);
      return;
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith(EMBED_MODAL_PREFIX)
    ) {
      await handleEmbedModal(interaction);
    }
  } catch (error) {
    try {
      if (error instanceof CommandNotice) {
        await sendNotice(interaction, error.notice);
        return;
      }

      console.error("Failed to handle Discord interaction:", error);
      const explained = explainError(error);
      await sendNotice(interaction, {
        title: "❌ Couldn't complete that",
        color: ERROR_COLOR,
        ...(explained ?? {
          missing: "Something unexpected went wrong on my side.",
          fix: "Try again in a moment. If it keeps happening, check the bot's console log for the error.",
        }),
      });
    } catch (replyError) {
      console.error("Failed to report the interaction error:", replyError);
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
