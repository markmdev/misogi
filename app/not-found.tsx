import Link from "next/link";
import { TopBar } from "@/components/nav";
import { Mascot } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <TopBar user={null} />
      <main className="mx-auto flex max-w-md flex-col items-center px-4 pt-16 text-center">
        <Mascot pose="think" size={130} />
        <h1 className="mt-4 text-[26px] leading-8 text-ink">This trail doesn&apos;t exist</h1>
        <p className="mt-2 text-[15px] leading-6 text-ink-2">The page may have moved, or the link has a typo.</p>
        <div className="mt-6 flex gap-3">
          <Link href="/explore" className="btn btn-ghost">
            Explore
          </Link>
          <Link href="/" className="btn">
            Home
          </Link>
        </div>
      </main>
    </>
  );
}
