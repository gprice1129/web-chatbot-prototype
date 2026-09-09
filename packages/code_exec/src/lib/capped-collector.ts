export {
  CappedCollector,
}

// Collects stream bytes up to a cap. Later bytes are dropped so the
// stream can keep draining.
class CappedCollector {
  private readonly _cap: number;
  private readonly _chunks: Buffer[];
  private _size: number;
  private _truncated: boolean;

  constructor(cap: number) {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new Error(`collector cap must be a positive integer, got ${cap}`);
    }
    this._cap = cap;
    this._chunks = [];
    this._size = 0;
    this._truncated = false;
  }

  // Feed one chunk, keeping only what fits under the cap.
  push(chunk: Buffer): void {
    if (this._truncated) {
      return;
    }
    const room = this._cap - this._size;
    if (chunk.length <= room) {
      this._chunks.push(chunk);
      this._size += chunk.length;
      return;
    }
    this._chunks.push(chunk.subarray(0, room));
    this._size = this._cap;
    this._truncated = true;
  }

  get truncated(): boolean {
    return this._truncated;
  }

  // Collected bytes decoded as UTF-8.
  text(): string {
    return Buffer.concat(this._chunks).toString("utf8");
  }
}
