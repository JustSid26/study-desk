/**
 * Subjects — what you are studying, broken into topics that each carry a
 * mastery level. Server Component: every read happens here, and the only
 * client code is the dialogs and the topic controls.
 */
import { getRecentSessions, getSubjects } from "@/lib/queries";
import { formatMins } from "@/lib/dates";
import { Card, Empty, PageHeader } from "@/components/ui";
import { LogSessionButton } from "@/components/log-dialogs";
import { NewSubjectButton } from "@/components/subjects/new-subject-dialog";
import { SubjectCard } from "@/components/subjects/subject-card";
import { RecentSessions } from "@/components/subjects/recent-sessions";

export const dynamic = "force-dynamic";

export default async function SubjectsPage() {
  const [subjects, recent] = await Promise.all([getSubjects(), getRecentSessions(10)]);

  const totalMins = subjects.reduce((a, s) => a + s.minutesLogged, 0);
  const topicCount = subjects.reduce((a, s) => a + s.topics.length, 0);
  const solidCount = subjects.reduce((a, s) => a + s.counts.solid, 0);

  const sub = subjects.length
    ? `${formatMins(totalMins)} tracked · ${subjects.length} ${
        subjects.length === 1 ? "subject" : "subjects"
      } · ${topicCount} ${topicCount === 1 ? "topic" : "topics"}, ${solidCount} solid`
    : "What you are studying, broken into topics you can mark off as they get solid.";

  const logButton = (
    <LogSessionButton
      subjects={subjects.map((s) => ({ id: s.id, name: s.name, color: s.color }))}
    />
  );

  return (
    <>
      <PageHeader title="Subjects" sub={sub}>
        <NewSubjectButton />
        {logButton}
      </PageHeader>

      {subjects.length === 0 ? (
        <Card>
          <Empty title="No subjects yet" action={<NewSubjectButton />}>
            A subject is one thing you are studying — a paper, a module, a language. Inside it,
            each topic carries its own mastery level, from not started through to solid, so you
            can see what is left rather than guessing.
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {subjects.map((s) => (
            <SubjectCard key={s.id} subject={s} />
          ))}
        </div>
      )}

      <RecentSessions sessions={recent} action={logButton} />
    </>
  );
}
