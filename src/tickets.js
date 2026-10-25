import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} from "discord.js";

export const TICKET_CATEGORY_ID = "1563686662402220043";
const ACCESS_ROLE_ID = "1563677636654407841";
const OWNER_TOPIC_PREFIX = "wildcard-onboarding-owner:";
const WILDCARD_STAFF_ID = "1563617838944751698";
const CAMPAIGN_BRIEFS_CHANNEL_ID = "1563713237407637574";

function makeTicketName(username) {
  const prefix = "🎟️︲";
  const maxUsernameLength = 100 - [...prefix].length;
  const safeUsername = username.trim().replace(/\s+/g, "-") || "member";
  return `${prefix}${[...safeUsername].slice(0, maxUsernameLength).join("")}`;
}

function findWildcardEmoji(guild) {
  return guild.emojis.cache.find((emoji) => emoji.name === "wildcard");
}

function buildTicketWelcomeEmbed(guild, fullName) {
  const wildcardEmoji = findWildcardEmoji(guild);
  const title = wildcardEmoji
    ? `Welcome to Wildcard! ${wildcardEmoji}`
    : "Welcome to Wildcard! :wildcard:";

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      [
        `This is your personal space, ${fullName}.`,
        "",
        `📖 Start by reading the briefs of the campaign(s) that catch your interest in <#${CAMPAIGN_BRIEFS_CHANNEL_ID}>.`,
        "",
        "🧰 In the same channel, make sure you get the role(s) for the corresponding campaign.",
        "",
        `Any questions along the way? Just tag <@&${WILDCARD_STAFF_ID}> in here and someone will get back to you. 🙌`,
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

export async function createTicket(guild, user, application) {
  const channels = await guild.channels.fetch();
  const ownerTopic = `${OWNER_TOPIC_PREFIX}${user.id}`;
  const existingTicket = channels.find(
    (channel) =>
      channel.type === ChannelType.GuildText && channel.topic === ownerTopic,
  );

  if (existingTicket) {
    return { channel: existingTicket, created: false };
  }

  const category = await guild.channels.fetch(TICKET_CATEGORY_ID);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error(
      `Ticket category ${TICKET_CATEGORY_ID} does not exist or is not a category.`,
    );
  }

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
      ],
    },
  ];
  if (permissionOverwrites.length > 100) {
    throw new Error(
      "This server has too many view-enabled roles to safely create a private ticket.",
    );
  }

  const ticket = await guild.channels.create({
    name: makeTicketName(user.username),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: ownerTopic,
    permissionOverwrites,
    reason: `Wildcard onboarding ticket for ${user.tag}`,
  });

  try {
    await ticket.send({
      embeds: [buildTicketWelcomeEmbed(guild, application.fullName)],
      allowedMentions: { parse: [] },
    });
    await ticket.send({
      embeds: [buildApplicationEmbed(application)],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    try {
      await ticket.delete("Failed to initialize onboarding ticket");
    } catch (cleanupError) {
      console.error(
        `Failed to clean up uninitialized onboarding ticket ${ticket.id}:`,
        cleanupError,
      );
    }
    throw error;
  }

  return { channel: ticket, created: true };
}

export async function closeTicket(interaction) {
  const channel = interaction.channel;
  if (
    !channel ||
    channel.type !== ChannelType.GuildText ||
    !channel.topic?.startsWith(OWNER_TOPIC_PREFIX)
  ) {
    await interaction.reply({
      content: "Use `/close-ticket` inside an open onboarding ticket.",
      ephemeral: true,
    });
    return;
  }

  if (channel.topic.endsWith("|archived")) {
    await interaction.reply({
      content: "This onboarding ticket has already been archived.",
      ephemeral: true,
    });
    return;
  }

  const ownerId = channel.topic.slice(OWNER_TOPIC_PREFIX.length);
  if (!/^\d+$/.test(ownerId)) {
    throw new Error(`Ticket ${channel.id} has an invalid owner in its topic.`);
  }

  const ownerOverwrite = channel.permissionOverwrites.cache.get(ownerId);
  if (!ownerOverwrite) {
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
    { reason: `Ticket archived by ${interaction.user.tag}` },
  );

  const closedName = `${[...channel.name].slice(0, 93).join("")}-closed`;
  await channel.edit({
    name: closedName,
    topic: `${channel.topic}|archived`,
    reason: `Ticket archived by ${interaction.user.tag}`,
  });

  await interaction.reply({
    content: "Ticket archived. The user can still read it, but cannot send messages.",
    ephemeral: true,
  });
}
