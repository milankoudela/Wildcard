import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "reaction-roles.json",
);

let rules;
let writeQueue = Promise.resolve();

async function loadRules() {
  if (rules) return rules;

  let contents;
  try {
    contents = await readFile(DATA_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      rules = [];
      return rules;
    }
    throw error;
  }

  const parsed = JSON.parse(contents);
  if (!Array.isArray(parsed)) {
    throw new Error(`Reaction-role file ${DATA_FILE} must contain an array.`);
  }

  for (const rule of parsed) {
    if (
      !rule ||
      !/^\d+$/.test(rule.guildId) ||
      !/^\d+$/.test(rule.channelId) ||
      !/^\d+$/.test(rule.messageId) ||
      !/^\d+$/.test(rule.roleId) ||
      typeof rule.emojiKey !== "string" ||
      typeof rule.emojiDisplay !== "string"
    ) {
      throw new Error(`Reaction-role file ${DATA_FILE} contains an invalid rule.`);
    }
  }

  rules = parsed;
  return rules;
}

async function persistRules(nextRules) {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  try {
    await writeFile(tempFile, `${JSON.stringify(nextRules, null, 2)}\n`, {
      encoding: "utf8",
      flag: "w",
      mode: 0o600,
    });
    await rename(tempFile, DATA_FILE);
  } catch (error) {
    try {
      await rm(tempFile, { force: true });
    } catch (cleanupError) {
      console.error("Failed to clean up temporary reaction-role file:", cleanupError);
    }
    throw error;
  }
}

export async function saveReactionRole(rule) {
  const operation = writeQueue.then(async () => {
    const currentRules = await loadRules();
    const existingIndex = currentRules.findIndex(
      (existing) =>
        existing.guildId === rule.guildId &&
        existing.messageId === rule.messageId &&
        existing.emojiKey === rule.emojiKey,
    );
    const nextRules = [...currentRules];

    if (existingIndex === -1) {
      nextRules.push(rule);
    } else {
      nextRules[existingIndex] = rule;
    }

    await persistRules(nextRules);
    rules = nextRules;
  });

  writeQueue = operation.catch(() => {});
  await operation;
}

export async function getReactionRole(guildId, messageId, emojiKey) {
  const currentRules = await loadRules();
  return (
    currentRules.find(
      (rule) =>
        rule.guildId === guildId &&
        rule.messageId === messageId &&
        rule.emojiKey === emojiKey,
    ) ?? null
  );
}
