import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Campaign briefs posted in onboarding tickets, in display order:
// [{ key, name, link, roleId, emojiKey, emojiDisplay }]
const DATA_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "briefs.json",
);

let briefs;
let writeQueue = Promise.resolve();

async function loadBriefs() {
  if (briefs) return briefs;

  let contents;
  try {
    contents = await readFile(DATA_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      briefs = [];
      return briefs;
    }
    throw error;
  }

  const parsed = JSON.parse(contents);
  if (!Array.isArray(parsed)) {
    throw new Error(`Brief file ${DATA_FILE} must contain an array.`);
  }

  for (const brief of parsed) {
    if (
      !brief ||
      !/^[a-z0-9-]+$/.test(brief.key) ||
      typeof brief.name !== "string" ||
      typeof brief.link !== "string" ||
      !/^\d+$/.test(brief.roleId) ||
      typeof brief.emojiKey !== "string" ||
      typeof brief.emojiDisplay !== "string"
    ) {
      throw new Error(`Brief file ${DATA_FILE} contains an invalid brief.`);
    }
  }

  briefs = parsed;
  return briefs;
}

async function persistBriefs(nextBriefs) {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  try {
    await writeFile(tempFile, `${JSON.stringify(nextBriefs, null, 2)}\n`, {
      encoding: "utf8",
      flag: "w",
      mode: 0o600,
    });
    await rename(tempFile, DATA_FILE);
  } catch (error) {
    try {
      await rm(tempFile, { force: true });
    } catch (cleanupError) {
      console.error("Failed to clean up temporary brief file:", cleanupError);
    }
    throw error;
  }
}

function queueWrite(update) {
  const operation = writeQueue.then(async () => {
    const nextBriefs = update(await loadBriefs());
    if (!nextBriefs) return false;
    await persistBriefs(nextBriefs);
    briefs = nextBriefs;
    return true;
  });

  writeQueue = operation.catch(() => {});
  return operation;
}

/** Turns a campaign name into the stable ID used to recognise its brief messages. */
export function makeBriefKey(name) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function listBriefs() {
  return [...(await loadBriefs())];
}

export async function getBrief(key) {
  return (await loadBriefs()).find((brief) => brief.key === key) ?? null;
}

/** Adds a brief, or replaces the one with the same key while keeping its position. */
export async function saveBrief(brief) {
  await queueWrite((currentBriefs) => {
    const nextBriefs = [...currentBriefs];
    const existingIndex = nextBriefs.findIndex((item) => item.key === brief.key);
    if (existingIndex === -1) {
      nextBriefs.push(brief);
    } else {
      nextBriefs[existingIndex] = brief;
    }
    return nextBriefs;
  });
}

/** Returns true when a brief was removed. */
export async function removeBrief(key) {
  return queueWrite((currentBriefs) => {
    if (!currentBriefs.some((brief) => brief.key === key)) return null;
    return currentBriefs.filter((brief) => brief.key !== key);
  });
}
