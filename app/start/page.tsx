import type { Metadata } from "next";
import { StartFlow } from "@/components/client/start-flow";
import { TopBar } from "@/components/nav";
import { currentUser, publicOrigin } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Start your misogi" };

export default async function StartPage(props: PageProps<"/start">) {
  const sp = await props.searchParams;
  const idea = typeof sp.idea === "string" ? sp.idea.slice(0, 200) : "";
  const user = await currentUser();
  return (
    <>
      <TopBar user={user} />
      <StartFlow initialIdea={idea} signedInName={user?.display_name ?? null} origin={await publicOrigin()} />
    </>
  );
}
