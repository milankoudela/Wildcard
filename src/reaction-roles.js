import { getReactionRole } from "./reaction-role-store.js";

export async function handleReactionRoleEvent(reaction, user, guildId, action) {
  if (user.bot) return;

  if (reaction.partial) {
    reaction = await reaction.fetch();
  }

  const message = reaction.message.partial
    ? await reaction.message.fetch()
    : reaction.message;
  if (!message?.guildId || message.guildId !== guildId) return;

  const emojiKey = reaction.emoji.id ?? reaction.emoji.name;
  const rule = await getReactionRole(guildId, message.id, emojiKey);
  if (!rule) return;

  const member = await message.guild.members.fetch(user.id);
  if (action === "add") {
    await member.roles.add(rule.roleId, "Reaction role selected");
  } else {
    await member.roles.remove(rule.roleId, "Reaction role unselected");
  }
}
