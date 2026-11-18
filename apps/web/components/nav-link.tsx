"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label }: { href: string; label: string }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} className={active ? "nav-link active" : "nav-link"} aria-current={active ? "page" : undefined}>
      {label}
    </Link>
  );
}
