import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PRACTICE_LANGS,
  ensureDataDirs,
  insidePractice,
  type PracticeLang,
} from "./paths";

/**
 * Run a practice file — the "click Run instead of typing javac" part.
 *
 * Java compiles to a scratch directory outside the source tree so the folder
 * you browse never fills up with .class files. Python runs in place.
 *
 * Guards, because this spawns a real process:
 *  - a wall-clock timeout, after which the whole process GROUP is killed
 *    (`detached: true` + `kill(-pid)`), since `javac`/`java` spawn children that
 *    survive killing the parent alone
 *  - output is capped, so `while True: print(1)` cannot exhaust memory
 *  - stdin is closed unless input is supplied, so a program waiting on input
 *    fails fast instead of hanging until the timeout
 */

const TIMEOUT_MS = 15_000;
const MAX_OUTPUT = 256 * 1024;

export interface RunDiagnostic {
  line: number | null;
  column: number | null;
  message: string;
  /** plain-language hint for the errors people actually hit */
  hint?: string;
}

export interface RunResult {
  ok: boolean;
  stage: "compile" | "run";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  ms: number;
  timedOut: boolean;
  truncated: boolean;
  diagnostics: RunDiagnostic[];
}

interface ExecOut {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
  truncated: boolean;
}

function exec(
  cmd: string,
  args: string[],
  opts: { cwd: string; input?: string },
): Promise<ExecOut> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      detached: true, // its own process group, so we can kill descendants
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let done = false;

    const take = (buf: string, chunk: Buffer) => {
      if (buf.length >= MAX_OUTPUT) {
        truncated = true;
        return buf;
      }
      return buf + chunk.toString("utf8");
    };

    child.stdout.on("data", (c: Buffer) => (stdout = take(stdout, c)));
    child.stderr.on("data", (c: Buffer) => (stderr = take(stderr, c)));

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, TIMEOUT_MS);

    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, MAX_OUTPUT),
        code,
        timedOut,
        truncated,
      });
    };

    child.on("error", (err) => {
      stderr += `\n${err.message}`;
      finish(null);
    });
    child.on("close", finish);

    if (opts.input) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

/* --------------------------- error interpretation ------------------------- */

/**
 * Turn a compiler or interpreter message into something with a line number and,
 * where the error is a common one, a sentence saying what to actually do. The
 * raw output is always shown too — this annotates, it never replaces.
 */
const JAVA_HINTS: Array<[RegExp, string]> = [
  [/cannot find symbol/i, "A name here isn't declared — check the spelling, or whether the variable or method exists in this scope."],
  [/';' expected/i, "A statement is missing its semicolon, usually at the end of the line above."],
  [/class .+ is public, should be declared in a file named/i, "A public class has to live in a file with exactly its own name. Rename the file or the class so they match."],
  [/incompatible types: (.+) cannot be converted to (.+)/i, "The value's type doesn't match what the variable or parameter expects. Cast it, or change the declared type."],
  [/might not have been initialized/i, "The variable is declared but never assigned before it's used. Give it a starting value."],
  [/missing return statement/i, "A method that declares a return type has a path that returns nothing."],
  [/unreachable statement/i, "Code sits after a return, break or throw, so it can never run."],
  [/NullPointerException/i, "Something was null when it was used. The stack trace's first line names the method where it happened."],
  [/ArrayIndexOutOfBoundsException: Index (\d+) out of bounds for length (\d+)/i, "An index went past the end of the array — valid indexes stop one before the length."],
  [/StackOverflowError/i, "Infinite recursion — a method calls itself with no base case that stops it."],
  [/NumberFormatException/i, "A string that isn't a number was parsed as one."],
  [/main class .+ not found|Could not find or load main class/i, "The class has no `public static void main(String[] args)`, or the filename and class name disagree."],
];

const PY_HINTS: Array<[RegExp, string]> = [
  [/IndentationError|unexpected indent|expected an indented block/i, "The indentation doesn't line up. Python needs a consistent number of spaces per level — mixing tabs and spaces causes this too."],
  [/NameError: name '(.+)' is not defined/i, "That name is used before it's assigned, or it's spelled differently where it was defined."],
  [/TypeError: (.+)/i, "An operation got a type it can't work with — often a string where a number was meant, or None from a function that returned nothing."],
  [/IndexError: list index out of range/i, "An index went past the end of the list — valid indexes stop one before len()."],
  [/KeyError: (.+)/i, "That key isn't in the dictionary. Use .get(key) if a missing key should be allowed."],
  [/ZeroDivisionError/i, "Division by zero — guard the denominator before dividing."],
  [/ValueError: invalid literal for int\(\)/i, "int() got a string that isn't a whole number."],
  [/RecursionError/i, "Infinite recursion — the function calls itself with no base case."],
  [/ModuleNotFoundError: No module named '(.+)'/i, "That module isn't installed in this interpreter. Install it, or check the spelling."],
  [/SyntaxError: invalid syntax/i, "Python couldn't parse the line — a common cause is a missing colon after if/for/while/def, or unbalanced brackets."],
  [/AttributeError: '(.+)' object has no attribute '(.+)'/i, "That object doesn't have the attribute being used — check the type it actually holds."],
];

function hintFor(message: string, lang: PracticeLang): string | undefined {
  for (const [re, hint] of lang === "java" ? JAVA_HINTS : PY_HINTS) {
    if (re.test(message)) return hint;
  }
  return undefined;
}

function parseDiagnostics(
  text: string,
  lang: PracticeLang,
  filename: string,
): RunDiagnostic[] {
  if (!text.trim()) return [];
  const out: RunDiagnostic[] = [];
  const seen = new Set<string>();

  const push = (line: number | null, column: number | null, message: string) => {
    const key = `${line}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ line, column, message, hint: hintFor(message, lang) });
  };

  if (lang === "java") {
    // javac:  Main.java:7: error: ';' expected
    for (const m of text.matchAll(/^.*?([\w./-]+\.java):(\d+):\s*(?:error|warning):\s*(.+)$/gm)) {
      push(Number(m[2]), null, m[3].trim());
    }
    // runtime: Exception in thread "main" java.lang.Foo: msg  /  at Main.main(Main.java:12)
    const ex = text.match(/^(?:Exception in thread ".*?"\s*)?([\w.$]*(?:Exception|Error))(?::\s*(.*))?$/m);
    if (ex) {
      const at = text.match(new RegExp(`\\(${filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)\\)`));
      push(at ? Number(at[1]) : null, null, ex[2] ? `${ex[1]}: ${ex[2]}` : ex[1]);
    }
  } else {
    // File "x.py", line 4  ...  NameError: name 'foo' is not defined
    const lines = text.split("\n");
    let lastLine: number | null = null;
    for (const l of lines) {
      const loc = l.match(/^\s*File ".*?", line (\d+)/);
      if (loc) lastLine = Number(loc[1]);
      const err = l.match(/^\s*(\w*(?:Error|Exception|Warning))(?::\s*(.*))?$/);
      if (err) push(lastLine, null, err[2] ? `${err[1]}: ${err[2]}` : err[1]);
    }
    // SyntaxError carries its own caret line and is not always matched above
    const syn = text.match(/^\s*File ".*?", line (\d+)[\s\S]*?^(\w*SyntaxError): (.+)$/m);
    if (syn) push(Number(syn[1]), null, `${syn[2]}: ${syn[3]}`);
  }

  return out;
}

/* --------------------------------- run ----------------------------------- */

export async function runPractice(
  lang: PracticeLang,
  filename: string,
  input?: string,
): Promise<RunResult> {
  ensureDataDirs();
  const abs = insidePractice(lang, filename);
  const started = Date.now();

  const shape = (
    stage: RunResult["stage"],
    r: ExecOut,
    okWhen = r.code === 0,
  ): RunResult => ({
    ok: okWhen && !r.timedOut,
    stage,
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.code,
    ms: Date.now() - started,
    timedOut: r.timedOut,
    truncated: r.truncated,
    diagnostics: parseDiagnostics(
      `${r.stderr}\n${r.stdout}`,
      lang,
      path.basename(abs),
    ),
  });

  if (lang === "python") {
    const r = await exec("python3", [abs], { cwd: PRACTICE_LANGS.python.dir, input });
    return shape("run", r);
  }

  // Java: compile to a temp dir, then run the class from there.
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "study-java-"));
  try {
    const compile = await exec("javac", ["-d", outDir, abs], {
      cwd: PRACTICE_LANGS.java.dir,
    });
    if (compile.code !== 0 || compile.timedOut) return shape("compile", compile, false);

    const className = path.basename(abs, ".java");
    const run = await exec("java", ["-cp", outDir, className], {
      cwd: PRACTICE_LANGS.java.dir,
      input,
    });
    // Keep any compiler warnings visible alongside the run output.
    if (compile.stderr.trim()) run.stderr = `${compile.stderr.trim()}\n${run.stderr}`;
    return shape("run", run);
  } finally {
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Is the toolchain actually installed? Setup shows this so a failure is legible. */
export async function toolchainStatus(): Promise<
  Record<PracticeLang, { available: boolean; version: string }>
> {
  const probe = async (cmd: string, args: string[]) => {
    try {
      const r = await exec(cmd, args, { cwd: os.tmpdir() });
      const text = `${r.stdout}${r.stderr}`.trim().split("\n")[0] ?? "";
      return { available: r.code === 0, version: text };
    } catch {
      return { available: false, version: "" };
    }
  };
  const [java, python] = await Promise.all([
    probe("javac", ["-version"]),
    probe("python3", ["-V"]),
  ]);
  return { java, python };
}
