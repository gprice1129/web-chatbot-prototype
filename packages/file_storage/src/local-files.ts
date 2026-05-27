export {
  FileService,
  LocalFileService,
  WriteResult,
}

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { FileService, WriteResult } from "./file-service.js";

interface LocalFileServiceConfig {
  base_path: string;
}

class LocalFileService implements FileService {
  readonly backend = "local";
  private _base_path: string;

  constructor(cfg: LocalFileServiceConfig) {
    this._base_path = cfg.base_path;
  }

  async write(stream: Readable): Promise<WriteResult> {
    const storage_key = uuid_to_path(crypto.randomUUID());
    const file_path = this._resolve_path(storage_key);
    const hash = crypto.createHash("sha256");
    let size_bytes = 0;
    try {
      await fs.promises.mkdir(path.dirname(file_path), { recursive: true });
      await pipeline(
        stream,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            hash.update(chunk);
            size_bytes += chunk.length;
            yield chunk;
          }
        },
        fs.createWriteStream(file_path),
      );
    } catch (err) {
      // Best-effort cleanup; surface the original failure to the caller so
      // they can decide how to map it (HTTP code, retry, etc.).
      await fs.promises.unlink(file_path).catch(() => {});
      throw err;
    }
    return {
      storage_key,
      size_bytes,
      checksum_sha256: hash.digest("hex"),
    };
  }

  async read(storage_key: string): Promise<Readable> {
    const stream = fs.createReadStream(this._resolve_path(storage_key));
    await new Promise<void>((resolve, reject) => {
      stream.once("open", () => resolve());
      stream.once("error", reject);
    });
    return stream;
  }

  async delete(storage_key: string): Promise<void> {
    try {
      await fs.promises.unlink(this._resolve_path(storage_key));
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") return;
      throw err;
    }
  }

  private _resolve_path(storage_key: string): string {
    return path.join(this._base_path, storage_key);
  }
}

// Shard a UUID across `depth` directories of `chars` hex chars each, so a
// large number of files doesn't pile up in a single directory. The full
// UUID is appended as the leaf so the on-disk name is self-describing.
function uuid_to_path(uuid: string, depth: number = 2, chars: number = 2): string {
  const clean = uuid.replaceAll("-", "");
  const parts: string[] = [];
  for (let i = 0; i < depth; i++) {
    parts.push(clean.slice(i * chars, i * chars + chars));
  }
  parts.push(uuid);
  return path.join(...parts);
}
