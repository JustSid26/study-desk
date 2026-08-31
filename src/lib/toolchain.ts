import "server-only";

import { spawn } from "node:child_process";

/**
 * Locating the toolchain, and stopping it, across platforms.
 *
 * Two things differ enough between Windows and everything else that hard-coding
 * either one breaks the app on the other:
 *
 *  - **The Python command.** POSIX has `python3`. The Windows installer creates
 *    `python.exe` and the `py` launcher and does NOT create `python3` — worse,
 *    Windows ships an App Execution Alias called `python3` that opens the
 *    Microsoft Store instead of running anything. So the command is discovered
 *    rather than assumed, and every candidate is checked for a real "Python 3"
 *    banner before being trusted.
 *
 *  - **Killing a run.** `javac` and `java` spawn children, so stopping a run
 *    means stopping a whole tree. POSIX does that with a process group and a
 *    negative pid; Windows has no such thing and needs `taskkill /T`.
 */

export const IS_WINDOWS = process.platform === "win32";

interface Probe {
  cmd: string;
  args: string[];
}

/** In preference order. `py -3` first on Windows: it is the official launcher. */
const PYTHON_CANDIDATES: Probe[] = IS_WINDOWS
  ? [
      { cmd: "py", args: ["-3"] },
      { cmd: "python", args: [] },
      { cmd: "python3", args: [] },
    ]
  : [
      { cmd: "python3", args: [] },
      { cmd: "python", args: [] },
    ];

export interface ResolvedCommand {
  /** the executable to spawn, or null when nothing usable was found */
  cmd: string | null;
  /** arguments that must come before the script path, e.g. ["-3"] for `py` */
  prefix: string[];
  /** the version banner, for showing in Setup */
  version: string;
}

function run(cmd: string, args: string[], timeout = 8000): Promise<{ out: string; code: number | null }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: IS_WINDOWS });
    } catch {
      resolve({ out: "", code: null });
      return;
    }
    let out = "";
    const take = (c: Buffer) => {
      if (out.length < 4000) out += c.toString("utf8");
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const timer = setTimeout(() => child.kill(), timeout);
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ out: "", code: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ out, code });
    });
  });
}

let pythonCache: ResolvedCommand | null = null;

/**
 * Find a working Python 3. Cached for the process — this spawns up to three
 * probes and the answer cannot change without a restart anyway.
 */
export async function resolvePython(): Promise<ResolvedCommand> {
  if (pythonCache) return pythonCache;

  for (const { cmd, args } of PYTHON_CANDIDATES) {
    const r = await run(cmd, [...args, "-V"]);
    const banner = r.out.trim().split("\n")[0] ?? "";
    // The Store stub exits non-zero and prints nothing useful, and a stray
    // Python 2 must not be accepted either.
    if (r.code === 0 && /^Python 3\./.test(banner)) {
      pythonCache = { cmd, prefix: args, version: banner };
      return pythonCache;
    }
  }

  pythonCache = { cmd: null, prefix: [], version: "" };
  return pythonCache;
}

/** The command that would install it, named per platform, for the error text. */
export const PYTHON_HINT = IS_WINDOWS
  ? 'Install Python from python.org and tick "Add python.exe to PATH", then restart the app.'
  : process.platform === "darwin"
    ? "Install it with `brew install python` (or from python.org), then restart the app."
    : "Install it with your package manager, e.g. `sudo apt install python3`, then restart the app.";

export const JAVA_HINT = IS_WINDOWS
  ? "Install a JDK (Temurin or Oracle), make sure its bin folder is on PATH, then restart the app."
  : process.platform === "darwin"
    ? "Install a JDK with `brew install openjdk` (then follow the symlink line it prints), or from adoptium.net, and restart the app."
    : "Install a full JDK — `sudo apt install default-jdk` — not just the JRE, then restart the app.";

/**
 * Stop a spawned process and everything it started.
 *
 * POSIX: the child was put in its own group, so a negative pid reaches the
 * whole tree. Windows: no process groups, so `taskkill /T` walks the tree
 * instead. Falling back to `child.kill()` alone would leave `java` running
 * after a timeout.
 */
export function killTree(child: { pid?: number; kill: (sig?: NodeJS.Signals) => boolean }) {
  const pid = child.pid;
  if (!pid) return;

  if (IS_WINDOWS) {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", shell: true });
      return;
    } catch {
      /* fall through to the plain kill */
    }
  } else {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      /* the group is already gone, or was never created */
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* already dead */
  }
}

/** `detached` means "new process group" on POSIX but "new console" on Windows. */
export const DETACHED = !IS_WINDOWS;
