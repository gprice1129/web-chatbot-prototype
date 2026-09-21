export {
  unless_aborted,
}

/*
 * Idea: Wait on a promise only while a signal stays unaborted.
 *
 * (Promise<T>, AbortSignal) => Promise<T>
 * Settle as `pending` does, unless the signal aborts first: then reject with
 * the error throwIfAborted would, and with it at once when the signal is
 * already aborted. The abort ends the wait, not the work behind `pending`,
 * which stays observed either way so a rejection after the wait is never
 * left unhandled. The listener is removed once `pending` settles, so a
 * signal that outlives many waits keeps none of them.
 * Side Effect: listens on the signal until `pending` settles
 * Public
 */
function unless_aborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
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
    // Checked last so `pending` is already observed when this rejects.
    signal.throwIfAborted();
  });
}
