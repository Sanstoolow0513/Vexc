import type { editor as MonacoEditor } from "monaco-editor";

import { buildHints } from "../hints";
import { getLanguageDefinitions } from "./languageRegistry";

export const MONACO_THEME_NAME = "vexc-one-dark-pro-orange";

const DEFAULT_MONACO_THEME: MonacoEditor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "c678dd" },
    { token: "variable", foreground: "e06c75" },
    { token: "string", foreground: "98c379" },
    { token: "function", foreground: "61afef" },
    { token: "number", foreground: "d19a66" },
    { token: "comment", foreground: "5c6370", fontStyle: "italic" },
    { token: "type", foreground: "e5c07b" },
  ],
  colors: {
    "editor.background": "#0a0c10",
    "editor.foreground": "#abb2bf",
    "editorCursor.foreground": "#d19a66",
    "editor.lineHighlightBackground": "#13161c",
    "editor.selectionBackground": "#2c313a",
    "editor.inactiveSelectionBackground": "#1c1f26",
  },
};

interface MonacoSetupState {
  initialized: boolean;
  completionDisposables: Array<{ dispose: () => void }>;
}

const monacoSetupState: MonacoSetupState = {
  initialized: false,
  completionDisposables: [],
};

export function setupMonacoOnce(monacoApi: typeof import("monaco-editor")): void {
  if (monacoSetupState.initialized) {
    return;
  }

  monacoApi.editor.defineTheme(MONACO_THEME_NAME, DEFAULT_MONACO_THEME);

  for (const definition of getLanguageDefinitions()) {
    const disposable = monacoApi.languages.registerCompletionItemProvider(
      definition.monacoLanguageId,
      {
        triggerCharacters: ["."],
        provideCompletionItems: (model, position) => {
          const languageId = model.getLanguageId();
          const suggestions = buildHints(model.getValue(), languageId).map((hint, index) => {
            const range = new monacoApi.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            );

            return {
              label: hint.title,
              kind: monacoApi.languages.CompletionItemKind.Snippet,
              documentation: hint.message,
              insertText: hint.insertText,
              insertTextRules: monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range,
              sortText: `z_hint_${index}`,
              detail: "VEXC Hint",
            };
          });

          return { suggestions };
        },
      },
    );
    monacoSetupState.completionDisposables.push(disposable);
  }

  monacoSetupState.initialized = true;
}

export function mountMonacoEditor(
  editor: MonacoEditor.IStandaloneCodeEditor,
  monacoApi: typeof import("monaco-editor"),
  onSave: () => void,
): void {
  setupMonacoOnce(monacoApi);
  monacoApi.editor.setTheme(MONACO_THEME_NAME);

  editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => {
    onSave();
  });
}
