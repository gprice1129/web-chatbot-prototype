export {
  CappedCounter,
}

// Counter with a cap; incrementing past the cap fails.
class CappedCounter {
  private readonly _cap: number;
  private _value: number;

  constructor(cap: number) {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new Error(`counter cap must be a positive integer, got ${cap}`);
    }
    this._cap = cap;
    this._value = 0;
  }

  // Count one more if under the cap.
  try_increment(): boolean {
    if (this._value >= this._cap) {
      return false;
    }
    this._value += 1;
    return true;
  }

  // Count one less; going below zero is a caller bug.
  decrement(): void {
    if (this._value < 1) {
      throw new Error("counter decremented below zero");
    }
    this._value -= 1;
  }
}
