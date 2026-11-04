// What a restart would cut off: page builds, pictures, plans and answers in progress. On a deploy the server lets
// them finish before it exits (instrumentation.ts).

const state = globalThis as unknown as { __unfinished?: Set<Promise<unknown>> };
const unfinished = () => (state.__unfinished ??= new Set());

/** Keeps the server from exiting before `work` settles, and returns it. */
export function finishBeforeExit<T>(work: Promise<T>): Promise<T> {
  unfinished().add(work);
  const done = () => void unfinished().delete(work);
  work.then(done, done);
  return work;
}

/** Resolves once nothing is in progress, including work that finishing work started. */
export async function allFinished(): Promise<void> {
  while (unfinished().size) await Promise.allSettled([...unfinished()]);
}
