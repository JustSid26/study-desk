"use client";

/**
 * Only the link list is a Client Component — it needs `usePathname` to mark the
 * active route. The rail shell around it stays on the server.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

type IconProps = { className?: string };

const S = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function IconDashboard(p: IconProps) {
  return (
    <svg {...S} {...p} aria-hidden="true">
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconNotes(p: IconProps) {
  return (
    <svg {...S} {...p} aria-hidden="true">
      <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

function IconCode(p: IconProps) {
  return (
    <svg {...S} {...p} aria-hidden="true">
      <path d="m8 8-4 4 4 4" />
      <path d="m16 8 4 4-4 4" />
      <path d="m13.5 5-3 14" />
    </svg>
  );
}

function IconSubjects(p: IconProps) {
  return (
    <svg {...S} {...p} aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5Z" />
    </svg>
  );
}

function IconSetup(p: IconProps) {
  return (
    <svg {...S} {...p} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
    </svg>
  );
}

const LINKS = [
  { href: "/", label: "Dashboard", Icon: IconDashboard },
  { href: "/notes", label: "Notes", Icon: IconNotes },
  { href: "/leetcode", label: "LeetCode", Icon: IconCode },
  { href: "/subjects", label: "Subjects", Icon: IconSubjects },
  { href: "/setup", label: "Setup", Icon: IconSetup },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ variant = "rail" }: { variant?: "rail" | "bar" }) {
  const pathname = usePathname() ?? "/";

  if (variant === "bar") {
    return (
      <ul className="flex items-stretch justify-around">
        {LINKS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2 text-[10.5px] font-medium transition-colors ${
                  active ? "text-accent" : "text-ink-3 hover:text-ink"
                }`}
              >
                <Icon />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5 px-2.5">
      {LINKS.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-[13px] font-medium transition-colors ${
                active
                  ? "bg-accent-soft text-accent"
                  : "text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <span className="shrink-0">
                <Icon />
              </span>
              <span className="truncate">{label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
