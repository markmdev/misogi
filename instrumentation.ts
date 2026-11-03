export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { db } = await import("./lib/server/db");
    db(); // open the database and apply migrations before serving
    const { initSpaceQueue } = await import("./lib/server/spaces");
    initSpaceQueue();
  }
}
