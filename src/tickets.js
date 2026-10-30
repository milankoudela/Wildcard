import { ChannelType, PermissionFlagsBits } from "discord.js";
import { ACCESS_ROLE_ID, TICKET_CATEGORY_ID } from "./config.js";

// A ticket's channel topic identifies its owner and state:
//   wildcard-onboarding-owner:<userId>                  onboarding completed
//   wildcard-onboarding-owner:<userId>|pending          onboarding form not yet submitted
//   ...|archived                                        closed with /close-ticket
// Tickets created before tickets were opened on join have no "pending" flag,
// so they are correctly treated as completed.
const OWNER_TOPIC_PREFIX = "wildcard-onboarding-owner:";
const PENDING_FLAG = "pending";
const ARCHIVED_FLAG = "archived";

export function parseTicketTopic(topic) {
  if (!topic?.startsWith(OWNER_TOPIC_PREFIX)) return null;

  const [ownerId, ...flags] = topic.slice(OWNER_TOPIC_PREFIX.length).split("|");
  if (!/^\d+$/.test(ownerId)) return null;

  return {
    ownerId,
    pending: flags.includes(PENDING_FLAG),
    archived: flags.includes(ARCHIVED_FLAG),
  };
}

export function getTicketInfo(channel) {
  if (!channel || channel.type !== ChannelType.GuildText) return null;
  return parseTicketTopic(channel.topic);
}

/** Returns the user's non-archived ticket, using the channel cache kept up to date by the Guilds intent. */
export function findOpenTicket(guild, userId) {
  return (
    guild.channels.cache.find((channel) => {
      const ticket = getTicketInfo(channel);
      return ticket?.ownerId === userId && !ticket.archived;
    }) ?? null
  );
}

/** Every non-archived ticket whose owner has completed the onboarding form. */
export function listCompletedTickets(guild) {
  return listOpenTickets(guild, (ticket) => !ticket.pending);
}

/** Every non-archived ticket whose owner hasn't submitted the form yet. */
export function listPendingTickets(guild) {
  return listOpenTickets(guild, (ticket) => ticket.pending);
}

function listOpenTickets(guild, predicate) {
  return [
    ...guild.channels.cache
      .filter((channel) => {
        const ticket = getTicketInfo(channel);
        return ticket && !ticket.archived && predicate(ticket);
      })
      .values(),
  ];
}

function makeTicketName(username) {
  const prefix = "🎟️︲";
  const maxUsernameLength = 100 - [...prefix].length;
  const safeUsername = username.trim().replace(/\s+/g, "-") || "member";
  return `${prefix}${[...safeUsername].slice(0, maxUsernameLength).join("")}`;
}

/** Creates an empty private ticket channel in the "pending" state. */
export async function createTicketChannel(guild, user) {
  const category = await guild.channels.fetch(TICKET_CATEGORY_ID);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error(
      `Ticket category ${TICKET_CATEGORY_ID} does not exist or is not a category.`,
    );
  }

  // Checked up front so a ticket is never opened for a user who could not be
  // given the access role once they submit the form.
  const accessRole = await guild.roles.fetch(ACCESS_ROLE_ID);
  if (!accessRole) {
    throw new Error(`Access role ${ACCESS_ROLE_ID} does not exist.`);
  }

  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  if (
    !accessRole.editable ||
    accessRole.position >= botMember.roles.highest.position
  ) {
    throw new Error(
      `Move the bot's highest role above access role ${ACCESS_ROLE_ID}.`,
    );
  }

  const readableRoles = guild.roles.cache.filter(
    (role) =>
      role.id !== guild.roles.everyone.id &&
      role.permissions.has(PermissionFlagsBits.ViewChannel),
  );
  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    ...readableRoles.map((role) => ({
      id: role.id,
      deny: [PermissionFlagsBits.ViewChannel],
    })),
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        // Needed to pick campaigns by reacting to the briefs.
        PermissionFlagsBits.AddReactions,
      ],
    },
    {
      id: botMember.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AddReactions,
      ],
    },
  ];
  if (permissionOverwrites.length > 100) {
    throw new Error(
      "This server has too many view-enabled roles to safely create a private ticket.",
    );
  }

  return guild.channels.create({
    name: makeTicketName(user.username),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `${OWNER_TOPIC_PREFIX}${user.id}|${PENDING_FLAG}`,
    permissionOverwrites,
    reason: `Wildcard onboarding ticket for ${user.tag}`,
  });
}

/** Clears the "pending" flag once the owner has submitted the onboarding form. */
export async function markTicketOnboarded(channel) {
  const ticket = getTicketInfo(channel);
  if (!ticket?.pending) return;

  const flags = [ticket.archived ? ARCHIVED_FLAG : null].filter(Boolean);
  await channel.setTopic(
    [`${OWNER_TOPIC_PREFIX}${ticket.ownerId}`, ...flags].join("|"),
    "Onboarding form submitted",
  );
}

/**
 * Archives a ticket: the owner keeps read access but can no longer write or
 * react, and the channel is renamed and flagged as archived.
 */
export async function archiveTicket(channel, reason) {
  const ticket = getTicketInfo(channel);
  if (!ticket || ticket.archived) return false;

  const { ownerId } = ticket;
  if (!channel.permissionOverwrites.cache.has(ownerId)) {
    throw new Error(`Ticket ${channel.id} is missing its owner's permissions.`);
  }

  await channel.permissionOverwrites.edit(
    ownerId,
    {
      SendMessages: false,
      SendMessagesInThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
      AddReactions: false,
    },
    { reason },
  );

  const closedName = `${[...channel.name].slice(0, 93).join("")}-closed`;
  await channel.edit({
    name: closedName,
    topic: `${channel.topic}|${ARCHIVED_FLAG}`,
    reason,
  });
  return true;
}
