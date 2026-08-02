"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReadOnly } from "@/components/ReadOnly";

const LINKS = [
  { href: "/", label: "Now" },
  { href: "/trips", label: "Trips" },
  { href: "/route", label: "Route" },
];

export default function Nav() {
  const pathname = usePathname();
  const readOnly = useReadOnly();

  return (
    <nav className="nav">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={pathname === l.href ? "active" : ""}
        >
          {l.label}
        </Link>
      ))}
      {/* Without this the disabled controls just look broken. */}
      {readOnly && <span className="view-badge">view only</span>}
    </nav>
  );
}
