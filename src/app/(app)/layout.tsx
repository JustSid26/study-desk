/**
 * The reading layout: a centred column with breathing room, used by every page
 * except Practice.
 *
 * It lives in a route group so Practice can opt out without a prop or a
 * pathname check — `(app)` does not appear in any URL, so /subjects and the
 * rest are untouched, while /practice sits outside this layout and fills the
 * window like an editor.
 */
export default function ReadingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="px-5 pb-28 pt-6 md:px-10 md:pb-16 md:pt-9">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-6">{children}</div>
    </div>
  );
}
