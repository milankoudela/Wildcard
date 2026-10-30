import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import {
  getBrief,
  listBriefs,
  makeBriefKey,
  removeBrief,
  saveBrief,
} from "./brief-store.js";
import { postBriefsToTicket } from "./briefs.js";
import { getCreatorInfo } from "./creator-store.js";
import { parseReactionEmoji } from "./emoji.js";
import { clearNoticeForChannel, inactivityCommand } from "./inactivity.js";
import { onboardingEmbedCommand } from "./onboarding-embed.js";
import { openOnboardingTicket } from "./onboarding.js";
import {
  CommandNotice,
  notInTicketNotice,
  requireAdministrator,
  respond,
} from "./notices.js";
import { saveReactionRole } from "./reaction-role-store.js";
import {
  archiveTicket,
  getTicketInfo,
  listCompletedTickets,
} from "./tickets.js";

const EMOJI_NOTICE = {
  fix: "Use a regular emoji such as ✅, or a custom emoji from this server written as `<:name:id>` (type `\\:name:` in a message to get it).",
};

/** Throws a notice when the bot cannot hand out the role. */
async function requireAssignableRole(guild, role) {
  if (role.id === guild.id || role.managed) {
    throw new CommandNotice({
      missing: `<@&${role.id}> can't be given out by a bot (it's @everyone or managed by an integration).`,
      fix: "Pick a normal role created in Server Settings → Roles.",
    });
  }
  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  if (!role.editable || role.position >= botMember.roles.highest.position) {
    throw new CommandNotice({
      missing: `My role is below <@&${role.id}>, so I can't give it out.`,
      fix: "In Server Settings → Roles, drag my role above that role, then run the command again.",
    });
  }
}

export const pingCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check whether the bot is online."),
  async execute(interaction) {
    await interaction.reply("Pong!");
  },
};

export const openTicketCommand = {
  data: new SlashCommandBuilder()
    .setName("open-ticket")
    .setDescription("Open an onboarding ticket for a member who doesn't have one.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option
        .setName("user")
        .setDescription("The member to open a ticket for.")
        .setRequired(true),
    ),
  async execute(interaction) {
    if (!(await requireAdministrator(interaction))) return;

    const user = interaction.options.getUser("user", true);
    if (user.bot) {
      throw new CommandNotice({
        missing: "You picked a bot, and bots don't need onboarding tickets.",
        fix: "Pick the member you want to open a ticket for.",
        example: "/open-ticket user:@username",
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await interaction.guild.members.fetch(user.id);
    } catch {
      throw new CommandNotice({
        missing: `<@${user.id}> isn't a member of this server.`,
        fix: "They need to join the server first. A ticket opens automatically when they do.",
      });
    }

    const result = await openOnboardingTicket(interaction.guild, user);
    await respond(interaction, {
      content: result.created
        ? `Opened an onboarding ticket for <@${user.id}>: <#${result.channel.id}>`
        : `<@${user.id}> already has an open ticket: <#${result.channel.id}>`,
      allowedMentions: { parse: [] },
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

    const ticket = getTicketInfo(interaction.channel);
    if (!ticket) throw new CommandNotice(notInTicketNotice("/close-ticket"));
    if (ticket.archived) {
      throw new CommandNotice({
        missing: "This ticket is already archived.",
        fix: "Nothing to do. If the member needs a new ticket, use `/open-ticket`.",
        example: "/open-ticket user:@username",
      });
    }

    await archiveTicket(interaction.channel, `Ticket archived by ${interaction.user.tag}`);
    // The owner can no longer write here, so a pending inactivity notice
    // would otherwise always end in a kick.
    const noticeCleared = await clearNoticeForChannel(interaction.channelId);
    await respond(
      interaction,
      [
        "Ticket archived. The user can still read it, but cannot send messages.",
        noticeCleared ? "Its inactivity notice was cancelled." : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
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
      throw new CommandNotice({
        missing: `No onboarding information is saved for <@${user.id}>.`,
        fix: "They haven't submitted the onboarding form yet. Check their ticket, or pick a different member.",
      });
    }

    await respond(interaction, {
      content: `**Full Name:** ${creator.fullName}\n**Email:** ${creator.email}`,
      allowedMentions: { parse: [] },
    });
  },
};

function parseBriefLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {
    // Fall through to the notice below.
  }
  throw new CommandNotice({
    missing: `\`${value}\` isn't a valid link.`,
    fix: "Paste the full link to the brief, starting with `https://`.",
    example: "/briefs add name:Halo AI link:https://docs.google.com/... role:@Halo AI",
  });
}

function describePostResult(result) {
  const parts = [`${result.posted} posted`];
  if (result.updated) parts.push(`${result.updated} updated`);
  if (result.reactionFailures) {
    parts.push(`${result.reactionFailures} reaction(s) couldn't be added`);
  }
  return parts.join(", ");
}

function unknownBriefNotice(name) {
  return new CommandNotice({
    missing: `There is no brief called **${name}**.`,
    fix: "Check the spelling with `/briefs list`, then use the campaign name exactly as shown there.",
    example: "/briefs list",
  });
}

async function addBrief(interaction) {
  const name = interaction.options.getString("name", true).trim();
  const key = makeBriefKey(name);
  if (!key) {
    throw new CommandNotice({
      missing: "The campaign name has no letters or numbers.",
      fix: "Use the campaign's real name.",
      example: "/briefs add name:Halo AI link:https://... role:@Halo AI",
    });
  }

  const link = parseBriefLink(interaction.options.getString("link", true).trim());
  const role = interaction.options.getRole("role", true);
  const emojiInput = (interaction.options.getString("emoji") ?? "✅").trim();
  const emoji = parseReactionEmoji(emojiInput);
  if (!emoji) {
    throw new CommandNotice({ missing: `\`${emojiInput}\` isn't an emoji I can react with.`, ...EMOJI_NOTICE });
  }
  if (emoji.key !== emoji.display && !interaction.client.emojis.cache.has(emoji.key)) {
    throw new CommandNotice({
      missing: `${emoji.display} is a custom emoji from another server, which I can't use.`,
      ...EMOJI_NOTICE,
    });
  }
  await requireAssignableRole(interaction.guild, role);

  const existed = Boolean(await getBrief(key));
  await saveBrief({
    key,
    name,
    link,
    roleId: role.id,
    emojiKey: emoji.key,
    emojiDisplay: emoji.display,
  });

  await respond(interaction, {
    content: [
      `${existed ? "Updated" : "Added"} the **${name}** brief: reacting with ${emoji.display} gives <@&${role.id}>.`,
      "New members get it in their ticket after onboarding. Use `/briefs post all-tickets:True` to send it to members who already onboarded.",
    ].join("\n"),
    allowedMentions: { parse: [] },
  });
}

async function removeBriefCommand(interaction) {
  const name = interaction.options.getString("name", true).trim();
  if (!(await removeBrief(makeBriefKey(name)))) throw unknownBriefNotice(name);
  await respond(interaction, {
    content: `Removed the **${name}** brief. Brief messages already in tickets stay visible, but reacting to them no longer changes roles.`,
    allowedMentions: { parse: [] },
  });
}

async function listBriefsCommand(interaction) {
  const briefs = await listBriefs();
  if (briefs.length === 0) {
    throw new CommandNotice({
      missing: "No campaign briefs are set up yet.",
      fix: "Add one with `/briefs add`, giving the campaign name, the link to its brief and the role to hand out.",
      example: "/briefs add name:Halo AI link:https://... role:@Halo AI emoji:✅",
    });
  }
  await respond(interaction, {
    content: briefs
      .map((brief) => `- **${brief.name}** — ${brief.emojiDisplay} → <@&${brief.roleId}> — <${brief.link}>`)
      .join("\n"),
    allowedMentions: { parse: [] },
  });
}

async function postBriefsCommand(interaction) {
  const campaign = interaction.options.getString("campaign")?.trim();
  const allTickets = interaction.options.getBoolean("all-tickets") ?? false;

  let briefs = await listBriefs();
  if (briefs.length === 0) {
    throw new CommandNotice({
      missing: "There are no briefs to post yet.",
      fix: "Add one first with `/briefs add`.",
      example: "/briefs add name:Halo AI link:https://... role:@Halo AI",
    });
  }
  if (campaign) {
    briefs = briefs.filter((brief) => brief.key === makeBriefKey(campaign));
    if (briefs.length === 0) throw unknownBriefNotice(campaign);
  }

  if (!allTickets) {
    const ticket = getTicketInfo(interaction.channel);
    if (!ticket) {
      throw new CommandNotice({
        missing: "You're not in an onboarding ticket and didn't set `all-tickets`.",
        fix: "Run it inside a member's ticket to post there, or add `all-tickets:True` to post in every onboarded ticket.",
        example: "/briefs post all-tickets:True",
      });
    }
    if (ticket.archived) {
      throw new CommandNotice({
        missing: "This ticket is archived.",
        fix: "Briefs can only be posted in open tickets.",
      });
    }
    if (ticket.pending) {
      throw new CommandNotice({
        missing: "This member hasn't submitted the onboarding form yet.",
        fix: "Nothing to do: they get the briefs automatically as soon as they submit it.",
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await postBriefsToTicket(interaction.channel, briefs);
    await respond(interaction, `Briefs: ${describePostResult(result)}.`);
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const tickets = listCompletedTickets(interaction.guild);
  const total = { posted: 0, updated: 0, reactionFailures: 0 };
  const failed = [];
  for (const channel of tickets) {
    try {
      const result = await postBriefsToTicket(channel, briefs);
      total.posted += result.posted;
      total.updated += result.updated;
      total.reactionFailures += result.reactionFailures;
    } catch (error) {
      failed.push(channel.id);
      console.error(`Failed to post briefs in ticket ${channel.id}:`, error);
    }
  }

  await respond(
    interaction,
    [
      `Checked ${tickets.length} open ticket(s). Briefs: ${describePostResult(total)}.`,
      failed.length ? `Couldn't post in: ${failed.map((id) => `<#${id}>`).join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export const briefsCommand = {
  data: new SlashCommandBuilder()
    .setName("briefs")
    .setDescription("Manage the campaign briefs posted in onboarding tickets.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add or update a campaign brief.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Campaign name, such as Halo AI.")
            .setRequired(true)
            .setMaxLength(50),
        )
        .addStringOption((option) =>
          option
            .setName("link")
            .setDescription("Link to the brief.")
            .setRequired(true)
            .setMaxLength(500),
        )
        .addRoleOption((option) =>
          option
            .setName("role")
            .setDescription("Role given when a member reacts to the brief.")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("emoji")
            .setDescription("Reaction emoji (default ✅). Unicode or <:name:id>."),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Stop using a campaign brief.")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Campaign name.")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("Show the configured campaign briefs."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("post")
        .setDescription("Post briefs in this ticket, or in every onboarded ticket.")
        .addStringOption((option) =>
          option
            .setName("campaign")
            .setDescription("Only post this campaign's brief."),
        )
        .addBooleanOption((option) =>
          option
            .setName("all-tickets")
            .setDescription("Post in every open ticket whose member has completed onboarding."),
        ),
    ),
  async execute(interaction) {
    if (!(await requireAdministrator(interaction))) return;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "add") await addBrief(interaction);
    else if (subcommand === "remove") await removeBriefCommand(interaction);
    else if (subcommand === "list") await listBriefsCommand(interaction);
    else if (subcommand === "post") await postBriefsCommand(interaction);
  },
};

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
    const example = "/reaction-role message-id:1234567890123456789 role-id:1234567890123456789 emoji:✅";

    const badIds = [];
    if (!/^\d{17,20}$/.test(messageId)) badIds.push(`\`message-id\` (\`${messageId}\`)`);
    if (!/^\d{17,20}$/.test(roleId)) badIds.push(`\`role-id\` (\`${roleId}\`)`);
    if (badIds.length) {
      throw new CommandNotice({
        missing: `Not a valid Discord ID: ${badIds.join(" and ")}. IDs are 17–20 digit numbers.`,
        fix: "Turn on Developer Mode (User Settings → Advanced), then right-click the message or role and choose **Copy ID**.",
        example,
      });
    }

    const emoji = parseReactionEmoji(emojiInput);
    if (!emoji) {
      throw new CommandNotice({ missing: `\`${emojiInput}\` isn't an emoji I can react with.`, ...EMOJI_NOTICE, example });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const role = await interaction.guild.roles.fetch(roleId);
    if (!role) {
      throw new CommandNotice({
        missing: `No role with ID \`${roleId}\` exists in this server.`,
        fix: "Copy the role's ID again from Server Settings → Roles (right-click → Copy Role ID).",
        example,
      });
    }
    await requireAssignableRole(interaction.guild, role);
    const botMember =
      interaction.guild.members.me ??
      (await interaction.guild.members.fetchMe());

    const target = await findMessageById(interaction.guild, messageId);
    if (!target) {
      throw new CommandNotice({
        missing: `I couldn't find message \`${messageId}\` in any channel I can see.`,
        fix: "Check the ID (right-click the message → Copy Message ID) and make sure I can view that channel.",
        example,
      });
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
      await target.message.react(emoji.display);
    } catch (error) {
      console.error(
        `Failed to add configured reaction ${emoji.display} to message ${messageId}:`,
        error,
      );
      throw new CommandNotice({
        missing: `I couldn't react with ${emoji.display} on that message.`,
        fix: "Make sure I have Add Reactions in that channel and that the emoji is from this server.",
        example,
      });
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

    await respond(
      interaction,
      `Configured ${emoji.display} on [that message](https://discord.com/channels/${interaction.guildId}/${target.channel.id}/${messageId}) to give <@&${role.id}> when a user reacts and remove it when they unreact.`,
    );
  },
};

export const commands = [
  pingCommand,
  openTicketCommand,
  closeTicketCommand,
  inactivityCommand,
  creatorInfoCommand,
  briefsCommand,
  onboardingEmbedCommand,
  reactionRoleCommand,
];
