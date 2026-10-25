import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "creator-info.json",
);

let records;
let writeQueue = Promise.resolve();

async function loadRecords() {
  if (records) return records;

  let contents;
  try {
    contents = await readFile(DATA_FILE, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      records = {};
      return records;
    }
    throw error;
  }

  const parsed = JSON.parse(contents);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Creator information file ${DATA_FILE} must contain an object.`,
    );
  }

  for (const [userId, record] of Object.entries(parsed)) {
    if (
      !/^\d+$/.test(userId) ||
      !record ||
      typeof record.fullName !== "string" ||
      typeof record.email !== "string"
    ) {
      throw new Error(
        `Creator information file ${DATA_FILE} contains an invalid record.`,
      );
    }
  }

  records = parsed;
  return records;
}

async function persistRecords(nextRecords) {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  try {
    await writeFile(tempFile, `${JSON.stringify(nextRecords, null, 2)}\n`, {
      encoding: "utf8",
      flag: "w",
      mode: 0o600,
    });
    await rename(tempFile, DATA_FILE);
  } catch (error) {
    try {
      await rm(tempFile, { force: true });
    } catch (cleanupError) {
      console.error("Failed to clean up temporary creator data file:", cleanupError);
    }
    throw error;
  }
}

export async function saveCreatorInfo(userId, { fullName, email }) {
  const operation = writeQueue.then(async () => {
    const currentRecords = await loadRecords();
    const nextRecords = {
      ...currentRecords,
      [userId]: {
        fullName,
        email,
        updatedAt: new Date().toISOString(),
      },
    };

    await persistRecords(nextRecords);
    records = nextRecords;
  });

  writeQueue = operation.catch(() => {});
  await operation;
}

export async function getCreatorInfo(userId) {
  const currentRecords = await loadRecords();
  return currentRecords[userId] ?? null;
}
