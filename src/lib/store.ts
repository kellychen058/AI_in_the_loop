import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createSeedDatabase } from './seed';
import type { AppDatabase } from './types';

export const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'db.json');

// Per-path in-process write queue so concurrent API requests never race on the JSON file.
const writeQueues = new Map<string, Promise<unknown>>();

function resolveDbPath(dbPath?: string): string {
  return path.resolve(dbPath ?? DEFAULT_DB_PATH);
}

function enqueue<T>(targetPath: string, operation: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(targetPath) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(targetPath, settled);
  return next;
}

async function atomicWriteJson(targetPath: string, data: AppDatabase): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const uniqueSuffix = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  const tmpPath = `${targetPath}.${uniqueSuffix}.tmp`;
  const serialized = `${JSON.stringify(data, null, 2)}\n`;

  try {
    await fs.writeFile(tmpPath, serialized, 'utf8');
    await fs.rename(tmpPath, targetPath);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

async function readOrSeedUnlocked(targetPath: string): Promise<AppDatabase> {
  try {
    const raw = await fs.readFile(targetPath, 'utf8');
    return JSON.parse(raw) as AppDatabase;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      const seeded = createSeedDatabase();
      await atomicWriteJson(targetPath, seeded);
      return seeded;
    }
    throw error;
  }
}

/**
 * Reads the local JSON database, auto-creating `data/` and auto-seeding if missing.
 */
export async function readDb(dbPath?: string): Promise<AppDatabase> {
  const targetPath = resolveDbPath(dbPath);
  try {
    const raw = await fs.readFile(targetPath, 'utf8');
    return JSON.parse(raw) as AppDatabase;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT') {
      return enqueue(targetPath, () => readOrSeedUnlocked(targetPath));
    }
    throw error;
  }
}

/**
 * Atomically writes the full database snapshot via a temp file + rename.
 */
export async function writeDb(db: AppDatabase, dbPath?: string): Promise<void> {
  const targetPath = resolveDbPath(dbPath);
  await enqueue(targetPath, () => atomicWriteJson(targetPath, db));
}

/**
 * Atomically reads, transforms, and persists the database under the per-path write queue.
 * The updater may mutate `db` in place (returning `void`) or return a replacement `AppDatabase`.
 */
export async function updateDb(
  updater: (db: AppDatabase) => AppDatabase | void | Promise<AppDatabase | void>,
  dbPath?: string,
): Promise<AppDatabase> {
  const targetPath = resolveDbPath(dbPath);
  return enqueue(targetPath, async () => {
    const current = await readOrSeedUnlocked(targetPath);
    const updated = await updater(current);
    const nextDb = updated ?? current;
    await atomicWriteJson(targetPath, nextDb);
    return nextDb;
  });
}

/**
 * Resets the database back to a fresh seed snapshot anchored to the active workweek.
 */
export async function resetDb(dbPath?: string, referenceDate?: Date): Promise<AppDatabase> {
  const targetPath = resolveDbPath(dbPath);
  return enqueue(targetPath, async () => {
    const seeded = createSeedDatabase(referenceDate);
    await atomicWriteJson(targetPath, seeded);
    return seeded;
  });
}
