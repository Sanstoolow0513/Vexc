import type { ITheme as XtermTheme } from "@xterm/xterm";
import type { editor as MonacoEditor } from "monaco-editor";

export interface AppThemeConfig {
  cssVariables: Record<`--${string}`, string>;
  terminalTheme: XtermTheme;
  monacoThemeName: string;
  monacoThemeData: MonacoEditor.IStandaloneThemeData;
}

export const DEFAULT_THEME: AppThemeConfig = {
  cssVariables: {
    "--bg-deep": "#0f1011",
    "--bg-mid": "#111214",
    "--bg-cosmic": "#141519",
    "--surface-0": "#1e1e1e",
    "--surface-1": "#252526",
    "--surface-2": "#2d2d30",
    "--surface-hover": "#37373d",
    "--surface-active": "#3e3e45",
    "--line-soft": "#2f2f31",
    "--line": "#45484d",
    "--line-strong": "#5c6066",
    "--line-glow": "rgba(14, 99, 156, 0.45)",
    "--text": "#cccccc",
    "--text-secondary": "#aab2bc",
    "--muted": "#9da3ab",
    "--accent": "#0e639c",
    "--accent-hover": "#1177bb",
    "--accent-ink": "#f2f6fa",
    "--danger": "#f48771",
    "--danger-surface": "#5f2a22",
    "--focus-ring": "rgba(14, 99, 156, 0.18)",
    "--selection-bg": "rgba(14, 99, 156, 0.28)",
    "--accent-border": "#0f75ba",
    "--accent-border-hover": "#1286d4",
    "--secondary-hover": "#2c2c30",
    "--input-bg": "#1e1e1e",
    "--placeholder": "#7f8791",
    "--tab-strip-bg": "#252526",
    "--tab-close-text": "#8a919a",
    "--tab-close-hover-text": "#d0d4d8",
    "--brand-border": "#5f6f83",
    "--brand-bg": "rgba(14, 99, 156, 0.18)",
    "--window-close-hover-text": "#ffffff",
    "--window-control-hover-bg": "rgba(14, 99, 156, 0.18)",
    "--tree-hover-bg": "rgba(14, 99, 156, 0.16)",
    "--tree-hover-border": "rgba(14, 99, 156, 0.33)",
    "--tree-active-bg": "rgba(14, 99, 156, 0.25)",
    "--tab-active-bg": "rgba(14, 99, 156, 0.20)",
    "--tab-close-hover-bg": "rgba(244, 135, 113, 0.16)",
    "--terminal-toolbar-bg": "#252526",
    "--terminal-bg": "#1e1e1e",
    "--terminal-tab-active-bg": "rgba(14, 99, 156, 0.26)",
    "--terminal-tab-hover-border": "rgba(14, 99, 156, 0.38)",
    "--terminal-tab-hover-bg": "rgba(14, 99, 156, 0.12)",
    "--terminal-tab-stopped-dot": "#8a919a",
    "--terminal-tab-running-dot": "#35c98f",
    "--panel-gradient-top": "rgba(37, 37, 38, 0.97)",
    "--panel-gradient-bottom": "rgba(30, 30, 30, 0.97)",
    "--terminal-border-top": "rgba(138, 145, 154, 0.16)",
    "--tree-tone-code": "#4fc1ff",
    "--tree-tone-data": "#3fb8af",
    "--tree-tone-doc": "#d7ba7d",
    "--tree-tone-media": "#85d888",
    "--tree-tone-archive": "#d19a66",
    "--tree-tone-script": "#c586c0",
    "--tree-tone-secure": "#f48771",
    "--grid-color": "rgba(14, 99, 156, 0.03)",
  },
  terminalTheme: {
    background: "#0f141a",
    foreground: "#d6deea",
    cursor: "#5d98ff",
    selectionBackground: "rgba(93, 152, 255, 0.24)",
    black: "#0f141a",
    red: "#ef6b73",
    green: "#6fca8f",
    yellow: "#d8b569",
    blue: "#76a9fa",
    magenta: "#8ea6ff",
    cyan: "#56b6c2",
    white: "#d6deea",
    brightBlack: "#6b7785",
    brightRed: "#ff8a93",
    brightGreen: "#90e3ac",
    brightYellow: "#e9cd89",
    brightBlue: "#9ac1ff",
    brightMagenta: "#adc0ff",
    brightCyan: "#7fd4df",
    brightWhite: "#f4f8ff",
  },
  monacoThemeName: "vexc-workbench",
  monacoThemeData: {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "569CD6" },
      { token: "variable", foreground: "9CDCFE" },
      { token: "string", foreground: "CE9178" },
      { token: "function", foreground: "DCDCAA" },
      { token: "number", foreground: "B5CEA8" },
      { token: "comment", foreground: "6A9955", fontStyle: "italic" },
      { token: "type", foreground: "4EC9B0" },
    ],
    colors: {
      "editor.background": "#111720",
      "editor.foreground": "#D4D4D4",
      "editorCursor.foreground": "#0e639c",
      "editor.lineHighlightBackground": "#1a2230",
      "editor.selectionBackground": "#264f78",
      "editor.inactiveSelectionBackground": "#1f3f5f",
    },
  },
};

export function applyThemeCssVariables(cssVariables: AppThemeConfig["cssVariables"]): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(cssVariables)) {
    root.style.setProperty(key, value);
  }
}
