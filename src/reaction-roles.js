import { getEmojiKey } from "./emoji.js";
import { getReactionRole } from "./reaction-role-store.js";

export async function handleReactionRoleEvent(reaction, message, user, guildId, action) {
  const rule = await getReactionRole(guildId, message.id, getEmojiKey(reaction.emoji));
  if (!rule) return;

  const member = await message.guild.members.fetch(user.id);
  if (action === "add") {
    await member.roles.add(rule.roleId, "Reaction role selected");
  } else {
    await member.roles.remove(rule.roleId, "Reaction role unselected");
  }
}
