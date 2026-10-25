import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { getCreatorInfo } from "./creator-store.js";
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

export const commands = [
  pingCommand,
  onboardingCommand,
  closeTicketCommand,
  creatorInfoCommand,
];
