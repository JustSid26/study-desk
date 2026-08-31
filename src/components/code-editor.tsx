"use client";

/**
 * The code editor, shared by the Practice tab and the LeetCode solver.
 *
 * This replaces a hand-rolled textarea. The things a textarea cannot do without
 * reimplementing an editor — tokenising for syntax highlighting, closing a
 * bracket and stepping over the close when you type it yourself, re-indenting a
 * line as you type `}` or `else:` — are exactly what CodeMirror already does,
 * so the language modes come from it rather than from a regex here.
 *
 * Language modes are loaded on demand: the solver offers a dozen languages and
 * nobody needs Rust's grammar in the bundle to write Python.
 *
 * Accessibility: Tab inserts an indent, which would trap the keyboard. Escape
 * releases it — the next Tab moves focus instead — matching the textarea this
 * replaces, and the hint is shown under the editor.
 */

import * as React from "react";
import { EditorState, type Extension, Compartment, StateEffect, StateField } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  dropCursor,
  Decoration,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  HighlightStyle,
  foldKeymap,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";

/* ------------------------------ highlighting ------------------------------ */

/**
 * Two palettes, both validated to 4.5:1 against the editor surface in each theme.
 *
 * MONO is the default because the rest of the interface is monochrome: keywords
 * carry weight, comments go light and italic, and the four tone steps do the
 * separating. COLOUR exists because "highlighted" reasonably means hue to a lot
 * of people, and code is the one surface where hue genuinely aids scanning. Both
 * read from CSS variables so the light/dark swap happens in one place.
 */
const styleFor = (mode: "mono" | "colour") => {
  const v = (name: string) => `var(--code-${mode}-${name})`;
  return HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.definitionKeyword, t.operatorKeyword],
      color: v("kw"), fontWeight: "700" },
    { tag: [t.typeName, t.className, t.namespace, t.standard(t.typeName), t.self],
      color: v("type"), fontWeight: "600" },
    { tag: [t.function(t.variableName), t.function(t.definition(t.variableName)), t.macroName],
      color: v("fn"), fontWeight: "600" },
    { tag: [t.string, t.special(t.string), t.character, t.regexp],
      color: v("str") },
    { tag: [t.number, t.bool, t.null, t.integer, t.float, t.atom],
      color: v("num") },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
      color: v("com"), fontStyle: "italic" },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket, t.paren, t.brace, t.squareBracket],
      color: v("punct") },
    { tag: [t.propertyName, t.attributeName], color: v("prop") },
    { tag: [t.variableName, t.definition(t.variableName)], color: v("var") },
    { tag: [t.invalid], color: v("kw"), textDecoration: "underline wavy" },
  ]);
};

const MONO_STYLE = styleFor("mono");
const COLOUR_STYLE = styleFor("colour");

/* --------------------------------- theme ---------------------------------- */

/** Chrome only — every colour comes from the app's own tokens. */
const baseTheme = EditorView.theme({
  "&": {
    color: "var(--color-ink)",
    backgroundColor: "transparent",
    fontSize: "12.5px",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "21px",
    overflow: "auto",
  },
  ".cm-content": { padding: "12px 0", caretColor: "var(--color-ink)" },
  ".cm-gutters": {
    backgroundColor: "var(--color-surface-3)",
    color: "var(--color-ink-3)",
    borderRight: "1px solid var(--color-line-soft)",
    paddingRight: "2px",
    userSelect: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 12px", minWidth: "34px" },
  ".cm-activeLine": { backgroundColor: "var(--color-surface-2)" },
  // The traced line has to out-rank .cm-activeLine, which is also a line
  // decoration and would otherwise win by document order.
  ".cm-tracedLine, .cm-tracedLine.cm-activeLine": {
    backgroundColor: "var(--color-accent-soft)",
    boxShadow: "inset 2px 0 0 0 var(--color-accent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--color-surface-2)",
    color: "var(--color-ink-2)",
  },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--color-ink)", borderLeftWidth: "2px" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--color-code-select)" },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: "var(--color-code-select)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--color-code-bracket)",
    outline: "1px solid var(--color-line-strong)",
    color: "inherit",
  },
  ".cm-nonmatchingBracket": { outline: "1px solid var(--color-hard)" },
  ".cm-selectionMatch": { backgroundColor: "var(--color-code-bracket)" },
  ".cm-foldGutter .cm-gutterElement": { padding: "0 2px", cursor: "pointer" },
  ".cm-tooltip": {
    backgroundColor: "var(--color-surface)",
    border: "1px solid var(--color-line)",
    borderRadius: "8px",
    color: "var(--color-ink)",
  },
});

/* --------------------------- traced-line marker --------------------------- */

/**
 * The line the trace is currently sitting on. A StateField rather than a class
 * on the DOM node: CodeMirror recycles line elements as it scrolls, so anything
 * applied directly to an element is lost the moment it leaves the viewport.
 */
const setTracedLine = StateEffect.define<number | null>();

const tracedLineMark = Decoration.line({ class: "cm-tracedLine" });

const tracedLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setTracedLine)) continue;
      const line = e.value;
      if (line == null || line < 1 || line > tr.state.doc.lines) return Decoration.none;
      const from = tr.state.doc.line(line).from;
      return Decoration.set([tracedLineMark.range(from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ------------------------------- languages -------------------------------- */

/**
 * LeetCode's language slugs mapped onto grammars. Anything absent still edits
 * fine — it just has no tokenising, which is better than blocking the language.
 */
const LOADERS: Record<string, () => Promise<Extension>> = {
  java: async () => (await import("@codemirror/lang-java")).java(),
  python: async () => (await import("@codemirror/lang-python")).python(),
  python3: async () => (await import("@codemirror/lang-python")).python(),
  cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
  c: async () => (await import("@codemirror/lang-cpp")).cpp(),
  csharp: async () => (await import("@codemirror/lang-cpp")).cpp(),
  javascript: async () => (await import("@codemirror/lang-javascript")).javascript(),
  typescript: async () =>
    (await import("@codemirror/lang-javascript")).javascript({ typescript: true }),
  rust: async () => (await import("@codemirror/lang-rust")).rust(),
  golang: async () => (await import("@codemirror/lang-go")).go(),
  go: async () => (await import("@codemirror/lang-go")).go(),
};

export const hasGrammar = (lang: string) => lang in LOADERS;

/* -------------------------------- component ------------------------------- */

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** a LeetCode language slug, or "java" / "python" */
  language: string;
  /** "mono" (default) or "colour" */
  palette?: "mono" | "colour";
  onSave?: () => void;
  onRun?: () => void;
  className?: string;
  readOnly?: boolean;
  ariaLabel?: string;
  /** 1-based line to mark as the trace's current position, or null for none */
  tracedLine?: number | null;
}

export interface CodeEditorHandle {
  /** Put the caret on a 1-based line and scroll it into view. */
  goToLine: (line: number) => void;
  focus: () => void;
}

export const CodeEditor = React.forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(
    {
      value, onChange, language, palette = "mono", onSave, onRun,
      className, readOnly, ariaLabel, tracedLine = null,
    },
    ref,
  ) {
    const host = React.useRef<HTMLDivElement>(null);
    const view = React.useRef<EditorView | null>(null);

    // Compartments let language and palette be swapped without rebuilding the
    // state, which would otherwise drop the undo history and the caret.
    const langComp = React.useRef(new Compartment()).current;
    const paletteComp = React.useRef(new Compartment()).current;

    // Callbacks live in refs so the editor is created exactly once. Rebuilding
    // it on every render would fight the caret on each keystroke.
    const onChangeRef = React.useRef(onChange);
    const onSaveRef = React.useRef(onSave);
    const onRunRef = React.useRef(onRun);
    React.useEffect(() => {
      onChangeRef.current = onChange;
      onSaveRef.current = onSave;
      onRunRef.current = onRun;
    });

    // Tab indents, which traps the keyboard. Escape arms an exit so the very
    // next Tab moves focus instead.
    const escaped = React.useRef(false);

    React.useEffect(() => {
      if (!host.current || view.current) return;

      const escapeHatch = keymap.of([
        {
          key: "Escape",
          run: () => {
            escaped.current = true;
            return false; // let other Escape handlers (dialogs) still see it
          },
        },
        {
          key: "Tab",
          run: (v) => {
            if (escaped.current) {
              escaped.current = false;
              return false; // fall through to the browser: focus moves on
            }
            return indentMore(v);
          },
          shift: (v) => {
            if (escaped.current) {
              escaped.current = false;
              return false;
            }
            return indentLess(v);
          },
        },
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            onSaveRef.current?.();
            return true;
          },
        },
        {
          key: "Mod-Enter",
          preventDefault: true,
          run: () => {
            onRunRef.current?.();
            return true;
          },
        },
      ]);

      const state = EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          indentUnit.of("    "),
          bracketMatching(),
          closeBrackets(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          escapeHatch,
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap.filter((b) => b.key !== "Mod-Enter"),
            ...historyKeymap,
            ...foldKeymap,
            ...searchKeymap,
          ]),
          tracedLineField,
          langComp.of([]),
          paletteComp.of(syntaxHighlighting(palette === "colour" ? COLOUR_STYLE : MONO_STYLE)),
          baseTheme,
          EditorView.lineWrapping,
          EditorState.readOnly.of(Boolean(readOnly)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel ?? "Code editor",
            ...(readOnly ? {} : { spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
          }),
        ],
      });

      view.current = new EditorView({ state, parent: host.current });
      return () => {
        view.current?.destroy();
        view.current = null;
      };
      // Created once on purpose — see the refs above.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Swap the grammar when the language changes. `cancelled` guards the async
    // import resolving after the component has gone.
    React.useEffect(() => {
      let cancelled = false;
      const load = LOADERS[language];
      if (!load) {
        view.current?.dispatch({ effects: langComp.reconfigure([]) });
        return;
      }
      load()
        .then((ext) => {
          if (!cancelled) view.current?.dispatch({ effects: langComp.reconfigure(ext) });
        })
        .catch(() => {
          // A grammar that fails to load leaves plain text — still editable.
          if (!cancelled) view.current?.dispatch({ effects: langComp.reconfigure([]) });
        });
      return () => {
        cancelled = true;
      };
    }, [language, langComp]);

    React.useEffect(() => {
      const v = view.current;
      if (!v) return;
      v.dispatch({ effects: setTracedLine.of(tracedLine) });
      if (tracedLine != null && tracedLine >= 1 && tracedLine <= v.state.doc.lines) {
        v.dispatch({
          effects: EditorView.scrollIntoView(v.state.doc.line(tracedLine).from, { y: "center" }),
        });
      }
    }, [tracedLine]);

    React.useEffect(() => {
      view.current?.dispatch({
        effects: paletteComp.reconfigure(
          syntaxHighlighting(palette === "colour" ? COLOUR_STYLE : MONO_STYLE),
        ),
      });
    }, [palette, paletteComp]);

    // Adopt a value changed from outside (switching file, or language snippet).
    // Comparing first is what stops this fighting the user's own typing.
    React.useEffect(() => {
      const v = view.current;
      if (!v) return;
      const current = v.state.doc.toString();
      if (current === value) return;
      v.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor: Math.min(v.state.selection.main.anchor, value.length) },
      });
    }, [value]);

    React.useImperativeHandle(ref, () => ({
      goToLine(line: number) {
        const v = view.current;
        if (!v) return;
        const n = Math.max(1, Math.min(line, v.state.doc.lines));
        const pos = v.state.doc.line(n).from;
        v.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: "center" }),
          scrollIntoView: true,
        });
        v.focus();
      },
      focus() {
        view.current?.focus();
      },
    }));

    return <div ref={host} className={className} />;
  },
);
