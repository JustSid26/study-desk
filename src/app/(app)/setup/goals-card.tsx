"use client";

/**
 * Goals.
 *
 * Saves on blur and on a committed change, never on every keystroke, and never
 * re-reads the server value back into the field — refocusing the input you just
 * left is the single most annoying thing a settings form can do.
 */

import * as React from "react";

import { Button, Card, CardBody, CardHeader, Field, Input } from "@/components/ui";
import { updateGoals } from "@/app/actions/settings";

export interface GoalValues {
  dailyProblems: number;
  goalEasy: number;
  goalMedium: number;
  goalHard: number;
  revisitDays: number;
}

type GoalKey = keyof GoalValues;

const FIELDS: Array<{
  key: GoalKey;
  label: string;
  hint: string;
  min: number;
  max: number;
  suffix: string;
}> = [
  {
    key: "dailyProblems",
    label: "Problems a day",
    hint: "What the dashboard counts today against, and what the heatmap shades a day by.",
    min: 0,
    max: 50,
    suffix: "problems",
  },
  {
    key: "goalEasy",
    label: "Easy target",
    hint: "The denominator on the Easy difficulty bar.",
    min: 0,
    max: 5000,
    suffix: "solved",
  },
  {
    key: "goalMedium",
    label: "Medium target",
    hint: "The denominator on the Medium difficulty bar.",
    min: 0,
    max: 5000,
    suffix: "solved",
  },
  {
    key: "goalHard",
    label: "Hard target",
    hint: "The denominator on the Hard difficulty bar.",
    min: 0,
    max: 5000,
    suffix: "solved",
  },
  {
    key: "revisitDays",
    label: "Revisit after",
    hint: "A solved problem older than this drops back into the revisit queue.",
    min: 1,
    max: 365,
    suffix: "days",
  },
];

export function GoalsCard({ initial }: { initial: GoalValues }) {
  const [values, setValues] = React.useState<Record<GoalKey, string>>({
    dailyProblems: String(initial.dailyProblems),
    goalEasy: String(initial.goalEasy),
    goalMedium: String(initial.goalMedium),
    goalHard: String(initial.goalHard),
    revisitDays: String(initial.revisitDays),
  });
  const committed = React.useRef(values);
  const [note, setNote] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function save(next: Record<GoalKey, string>) {
    setSaving(true);
    setError(null);
    try {
      const fd = new FormData();
      for (const { key } of FIELDS) fd.set(key, next[key]);
      const res = await updateGoals(fd);
      if (res.ok) {
        // The action clamps; reflect what was actually stored, but only for
        // fields the person is not currently typing in.
        const stored: Record<GoalKey, string> = {
          dailyProblems: String(res.dailyProblems),
          goalEasy: String(res.goalEasy),
          goalMedium: String(res.goalMedium),
          goalHard: String(res.goalHard),
          revisitDays: String(res.revisitDays),
        };
        committed.current = stored;
        setValues((cur) => {
          const active = document.activeElement as HTMLElement | null;
          const activeKey = active?.dataset?.goalKey as GoalKey | undefined;
          const merged = { ...stored };
          if (activeKey) merged[activeKey] = cur[activeKey];
          return merged;
        });
        setNote("Saved.");
      } else {
        setError(res.error);
      }
    } finally {
      setSaving(false);
    }
  }

  function commit(key: GoalKey) {
    if (values[key] === committed.current[key]) return;
    if (!values[key].trim()) {
      setValues((cur) => ({ ...cur, [key]: committed.current[key] }));
      return;
    }
    void save(values);
  }

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Goals</h2>
          <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">
            Targets, not rules. Each one drives exactly one thing elsewhere in the app.
          </p>
        </div>
        <span className="text-[11.5px] text-ink-3" aria-live="polite">
          {saving ? "Saving…" : error ? "" : note}
        </span>
      </CardHeader>

      <CardBody>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={f.min}
                  max={f.max}
                  step={1}
                  data-goal-key={f.key}
                  value={values[f.key]}
                  onChange={(e) => {
                    setValues((cur) => ({ ...cur, [f.key]: e.target.value }));
                    setNote(null);
                  }}
                  onBlur={() => commit(f.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commit(f.key);
                    }
                  }}
                  className="max-w-[7.5rem]"
                />
                <span className="text-[12px] text-ink-3">{f.suffix}</span>
              </div>
            </Field>
          ))}
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-[12.5px] leading-snug">
            {error}{" "}
            <Button size="sm" variant="ghost" onClick={() => void save(values)}>
              Try again
            </Button>
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
