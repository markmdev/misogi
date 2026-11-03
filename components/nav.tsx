import Link from "next/link";
import type { UserRow } from "@/lib/server/auth";
import { Avatar, cx, Icon } from "./ui";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cx("flex shrink-0 items-center gap-2", className)} aria-label="Misogi home">
      <Icon name="summit" size={34} />
      <span className="font-display text-[22px] font-semibold tracking-tight text-ink max-[299px]:hidden">misogi</span>
    </Link>
  );
}

export function TopBar({ user, transparent = false }: { user: Pick<UserRow, "display_name" | "avatar" | "handle"> | null; transparent?: boolean }) {
  return (
    <header className={cx("sticky top-0 z-40", transparent ? "bg-transparent" : "border-b border-line/70 bg-cream/85 backdrop-blur-md")}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 max-[299px]:px-3 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/explore" className="rounded-xl px-3 py-2 max-[279px]:px-2 text-[15px] font-bold text-ink-2 transition hover:bg-white/70 hover:text-ink">
            Explore
          </Link>
          {user ? (
            <Link href="/me" className="flex items-center gap-2 rounded-full py-1 pr-1 pl-3 text-[15px] font-bold text-ink transition hover:bg-white/70">
              <span className="hidden sm:inline">My climbs</span>
              <Avatar name={user.display_name} color={user.avatar} size={34} />
            </Link>
          ) : (
            <Link href="/start" className="btn btn-sm max-[255px]:hidden">
              Start yours
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="sticky top-[100vh] mt-20 border-t border-line/80">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-[14px] text-ink-2 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <Icon name="summit" size={24} />
          <span className="font-display font-semibold text-ink">misogi</span>
          <span>· one hard thing this year</span>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/explore" className="hover:text-ink">Explore</Link>
          <Link href="/agent.md" className="hover:text-ink">For AI agents</Link>
          <Link href="/connect" className="hover:text-ink">Connect your AI</Link>
        </div>
      </div>
    </footer>
  );
}
