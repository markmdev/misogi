"use client";

import Link from "next/link";
import { type ComponentProps, useState } from "react";

/**
 * A link that loads its whole page once the pointer rests on it, a finger touches it or it takes focus, so the move to it
 * starts at once instead of after the server answers.
 */
export function IntentLink(props: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  const want = () => setIntent(true);
  return <Link {...props} prefetch={intent} onPointerEnter={want} onTouchStart={want} onFocus={want} />;
}
