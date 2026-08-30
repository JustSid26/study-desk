/**
 * Presentational primitives. Everything here is server-safe — no "use client",
 * no hooks, no event handlers — so a Server Component can render it directly
 * and a Client Component can still import it and hang handlers off the props.
 */
import * as React from "react";

const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

/* --------------------------------- card ---------------------------------- */

export function Card({
  className,
  children,
  ...rest
}: React.ComponentPropsWithRef<"section">) {
  return (
    <section className={cx("card overflow-hidden", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({
  className,
  children,
  ...rest
}: React.ComponentPropsWithRef<"div">) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line-soft px-4 py-3",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardBody({
  className,
  children,
  ...rest
}: React.ComponentPropsWithRef<"div">) {
  return (
    <div className={cx("px-4 py-4", className)} {...rest}>
      {children}
    </div>
  );
}

/* ------------------------------ page header ------------------------------- */

export function PageHeader({
  title,
  sub,
  children,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[24px] font-bold leading-tight tracking-[-0.022em] text-ink">
          {title}
        </h1>
        {sub ? <p className="sub mt-1 text-[13px] leading-snug text-ink-2">{sub}</p> : null}
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </header>
  );
}

/* ------------------------------- stat tile -------------------------------- */

export function StatTile({
  label,
  value,
  sub,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("card px-4 py-3.5", className)}>
      <div className="lbl">{label}</div>
      <div className="mt-1.5 text-[27px] font-bold leading-none tabular-nums tracking-[-0.02em] text-ink">
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-[11.5px] leading-snug text-ink-3">{sub}</div> : null}
    </div>
  );
}

/* ---------------------------------- chip ---------------------------------- */

/**
 * The dot is decoration on top of a text label, never a substitute for one —
 * `medium` sits under 3:1 on the light ground, so hue alone can't carry meaning.
 */
export function Chip({
  children,
  color,
  dot,
  className,
}: {
  children: React.ReactNode;
  color?: string;
  dot?: boolean | string;
  className?: string;
}) {
  const dotColor = typeof dot === "string" ? dot : color;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-[3px] text-[11.5px] font-medium leading-none text-ink-2",
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="inline-block h-[6px] w-[6px] shrink-0 rounded-full"
          style={{ backgroundColor: dotColor ?? "var(--color-accent)" }}
        />
      ) : null}
      {children}
    </span>
  );
}

/* --------------------------------- empty ---------------------------------- */

export function Empty({
  title,
  children,
  action,
  className,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center px-5 py-[30px] text-center", className)}>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {children ? (
        <p className="mt-1.5 max-w-[42ch] text-[13px] leading-relaxed text-ink-3">{children}</p>
      ) : null}
      {action ? <div className="mt-3.5">{action}</div> : null}
    </div>
  );
}

/* --------------------------------- meter ---------------------------------- */

export function Meter({ value, className }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, (Number.isFinite(value) ? value : 0) * 100));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cx("h-[6px] w-full overflow-hidden rounded-full bg-surface-2", className)}
    >
      <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* -------------------------------- bar row --------------------------------- */

export function BarRow({
  label,
  value,
  max,
  color,
  valueText,
}: {
  label: React.ReactNode;
  value: number;
  max: number;
  color?: string;
  valueText?: React.ReactNode;
}) {
  // A zero or negative target must not paint every row full, so fall back to a
  // denominator of 1 and let the clamp do the rest.
  const denom = Number.isFinite(max) && max > 0 ? max : 1;
  const raw = ((Number.isFinite(value) ? value : 0) / denom) * 100;
  const pct = Math.min(100, Math.max(0, raw));
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-3">
      <div className="lbl truncate">{label}</div>
      <div className="h-[8px] w-full overflow-hidden rounded-full bg-surface-2">
        {/* block, not inline — an inline element ignores width and paints nothing. */}
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color ?? "var(--color-accent)" }}
        />
      </div>
      <div className="font-mono text-[11.5px] tabular-nums text-ink-2">
        {valueText ?? value}
      </div>
    </div>
  );
}

/* -------------------------------- button ---------------------------------- */

type ButtonVariant = "primary" | "default" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent border border-accent hover:bg-accent-2 hover:border-accent-2",
  default: "bg-surface text-ink border border-line hover:bg-surface-2",
  danger: "bg-surface text-flame border border-line hover:bg-flame-soft",
  ghost: "bg-transparent text-ink-2 border border-transparent hover:bg-surface-2 hover:text-ink",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[12px] rounded-[6px] gap-1.5",
  md: "h-9 px-3.5 text-[13px] rounded-[7px] gap-2",
};

export function Button({
  variant = "default",
  size = "md",
  className,
  type,
  ...rest
}: React.ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type ?? "button"}
      className={cx(
        "inline-flex shrink-0 cursor-pointer items-center justify-center font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_SIZE[size],
        BUTTON_VARIANT[variant],
        className,
      )}
      {...rest}
    />
  );
}

/* --------------------------------- dialog --------------------------------- */

/**
 * The shared `<dialog>` panel. Six dialogs had hand-rolled this, with four
 * different backdrops between them — one of which (`bg-ink/40`) inverts to a
 * near-white haze in dark mode, because `ink` flips with the theme. The scrim
 * is a dark wash in both themes; the width stays at the call site so Tailwind
 * still sees it as a literal class.
 */
export const DIALOG_PANEL =
  "glass m-auto rounded-[16px] border p-0 text-ink shadow-none backdrop:bg-black/50";

/* ------------------------------ link button -------------------------------- */

/**
 * The Button look, as a class string, for the cases that must stay an anchor:
 * a `<Link>` for client-side navigation, or an `<a>` to somewhere outside the
 * app. A button that calls `location.assign` loses middle-click, the status bar
 * and the focus order, so the element stays a link and only the paint is shared.
 */
export function linkButtonClass({
  size = "md",
  variant = "default",
  className,
}: {
  size?: ButtonSize;
  variant?: Extract<ButtonVariant, "primary" | "default">;
  className?: string;
} = {}): string {
  return cx(
    "inline-flex shrink-0 items-center justify-center font-medium leading-none no-underline transition-colors",
    BUTTON_SIZE[size],
    BUTTON_VARIANT[variant],
    className,
  );
}

/** An `<a>` that looks like a Button — for links that leave the app. */
export function LinkButton({
  className,
  size = "md",
  variant = "default",
  ...rest
}: React.ComponentPropsWithRef<"a"> & {
  size?: ButtonSize;
  variant?: Extract<ButtonVariant, "primary" | "default">;
}) {
  return <a className={linkButtonClass({ size, variant, className })} {...rest} />;
}

/* --------------------------------- fields --------------------------------- */

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      {label ? <span className="lbl">{label}</span> : null}
      {children}
      {hint ? <span className="text-[11.5px] leading-snug text-ink-3">{hint}</span> : null}
    </label>
  );
}

const CONTROL =
  "w-full min-w-0 rounded-[7px] border border-line bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-3 disabled:opacity-60";

export function Input({ className, ...rest }: React.ComponentPropsWithRef<"input">) {
  return <input className={cx(CONTROL, "h-9", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: React.ComponentPropsWithRef<"select">) {
  return (
    <select className={cx(CONTROL, "h-9 pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: React.ComponentPropsWithRef<"textarea">) {
  return <textarea className={cx(CONTROL, "py-2 leading-relaxed", className)} {...rest} />;
}
