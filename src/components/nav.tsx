/**
 * The nav shell is a Server Component; only `NavLinks` is client-side, because
 * the active state comes from `usePathname`.
 *
 * md+ : a sticky full-height left rail with a border on the right.
 * < md: a fixed bottom bar. The layout leaves bottom padding for it.
 */
import { NavLinks } from "@/components/nav-links";

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
      <aside className="glass sticky top-0 hidden h-screen flex-col border-r md:flex">
        <div className="px-4 pb-3 pt-5">
          <span className="text-[15px] font-bold tracking-[-0.02em] text-ink">
            Study Tracker
          </span>
        </div>

        <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto py-1">
          <NavLinks />
        </nav>

        {slot ? <div className="border-t border-line-soft px-3 py-3">{slot}</div> : null}
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
