import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { getCreatorInfo } from "./creator-store.js";
import { saveReactionRole } from "./reaction-role-store.js";
import {
  ONBOARDING_CHANNEL_ID,
  buildOnboardingEmbed,
  buildOnboardingButton,
} from "./onboarding.js";
import { closeTicket } from "./tickets.js";

async function requireAdministrator(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: "Only server administrators can use this command.",
      ephemeral: true,
    });
    return false;
  }
  return true;
}

export const pingCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is online."),
  async execute(interaction) {
    await interaction.reply("Pong!");
  },
};

export const onboardingCommand = {
  data: new SlashCommandBuilder()
    .setName("onboarding")
    .setDescription("Post the Wildcard campaign onboarding panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!(await requireAdministrator(interaction))) return;

    const channel = await interaction.guild.channels.fetch(
      ONBOARDING_CHANNEL_ID,
    );
    if (!channel?.isTextBased() || channel.isDMBased()) {
      throw new Error(
        `Onboarding channel ${ONBOARDING_CHANNEL_ID} is not a server text channel.`,
      );
    }

    await channel.send({
      embeds: [buildOnboardingEmbed(interaction.guild)],
      components: [buildOnboardingButton()],
    });
    await interaction.reply({
      content: `Posted the onboarding panel in <#${ONBOARDING_CHANNEL_ID}>.`,
      ephemeral: true,
    });
  },
};

export const closeTicketCommand = {
  data: new SlashCommandBuilder()
    .setName("close-ticket")
    .setDescription("Archive this onboarding ticket.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  async execute(interaction) {
    if (!(await requireAdministrator(interaction))) return;
    await closeTicket(interaction);
  },
};

export const creatorInfoCommand = {
  data: new SlashCommandBuilder()
    .setName("creatorinfo")
    .setDescription("Look up a creator's onboarding name and email.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The creator to look up.")
        .setRequired(true),
    ),
  async execute(interaction) {
    if (!(await requireAdministrator(interaction))) return;

    const user = interaction.options.getUser("user", true);
    const creator = await getCreatorInfo(user.id);
    if (!creator) {
      await interaction.reply({
        content: `No saved onboarding information was found for <@${user.id}>.`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.reply({
      content: `**Full Name:** ${creator.fullName}\n**Email:** ${creator.email}`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  },
};

function parseReactionEmoji(value) {
  const customEmoji = value.match(/^<(a?):[^:]+:(\d+)>$/);
  if (customEmoji) {
    return {
      key: customEmoji[2],
      display: value,
      reaction: value,
    };
  }

  if (value.includes(":") || value.startsWith("<") || value.endsWith(">")) {
    return null;
  }

  return {
    key: value,
    display: value,
    reaction: value,
  };
}

async function findMessageById(guild, messageId) {
  const channels = await guild.channels.fetch();
  const textChannels = channels.filter(
    (channel) =>
      channel &&
      channel.isTextBased() &&
      !channel.isDMBased(),
  );

  for (const channel of textChannels.values()) {
    try {
      const message = await channel.messages.fetch(messageId);
      return { channel, message };
    } catch (error) {
      if (error.code === 10008 || error.code === 50001 || error.code === 50013) {
        continue;
      }
      throw error;
    }
  }

  return null;
}

export const reactionRoleCommand = {
  data: new SlashCommandBuilder()
    .setName("reaction-role")
    .setDescription("Configure a reaction that gives users a server role.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("message-id")
        .setDescription("ID of the message users will react to.")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("role-id")
        .setDescription("ID of the role to assign.")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName("emoji")
        .setDescription("Unicode emoji or custom emoji, such as <:name:id>.")
        .setRequired(true),
    ),
  async execute(interaction) {
    if (!(await requireAdministrator(interaction))) return;

    const messageId = interaction.options.getString("message-id", true).trim();
    const roleId = interaction.options.getString("role-id", true).trim();
    const emojiInput = interaction.options.getString("emoji", true).trim();

    if (!/^\d{17,20}$/.test(messageId) || !/^\d{17,20}$/.test(roleId)) {
      await interaction.reply({
        content: "Enter a valid Discord message ID and role ID.",
        ephemeral: true,
      });
      return;
    }

    const emoji = parseReactionEmoji(emojiInput);
    if (!emoji) {
      await interaction.reply({
        content:
          "Enter a Unicode emoji or a custom emoji in the format `<:name:id>` or `<a:name:id>`.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const role = await interaction.guild.roles.fetch(roleId);
    if (!role) {
      await interaction.editReply("I couldn't find that role in this server.");
      return;
    }

    const botMember =
      interaction.guild.members.me ??
      (await interaction.guild.members.fetchMe());
    if (!role.editable || role.position >= botMember.roles.highest.position) {
      await interaction.editReply(
        "I can't assign that role. Move the bot's highest role above it.",
      );
      return;
    }

    const target = await findMessageById(interaction.guild, messageId);
    if (!target) {
      await interaction.editReply(
        "I couldn't find that message in a server text channel the bot can access.",
      );
      return;
    }

    let addedBotReaction = false;
    try {
      const existingReaction = target.message.reactions.cache.find(
        (reaction) =>
          (reaction.emoji.id ?? reaction.emoji.name) === emoji.key &&
          reaction.me,
      );
      if (!existingReaction) {
        addedBotReaction = true;
      }
      await target.message.react(emoji.reaction);
    } catch (error) {
      console.error(
        `Failed to add configured reaction ${emoji.display} to message ${messageId}:`,
        error,
      );
      await interaction.editReply(
        "I couldn't add that reaction. Check that the bot can access the message and use that emoji.",
      );
      return;
    }

    try {
      await saveReactionRole({
        guildId: interaction.guildId,
        channelId: target.channel.id,
        messageId,
        roleId,
        emojiKey: emoji.key,
        emojiDisplay: emoji.display,
      });
    } catch (error) {
      console.error("Failed to save the reaction-role configuration:", error);
      if (addedBotReaction) {
        try {
          const reaction = target.message.reactions.cache.find(
            (item) => (item.emoji.id ?? item.emoji.name) === emoji.key,
          );
          await reaction?.users.remove(botMember.id);
        } catch (cleanupError) {
          console.error(
            `Failed to remove reaction ${emoji.display} after configuration save failed:`,
            cleanupError,
          );
        }
      }
      throw error;
    }

    await interaction.editReply(
      `Configured ${emoji.display} on [that message](https://discord.com/channels/${interaction.guildId}/${target.channel.id}/${messageId}) to give <@&${role.id}> when a user reacts and remove it when they unreact.`,
    );
  },
};

export const commands = [
  pingCommand,
  onboardingCommand,
  closeTicketCommand,
  creatorInfoCommand,
  reactionRoleCommand,
];
