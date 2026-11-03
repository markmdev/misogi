import type { Metadata } from "next";
import { TopBar } from "@/components/nav";
import { Mascot } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function SignIn(props: PageProps<"/signin/[token]">) {
  const { token } = await props.params;
  return (
    <>
      <TopBar user={null} />
      <main className="mx-auto flex max-w-md flex-col items-center px-4 pt-16 text-center">
        <Mascot pose="wave" size={120} />
        <h1 className="mt-4 text-[26px] leading-8 text-ink">Welcome back</h1>
        <p className="mt-2 text-[15px] leading-6 text-ink-2">Your AI sent you a one-time link. Continue to sign in on this device.</p>
        <form method="post" action="/api/signin" className="mt-6 w-full">
          <input type="hidden" name="token" value={token} />
          <button className="btn w-full">Continue</button>
        </form>
      </main>
    </>
  );
}
