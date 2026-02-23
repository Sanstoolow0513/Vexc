import type { editor as MonacoEditor } from "monaco-editor";

import { buildHints } from "../hints";
import { DEFAULT_THEME } from "../theme/themeConfig";
import { getLanguageDefinitions } from "./languageRegistry";

export const MONACO_THEME_NAME = DEFAULT_THEME.monacoThemeName;

const DEFAULT_MONACO_THEME: MonacoEditor.IStandaloneThemeData = DEFAULT_THEME.monacoThemeData;

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
