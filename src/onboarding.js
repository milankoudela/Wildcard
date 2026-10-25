import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { createTicket } from "./tickets.js";
import { saveCreatorInfo } from "./creator-store.js";

export const ONBOARDING_CHANNEL_ID = "1563620042841661644";
export const ONBOARDING_BUTTON_ID = "wildcard:start-onboarding";
export const ONBOARDING_MODAL_ID = "wildcard:onboarding-form";
const ACCESS_ROLE_ID = "1563677636654407841";
const OPEN_TICKET_SUBMISSIONS = new Set();

export function buildOnboardingEmbed(guild) {
  const wildcardEmoji = guild.emojis.cache.find(
    (emoji) => emoji.name === "wildcard",
  );
  const title = wildcardEmoji
    ? `${wildcardEmoji} Welcome to Wildcard`
    : ":wildcard: Welcome to Wildcard";

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      [
        "Find a campaign that fits the videos you want to make. You can apply for more than one.",
        "",
        "Read about the campaigns below, then click **Start onboarding** to agree to the server rules, complete your application, and choose your campaigns.",
        "",
        "**First time here?** Staff will review your first application before granting trial access. You can speak with the team in your private channel while you wait.",
        "",
        `For further information on the campaigns read <#1563713237407637574>.`,
      ].join("\n"),
    )
    .addFields(
      {
        name: "Halo AI",
        value: [
          "- AI Photo Editing app.",
          "- Requires posting on: Instagram, TikTok, Facebook, Snapchat, YouTube.",
          "- Posting volume is at least daily and up to 3 daily videos.",
        ].join("\n"),
      },
      {
        name: "Cantina",
        value: [
          "- Create short, entertaining videos featuring Cantina’s AI characters and video tools.",
          "- Content includes comedy, character interactions, and creative scenarios.",
        ].join("\n"),
      },
      {
        name: "CapCut",
        value: "- Video editing app.",
      },
    );
}

export function buildOnboardingButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(ONBOARDING_BUTTON_ID)
      .setLabel("Start onboarding")
      .setEmoji("🚀")
      .setStyle(ButtonStyle.Primary),
  );
}

function buildOnboardingModal() {
  const fullName = new TextInputBuilder()
    .setCustomId("full_name")
    .setLabel("Full Name")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);
  const email = new TextInputBuilder()
    .setCustomId("email")
    .setLabel("Email")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(254);
  const country = new TextInputBuilder()
    .setCustomId("country")
    .setLabel("Country")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  return new ModalBuilder()
    .setCustomId(ONBOARDING_MODAL_ID)
    .setTitle("Wildcard onboarding")
    .addComponents(
      new ActionRowBuilder().addComponents(fullName),
      new ActionRowBuilder().addComponents(email),
      new ActionRowBuilder().addComponents(country),
    );
}

export async function handleOnboardingButton(interaction, guildId) {
  if (interaction.guildId !== guildId) {
    await interaction.reply({
      content: "This bot is only available in its configured server.",
      ephemeral: true,
    });
    return;
  }

  await interaction.showModal(buildOnboardingModal());
}

export async function handleOnboardingModal(interaction, guildId) {
  if (interaction.guildId !== guildId || !interaction.guild) {
    await interaction.reply({
      content: "This bot is only available in its configured server.",
      ephemeral: true,
    });
    return;
  }

  const userId = interaction.user.id;
  if (OPEN_TICKET_SUBMISSIONS.has(userId)) {
    await interaction.reply({
      content: "Your onboarding submission is already being processed.",
      ephemeral: true,
    });
    return;
  }

  OPEN_TICKET_SUBMISSIONS.add(userId);

  try {
    await interaction.deferReply({ ephemeral: true });
    const application = {
      fullName: interaction.fields.getTextInputValue("full_name").trim(),
      email: interaction.fields.getTextInputValue("email").trim(),
      country: interaction.fields.getTextInputValue("country").trim(),
    };
    if (!application.fullName || !application.email || !application.country) {
      await interaction.editReply({
        content: "Please fill in your full name, email, and country.",
      });
      return;
    }

    const result = await createTicket(
      interaction.guild,
      interaction.user,
      application,
    );
    if (!result.created) {
      await interaction.editReply({
        content: `You already have an open onboarding ticket: <#${result.channel.id}>`,
      });
      return;
    }

    let creatorInfoSaved = true;
    try {
      await saveCreatorInfo(userId, application);
    } catch (error) {
      creatorInfoSaved = false;
      console.error(
        `Ticket ${result.channel.id} was created, but creator information could not be saved:`,
        error,
      );
    }

    let accessRoleAssigned = true;
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.roles.add(
        ACCESS_ROLE_ID,
        "Completed Wildcard onboarding form",
      );
    } catch (error) {
      console.error(
        `Ticket ${result.channel.id} was created, but role ${ACCESS_ROLE_ID} could not be assigned:`,
        error,
      );
      accessRoleAssigned = false;
    }

    const followUp = [];
    if (!creatorInfoSaved) {
      followUp.push(
        "Your name and email could not be saved for `/creatorinfo`; please let a server administrator know.",
      );
    }
    if (!accessRoleAssigned) {
      followUp.push(
        "I couldn't assign the server access role. Please let a server administrator know.",
      );
    }
    await interaction.editReply({
      content: [
        `Your onboarding ticket is ready: <#${result.channel.id}>`,
        ...followUp,
      ].join("\n"),
    });
  } catch (error) {
    console.error("Failed to process the onboarding submission:", error);
    const response = {
      content:
        "I couldn't create your onboarding ticket. Please try again later or contact a server administrator.",
      ephemeral: true,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: response.content });
    } else {
      await interaction.reply(response);
    }
  } finally {
    OPEN_TICKET_SUBMISSIONS.delete(userId);
  }
}
