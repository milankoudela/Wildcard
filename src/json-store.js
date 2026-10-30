import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

/**
 * A small JSON file in data/ with an in-memory copy and serialized writes.
 *   fallback()  value used when the file doesn't exist yet
 *   validate(v) throws if the file's contents are invalid
 */
export function createJsonStore(fileName, { fallback, validate }) {
  const file = join(DATA_DIR, fileName);
  let value;
  let writeQueue = Promise.resolve();

  async function read() {
    if (value !== undefined) return value;

    let contents;
    try {
      contents = await readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        value = fallback();
        return value;
      }
      throw error;
    }

    const parsed = JSON.parse(contents);
    try {
      validate(parsed);
    } catch (error) {
      throw new Error(`Data file ${file} is invalid: ${error.message}`);
    }
    value = parsed;
    return value;
  }

  async function persist(nextValue) {
    await mkdir(DATA_DIR, { recursive: true });
    const tempFile = `${file}.${process.pid}.tmp`;
    try {
      await writeFile(tempFile, `${JSON.stringify(nextValue, null, 2)}\n`, {
        encoding: "utf8",
        flag: "w",
        mode: 0o600,
      });
      await rename(tempFile, file);
    } catch (error) {
      try {
        await rm(tempFile, { force: true });
      } catch (cleanupError) {
        console.error(`Failed to clean up temporary file ${tempFile}:`, cleanupError);
      }
      throw error;
    }
  }

  /**
   * Applies update(current) and saves the result. Returning undefined from
   * update leaves the file untouched. Resolves to the stored value.
   */
  function update(updater) {
    const operation = writeQueue.then(async () => {
      const nextValue = await updater(await read());
      if (nextValue === undefined) return value;
      await persist(nextValue);
      value = nextValue;
      return value;
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  return { read, update };
}
