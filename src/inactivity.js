import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import {
  INACTIVITY_DAYS,
  INACTIVITY_REMINDER_DAYS,
  STAFF_ROLE_ID,
} from "./config.js";
import { createJsonStore } from "./json-store.js";
import {
  CommandNotice,
  notInTicketNotice,
  requireAdministrator,
  respond,
} from "./notices.js";
import { archiveTicket, getTicketInfo } from "./tickets.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;
const KICK_REASON = `Inactivity (no reply within ${INACTIVITY_DAYS} days of the notice)`;

// Active notices, one per ticket:
// [{ channelId, guildId, userId, issuedBy, issuedAt, deadline, noticeMessageId, reminded }]
const store = createJsonStore("inactivity-notices.json", {
  fallback: () => [],
  validate(value) {
    if (!Array.isArray(value)) throw new Error("expected an array");
    for (const notice of value) {
      if (
        !/^\d+$/.test(notice?.channelId) ||
        !/^\d+$/.test(notice.guildId) ||
        !/^\d+$/.test(notice.userId) ||
        !/^\d+$/.test(notice.noticeMessageId) ||
        typeof notice.deadline !== "number"
      ) {
        throw new Error("contains an invalid notice");
      }
    }
  },
});

// channelId -> notice, so checking every incoming message is a single lookup.
let noticesByChannel;

async function getNotices() {
  if (!noticesByChannel) {
    noticesByChannel = new Map((await store.read()).map((notice) => [notice.channelId, notice]));
  }
  return noticesByChannel;
}

async function saveNotice(notice) {
  await getNotices();
  await store.update((notices) => [
    ...notices.filter((item) => item.channelId !== notice.channelId),
    notice,
  ]);
  noticesByChannel.set(notice.channelId, notice);
}

async function removeNotice(channelId) {
  const notices = await getNotices();
  if (!notices.has(channelId)) return false;
  await store.update((items) => items.filter((item) => item.channelId !== channelId));
  notices.delete(channelId);
  return true;
}

const timestamp = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`;

function buildNoticeEmbed(userId, deadline) {
  return new EmbedBuilder()
    .setColor(0xf5a524)
    .setTitle("⏳ Inactivity notice")
    .setDescription(
      [
        `Hey <@${userId}>, we haven't heard from you in a while.`,
        "",
        `Please send a message in this channel by ${timestamp(deadline, "F")} (${timestamp(deadline, "R")}). If we don't hear from you by then, you'll be removed from the server for inactivity.`,
        "",
        "Need more time or have a question? Just tell us here.",
      ].join("\n"),
    );
}

/** Lifts the notice as soon as the ticket owner writes in their ticket. */
export async function handleTicketMessage(message) {
  if (message.author.bot || !message.inGuild()) return;

  const notice = (await getNotices()).get(message.channelId);
  if (!notice || notice.userId !== message.author.id) return;

  await removeNotice(message.channelId);
  await message.reply({
    content: "✅ Thanks for checking in! The inactivity notice has been lifted.",
    allowedMentions: { repliedUser: false },
  });
}

/** Clears notices when the ticket is archived or deleted. */
export async function clearNoticeForChannel(channelId) {
  return removeNotice(channelId);
}

/** Clears notices when the member leaves on their own. */
export async function clearNoticesForUser(userId) {
  for (const notice of [...(await getNotices()).values()]) {
    if (notice.userId === userId) await removeNotice(notice.channelId);
  }
}

/** Checks the ticket for a message from its owner after the notice (covers replies sent while the bot was offline). */
async function ownerReplied(channel, notice) {
  let after = notice.noticeMessageId;
  for (let page = 0; page < 5; page += 1) {
    const batch = await channel.messages.fetch({ after, limit: 100 });
    if (batch.size === 0) return false;
    if (batch.some((message) => message.author?.id === notice.userId)) return true;
    after = batch.reduce(
      (newest, message) => (BigInt(message.id) > BigInt(newest) ? message.id : newest),
      after,
    );
  }
  return false;
}

async function processNotice(client, notice, now) {
  const guild = client.guilds.cache.get(notice.guildId);
  const channel = guild?.channels.cache.get(notice.channelId);
  const ticket = getTicketInfo(channel);
  if (!ticket || ticket.archived) {
    await removeNotice(notice.channelId);
    return;
  }

  const reminderAt = notice.deadline - INACTIVITY_REMINDER_DAYS * DAY_MS;
  if (now < notice.deadline && (notice.reminded || now < reminderAt)) return;

  if (await ownerReplied(channel, notice)) {
    await removeNotice(notice.channelId);
    return;
  }

  if (now < notice.deadline) {
    await channel.send({
      content: `<@${notice.userId}> ⏳ Reminder: please send a message here by ${timestamp(notice.deadline, "F")} (${timestamp(notice.deadline, "R")}), or you'll be removed from the server for inactivity.`,
      allowedMentions: { users: [notice.userId] },
    });
    await saveNotice({ ...notice, reminded: true });
    return;
  }

  // Deadline passed with no reply.
  let member;
  try {
    member = await guild.members.fetch(notice.userId);
  } catch (error) {
    if (error.code === 10007) {
      await removeNotice(notice.channelId);
      return;
    }
    throw error;
  }

  await removeNotice(notice.channelId);
  try {
    if (!member.kickable) {
      throw new Error("Member is not kickable by the bot.");
    }
    if (!ticket.pending) {
      await channel.send({
        content: `<@${notice.userId}> didn't reply within ${INACTIVITY_DAYS} days and has been removed from the server for inactivity.`,
        allowedMentions: { parse: [] },
      });
    }
    try {
      await member.send(
        `You've been removed from **${guild.name}** for inactivity, because we didn't hear from you within ${INACTIVITY_DAYS} days of the notice in your ticket. You're welcome to rejoin anytime.`,
      );
    } catch {
      // Members can have DMs closed; the kick goes ahead regardless.
    }
    await member.kick(KICK_REASON);
  } catch (error) {
    console.error(`Failed to kick ${notice.userId} for inactivity:`, error);
    await channel.send({
      content: `<@&${STAFF_ROLE_ID}> The inactivity deadline for <@${notice.userId}> has passed, but I couldn't remove them (my role must be above theirs and have Kick Members). Please handle it manually.`,
      allowedMentions: { roles: [STAFF_ROLE_ID] },
    });
    return;
  }

  // Tickets still waiting for the form are deleted by the member-leave
  // handler; completed ones are archived so the history is kept.
  if (!ticket.pending) {
    await archiveTicket(channel, KICK_REASON);
  }
}

let checking = false;

export async function checkInactivityNotices(client) {
  if (checking) return;
  checking = true;
  try {
    const now = Date.now();
    for (const notice of [...(await getNotices()).values()]) {
      try {
        await processNotice(client, notice, now);
      } catch (error) {
        console.error(`Failed to process the inactivity notice in ${notice.channelId}:`, error);
      }
    }
  } finally {
    checking = false;
  }
}

export function startInactivityChecks(client) {
  checkInactivityNotices(client);
  setInterval(() => checkInactivityNotices(client), CHECK_INTERVAL_MS);
}

function requireOpenTicket(interaction, example) {
  const ticket = getTicketInfo(interaction.channel);
  if (!ticket) throw new CommandNotice(notInTicketNotice(example));
  if (ticket.archived) {
    throw new CommandNotice({
      missing: "This ticket is archived, so its owner can't send messages here.",
      fix: "Inactivity notices only work in open tickets.",
    });
  }
  return ticket;
}

async function startNotice(interaction) {
  const ticket = requireOpenTicket(interaction, "/inactivity start");
  const existing = (await getNotices()).get(interaction.channelId);
  if (existing) {
    throw new CommandNotice({
      missing: `This ticket already has an inactivity notice, ending ${timestamp(existing.deadline, "F")}.`,
      fix: "To restart the countdown, run `/inactivity cancel` first and then `/inactivity start` again.",
      example: "/inactivity cancel",
    });
  }

  let member;
  try {
    member = await interaction.guild.members.fetch(ticket.ownerId);
  } catch (error) {
    if (error.code !== 10007) throw error;
    throw new CommandNotice({
      missing: "The owner of this ticket is no longer in the server.",
      fix: "There's no one to notify. Archive the ticket with `/close-ticket` instead.",
      example: "/close-ticket",
    });
  }

  const me = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
  if (!me.permissions.has(PermissionFlagsBits.KickMembers)) {
    throw new CommandNotice({
      missing: "I don't have the Kick Members permission, so I couldn't remove them when the time runs out.",
      fix: "Give my role the Kick Members permission in Server Settings → Roles, then run the command again.",
    });
  }
  if (!member.kickable) {
    throw new CommandNotice({
      missing: `I can't remove <@${member.id}>: they own the server or have a role at or above mine.`,
      fix: "Move my role above theirs in Server Settings → Roles, or handle this member manually.",
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const issuedAt = Date.now();
  const deadline = issuedAt + INACTIVITY_DAYS * DAY_MS;
  const message = await interaction.channel.send({
    content: `<@${member.id}>`,
    embeds: [buildNoticeEmbed(member.id, deadline)],
    allowedMentions: { users: [member.id] },
  });

  try {
    await saveNotice({
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      userId: member.id,
      issuedBy: interaction.user.id,
      issuedAt,
      deadline,
      noticeMessageId: message.id,
      reminded: false,
    });
  } catch (error) {
    await message.delete().catch(() => {});
    throw error;
  }

  await respond(
    interaction,
    `Inactivity notice posted. <@${member.id}> will be removed ${timestamp(deadline, "R")} unless they send a message here, with a reminder ${INACTIVITY_REMINDER_DAYS} days before.`,
  );
}

async function cancelNotice(interaction) {
  requireOpenTicket(interaction, "/inactivity cancel");
  if (!(await removeNotice(interaction.channelId))) {
    throw new CommandNotice({
      missing: "This ticket has no active inactivity notice.",
      fix: "Nothing to cancel. Use `/inactivity list` to see the tickets that have one.",
      example: "/inactivity list",
    });
  }
  await interaction.channel.send({
    content: "The inactivity notice has been withdrawn by staff.",
    allowedMentions: { parse: [] },
  });
  await respond(interaction, "Inactivity notice cancelled.");
}

async function listNotices(interaction) {
  const notices = [...(await getNotices()).values()].sort((a, b) => a.deadline - b.deadline);
  await respond(interaction, {
    content: notices.length
      ? notices
          .map(
            (notice) =>
              `- <#${notice.channelId}> — <@${notice.userId}> — removed ${timestamp(notice.deadline, "R")}${notice.reminded ? " (reminded)" : ""}`,
          )
          .join("\n")
          .slice(0, 2000)
      : "No active inactivity notices.",
    allowedMentions: { parse: [] },
  });
}

export const inactivityCommand = {
  data: new SlashCommandBuilder()
    .setName("inactivity")
    .setDescription(`Give a ticket owner ${INACTIVITY_DAYS} days to reply before they are removed.`)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub.setName("start").setDescription(`Post an inactivity notice in this ticket (${INACTIVITY_DAYS} days to reply).`),
    )
    .addSubcommand((sub) => sub.setName("cancel").setDescription("Withdraw the inactivity notice in this ticket."))
    .addSubcommand((sub) => sub.setName("list").setDescription("Show every active inactivity notice.")),
  async execute(interaction) {
    if (!(await requireAdministrator(interaction))) return;
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "start") await startNotice(interaction);
    else if (subcommand === "cancel") await cancelNotice(interaction);
    else if (subcommand === "list") await listNotices(interaction);
  },
};
