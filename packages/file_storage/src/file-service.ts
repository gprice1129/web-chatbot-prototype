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

  // Allocate a fresh storage_key, stream the bytes to it, and return the
  // resulting metadata. Cleans up the partial blob on any failure.
  write(stream: Readable): Promise<WriteResult>;

  // Open a read stream for an existing storage_key. Awaits the stream's
  // "open" event so a missing key surfaces here rather than mid-response
  // after headers have already been sent.
  read(storage_key: string): Promise<Readable>;

  // Idempotent delete: missing key is a no-op; other I/O errors throw.
  delete(storage_key: string): Promise<void>;
}
