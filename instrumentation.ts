export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { db } = await import("./lib/server/db");
    db(); // open the database and apply migrations before serving
    const { initSpaceQueue } = await import("./lib/server/spaces");
    initSpaceQueue();
    if (process.env.NEXT_MANUAL_SIG_HANDLE) {
      const { allFinished } = await import("./lib/server/unfinished");
      process.once("SIGTERM", () => {
        // The extra second lets the last answers reach the browser.
        void allFinished().then(() => setTimeout(() => process.exit(0), 1000));
      });
    }
  }
}
