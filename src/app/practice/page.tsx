/**
 * Practice — a small IDE for the two languages this app cares about.
 *
 * Server-rendered because everything it needs is on the machine: the file list
 * is a directory read, the code is a file read, and whether Java can run at all
 * is a question only the server can answer. Force-dynamic, since a file changed
 * in a real editor has to show up here on the next load rather than whenever a
 * cache decides.
 */
import type { Metadata } from "next";

import { PracticeEditor } from "@/components/practice-editor";
import { relativeTime } from "@/lib/dates";
import { isPracticeLang, type PracticeLang } from "@/lib/paths";
import { listPracticeFiles, readPracticeFile } from "@/lib/practice";
import { toolchainStatus } from "@/lib/runner";
import { tracerAvailable } from "@/lib/tracer";

import { FileRail } from "./file-rail";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Practice — Study Tracker",
  description: "Write Java and Python, hit Run, and read the error in plain language.",
};

const LABEL: Record<PracticeLang, string> = { java: "Java", python: "Python" };
const COMMAND: Record<PracticeLang, string> = { java: "javac", python: "python3" };

/** searchParams values are `string | string[]`; a repeated key is not a language. */
function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function PracticePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  const requestedLang = one(params.lang);
  const lang: PracticeLang = isPracticeLang(requestedLang) ? requestedLang : "java";

  // Both folders, because the explorer shows the whole tree rather than only
  // the selected language.
  const [javaFiles, pythonFiles, toolchain, tracer] = await Promise.all([
    listPracticeFiles("java"),
    listPracticeFiles("python"),
    toolchainStatus(),
    tracerAvailable(),
  ]);
  const files = lang === "java" ? javaFiles : pythonFiles;

  // A ?file= naming something that no longer exists falls back to the newest
  // file rather than showing an empty editor over a full list.
  const requestedFile = one(params.file);
  const selected =
    files.find((f) => f.name === requestedFile)?.name ?? files[0]?.name ?? null;

  const code = selected
    ? await readPracticeFile(lang, selected).catch(() => "")
    : "";

  const available = toolchain[lang].available;
  const unavailableNote = available
    ? null
    : `${COMMAND[lang]} isn't on this machine's PATH, so ${LABEL[lang]} can't run here. ` +
      `You can still write and save files — install ${LABEL[lang]}, restart the app, and Run will work.`;

  const versions = (["java", "python"] as const)
    .map((l) => toolchain[l].version || `${COMMAND[l]} not found`)
    .join(" · ");

  return (
    /**
     * Practice fills the window rather than sitting in the reading column: it
     * is an editor, and an editor that only gets 1120px with a page heading
     * above it wastes most of the screen. `100dvh` rather than `100vh` so the
     * mobile browser's collapsing toolbar does not crop the bottom off.
     */
    <div className="flex h-[100dvh] min-w-0 flex-col overflow-hidden pb-[57px] md:pb-0">
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[212px_minmax(0,1fr)] md:grid-rows-1">
        {/* Explorer. On a phone it becomes a short scrollable strip above the
            editor rather than disappearing — hidden, there is no way to open a
            different file at all. */}
        <div className="max-h-[30vh] min-h-0 border-b border-line bg-surface md:max-h-none md:border-b-0 md:border-r">
          <FileRail
            lang={lang}
            selected={selected}
            filesByLang={{
              java: javaFiles.map((f) => ({ name: f.name, modifiedText: relativeTime(f.modified) })),
              python: pythonFiles.map((f) => ({ name: f.name, modifiedText: relativeTime(f.modified) })),
            }}
          />
        </div>

        {/* editor + results */}
        <PracticeEditor
          // Remount on a file change so the buffer, the run output and the
          // save state all belong to the file actually on screen.
          key={`${lang}/${selected ?? "none"}`}
          lang={lang}
          file={selected}
          code={code}
          available={available}
          unavailableNote={unavailableNote}
          versions={versions}
          canTrace={lang === "java" && tracer.available}
        />
      </div>
    </div>
  );
}
