import { link, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { assertSafeKey, FileStorageNotConnectedError, type FileStorage } from "./port.js";

/**
 * Files on a local disk under one directory. For a single server; the
 * directory must be part of the backups.
 */
export class LocalFileStorage implements FileStorage {
  readonly kind = "local";
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    assertSafeKey(key);
    return join(this.root, ...key.split("/"));
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    // Write next to the target, then link it into place: a reader never sees
    // half a file, and an existing file is never replaced (link fails).
    const temporary = `${target}.partial`;
    await writeFile(temporary, bytes, { flag: "wx" });
    try {
      await link(temporary, target);
    } finally {
      await unlink(temporary);
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** Kept in memory; for tests. */
export class FakeFileStorage implements FileStorage {
  readonly kind = "fake";
  readonly files = new Map<string, Uint8Array>();

  async put(key: string, bytes: Uint8Array): Promise<void> {
    assertSafeKey(key);
    this.files.set(key, bytes);
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.files.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}

/** Placeholder for an S3-compatible object store (e.g. STACKIT). Rejects every call until connected. */
export class ObjectStorage implements FileStorage {
  readonly kind = "s3";
  put(): Promise<void> {
    return Promise.reject(new FileStorageNotConnectedError(this.kind));
  }
  get(): Promise<Uint8Array | null> {
    return Promise.reject(new FileStorageNotConnectedError(this.kind));
  }
  delete(): Promise<void> {
    return Promise.reject(new FileStorageNotConnectedError(this.kind));
  }
}

export type FileStorageKind = "none" | "local" | "fake" | "s3";

/** Picks the storage by configuration (FILE_STORAGE, FILE_STORAGE_DIR). `none` = uploads are refused. */
export function createFileStorage(kind: string, directory?: string): FileStorage | null {
  switch (kind) {
    case "none":
      return null;
    case "local":
      if (!directory) throw new RangeError("FILE_STORAGE=local needs FILE_STORAGE_DIR");
      return new LocalFileStorage(directory);
    case "fake":
      return new FakeFileStorage();
    case "s3":
      return new ObjectStorage();
    default:
      throw new RangeError(`Unknown FILE_STORAGE: ${kind}`);
  }
}
