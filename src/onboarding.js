import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { listBriefs } from "./brief-store.js";
import { postBriefsToTicket, restoreBriefRoles } from "./briefs.js";
import { saveCreatorInfo } from "./creator-store.js";
import {
  ACCESS_ROLE_ID,
  GREETING_CHANNEL_ID,
  LEGACY_ONBOARDING_BUTTON_ID,
  ONBOARDING_MODAL_ID,
  STAFF_ROLE_ID,
  TICKET_ONBOARDING_BUTTON_ID,
} from "./config.js";
import { renderGuildText } from "./emoji.js";
import { sendNotice } from "./notices.js";
import { buildOnboardingEmbed } from "./onboarding-embed.js";
import {
  createTicketChannel,
  findOpenTicket,
  getTicketInfo,
  markTicketOnboarded,
} from "./tickets.js";

export {
  LEGACY_ONBOARDING_BUTTON_ID,
  ONBOARDING_MODAL_ID,
  TICKET_ONBOARDING_BUTTON_ID,
};

const OPEN_SUBMISSIONS = new Set();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TICKET_CREATIONS = new Map();

function buildStartButton({ completed = false } = {}) {
  const button = new ButtonBuilder()
    .setCustomId(TICKET_ONBOARDING_BUTTON_ID)
    .setStyle(completed ? ButtonStyle.Success : ButtonStyle.Primary)
    .setLabel(completed ? "Onboarding completed" : "Start onboarding")
    .setEmoji(completed ? "✅" : "🚀")
    .setDisabled(completed);
  return new ActionRowBuilder().addComponents(button);
}

function buildNextStepsEmbed(guild, fullName, hasBriefs) {
  const briefSteps = hasBriefs
    ? [
        "📖 The briefs for our campaigns are right below. Read the ones that catch your interest.",
        "",
        "🧰 React to a brief with the emoji shown on it to get the role for that campaign. Changed your mind? Just remove your reaction.",
      ]
    : ["📖 The campaign briefs will be posted in this channel soon."];

  return new EmbedBuilder()
    .setTitle(renderGuildText("You're all set! :wildcard:", guild))
    .setDescription(
      [
        `Thanks, ${fullName}! Your application is in.`,
        "",
        ...briefSteps,
        "",
        `Any questions along the way? Just tag <@&${STAFF_ROLE_ID}> in here and someone will get back to you. 🙌`,
      ].join("\n"),
    );
}

function buildApplicationEmbed(application) {
  return new EmbedBuilder()
    .setTitle("Onboarding application")
    .addFields(
      { name: "Full Name", value: application.fullName },
      { name: "Email", value: application.email },
      { name: "Country", value: application.country },
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

/**
 * Returns the user's open ticket, creating it (with the onboarding intro and
 * button) when they have none. Concurrent calls for the same user share one
 * creation, so a join and a button click can never open two tickets.
 */
export function openOnboardingTicket(guild, user) {
  const inFlight = TICKET_CREATIONS.get(user.id);
  if (inFlight) return inFlight;

  const operation = (async () => {
    const existing = findOpenTicket(guild, user.id);
    if (existing) return { channel: existing, created: false };

    const introEmbed = await buildOnboardingEmbed(guild, user);
    const channel = await createTicketChannel(guild, user);
    try {
      await channel.send({
        content: `<@${user.id}>`,
        embeds: [introEmbed],
        components: [buildStartButton()],
        allowedMentions: { users: [user.id] },
      });
    } catch (error) {
      try {
        await channel.delete("Failed to initialize onboarding ticket");
      } catch (cleanupError) {
        console.error(
          `Failed to clean up uninitialized onboarding ticket ${channel.id}:`,
          cleanupError,
        );
      }
      throw error;
    }
    return { channel, created: true };
  })().finally(() => TICKET_CREATIONS.delete(user.id));

  TICKET_CREATIONS.set(user.id, operation);
  return operation;
}

/** A returning member already has an open ticket: point them back to it. */
async function welcomeBack(channel, member) {
  const ticket = getTicketInfo(channel);
  if (ticket.pending) {
    await channel.send({
      content: `Welcome back, <@${member.id}>! Your onboarding is waiting for you above. Click **Start onboarding** whenever you're ready.`,
      allowedMentions: { users: [member.id] },
    });
    return;
  }

  // Discord strips roles when someone leaves, so restore what onboarding and
  // their brief reactions had given them.
  const problems = [];
  try {
    await member.roles.add(ACCESS_ROLE_ID, "Returning member with a completed onboarding ticket");
  } catch (error) {
    problems.push("access role");
    console.error(`Failed to restore access role for returning member ${member.id}:`, error);
  }
  try {
    await restoreBriefRoles(channel, member);
  } catch (error) {
    problems.push("campaign roles");
    console.error(`Failed to restore campaign roles for returning member ${member.id}:`, error);
  }

  await channel.send({
    content: problems.length
      ? `Welcome back, <@${member.id}>! I couldn't restore your ${problems.join(" and ")}. <@&${STAFF_ROLE_ID}> will sort it out for you.`
      : `Welcome back, <@${member.id}>! Your access and the campaigns you picked below have been restored.`,
    allowedMentions: { users: [member.id], roles: problems.length ? [STAFF_ROLE_ID] : [] },
  });
}

export async function handleMemberJoin(member) {
  if (member.user.bot) return;

  let ticket = null;
  let returning = false;
  try {
    const result = await openOnboardingTicket(member.guild, member.user);
    ticket = result.channel;
    returning = !result.created;
  } catch (error) {
    console.error(`Failed to open an onboarding ticket for ${member.user.tag}:`, error);
  }

  if (ticket && returning) {
    try {
      await welcomeBack(ticket, member);
    } catch (error) {
      console.error(`Failed to welcome back ${member.user.tag} in ticket ${ticket.id}:`, error);
    }
  }

  try {
    const channel = await member.client.channels.fetch(GREETING_CHANNEL_ID);
    if (!channel?.isTextBased() || channel.isDMBased()) {
      throw new Error("Configured greeting channel is not a server text channel.");
    }

    let content;
    let roles = [];
    if (!ticket) {
      content = `Welcome to Wildcard, <@${member.id}>! <@&${STAFF_ROLE_ID}> will open your private onboarding ticket shortly.`;
      roles = [STAFF_ROLE_ID];
    } else if (returning) {
      content = `Welcome back to Wildcard, <@${member.id}>! 🎟️ Your private ticket is still open: <#${ticket.id}>`;
    } else {
      content = `Welcome to Wildcard, <@${member.id}>! 🎟️ Your private onboarding ticket is ready: <#${ticket.id}>. Open it to complete your application, then read the campaign briefs and pick your campaigns.`;
    }

    await channel.send({
      content,
      allowedMentions: { users: [member.id], roles },
    });
  } catch (error) {
    console.error("Failed to send the new-member greeting:", error);
  }
}

/** Removes tickets of members who leave before submitting the form, so unused tickets don't fill the category. */
export async function handleMemberLeave(member) {
  const ticket = findOpenTicket(member.guild, member.id);
  if (!ticket || !getTicketInfo(ticket).pending) return;

  await ticket.delete("Member left before completing onboarding");
}

export async function handleLegacyOnboardingButton(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await openOnboardingTicket(interaction.guild, interaction.user);
  await interaction.editReply({
    content: result.created
      ? `Your onboarding ticket is ready: <#${result.channel.id}>`
      : `You already have an onboarding ticket: <#${result.channel.id}>`,
  });
}

async function rejectUnlessOwnPendingTicket(interaction) {
  const ticket = getTicketInfo(interaction.channel);
  let content = null;
  if (!ticket || ticket.ownerId !== interaction.user.id) {
    content = "Only the owner of this ticket can complete its onboarding.";
  } else if (ticket.archived) {
    content = "This onboarding ticket has been archived.";
  } else if (!ticket.pending) {
    content = "You've already completed onboarding.";
  }

  if (content) {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    return true;
  }
  return false;
}

export async function handleTicketOnboardingButton(interaction) {
  if (await rejectUnlessOwnPendingTicket(interaction)) return;
  await interaction.showModal(buildOnboardingModal());
}

export async function handleOnboardingModal(interaction) {
  const userId = interaction.user.id;
  if (OPEN_SUBMISSIONS.has(userId)) {
    await interaction.reply({
      content: "Your onboarding submission is already being processed.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (await rejectUnlessOwnPendingTicket(interaction)) return;

  OPEN_SUBMISSIONS.add(userId);
  const channel = interaction.channel;

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const application = {
      fullName: interaction.fields.getTextInputValue("full_name").trim(),
      email: interaction.fields.getTextInputValue("email").trim(),
      country: interaction.fields.getTextInputValue("country").trim(),
    };
    const formProblems = [];
    if (!application.fullName) formProblems.push("- Your full name is empty.");
    if (!application.email) formProblems.push("- Your email is empty.");
    else if (!EMAIL_PATTERN.test(application.email)) {
      formProblems.push(`- \`${application.email}\` doesn't look like an email address.`);
    }
    if (!application.country) formProblems.push("- Your country is empty.");
    if (formProblems.length) {
      await sendNotice(interaction, {
        title: "⚠️ Form incomplete",
        missing: formProblems.join("\n"),
        fix: "Click **Start onboarding** again and fill in every box. Use an email you check, like `name@example.com`.",
      });
      return;
    }

    // The application is the one step that must succeed; everything after it
    // is reported to the user and logged if it fails.
    await channel.send({
      embeds: [buildApplicationEmbed(application)],
      allowedMentions: { parse: [] },
    });

    const problems = [];

    try {
      await markTicketOnboarded(channel);
    } catch (error) {
      console.error(`Failed to mark ticket ${channel.id} as onboarded:`, error);
    }

    if (interaction.isFromMessage()) {
      try {
        await interaction.message.edit({ components: [buildStartButton({ completed: true })] });
      } catch (error) {
        console.error(`Failed to disable the onboarding button in ticket ${channel.id}:`, error);
      }
    }

    try {
      await saveCreatorInfo(userId, application);
    } catch (error) {
      problems.push(
        "Your name and email could not be saved for `/creatorinfo`; please let a server administrator know.",
      );
      console.error(
        `Ticket ${channel.id} received an application, but creator information could not be saved:`,
        error,
      );
    }

    try {
      const member = await interaction.guild.members.fetch(userId);
      await member.roles.add(ACCESS_ROLE_ID, "Completed Wildcard onboarding form");
    } catch (error) {
      problems.push(
        "I couldn't assign the server access role. Please let a server administrator know.",
      );
      console.error(
        `Ticket ${channel.id} received an application, but role ${ACCESS_ROLE_ID} could not be assigned:`,
        error,
      );
    }

    try {
      const briefs = await listBriefs();
      await channel.send({
        embeds: [buildNextStepsEmbed(interaction.guild, application.fullName, briefs.length > 0)],
        allowedMentions: { parse: [] },
      });
      await postBriefsToTicket(channel, briefs);
    } catch (error) {
      problems.push(
        "I couldn't post all the campaign briefs. Please let a server administrator know.",
      );
      console.error(`Failed to post campaign briefs in ticket ${channel.id}:`, error);
    }

    await interaction.editReply({
      content: [
        "You're all set! Check out the campaign briefs in this channel and react to pick your campaigns.",
        ...problems,
      ].join("\n"),
    });
  } catch (error) {
    console.error("Failed to process the onboarding submission:", error);
    const content =
      "I couldn't process your onboarding form. Please try again later or contact a server administrator.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } finally {
    OPEN_SUBMISSIONS.delete(userId);
  }
}
