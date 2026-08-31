/**
 * The nav shell is a Server Component; only `NavLinks` is client-side, because
 * the active state comes from `usePathname`.
 *
 * md+ : a sticky full-height left rail with a border on the right.
 * < md: a fixed bottom bar. The layout leaves bottom padding for it.
 */
import { NavLinks } from "@/components/nav-links";
import { RailToggle } from "@/components/rail-toggle";

export function Nav({
  footer,
  children,
}: {
  /** Slot at the foot of the rail (md+ only) — the streak chip lands here. */
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const slot = footer ?? children;

  return (
    <>
      <aside
        data-rail-aside
        className="glass sticky top-0 hidden h-screen flex-col border-r md:flex"
      >
        <div className="flex items-center justify-between gap-2 py-4 pl-4 pr-2.5">
          <span className="truncate text-[15px] font-bold tracking-[-0.02em] text-ink [[data-rail=collapsed]_&]:hidden">
            Study Tracker
          </span>
          <RailToggle />
        </div>

        <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto py-1">
          <NavLinks />
        </nav>

        {slot ? <div className="rail-foot border-t border-line-soft px-3 py-3">{slot}</div> : null}
      </aside>

      <nav
        aria-label="Main"
        className="glass fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <NavLinks variant="bar" />
      </nav>
    </>
  );
}

export default Nav;
