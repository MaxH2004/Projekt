import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFileStorage, detectFileType, FileStorageNotConnectedError, LocalFileStorage } from "../index.js";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "hv-files-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("local file storage", () => {
  it("stores, reads and deletes by key", async () => {
    const storage = new LocalFileStorage(dir);
    await storage.put("org-1/doc-1", new Uint8Array([1, 2, 3]));
    expect(await storage.get("org-1/doc-1")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await readdir(join(dir, "org-1"))).toEqual(["doc-1"]);
    await storage.delete("org-1/doc-1");
    expect(await storage.get("org-1/doc-1")).toBeNull();
  });

  it("never overwrites and refuses keys that could leave its directory", async () => {
    const storage = new LocalFileStorage(dir);
    await storage.put("a/b", new Uint8Array([1]));
    await expect(storage.put("a/b", new Uint8Array([2]))).rejects.toThrow();
    for (const key of ["../x", "a/../../x", "/etc/passwd", "a//b", "a/b.pdf", ""]) {
      await expect(storage.get(key), key).rejects.toThrow(/Unsafe storage key/);
    }
  });

  it("is chosen by configuration", async () => {
    expect(createFileStorage("none")).toBeNull();
    expect(() => createFileStorage("local")).toThrow(/FILE_STORAGE_DIR/);
    await expect(createFileStorage("s3")!.get("a")).rejects.toBeInstanceOf(FileStorageNotConnectedError);
  });
});

describe("file type detection", () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  it("recognises the accepted types by their content", () => {
    expect(detectFileType(new TextEncoder().encode("%PDF-1.7\n"))).toBe("application/pdf");
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(detectFileType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
  });

  it("refuses everything else, whatever it is called", () => {
    expect(detectFileType(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(detectFileType(new TextEncoder().encode("PK\x03\x04"))).toBeNull();
    expect(detectFileType(bytes())).toBeNull();
  });
});
