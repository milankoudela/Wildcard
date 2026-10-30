import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

const NOTICE_COLOR = 0xf5a524;
const ERROR_COLOR = 0xe5484d;

/**
 * Throw this from a command to stop it and show the user a notice instead of
 * a generic error. The interaction handler in index.js sends it.
 */
export class CommandNotice extends Error {
  constructor(notice) {
    super(notice.missing);
    this.name = "CommandNotice";
    this.notice = notice;
  }
}

/**
 * Sends an ephemeral notice explaining what is missing or wrong with a
 * command and how to fix it. Works whether or not the interaction was
 * already deferred or answered.
 *
 *   missing  what is missing or wrong (required)
 *   fix      what to do about it (required)
 *   example  an example of a correct command (optional)
 */
export async function sendNotice(
  interaction,
  { missing, fix, example, title = "⚠️ Command incomplete", color = NOTICE_COLOR },
) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .addFields(
      { name: "What's missing", value: truncate(missing, 1024) },
      { name: "How to fix it", value: truncate(fix, 1024) },
    );
  if (example) {
    embed.addFields({ name: "Example", value: truncate(example, 1024) });
  }

  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (interaction.deferred) {
    await interaction.editReply({ ...payload, content: "" });
  } else if (interaction.replied) {
    await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }
}

/** Ephemeral reply that works whether or not the interaction was deferred. */
export async function respond(interaction, options) {
  const payload = typeof options === "string" ? { content: options } : options;
  if (interaction.deferred) {
    await interaction.editReply(payload);
  } else if (interaction.replied) {
    await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }
}

export async function requireAdministrator(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  await sendNotice(interaction, {
    title: "⛔ Administrators only",
    missing: "You need the Administrator permission to use this.",
    fix: "Ask a server administrator to run it for you.",
  });
  return false;
}

/** Notice for commands that must be run inside an onboarding ticket. */
export function notInTicketNotice(command) {
  return {
    missing: "This command has to be used inside an onboarding ticket.",
    fix: "Open the member's ticket channel (🎟️︲username) and run the command there.",
    example: command,
  };
}

/** Turns errors Discord commonly returns into a notice an admin can act on. */
export function explainError(error) {
  switch (error?.code) {
    case 50013:
      return {
        missing: "I'm missing a Discord permission for this action.",
        fix: "Make sure my role has View Channels, Send Messages, Embed Links, Add Reactions, Read Message History, Manage Channels, Manage Roles and Kick Members, and sits above every role I give out or member I remove.",
      };
    case 50001:
      return {
        missing: "I can't access that channel.",
        fix: "Give my role access to the channel (or its category) and try again.",
      };
    case 50035:
      return {
        missing: "Discord rejected the content: something is too long or a link is invalid.",
        fix: "Shorten the text or check the links, then try again.",
      };
    case 10007:
      return {
        missing: "That member is no longer in the server.",
        fix: "Nothing to do here, or check that you picked the right member.",
      };
    case 10008:
    case 10003:
      return {
        missing: "The message or channel I needed no longer exists.",
        fix: "Check that it hasn't been deleted, then try again.",
      };
    default:
      return null;
  }
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export { ERROR_COLOR };
