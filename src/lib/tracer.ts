import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PRACTICE_LANGS, insidePractice, ensureDataDirs } from "./paths";

/**
 * Java execution tracing.
 *
 * `tools/tracer/Tracer.java` is a JDI client: it launches the practice file in
 * a second JVM under JDWP and records the stack and heap at every line. This
 * module compiles both halves and reads the JSON it prints.
 *
 * Tracing is opt-in per run — never part of pressing Run — because each step is
 * a socket round-trip between two JVMs, which is orders of magnitude slower than
 * simply executing the code.
 */

const TRACER_SRC = path.join(process.cwd(), "tools", "tracer", "Tracer.java");
/** Compiled Tracer classes. Rebuilt only when the source is newer. */
const TRACER_OUT = path.join(process.cwd(), ".tracer-build");

/** Hard ceiling on the whole operation; the Java side stops itself at 20s. */
const WALL_MS = 40_000;
/** A trace this big already exceeds what the viewer can scrub usefully. */
const MAX_OUTPUT = 32 * 1024 * 1024;
export const DEFAULT_MAX_STEPS = 2000;
export const MAX_STEPS_ALLOWED = 20_000;

/* ------------------------------- trace shape ------------------------------ */

export type TraceValue =
  | { kind: "null" }
  | { kind: "num"; type: string; text: string }
  | { kind: "bool"; text: string }
  | { kind: "char"; text: string }
  | { kind: "string"; text: string; truncated?: boolean }
  | { kind: "cycle"; id: number }
  | { kind: "deep"; type: string; id: number }
  | { kind: "boxed"; type: string; value: TraceValue }
  | { kind: "array"; id: number; type: string; length: number; items: TraceValue[]; more?: number }
  | { kind: "list"; id: number; type: string; length: number; items: TraceValue[]; more?: number }
  | {
      kind: "object";
      id: number;
      type: string;
      fields: Array<{ name: string; value: TraceValue }>;
    };

export interface TraceFrame {
  method: string;
  line: number;
  vars: Array<{ name: string; value: TraceValue }>;
}

export interface TraceStep {
  line: number;
  method: string;
  /** characters of stdout produced by this point, so output reveals in step */
  out: number;
  frames: TraceFrame[];
}

export type StopReason = "completed" | "step-limit" | "timeout";

export interface Trace {
  ok: true;
  stopReason: StopReason;
  steps: TraceStep[];
  stdout: string;
  stderr: string;
  ms: number;
  /** the plain sentence to show above the viewer when it stopped early */
  notice?: string;
}

export interface TraceFailure {
  ok: false;
  error: string;
  /** javac output, when it was the compile that failed */
  compileError?: string;
}

export type TraceResult = Trace | TraceFailure;

/* --------------------------------- exec ---------------------------------- */

interface ExecOut {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

function exec(cmd: string, args: string[], cwd: string, timeout: number): Promise<ExecOut> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let done = false;

    child.stdout.on("data", (c: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += c.toString("utf8");
    });
    child.stderr.on("data", (c: Buffer) => {
      if (stderr.length < 64_000) stderr += c.toString("utf8");
    });

    const timer = setTimeout(() => {
      timedOut = true;
      // The tracer launches a second JVM; killing only the parent orphans it.
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeout);

    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    };
    child.on("error", (e) => {
      stderr += `\n${e.message}`;
      finish(null);
    });
    child.on("close", finish);
  });
}

/* ------------------------------ tracer build ------------------------------ */

let building: Promise<string | null> | null = null;

/**
 * Compile Tracer.java if the build is missing or stale, and hand back an error
 * string on failure rather than throwing. Concurrent callers share one build:
 * two javac processes writing the same directory is how you get a half-written
 * class file and a mystery NoClassDefFoundError.
 */
async function ensureTracer(): Promise<string | null> {
  if (building) return building;
  building = (async () => {
    try {
      const [srcStat, outStat] = await Promise.all([
        fs.stat(TRACER_SRC),
        fs.stat(path.join(TRACER_OUT, "Tracer.class")).catch(() => null),
      ]);
      if (outStat && outStat.mtimeMs >= srcStat.mtimeMs) return null;

      await fs.mkdir(TRACER_OUT, { recursive: true });
      const r = await exec(
        "javac",
        ["--add-modules", "jdk.jdi", "-d", TRACER_OUT, TRACER_SRC],
        process.cwd(),
        60_000,
      );
      if (r.code !== 0) {
        return `Couldn't build the tracer: ${r.stderr.trim().split("\n")[0] || "javac failed"}`;
      }
      return null;
    } catch {
      return "The tracer source is missing from tools/tracer/.";
    } finally {
      // Allow a later call to rebuild after the source changes again.
      building = null;
    }
  })();
  return building;
}

/* ---------------------------------- trace --------------------------------- */

const NOTICE: Record<StopReason, string | undefined> = {
  completed: undefined,
  "step-limit":
    "Stopped at the step limit. Raise it below, or narrow the code down to the part you want to watch.",
  timeout:
    "Stopped after 20 seconds. A loop whose body never reaches another line records no steps while it spins, so this usually means an infinite loop.",
};

export async function tracePractice(
  filename: string,
  maxSteps = DEFAULT_MAX_STEPS,
): Promise<TraceResult> {
  ensureDataDirs();

  const abs = insidePractice("java", filename);
  const className = path.basename(abs, ".java");
  if (!/^[A-Za-z_$][\w$]*$/.test(className)) {
    return { ok: false, error: "That filename isn't a valid Java class name." };
  }

  const buildError = await ensureTracer();
  if (buildError) return { ok: false, error: buildError };

  const started = Date.now();
  const classes = await fs.mkdtemp(path.join(os.tmpdir(), "study-trace-"));
  try {
    // -g is not optional: without debug info the tracer can see line numbers but
    // no local variables, which is most of what there is to look at.
    const compile = await exec(
      "javac",
      ["-g", "-d", classes, abs],
      PRACTICE_LANGS.java.dir,
      30_000,
    );
    if (compile.code !== 0 || compile.timedOut) {
      return {
        ok: false,
        error: "The file has to compile before it can be traced.",
        compileError: compile.stderr.trim() || compile.stdout.trim(),
      };
    }

    const steps = Math.max(1, Math.min(Math.floor(maxSteps) || DEFAULT_MAX_STEPS, MAX_STEPS_ALLOWED));
    const run = await exec(
      "java",
      ["--add-modules", "jdk.jdi", "-cp", TRACER_OUT, "Tracer", classes, className, String(steps)],
      PRACTICE_LANGS.java.dir,
      WALL_MS,
    );

    if (run.timedOut) {
      return { ok: false, error: "The tracer didn't finish in time and was stopped." };
    }

    const text = run.stdout.trim();
    if (!text) {
      return {
        ok: false,
        error: run.stderr.trim().split("\n")[0] || "The tracer produced no output.",
      };
    }

    let parsed: unknown;
    try {
      // The tracer prints one JSON object as its last line; anything the JVM
      // wrote before it (agent notices, warnings) is skipped.
      const line = text.slice(text.lastIndexOf("\n{") + 1);
      parsed = JSON.parse(line.startsWith("{") ? line : text);
    } catch {
      return { ok: false, error: "The tracer's output couldn't be read." };
    }

    const t = parsed as Partial<Trace> & { ok?: boolean; error?: string };
    if (!t.ok) return { ok: false, error: t.error || "The trace failed." };

    const stopReason = (t.stopReason ?? "completed") as StopReason;
    return {
      ok: true,
      stopReason,
      steps: Array.isArray(t.steps) ? (t.steps as TraceStep[]) : [],
      stdout: typeof t.stdout === "string" ? t.stdout : "",
      stderr: typeof t.stderr === "string" ? t.stderr : "",
      ms: Date.now() - started,
      notice: NOTICE[stopReason],
    };
  } finally {
    await fs.rm(classes, { recursive: true, force: true }).catch(() => {});
  }
}

/** Is tracing usable on this machine? Setup and the Practice tab both ask. */
export async function tracerAvailable(): Promise<{ available: boolean; reason: string }> {
  try {
    const probe = await exec("java", ["--list-modules"], os.tmpdir(), 15_000);
    if (!probe.stdout.includes("jdk.jdi")) {
      return {
        available: false,
        reason: "This JDK has no jdk.jdi module, so Java code can't be traced.",
      };
    }
    await fs.access(TRACER_SRC);
    return { available: true, reason: "" };
  } catch {
    return { available: false, reason: "The tracer source is missing from tools/tracer/." };
  }
}
