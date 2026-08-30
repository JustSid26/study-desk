/**
 * A subject's stored colour is user input — it comes back out of SQLite and
 * would otherwise land straight in a `style` attribute. Anything that is not
 * exactly a 6-digit hex is thrown away and the accent token is used instead.
 */

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function subjectColor(c?: string | null): string {
  return typeof c === "string" && HEX6.test(c) ? c : "var(--color-accent)";
}

/**
 * Subject markers are TONES, not hues — the interface is monochrome, so a
 * subject is told apart by its name first and its weight second. Eight steps
 * spaced far enough apart to be distinguishable side by side, each holding up
 * on both the light and the dark ground (the mid steps carry both; the ends
 * are used sparingly and never adjacent).
 */
export const SUBJECT_COLORS: string[] = [
  "#14181B",
  "#333B41",
  "#4B535A",
  "#636C73",
  "#7D868E",
  "#959EA5",
  "#AEB6BD",
  "#C7CDD2",
];
