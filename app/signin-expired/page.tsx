import Link from "next/link";
import { TopBar } from "@/components/nav";
import { Mascot } from "@/components/ui";

export default function SignInExpired() {
  return (
    <>
      <TopBar user={null} />
      <main className="mx-auto flex max-w-md flex-col items-center px-4 pt-16 text-center">
        <Mascot pose="sleep" size={130} />
        <h1 className="mt-4 text-[26px] leading-8 text-ink">That link has expired</h1>
        <p className="mt-2 text-[15px] leading-6 text-ink-2">Sign-in links work once, for 15 minutes. Ask your AI for a new one.</p>
        <Link href="/" className="btn mt-6">
          Go home
        </Link>
      </main>
    </>
  );
}
