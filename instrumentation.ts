export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { db } = await import("./lib/server/db");
    db(); // open the database and apply migrations before serving
    const { initSpaceQueue } = await import("./lib/server/spaces");
    initSpaceQueue();
    if (process.env.NEXT_MANUAL_SIG_HANDLE) {
      const { allFinished, inProgress } = await import("./lib/server/unfinished");
      // The server keeps serving while it waits, so it exits only after a quiet second: the last answers reach the
      // browser, and nothing asked for in that second is cut off.
      const stop = () => void allFinished().then(() => setTimeout(() => (inProgress() ? stop() : process.exit(0)), 1000));
      process.once("SIGTERM", stop);
    }
  }
}
