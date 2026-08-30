/**
 * The last few logged sessions. Server-rendered; only the per-row delete is a
 * client component, so the list itself ships no JavaScript.
 */
import { formatDay, formatMins } from "@/lib/dates";
import { subjectColor } from "@/components/subject-color";
import { Card, CardHeader, Chip, Empty } from "@/components/ui";
import { DeleteSessionButton } from "@/components/subjects/delete-session-button";

export interface RecentSessionRow {
  id: string;
  minutes: number;
  day: string;
  note: string;
  subjectId: string | null;
  subjectName: string | null;
  subjectColor: string | null;
}

export function RecentSessions({
  sessions,
  action,
}: {
  sessions: RecentSessionRow[];
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-[14.5px] font-semibold text-ink">Recent sessions</h2>
        {action}
      </CardHeader>

      {sessions.length === 0 ? (
        <Empty title="No study time logged yet" action={action}>
          Log a session when you finish studying — minutes against a subject is what fills the
          heatmap and keeps the streak alive.
        </Empty>
      ) : (
        <ul className="divide-y divide-line-soft">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
              <Chip dot={subjectColor(s.subjectColor)} className="shrink-0">
                {s.subjectName ?? "Unfiled"}
              </Chip>
              <span className="shrink-0 font-mono text-[12.5px] tabular-nums text-ink">
                {formatMins(s.minutes)}
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-ink-3">
                {formatDay(s.day)}
              </span>
              {s.note ? (
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{s.note}</span>
              ) : (
                <span className="min-w-0 flex-1" />
              )}
              <DeleteSessionButton
                id={s.id}
                label={`${formatMins(s.minutes)} on ${formatDay(s.day)}`}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
