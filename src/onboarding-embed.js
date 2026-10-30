import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { EMBED_MODAL_PREFIX, TICKET_ONBOARDING_BUTTON_ID } from "./config.js";
import { renderGuildText } from "./emoji.js";
import { createJsonStore } from "./json-store.js";
import { CommandNotice, requireAdministrator, respond } from "./notices.js";
import { getTicketInfo, listPendingTickets } from "./tickets.js";

// The embed shown at the top of every new onboarding ticket, stored in
// data/onboarding-embed.json. Missing file = this default.
const DEFAULT_EMBED = {
  title: "Welcome to Wildcard! :wildcard:",
  description: [
    "This is your personal space. Find a campaign that fits the videos you want to make. You can apply for more than one.",
    "",
    "Read about the campaigns below, then click **Start onboarding** to agree to the server rules and complete your application. As soon as you're done, the campaign briefs will be posted right here so you can choose your campaigns.",
    "",
    "**First time here?** Staff will review your first application before granting trial access. You can speak with the team in this channel while you wait.",
  ].join("\n"),
  url: null,
  color: null,
  author: null,
  thumbnail: null,
  image: null,
  footer: null,
  timestamp: false,
  fields: [
    {
      name: "Halo AI",
      value: [
        "- AI Photo Editing app.",
        "- Requires posting on: Instagram, TikTok, Facebook, Snapchat, YouTube.",
        "- Posting volume is at least daily and up to 3 daily videos.",
      ].join("\n"),
      inline: false,
    },
    {
      name: "Cantina",
      value: [
        "- Create short, entertaining videos featuring Cantina’s AI characters and video tools.",
        "- Content includes comedy, character interactions, and creative scenarios.",
      ].join("\n"),
      inline: false,
    },
    { name: "CapCut", value: "- Video editing app.", inline: false },
  ],
};

const LIMITS = {
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  author: 256,
  total: 6000,
};

const store = createJsonStore("onboarding-embed.json", {
  fallback: () => structuredClone(DEFAULT_EMBED),
  validate(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.fields)) {
      throw new Error("expected an object with a fields array");
    }
  },
});

export async function getEmbedData() {
  return structuredClone(await store.read());
}

/** Builds the onboarding embed for a member, filling in {user}, {server} and :emoji:. */
export function buildEmbedFromData(data, guild, user) {
  const render = (text) => renderGuildText(text, guild, user);
  const embed = new EmbedBuilder();
  if (data.title) embed.setTitle(render(data.title));
  if (data.description) embed.setDescription(render(data.description));
  if (data.url) embed.setURL(data.url);
  if (data.color !== null && data.color !== undefined) embed.setColor(data.color);
  if (data.author?.name) {
    embed.setAuthor({
      name: render(data.author.name),
      iconURL: data.author.iconURL ?? undefined,
      url: data.author.url ?? undefined,
    });
  }
  if (data.thumbnail) embed.setThumbnail(data.thumbnail);
  if (data.image) embed.setImage(data.image);
  if (data.footer?.text) {
    embed.setFooter({
      text: render(data.footer.text),
      iconURL: data.footer.iconURL ?? undefined,
    });
  }
  if (data.timestamp) embed.setTimestamp();
  if (data.fields.length) {
    embed.addFields(
      data.fields.map((field) => ({
        name: render(field.name),
        value: render(field.value),
        inline: Boolean(field.inline),
      })),
    );
  }
  return embed;
}

export async function buildOnboardingEmbed(guild, user) {
  return buildEmbedFromData(await store.read(), guild, user);
}

/** Lists every reason Discord would reject the embed, worded for admins. */
function findEmbedProblems(data, guild) {
  // Measure with a worst-case member mention so a long ID can't overflow.
  const sampleUser = { id: "0".repeat(20) };
  const render = (text) => renderGuildText(text ?? "", guild, sampleUser);
  const problems = [];

  if (!data.title && !data.description && data.fields.length === 0) {
    problems.push("The embed needs at least a title, a description or one field.");
  }
  if (render(data.title).length > LIMITS.title) {
    problems.push(`The title is longer than ${LIMITS.title} characters.`);
  }
  if (render(data.description).length > LIMITS.description) {
    problems.push(`The description is longer than ${LIMITS.description} characters.`);
  }
  if (data.fields.length > LIMITS.fields) {
    problems.push(`An embed can have at most ${LIMITS.fields} fields.`);
  }
  data.fields.forEach((field, index) => {
    if (render(field.name).length > LIMITS.fieldName) {
      problems.push(`Field ${index + 1}'s name is longer than ${LIMITS.fieldName} characters.`);
    }
    if (render(field.value).length > LIMITS.fieldValue) {
      problems.push(`Field ${index + 1}'s value is longer than ${LIMITS.fieldValue} characters.`);
    }
  });
  if (render(data.author?.name).length > LIMITS.author) {
    problems.push(`The author name is longer than ${LIMITS.author} characters.`);
  }
  if (render(data.footer?.text).length > LIMITS.footer) {
    problems.push(`The footer text is longer than ${LIMITS.footer} characters.`);
  }
  if ((data.author?.iconURL || data.author?.url) && !data.author?.name) {
    problems.push("An author icon or link only shows when the author has a name. Set `author-name` too.");
  }
  if (data.footer?.iconURL && !data.footer?.text) {
    problems.push("A footer icon only shows when the footer has text. Set `footer-text` too.");
  }

  const total =
    render(data.title).length +
    render(data.description).length +
    render(data.author?.name).length +
    render(data.footer?.text).length +
    data.fields.reduce(
      (sum, field) => sum + render(field.name).length + render(field.value).length,
      0,
    );
  if (total > LIMITS.total) {
    problems.push(`All the text together is ${total} characters; Discord allows ${LIMITS.total}.`);
  }
  return problems;
}

function parseColor(value) {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? Number.parseInt(match[1], 16) : null;
}

function parseLink(value, optionName) {
  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {
    // Fall through to the notice below.
  }
  throw new CommandNotice({
    missing: `\`${optionName}\` isn't a valid link.`,
    fix: "Paste a full link starting with `https://`.",
    example: `/onboarding-embed set ${optionName}:https://example.com/picture.png`,
  });
}

function requireFieldNumber(data, number, example) {
  if (data.fields.length === 0) {
    throw new CommandNotice({
      missing: "The embed has no fields yet.",
      fix: "Add one first with `/onboarding-embed field-add`.",
      example: "/onboarding-embed field-add",
    });
  }
  if (number < 1 || number > data.fields.length) {
    throw new CommandNotice({
      missing: `There is no field number ${number}. The embed has ${data.fields.length} field(s).`,
      fix: "Use `/onboarding-embed view` to see the field numbers, then pick one of them.",
      example,
    });
  }
  return number - 1;
}

function fieldList(data) {
  if (data.fields.length === 0) return "No fields.";
  return data.fields
    .map((field, index) => `**${index + 1}.** ${field.name}${field.inline ? " *(inline)*" : ""}`)
    .join("\n")
    .slice(0, 1900);
}

async function replyWithPreview(interaction, data, message) {
  await respond(interaction, {
    content: [
      message,
      `**Fields:**\n${fieldList(data)}`,
      "-# Placeholders: `{user}` mentions the member, `{server}` is the server name, `:name:` shows a server emoji. Tickets that are already open keep the old version until you run `/onboarding-embed refresh-tickets`.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    embeds: [buildEmbedFromData(data, interaction.guild, interaction.user)],
    allowedMentions: { parse: [] },
  });
}

/**
 * Applies a change, validates the result against Discord's limits and saves
 * it. Problems are shown to the admin and nothing is saved.
 */
async function applyChange(interaction, change, message) {
  let problems = [];
  const saved = await store.update((current) => {
    const next = structuredClone(current);
    change(next);
    problems = findEmbedProblems(next, interaction.guild);
    return problems.length ? undefined : next;
  });

  if (problems.length) {
    throw new CommandNotice({
      missing: problems.map((problem) => `- ${problem}`).join("\n"),
      fix: "Adjust the change so the embed fits Discord's limits. Nothing was saved.",
    });
  }
  await replyWithPreview(interaction, saved, message);
}

function textInput(id, label, style, maxLength, value, required) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label)
    .setStyle(style)
    .setMaxLength(maxLength)
    .setRequired(required);
  if (value) input.setValue(value.slice(0, maxLength));
  return new ActionRowBuilder().addComponents(input);
}

async function showTextModal(interaction) {
  const data = await store.read();
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${EMBED_MODAL_PREFIX}text`)
      .setTitle("Onboarding embed text")
      .addComponents(
        textInput("title", "Title", TextInputStyle.Short, LIMITS.title, data.title, false),
        textInput("description", "Description", TextInputStyle.Paragraph, 4000, data.description, false),
      ),
  );
}

async function showFieldModal(interaction, { mode, number, inline, position }) {
  const data = await store.read();
  const field = mode === "edit" ? data.fields[number - 1] : null;
  const encode = (value) => (value === null || value === undefined ? "-" : String(Number(value)));
  const customId =
    mode === "edit"
      ? `${EMBED_MODAL_PREFIX}field-edit:${number}:${encode(inline)}`
      : `${EMBED_MODAL_PREFIX}field-add:${encode(inline)}:${encode(position)}`;

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(customId)
      .setTitle(mode === "edit" ? `Edit field ${number}` : "Add a field")
      .addComponents(
        textInput("name", "Field name", TextInputStyle.Short, LIMITS.fieldName, field?.name, true),
        textInput("value", "Field value", TextInputStyle.Paragraph, LIMITS.fieldValue, field?.value, true),
      ),
  );
}

export async function handleEmbedModal(interaction) {
  if (!(await requireAdministrator(interaction))) return;

  const [action, first, second] = interaction.customId
    .slice(EMBED_MODAL_PREFIX.length)
    .split(":");
  const decode = (value) => (value === "-" || value === undefined ? null : Number(value));
  const get = (id) => interaction.fields.getTextInputValue(id);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (action === "text") {
    const title = get("title").trim();
    const description = get("description").trim();
    await applyChange(
      interaction,
      (data) => {
        data.title = title || null;
        data.description = description || null;
      },
      "✅ Updated the title and description.",
    );
    return;
  }

  const name = get("name").trim();
  const value = get("value").trim();
  if (!name || !value) {
    throw new CommandNotice({
      missing: "A field needs both a name and a value.",
      fix: "Run the command again and fill in both boxes.",
    });
  }

  if (action === "field-add") {
    const inline = decode(first);
    const position = decode(second);
    await applyChange(
      interaction,
      (data) => {
        const index = position === null ? data.fields.length : Math.min(Math.max(position, 1), data.fields.length + 1) - 1;
        data.fields.splice(index, 0, { name, value, inline: Boolean(inline) });
      },
      `✅ Added the **${name}** field.`,
    );
    return;
  }

  if (action === "field-edit") {
    const number = decode(first);
    const inline = decode(second);
    await applyChange(
      interaction,
      (data) => {
        const index = requireFieldNumber(data, number, "/onboarding-embed field-edit number:1");
        data.fields[index] = {
          name,
          value,
          inline: inline === null ? data.fields[index].inline : Boolean(inline),
        };
      },
      `✅ Updated field ${number}.`,
    );
  }
}

const SET_OPTIONS = [
  ["title", "Title (single line; use edit-text for longer text)"],
  ["color", "Side color as a hex code, such as #5865F2"],
  ["url", "Link opened when clicking the title"],
  ["author-name", "Small text above the title"],
  ["author-icon", "Link to an image shown next to the author name"],
  ["author-url", "Link opened when clicking the author name"],
  ["thumbnail", "Link to a small image in the top-right corner"],
  ["image", "Link to a large image at the bottom"],
  ["footer-text", "Small text at the bottom"],
  ["footer-icon", "Link to an image shown next to the footer text"],
];

async function setProperties(interaction) {
  const values = Object.fromEntries(
    SET_OPTIONS.map(([name]) => [name, interaction.options.getString(name)?.trim() || null]),
  );
  const timestamp = interaction.options.getBoolean("timestamp");
  const provided = Object.entries(values).filter(([, value]) => value !== null);
  if (provided.length === 0 && timestamp === null) {
    throw new CommandNotice({
      missing: "You didn't choose anything to change.",
      fix: "Add at least one option after `/onboarding-embed set`, for example a color or an image. To edit the description or long text, use `/onboarding-embed edit-text`.",
      example: "/onboarding-embed set color:#5865F2 footer-text:See you inside!",
    });
  }

  let color = null;
  if (values.color) {
    color = parseColor(values.color);
    if (color === null) {
      throw new CommandNotice({
        missing: `\`${values.color}\` isn't a hex color.`,
        fix: "Use six hex digits, with or without #.",
        example: "/onboarding-embed set color:#5865F2",
      });
    }
  }
  const links = {};
  for (const name of ["url", "author-icon", "author-url", "thumbnail", "image", "footer-icon"]) {
    if (values[name]) links[name] = parseLink(values[name], name);
  }

  await applyChange(
    interaction,
    (data) => {
      if (values.title) data.title = values.title;
      if (color !== null) data.color = color;
      if (links.url) data.url = links.url;
      if (values["author-name"] || links["author-icon"] || links["author-url"]) {
        data.author = {
          name: values["author-name"] ?? data.author?.name ?? null,
          iconURL: links["author-icon"] ?? data.author?.iconURL ?? null,
          url: links["author-url"] ?? data.author?.url ?? null,
        };
      }
      if (links.thumbnail) data.thumbnail = links.thumbnail;
      if (links.image) data.image = links.image;
      if (values["footer-text"] || links["footer-icon"]) {
        data.footer = {
          text: values["footer-text"] ?? data.footer?.text ?? null,
          iconURL: links["footer-icon"] ?? data.footer?.iconURL ?? null,
        };
      }
      if (timestamp !== null) data.timestamp = timestamp;
    },
    "✅ Updated the onboarding embed.",
  );
}

const CLEARABLE = {
  title: (data) => { data.title = null; },
  description: (data) => { data.description = null; },
  color: (data) => { data.color = null; },
  url: (data) => { data.url = null; },
  author: (data) => { data.author = null; },
  thumbnail: (data) => { data.thumbnail = null; },
  image: (data) => { data.image = null; },
  footer: (data) => { data.footer = null; },
  timestamp: (data) => { data.timestamp = false; },
  fields: (data) => { data.fields = []; },
};

async function refreshTickets(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const data = await store.read();
  let updated = 0;
  const failed = [];

  for (const channel of listPendingTickets(interaction.guild)) {
    try {
      const messages = await channel.messages.fetch({ after: channel.id, limit: 10 });
      const intro = messages.find(
        (message) =>
          message.author?.id === interaction.client.user.id &&
          message.components.some((row) =>
            row.components?.some((component) => component.customId === TICKET_ONBOARDING_BUTTON_ID),
          ),
      );
      if (!intro) continue;
      const owner = { id: getTicketInfo(channel).ownerId };
      await intro.edit({ embeds: [buildEmbedFromData(data, interaction.guild, owner)] });
      updated += 1;
    } catch (error) {
      failed.push(channel.id);
      console.error(`Failed to refresh the onboarding embed in ticket ${channel.id}:`, error);
    }
  }

  await respond(
    interaction,
    [
      `Updated the onboarding embed in ${updated} ticket(s) still waiting for the form. Completed tickets keep the version their owner saw.`,
      failed.length ? `Couldn't update: ${failed.map((id) => `<#${id}>`).join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

export const onboardingEmbedCommand = {
  data: new SlashCommandBuilder()
    .setName("onboarding-embed")
    .setDescription("Edit the embed shown at the top of new onboarding tickets.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) => sub.setName("view").setDescription("Preview the embed and list its fields."))
    .addSubcommand((sub) =>
      sub.setName("edit-text").setDescription("Edit the title and description in a form (supports line breaks)."),
    )
    .addSubcommand((sub) => {
      sub.setName("set").setDescription("Change the color, links, images, author, footer or timestamp.");
      for (const [name, description] of SET_OPTIONS) {
        sub.addStringOption((option) =>
          option.setName(name).setDescription(description).setMaxLength(name === "title" ? 256 : 2048),
        );
      }
      return sub.addBooleanOption((option) =>
        option.setName("timestamp").setDescription("Show the time the ticket was opened in the footer."),
      );
    })
    .addSubcommand((sub) =>
      sub
        .setName("clear")
        .setDescription("Remove one part of the embed.")
        .addStringOption((option) =>
          option
            .setName("part")
            .setDescription("What to remove.")
            .setRequired(true)
            .addChoices(...Object.keys(CLEARABLE).map((name) => ({ name, value: name }))),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("field-add")
        .setDescription("Add a field (opens a form for its name and value).")
        .addBooleanOption((option) => option.setName("inline").setDescription("Show it side by side with other inline fields."))
        .addIntegerOption((option) =>
          option.setName("position").setDescription("Where to put it (1 = first). Defaults to last.").setMinValue(1).setMaxValue(25),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("field-edit")
        .setDescription("Edit a field (opens a form with its current text).")
        .addIntegerOption((option) =>
          option.setName("number").setDescription("Field number, as shown by /onboarding-embed view.").setRequired(true).setMinValue(1).setMaxValue(25),
        )
        .addBooleanOption((option) => option.setName("inline").setDescription("Show it side by side with other inline fields.")),
    )
    .addSubcommand((sub) =>
      sub
        .setName("field-remove")
        .setDescription("Remove a field.")
        .addIntegerOption((option) =>
          option.setName("number").setDescription("Field number, as shown by /onboarding-embed view.").setRequired(true).setMinValue(1).setMaxValue(25),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("field-move")
        .setDescription("Move a field to another position.")
        .addIntegerOption((option) =>
          option.setName("number").setDescription("Field number to move.").setRequired(true).setMinValue(1).setMaxValue(25),
        )
        .addIntegerOption((option) =>
          option.setName("position").setDescription("New position (1 = first).").setRequired(true).setMinValue(1).setMaxValue(25),
        ),
    )
    .addSubcommand((sub) => sub.setName("reset").setDescription("Restore the original onboarding embed."))
    .addSubcommand((sub) =>
      sub.setName("refresh-tickets").setDescription("Show the current embed in tickets still waiting for the form."),
    ),

  async execute(interaction) {
    if (!(await requireAdministrator(interaction))) return;
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "view": {
        const data = await store.read();
        await replyWithPreview(interaction, data, "This is how new tickets currently open:");
        return;
      }
      case "edit-text":
        await showTextModal(interaction);
        return;
      case "set":
        await setProperties(interaction);
        return;
      case "clear": {
        const part = interaction.options.getString("part", true);
        await applyChange(interaction, CLEARABLE[part], `✅ Removed the ${part}.`);
        return;
      }
      case "field-add": {
        const data = await store.read();
        if (data.fields.length >= LIMITS.fields) {
          throw new CommandNotice({
            missing: `The embed already has the maximum of ${LIMITS.fields} fields.`,
            fix: "Remove a field first with `/onboarding-embed field-remove`.",
            example: "/onboarding-embed field-remove number:25",
          });
        }
        await showFieldModal(interaction, {
          mode: "add",
          inline: interaction.options.getBoolean("inline"),
          position: interaction.options.getInteger("position"),
        });
        return;
      }
      case "field-edit": {
        const number = interaction.options.getInteger("number", true);
        requireFieldNumber(await store.read(), number, "/onboarding-embed field-edit number:1");
        await showFieldModal(interaction, {
          mode: "edit",
          number,
          inline: interaction.options.getBoolean("inline"),
        });
        return;
      }
      case "field-remove": {
        const number = interaction.options.getInteger("number", true);
        await applyChange(
          interaction,
          (data) => {
            const index = requireFieldNumber(data, number, "/onboarding-embed field-remove number:1");
            data.fields.splice(index, 1);
          },
          `✅ Removed field ${number}.`,
        );
        return;
      }
      case "field-move": {
        const number = interaction.options.getInteger("number", true);
        const position = interaction.options.getInteger("position", true);
        await applyChange(
          interaction,
          (data) => {
            const index = requireFieldNumber(data, number, "/onboarding-embed field-move number:3 position:1");
            const [field] = data.fields.splice(index, 1);
            data.fields.splice(Math.min(position, data.fields.length + 1) - 1, 0, field);
          },
          `✅ Moved field ${number}.`,
        );
        return;
      }
      case "reset":
        await applyChange(
          interaction,
          (data) => Object.assign(data, structuredClone(DEFAULT_EMBED)),
          "✅ Restored the original onboarding embed.",
        );
        return;
      case "refresh-tickets":
        await refreshTickets(interaction);
    }
  },
};
