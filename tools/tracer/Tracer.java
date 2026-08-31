import com.sun.jdi.*;
import com.sun.jdi.connect.*;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Records what a Java program does, line by line, and prints it as JSON.
 *
 * The JVM has no equivalent of Python's sys.settrace. The only supported way to
 * watch a program run is JDI, which is a *Java* API — so this is a second JVM
 * that launches the target under JDWP, single-steps it, and serialises the
 * stack and heap at every line. Node spawns this and reads stdout.
 *
 *   java --add-modules jdk.jdi -cp <thisDir> Tracer <classesDir> <MainClass> <maxSteps>
 *
 * The target must be compiled with -g, or `visibleVariables()` throws
 * AbsentInformationException and there are no locals to show — the caller is
 * responsible for that flag.
 *
 * Everything is bounded on purpose. Stepping costs a socket round-trip per
 * line, so a loop to a million would take hours and produce a trace no UI could
 * open: `maxSteps` stops it and the JSON says so, rather than appearing to
 * succeed with a truncated story.
 */
public final class Tracer {

  /** How deep into an object graph to serialise before writing a placeholder. */
  private static final int MAX_DEPTH = 3;
  /** Elements of an array or list to record. Beyond this the JSON notes the rest. */
  private static final int MAX_ELEMENTS = 100;
  /** Characters of any single string. */
  private static final int MAX_STRING = 400;
  /**
   * Wall-clock ceiling, independent of the step cap.
   *
   * Both limits are needed. STEP_LINE only fires when execution reaches a
   * *different* line, so a loop whose body never leaves one line — `while (true)
   * { x++; }` — produces no step events at all and would spin past any step cap
   * untouched. The clock is the only thing that catches it.
   */
  private static final long MAX_MILLIS = 20_000;

  private final StringBuilder out = new StringBuilder();
  private final StringBuilder err = new StringBuilder();
  private final List<String> steps = new ArrayList<>();

  private String stopReason = "completed";
  private int stepCount = 0;

  public static void main(String[] args) {
    if (args.length < 3) {
      System.out.println("{\"ok\":false,\"error\":\"usage: Tracer <classesDir> <MainClass> <maxSteps>\"}");
      return;
    }
    PrintStream stdout = new PrintStream(System.out, true, StandardCharsets.UTF_8);
    try {
      new Tracer().run(args[0], args[1], Integer.parseInt(args[2]), stdout);
    } catch (Throwable t) {
      stdout.println("{\"ok\":false,\"error\":" + Json.str(describe(t)) + "}");
    }
  }

  private static String describe(Throwable t) {
    String m = t.getMessage();
    return t.getClass().getSimpleName() + (m == null ? "" : ": " + m);
  }

  /* ------------------------------------------------------------------ run */

  private void run(String classesDir, String mainClass, int maxSteps, PrintStream stdout)
      throws Exception {

    LaunchingConnector connector = Bootstrap.virtualMachineManager().defaultConnector();
    Map<String, Connector.Argument> args = connector.defaultArguments();
    args.get("main").setValue(mainClass);
    args.get("options").setValue("-cp \"" + classesDir + "\"");
    // Suspended at launch so the step request is in place before main() runs.
    args.get("suspend").setValue("true");

    VirtualMachine vm = connector.launch(args);

    // The target's pipes must be drained continuously. A full pipe buffer blocks
    // the target JVM's write, and it never reaches the next line to be stepped —
    // the trace would simply hang partway through with no error.
    Process proc = vm.process();
    Thread tOut = drain(proc.getInputStream(), out);
    Thread tErr = drain(proc.getErrorStream(), err);

    EventRequestManager erm = vm.eventRequestManager();
    ClassPrepareRequest prepare = erm.createClassPrepareRequest();
    prepare.addClassFilter(mainClass);
    prepare.setSuspendPolicy(EventRequest.SUSPEND_ALL);
    prepare.enable();

    long deadline = System.currentTimeMillis() + MAX_MILLIS;
    boolean running = true;
    vm.resume();

    EventQueue queue = vm.eventQueue();
    while (running) {
      EventSet set;
      try {
        set = queue.remove(500);
      } catch (InterruptedException e) {
        break;
      }
      if (set == null) {
        if (System.currentTimeMillis() > deadline) {
          stopReason = "timeout";
          break;
        }
        continue;
      }

      boolean resume = true;
      for (Event event : set) {
        if (event instanceof ClassPrepareEvent) {
          ThreadReference thread = ((ClassPrepareEvent) event).thread();
          StepRequest step = erm.createStepRequest(
              thread, StepRequest.STEP_LINE, StepRequest.STEP_INTO);
          // Only the user's own class. Without this, every step descends into
          // the JDK's internals and the trace is thousands of frames of
          // String.format before it reaches line two.
          step.addClassFilter(mainClass);
          step.setSuspendPolicy(EventRequest.SUSPEND_ALL);
          step.enable();

        } else if (event instanceof StepEvent) {
          StepEvent se = (StepEvent) event;
          if (stepCount >= maxSteps) {
            stopReason = "step-limit";
            running = false;
            resume = false;
            break;
          }
          if (System.currentTimeMillis() > deadline) {
            stopReason = "timeout";
            running = false;
            resume = false;
            break;
          }
          capture(se.thread(), mainClass);
          stepCount++;

        } else if (event instanceof VMDeathEvent || event instanceof VMDisconnectEvent) {
          running = false;
          resume = false;
        }
      }
      if (resume) set.resume();
    }

    // Stop the target regardless of how the loop ended.
    try {
      vm.exit(0);
    } catch (Throwable ignored) {
      try {
        proc.destroyForcibly();
      } catch (Throwable ignored2) {
        /* already gone */
      }
    }
    join(tOut);
    join(tErr);

    emit(stdout);
  }

  private static void join(Thread t) {
    try {
      t.join(1500);
    } catch (InterruptedException ignored) {
      Thread.currentThread().interrupt();
    }
  }

  private Thread drain(InputStream in, StringBuilder sink) {
    Thread t = new Thread(() -> {
      try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
        char[] buf = new char[4096];
        int n;
        while ((n = r.read(buf)) != -1) {
          synchronized (sink) {
            if (sink.length() < 200_000) sink.append(buf, 0, n);
          }
        }
      } catch (IOException ignored) {
        /* the target exited mid-read */
      }
    });
    t.setDaemon(true);
    t.start();
    return t;
  }

  /* -------------------------------------------------------------- capture */

  private void capture(ThreadReference thread, String mainClass) {
    try {
      List<StackFrame> frames = thread.frames();
      if (frames.isEmpty()) return;

      StackFrame top = frames.get(0);
      Location loc = top.location();

      StringBuilder sb = new StringBuilder(256);
      sb.append("{\"line\":").append(loc.lineNumber());
      sb.append(",\"method\":").append(Json.str(loc.method().name()));

      // How much the program had printed by this step, so the viewer can reveal
      // output in step with the code rather than dumping it all at the end.
      int printed;
      synchronized (out) {
        printed = out.length();
      }
      sb.append(",\"out\":").append(printed);

      sb.append(",\"frames\":[");
      int shown = 0;
      for (StackFrame f : frames) {
        // Frames below the user's class are the JVM's own launcher; showing them
        // is noise.
        if (!f.location().declaringType().name().equals(mainClass)) continue;
        if (shown > 0) sb.append(',');
        sb.append(frame(f));
        shown++;
        if (shown >= 24) break; // deep recursion: keep the trace readable
      }
      sb.append("]}");
      steps.add(sb.toString());

    } catch (IncompatibleThreadStateException | InvalidStackFrameException e) {
      // The thread moved on before we read it — skip this step rather than
      // abandoning the whole trace.
    }
  }

  private String frame(StackFrame f) {
    StringBuilder sb = new StringBuilder(128);
    sb.append("{\"method\":").append(Json.str(f.location().method().name()));
    sb.append(",\"line\":").append(f.location().lineNumber());
    sb.append(",\"vars\":[");

    boolean first = true;
    try {
      // `this` first, when there is one — an instance field is as much a local
      // as a variable is, from the reader's point of view.
      ObjectReference self = f.thisObject();
      if (self != null) {
        sb.append("{\"name\":\"this\",\"value\":")
          .append(value(self, 1, new IdentityHashMap<>()))
          .append('}');
        first = false;
      }

      for (LocalVariable v : f.visibleVariables()) {
        Value val;
        try {
          val = f.getValue(v);
        } catch (Throwable t) {
          continue; // not yet in scope at this line
        }
        if (!first) sb.append(',');
        sb.append("{\"name\":").append(Json.str(v.name()))
          .append(",\"value\":").append(value(val, 1, new IdentityHashMap<>()))
          .append('}');
        first = false;
      }
    } catch (AbsentInformationException e) {
      // Compiled without -g. The caller passes it, so this is close to
      // unreachable; if it happens, the line numbers are still worth showing.
    } catch (Throwable ignored) {
      /* a frame that vanished mid-read */
    }

    sb.append("]}");
    return sb.toString();
  }

  /* ------------------------------------------------------- serialising values */

  /**
   * Render a JDI value as JSON.
   *
   * `seen` is an identity map, not a set of values: an object graph can contain
   * cycles (a node whose child points back at it), and without it this recurses
   * until the stack overflows.
   */
  private String value(Value v, int depth, IdentityHashMap<ObjectReference, Boolean> seen) {
    if (v == null) return "{\"kind\":\"null\"}";

    if (v instanceof PrimitiveValue) {
      String type = v.type().name();
      if (v instanceof CharValue) {
        return "{\"kind\":\"char\",\"text\":" + Json.str(String.valueOf(((CharValue) v).value())) + "}";
      }
      if (v instanceof BooleanValue) {
        return "{\"kind\":\"bool\",\"text\":\"" + ((BooleanValue) v).value() + "\"}";
      }
      // Doubles and longs go out as text: JSON numbers cannot carry NaN,
      // Infinity, or a long past 2^53 without quietly losing precision.
      return "{\"kind\":\"num\",\"type\":" + Json.str(type)
           + ",\"text\":" + Json.str(v.toString()) + "}";
    }

    if (v instanceof StringReference) {
      String s = ((StringReference) v).value();
      boolean cut = s.length() > MAX_STRING;
      return "{\"kind\":\"string\",\"text\":" + Json.str(cut ? s.substring(0, MAX_STRING) : s)
           + (cut ? ",\"truncated\":true" : "") + "}";
    }

    ObjectReference obj = (ObjectReference) v;
    if (seen.containsKey(obj)) {
      return "{\"kind\":\"cycle\",\"id\":" + obj.uniqueID() + "}";
    }
    if (depth > MAX_DEPTH) {
      return "{\"kind\":\"deep\",\"type\":" + Json.str(simple(obj.referenceType().name()))
           + ",\"id\":" + obj.uniqueID() + "}";
    }
    seen.put(obj, Boolean.TRUE);
    try {
      if (obj instanceof ArrayReference) return array((ArrayReference) obj, depth, seen);

      String type = obj.referenceType().name();
      if (type.equals("java.util.ArrayList") || type.equals("java.util.LinkedList")
          || type.equals("java.util.Arrays$ArrayList")) {
        String asList = list(obj, depth, seen);
        if (asList != null) return asList;
      }
      if (isBoxed(type)) {
        Value inner = fieldNamed(obj, "value");
        if (inner != null) {
          return "{\"kind\":\"boxed\",\"type\":" + Json.str(simple(type))
               + ",\"value\":" + value(inner, depth + 1, seen) + "}";
        }
      }
      return object(obj, depth, seen);
    } finally {
      seen.remove(obj);
    }
  }

  private String array(ArrayReference arr, int depth, IdentityHashMap<ObjectReference, Boolean> seen) {
    StringBuilder sb = new StringBuilder(128);
    int len = arr.length();
    int show = Math.min(len, MAX_ELEMENTS);
    sb.append("{\"kind\":\"array\",\"id\":").append(arr.uniqueID())
      .append(",\"type\":").append(Json.str(simple(arr.referenceType().name())))
      .append(",\"length\":").append(len)
      .append(",\"items\":[");
    List<Value> values = show == 0 ? Collections.emptyList() : arr.getValues(0, show);
    for (int i = 0; i < values.size(); i++) {
      if (i > 0) sb.append(',');
      sb.append(value(values.get(i), depth + 1, seen));
    }
    sb.append(']');
    if (len > show) sb.append(",\"more\":").append(len - show);
    return sb.append('}').toString();
  }

  /**
   * ArrayList and friends, shown as their logical contents.
   *
   * Reading the backing array directly rather than calling toString(): an
   * invokeMethod on a suspended thread runs real user code inside the traced
   * program, which can hit a breakpoint, mutate state, or deadlock. Reading a
   * field cannot.
   */
  private String list(ObjectReference obj, int depth, IdentityHashMap<ObjectReference, Boolean> seen) {
    Value data = fieldNamed(obj, "elementData");
    Value sizeV = fieldNamed(obj, "size");
    if (!(data instanceof ArrayReference) || !(sizeV instanceof IntegerValue)) return null;

    ArrayReference backing = (ArrayReference) data;
    int size = Math.min(((IntegerValue) sizeV).value(), backing.length());
    int show = Math.min(size, MAX_ELEMENTS);

    StringBuilder sb = new StringBuilder(128);
    sb.append("{\"kind\":\"list\",\"id\":").append(obj.uniqueID())
      .append(",\"type\":").append(Json.str(simple(obj.referenceType().name())))
      .append(",\"length\":").append(size)
      .append(",\"items\":[");
    List<Value> values = show == 0 ? Collections.emptyList() : backing.getValues(0, show);
    for (int i = 0; i < values.size(); i++) {
      if (i > 0) sb.append(',');
      sb.append(value(values.get(i), depth + 1, seen));
    }
    sb.append(']');
    if (size > show) sb.append(",\"more\":").append(size - show);
    return sb.append('}').toString();
  }

  private String object(ObjectReference obj, int depth, IdentityHashMap<ObjectReference, Boolean> seen) {
    StringBuilder sb = new StringBuilder(128);
    sb.append("{\"kind\":\"object\",\"id\":").append(obj.uniqueID())
      .append(",\"type\":").append(Json.str(simple(obj.referenceType().name())))
      .append(",\"fields\":[");
    int n = 0;
    try {
      ReferenceType rt = obj.referenceType();
      for (Field f : rt.fields()) {
        if (f.isStatic()) continue;
        if (n >= 32) break;
        if (n > 0) sb.append(',');
        sb.append("{\"name\":").append(Json.str(f.name()))
          .append(",\"value\":").append(value(obj.getValue(f), depth + 1, seen))
          .append('}');
        n++;
      }
    } catch (Throwable ignored) {
      /* a class that will not report its fields — the type name still shows */
    }
    return sb.append("]}").toString();
  }

  private static Value fieldNamed(ObjectReference obj, String name) {
    try {
      Field f = obj.referenceType().fieldByName(name);
      return f == null ? null : obj.getValue(f);
    } catch (Throwable t) {
      return null;
    }
  }

  private static boolean isBoxed(String type) {
    switch (type) {
      case "java.lang.Integer": case "java.lang.Long": case "java.lang.Double":
      case "java.lang.Float": case "java.lang.Short": case "java.lang.Byte":
      case "java.lang.Character": case "java.lang.Boolean":
        return true;
      default:
        return false;
    }
  }

  private static String simple(String name) {
    int i = name.lastIndexOf('.');
    return i == -1 ? name : name.substring(i + 1);
  }

  /* --------------------------------------------------------------- output */

  private void emit(PrintStream stdout) {
    StringBuilder sb = new StringBuilder(1024);
    sb.append("{\"ok\":true,\"stopReason\":").append(Json.str(stopReason));
    sb.append(",\"steps\":[");
    for (int i = 0; i < steps.size(); i++) {
      if (i > 0) sb.append(',');
      sb.append(steps.get(i));
    }
    sb.append("],\"stdout\":");
    synchronized (out) {
      sb.append(Json.str(out.toString()));
    }
    sb.append(",\"stderr\":");
    synchronized (err) {
      sb.append(Json.str(err.toString()));
    }
    sb.append('}');
    stdout.println(sb);
  }

  /** Just enough JSON to write it; nothing here parses any. */
  static final class Json {
    static String str(String s) {
      if (s == null) return "null";
      StringBuilder sb = new StringBuilder(s.length() + 16).append('"');
      for (int i = 0; i < s.length(); i++) {
        char c = s.charAt(i);
        switch (c) {
          case '"':  sb.append("\\\""); break;
          case '\\': sb.append("\\\\"); break;
          case '\n': sb.append("\\n"); break;
          case '\r': sb.append("\\r"); break;
          case '\t': sb.append("\\t"); break;
          case '\b': sb.append("\\b"); break;
          case '\f': sb.append("\\f"); break;
          default:
            // Control characters and lone surrogates must be escaped or the JSON
            // is invalid; a lone surrogate survives Java's char but not UTF-8.
            if (c < 0x20 || (c >= 0xD800 && c <= 0xDFFF)) {
              sb.append(String.format("\\u%04x", (int) c));
            } else {
              sb.append(c);
            }
        }
      }
      return sb.append('"').toString();
    }
  }
}
