import { IntegrationNotConnectedError } from "../not-connected.js";

/**
 * Port for storing uploaded files. Keys are chosen by the application and
 * contain no user input. The provider behind it (local disk, an S3-compatible
 * object store) is interchangeable.
 */
export interface FileStorage {
  readonly kind: string;
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** Null if there is no file under the key. */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export class FileStorageNotConnectedError extends IntegrationNotConnectedError {
  constructor(kind: string) {
    super("file-storage", kind);
    this.name = "FileStorageNotConnectedError";
  }
}

/** Keys are ids joined by slashes: letters, digits and dashes only, no "..". */
export function assertSafeKey(key: string): void {
  if (!/^[A-Za-z0-9-]+(\/[A-Za-z0-9-]+)*$/.test(key)) throw new RangeError(`Unsafe storage key: ${key}`);
}
