export {
  FileService,
  WriteResult,
}

import { Readable } from "node:stream";

interface WriteResult {
  storage_key: string;
  size_bytes: number;
  checksum_sha256: string;
}

interface FileService {
  // Identifier persisted to db.files.storage_backend so a row can be routed
  // back to the service that owns its bytes.
  readonly backend: string;

  // Stream the bytes to the backend and return the resulting metadata. If
  // `storage_key` is omitted a fresh one is allocated; if supplied, the bytes
  // are written at that key (overwriting any existing blob there).
  // Cleans up the partial blob on any failure.
  write(stream: Readable, storage_key?: string): Promise<WriteResult>;

  // Open a read stream for an existing storage_key. Awaits the stream's
  // "open" event so a missing key surfaces here rather than mid-response
  // after headers have already been sent.
  read(storage_key: string): Promise<Readable>;

  // Idempotent delete: missing key is a no-op; other I/O errors throw.
  delete(storage_key: string): Promise<void>;
}
