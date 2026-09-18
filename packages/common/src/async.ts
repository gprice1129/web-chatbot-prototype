export {
  unless_aborted,
}

/*
 * Idea: Wait on a promise only while a signal stays unaborted.
 *
 * (Promise<T>, AbortSignal) => Promise<T>
 * Settle as `pending` does, unless the signal aborts first: then reject with
 * the error throwIfAborted would, and with it at once when the signal is
 * already aborted. The abort ends the wait, not the work behind `pending`.
 * The listener is removed once `pending` settles, so a signal that outlives
 * many waits keeps none of them.
 * Side Effect: listens on the signal until `pending` settles
 * Public
 */
function unless_aborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      try {
        signal.throwIfAborted();
      } catch (err) {
        reject(err);
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    pending
      .finally(() => signal.removeEventListener("abort", abort))
      .then(resolve, reject);
  });
}
