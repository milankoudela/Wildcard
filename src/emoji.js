const UNICODE_EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/**
 * Parses an emoji typed into a slash-command option. Accepts a Unicode emoji
 * or a custom emoji written as <:name:id> / <a:name:id>.
 * Returns { key, display } or null when the value is not an emoji.
 * `key` matches what Discord reports on reactions (custom emoji ID or the
 * Unicode character), `display` can be used both in messages and to react.
 */
export function parseReactionEmoji(value) {
  const customEmoji = value.match(/^<(a?):[^:]+:(\d+)>$/);
  if (customEmoji) {
    return { key: customEmoji[2], display: value };
  }

  if (
    value.includes(":") ||
    value.startsWith("<") ||
    value.endsWith(">") ||
    !UNICODE_EMOJI_PATTERN.test(value)
  ) {
    return null;
  }

  return { key: value, display: value };
}

export function getEmojiKey(emoji) {
  return emoji.id ?? emoji.name;
}

/**
 * Fills in text written by admins: {user} becomes a mention of the member,
 * {server} the server name, and :name: the server's custom emoji with that
 * name (left as typed when there is none).
 */
export function renderGuildText(text, guild, user) {
  return text
    .replaceAll("{user}", user ? `<@${user.id}>` : "{user}")
    .replaceAll("{server}", guild.name ?? "")
    .replace(/(?<!<a?):([\w~]{2,32}):(?!\d)/g, (match, name) => {
      const emoji = guild.emojis.cache.find((item) => item.name === name);
      return emoji ? emoji.toString() : match;
    });
}
