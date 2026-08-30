/**
 * The LeetCode-specific presentational pieces, shared by the page (a Server
 * Component) and its client-side table. Nothing here has state or a handler,
 * and nothing imports a `server-only` module at runtime, so both sides can use
 * it. The generic primitives — including `LinkButton` — live in
 * `@/components/ui`.
 */
import type { Difficulty } from "@/db/schema";
import { Chip } from "@/components/ui";

/** Row shape the table and the revisit list read. Mirrors `ProblemView` from
 *  `@/lib/queries` structurally, so the page can pass its rows straight in
 *  without dragging a server-only module into the client bundle. */
export interface ProblemItem {
  id: string;
  slug: string;
  number: number | null;
  title: string;
  url: string | null;
  difficulty: Difficulty;
  status: string;
  solvedDay: string;
  minutes: number | null;
  lang: string | null;
  notes: string;
  attempts: number;
  confidence: number | null;
  source: string;
  tags: string[];
}

export const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  Easy: "var(--color-easy)",
  Medium: "var(--color-medium)",
  Hard: "var(--color-hard)",
};

/** The word is the label; the dot is decoration. `medium` is under 3:1 on the
 *  light ground, so hue on its own would be unreadable for some people. */
export function DifficultyChip({ difficulty }: { difficulty: Difficulty }) {
  return (
    <Chip dot={DIFFICULTY_COLOR[difficulty]}>
      <span>{difficulty}</span>
    </Chip>
  );
}
