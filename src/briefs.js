import { EmbedBuilder } from "discord.js";
import { getBrief, listBriefs } from "./brief-store.js";
import { getEmojiKey } from "./emoji.js";
import { getTicketInfo } from "./tickets.js";

// The footer carries the brief's key so reactions can be matched to a campaign
// without storing a message ID for every ticket.
const BRIEF_FOOTER_PREFIX = "Brief ID: ";

export function buildBriefEmbed(brief) {
  return new EmbedBuilder()
    .setTitle(`📄 ${brief.name} brief`)
    .setURL(brief.link)
    .setDescription(
      [
        `[Open the ${brief.name} brief](${brief.link})`,
        "",
        `React with ${brief.emojiDisplay} to get the <@&${brief.roleId}> role and join this campaign. Remove your reaction to leave it.`,
      ].join("\n"),
    )
    .setFooter({ text: `${BRIEF_FOOTER_PREFIX}${brief.key}` });
}

/** Returns the brief key of a brief message posted by this bot, or null. */
export function getBriefKey(message) {
  if (!message.author || message.author.id !== message.client.user.id) {
    return null;
  }
  const footer = message.embeds[0]?.footer?.text;
  if (!footer?.startsWith(BRIEF_FOOTER_PREFIX)) return null;
  return footer.slice(BRIEF_FOOTER_PREFIX.length);
}

async function findBriefMessages(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const byKey = new Map();
  for (const message of messages.values()) {
    const key = getBriefKey(message);
    if (key && !byKey.has(key)) byKey.set(key, message);
  }
  return byKey;
}

/**
 * Posts the given briefs in a ticket. Briefs already in the ticket are not
 * posted again; their text is refreshed if the brief has changed since.
 */
export async function postBriefsToTicket(channel, briefs) {
  const result = { posted: 0, updated: 0, reactionFailures: 0 };
  if (briefs.length === 0) return result;

  const existing = await findBriefMessages(channel);
  for (const brief of briefs) {
    const embed = buildBriefEmbed(brief);
    let message = existing.get(brief.key);

    if (!message) {
      message = await channel.send({
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
      result.posted += 1;
    } else {
      const current = message.embeds[0];
      if (
        current?.title !== embed.data.title ||
        current?.url !== embed.data.url ||
        current?.description !== embed.data.description
      ) {
        await message.edit({ embeds: [embed], allowedMentions: { parse: [] } });
        result.updated += 1;
      }
    }

    const alreadyReacted = message.reactions.cache.some(
      (reaction) => getEmojiKey(reaction.emoji) === brief.emojiKey && reaction.me,
    );
    if (!alreadyReacted) {
      try {
        await message.react(brief.emojiDisplay);
      } catch (error) {
        result.reactionFailures += 1;
        console.error(
          `Failed to add ${brief.emojiDisplay} to the ${brief.key} brief in ticket ${channel.id}:`,
          error,
        );
      }
    }
  }

  return result;
}

/**
 * Gives or removes a campaign role when a ticket owner reacts to a brief.
 * Returns true when the message is a brief message (handled or deliberately
 * ignored), false when the event belongs to someone else.
 */
export async function handleBriefReaction(reaction, message, user, action) {
  const key = getBriefKey(message);
  if (!key) return false;

  const ticket = getTicketInfo(message.channel);
  if (!ticket) return false;

  // Archived tickets are frozen, and only the ticket owner picks campaigns.
  if (ticket.archived || user.id !== ticket.ownerId) return true;

  const brief = await getBrief(key);
  if (!brief || brief.emojiKey !== getEmojiKey(reaction.emoji)) return true;

  const member = await message.guild.members.fetch(user.id);
  if (action === "add") {
    await member.roles.add(brief.roleId, `Selected the ${brief.name} campaign brief`);
  } else {
    await member.roles.remove(brief.roleId, `Unselected the ${brief.name} campaign brief`);
  }
  return true;
}

/**
 * Re-applies the campaign roles a returning member had selected in their
 * ticket (Discord removes all roles when someone leaves the server).
 * Returns the number of roles restored.
 */
export async function restoreBriefRoles(channel, member) {
  const briefsByKey = new Map((await listBriefs()).map((brief) => [brief.key, brief]));
  if (briefsByKey.size === 0) return 0;

  let restored = 0;
  for (const [key, message] of await findBriefMessages(channel)) {
    const brief = briefsByKey.get(key);
    if (!brief) continue;

    const reaction = message.reactions.cache.find(
      (item) => getEmojiKey(item.emoji) === brief.emojiKey,
    );
    if (!reaction) continue;

    const users = await reaction.users.fetch();
    if (!users.has(member.id)) continue;

    await member.roles.add(brief.roleId, `Restored the ${brief.name} campaign role`);
    restored += 1;
  }
  return restored;
}
