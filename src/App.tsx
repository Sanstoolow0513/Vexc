import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Editor from "@monaco-editor/react";
import {
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileLock,
  FilePenLine,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  Folder,
  FolderArchive,
  FolderCog,
  FolderCode,
  FolderGit2,
  FolderLock,
  FolderOpen,
  FolderRoot,
  FolderSearch,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import type { editor as MonacoEditor } from "monaco-editor";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  getWorkspace,
  listDirectory,
  readFile,
  setWorkspace,
  terminalClear,
  terminalClose,
  terminalCreate,
  terminalList,
  terminalResize,
  terminalSnapshot,
  terminalWrite,
  writeFile,
} from "./api";
import type {
  EditorTab,
  FileNode,
  TerminalOutputEvent,
  TerminalSession,
  TerminalSessionSnapshot,
  WorkspaceInfo,
} from "./types";
import { detectLanguage, fileNameFromPath } from "./utils";
import "./App.css";

const WORKSPACE_STORAGE_KEY = "vexc.workspacePath";
const COLOR_THEME_STORAGE_KEY = "vexc.colorTheme";
const FILE_ICON_THEME_STORAGE_KEY = "vexc.fileIconTheme";

type ColorThemeId = "dark-plus" | "light-plus" | "one-dark-pro-orange";
type FileIconThemeId = "vscode-colored" | "vscode-minimal";

interface ColorThemeOption {
  id: ColorThemeId;
  label: string;
  monacoThemeName: string;
  monacoThemeData: MonacoEditor.IStandaloneThemeData;
  terminalTheme: ITheme;
}

interface FileIconThemeOption {
  id: FileIconThemeId;
  label: string;
}

const DEFAULT_COLOR_THEME_ID: ColorThemeId = "dark-plus";
const DEFAULT_FILE_ICON_THEME_ID: FileIconThemeId = "vscode-colored";

const colorThemeOptions: readonly ColorThemeOption[] = [
  {
    id: "dark-plus",
    label: "Dark+ (VS Code)",
    monacoThemeName: "vexc-dark-plus",
    monacoThemeData: {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "569cd6" },
        { token: "variable", foreground: "9cdcfe" },
        { token: "string", foreground: "ce9178" },
        { token: "function", foreground: "dcdcaa" },
        { token: "number", foreground: "b5cea8" },
        { token: "comment", foreground: "6a9955", fontStyle: "italic" },
        { token: "type", foreground: "4ec9b0" },
      ],
      colors: {
        "editor.background": "#1e1e1e",
        "editor.foreground": "#d4d4d4",
        "editorCursor.foreground": "#aeafad",
        "editor.lineHighlightBackground": "#2a2d2e",
        "editor.selectionBackground": "#264f78",
        "editor.inactiveSelectionBackground": "#3a3d41",
      },
    },
    terminalTheme: {
      background: "#1e1e1e",
      foreground: "#d4d4d4",
      cursor: "#aeafad",
      selectionBackground: "rgba(38, 79, 120, 0.35)",
      black: "#000000",
      red: "#cd3131",
      green: "#0dbc79",
      yellow: "#e5e510",
      blue: "#2472c8",
      magenta: "#bc3fbc",
      cyan: "#11a8cd",
      white: "#e5e5e5",
      brightBlack: "#666666",
      brightRed: "#f14c4c",
      brightGreen: "#23d18b",
      brightYellow: "#f5f543",
      brightBlue: "#3b8eea",
      brightMagenta: "#d670d6",
      brightCyan: "#29b8db",
      brightWhite: "#e5e5e5",
    },
  },
  {
    id: "light-plus",
    label: "Light+ (VS Code)",
    monacoThemeName: "vexc-light-plus",
    monacoThemeData: {
      base: "vs",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "0000ff" },
        { token: "variable", foreground: "001080" },
        { token: "string", foreground: "a31515" },
        { token: "function", foreground: "795e26" },
        { token: "number", foreground: "098658" },
        { token: "comment", foreground: "008000", fontStyle: "italic" },
        { token: "type", foreground: "267f99" },
      ],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#333333",
        "editorCursor.foreground": "#111111",
        "editor.lineHighlightBackground": "#f5f5f5",
        "editor.selectionBackground": "#add6ff",
        "editor.inactiveSelectionBackground": "#e5ebf1",
      },
    },
    terminalTheme: {
      background: "#ffffff",
      foreground: "#222222",
      cursor: "#1f2328",
      selectionBackground: "rgba(10, 103, 206, 0.25)",
      black: "#000000",
      red: "#a1260d",
      green: "#007100",
      yellow: "#795e26",
      blue: "#0451a5",
      magenta: "#bc05bc",
      cyan: "#0598bc",
      white: "#a5a5a5",
      brightBlack: "#666666",
      brightRed: "#cd3131",
      brightGreen: "#14ce14",
      brightYellow: "#b5ba00",
      brightBlue: "#0451a5",
      brightMagenta: "#bc05bc",
      brightCyan: "#0598bc",
      brightWhite: "#a5a5a5",
    },
  },
  {
    id: "one-dark-pro-orange",
    label: "One Dark Pro Orange",
    monacoThemeName: "vexc-one-dark-pro-orange",
    monacoThemeData: {
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
    },
    terminalTheme: {
      background: "#000000",
      foreground: "#abb2bf",
      cursor: "#d19a66",
      selectionBackground: "rgba(209, 154, 102, 0.2)",
      black: "#000000",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#4b5263",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#abb2bf",
    },
  },
];

const colorThemeConfigById: Record<ColorThemeId, ColorThemeOption> = {
  "dark-plus": colorThemeOptions[0],
  "light-plus": colorThemeOptions[1],
  "one-dark-pro-orange": colorThemeOptions[2],
};

function isColorThemeId(value: string): value is ColorThemeId {
  return Object.prototype.hasOwnProperty.call(colorThemeConfigById, value);
}

function resolveColorThemeById(themeId: string | null): ColorThemeOption {
  if (themeId && isColorThemeId(themeId)) {
    return colorThemeConfigById[themeId];
  }
  return colorThemeConfigById[DEFAULT_COLOR_THEME_ID];
}

const fileIconThemeOptions: readonly FileIconThemeOption[] = [
  {
    id: "vscode-colored",
    label: "VSCode Colored",
  },
  {
    id: "vscode-minimal",
    label: "VSCode Minimal",
  },
];

function readStoredColorThemeId(): ColorThemeId {
  const stored = localStorage.getItem(COLOR_THEME_STORAGE_KEY);
  return resolveColorThemeById(stored).id;
}

function readStoredFileIconThemeId(): FileIconThemeId {
  const stored = localStorage.getItem(FILE_ICON_THEME_STORAGE_KEY);
  if (stored === "vscode-colored" || stored === "vscode-minimal") {
    return stored;
  }
  return DEFAULT_FILE_ICON_THEME_ID;
}

interface PendingPosition {
  tabId: string;
  line: number;
  column: number;
}

type TreeIconTone =
  | "default"
  | "code"
  | "data"
  | "doc"
  | "media"
  | "archive"
  | "script"
  | "secure";

interface TreeNodeVisual {
  icon: ReactElement;
  tone: TreeIconTone;
}

const codeFileExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".cs",
  ".php",
  ".rb",
]);

const scriptFileExtensions = new Set([".sh", ".bash", ".zsh", ".ps1", ".cmd", ".bat"]);

const configFileExtensions = new Set([
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".xml",
  ".lock",
]);

const docFileExtensions = new Set([".md", ".mdx", ".txt", ".log", ".rst"]);
const sheetFileExtensions = new Set([".csv", ".tsv", ".xlsx", ".xls"]);
const mediaFileExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".bmp",
]);
const archiveFileExtensions = new Set([
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".tgz",
  ".xz",
]);

const codeDirectoryNames = new Set([
  "src",
  "app",
  "apps",
  "lib",
  "components",
  "pages",
  "routes",
  "hooks",
]);
const configDirectoryNames = new Set(["config", "configs", ".config", ".vscode", ".idea"]);
const buildDirectoryNames = new Set(["dist", "build", "target", "out", "node_modules", ".next"]);
const secureDirectoryNames = new Set([".ssh", "secrets", "secret", "private", "certs"]);
const inspectionDirectoryNames = new Set(["test", "tests", "spec", "specs", "__tests__"]);

function extensionFromName(name: string): string {
  const normalizedName = name.toLowerCase();
  const extensionIndex = normalizedName.lastIndexOf(".");
  if (extensionIndex < 0) {
    return "";
  }
  return normalizedName.slice(extensionIndex);
}

type DirectoryVisualKind = "root" | "git" | "code" | "config" | "build" | "secure" | "inspection" | "default";
type FileVisualKind =
  | "secure"
  | "docker"
  | "script"
  | "code"
  | "sheet"
  | "media"
  | "archive"
  | "config"
  | "doc-markdown"
  | "doc"
  | "schema"
  | "default";

interface DirectoryVisualDescriptor {
  kind: DirectoryVisualKind;
  tone: TreeIconTone;
}

interface FileVisualDescriptor {
  kind: FileVisualKind;
  tone: TreeIconTone;
}

function describeDirectoryVisual(name: string, isRoot = false): DirectoryVisualDescriptor {
  if (isRoot) {
    return {
      kind: "root",
      tone: "code",
    };
  }

  const normalizedName = name.toLowerCase();

  if (normalizedName === ".git") {
    return {
      kind: "git",
      tone: "data",
    };
  }

  if (codeDirectoryNames.has(normalizedName)) {
    return {
      kind: "code",
      tone: "code",
    };
  }

  if (configDirectoryNames.has(normalizedName)) {
    return {
      kind: "config",
      tone: "data",
    };
  }

  if (buildDirectoryNames.has(normalizedName)) {
    return {
      kind: "build",
      tone: "archive",
    };
  }

  if (secureDirectoryNames.has(normalizedName)) {
    return {
      kind: "secure",
      tone: "secure",
    };
  }

  if (inspectionDirectoryNames.has(normalizedName)) {
    return {
      kind: "inspection",
      tone: "doc",
    };
  }

  return {
    kind: "default",
    tone: "default",
  };
}

function describeFileVisual(name: string): FileVisualDescriptor {
  const normalizedName = name.toLowerCase();
  const extension = extensionFromName(name);

  if (normalizedName.startsWith(".env")) {
    return {
      kind: "secure",
      tone: "secure",
    };
  }

  if (normalizedName === "dockerfile") {
    return {
      kind: "docker",
      tone: "script",
    };
  }

  if (scriptFileExtensions.has(extension)) {
    return {
      kind: "script",
      tone: "script",
    };
  }

  if (codeFileExtensions.has(extension)) {
    return {
      kind: "code",
      tone: "code",
    };
  }

  if (sheetFileExtensions.has(extension)) {
    return {
      kind: "sheet",
      tone: "data",
    };
  }

  if (mediaFileExtensions.has(extension)) {
    return {
      kind: "media",
      tone: "media",
    };
  }

  if (archiveFileExtensions.has(extension)) {
    return {
      kind: "archive",
      tone: "archive",
    };
  }

  if (configFileExtensions.has(extension)) {
    return {
      kind: "config",
      tone: "data",
    };
  }

  if (docFileExtensions.has(extension)) {
    return {
      kind: extension === ".md" || extension === ".mdx" ? "doc-markdown" : "doc",
      tone: "doc",
    };
  }

  if (normalizedName.includes("license") || normalizedName.includes("changelog")) {
    return {
      kind: "doc",
      tone: "doc",
    };
  }

  if (normalizedName.includes("readme")) {
    return {
      kind: "doc-markdown",
      tone: "doc",
    };
  }

  if (extension === ".sql") {
    return {
      kind: "sheet",
      tone: "data",
    };
  }

  if (extension === ".proto" || extension === ".graphql") {
    return {
      kind: "schema",
      tone: "data",
    };
  }

  return {
    kind: "default",
    tone: "default",
  };
}

function toneForMinimalIcons(tone: TreeIconTone): TreeIconTone {
  if (tone === "secure" || tone === "media") {
    return tone;
  }
  return "default";
}

function resolveDirectoryVisual(
  name: string,
  expanded: boolean,
  iconThemeId: FileIconThemeId,
  isRoot = false,
): TreeNodeVisual {
  const descriptor = describeDirectoryVisual(name, isRoot);

  if (iconThemeId === "vscode-minimal") {
    switch (descriptor.kind) {
      case "root":
        return {
          icon: <FolderRoot size={14} />,
          tone: "default",
        };
      case "git":
        return {
          icon: <FolderGit2 size={14} />,
          tone: "default",
        };
      case "secure":
        return {
          icon: <FolderLock size={14} />,
          tone: "secure",
        };
      default:
        return {
          icon: expanded ? <FolderOpen size={14} /> : <Folder size={14} />,
          tone: toneForMinimalIcons(descriptor.tone),
        };
    }
  }

  switch (descriptor.kind) {
    case "root":
      return {
        icon: <FolderRoot size={14} />,
        tone: descriptor.tone,
      };
    case "git":
      return {
        icon: <FolderGit2 size={14} />,
        tone: descriptor.tone,
      };
    case "code":
      return {
        icon: <FolderCode size={14} />,
        tone: descriptor.tone,
      };
    case "config":
      return {
        icon: <FolderCog size={14} />,
        tone: descriptor.tone,
      };
    case "build":
      return {
        icon: <FolderArchive size={14} />,
        tone: descriptor.tone,
      };
    case "secure":
      return {
        icon: <FolderLock size={14} />,
        tone: descriptor.tone,
      };
    case "inspection":
      return {
        icon: <FolderSearch size={14} />,
        tone: descriptor.tone,
      };
    default:
      return {
        icon: expanded ? <FolderOpen size={14} /> : <Folder size={14} />,
        tone: descriptor.tone,
      };
  }
}

function resolveFileVisual(name: string, iconThemeId: FileIconThemeId): TreeNodeVisual {
  const descriptor = describeFileVisual(name);

  if (iconThemeId === "vscode-minimal") {
    switch (descriptor.kind) {
      case "secure":
        return {
          icon: <FileLock size={14} />,
          tone: "secure",
        };
      case "media":
        return {
          icon: <FileImage size={14} />,
          tone: "media",
        };
      case "archive":
        return {
          icon: <FileArchive size={14} />,
          tone: "default",
        };
      case "doc-markdown":
        return {
          icon: <FilePenLine size={14} />,
          tone: "default",
        };
      case "script":
      case "docker":
        return {
          icon: <FileTerminal size={14} />,
          tone: "default",
        };
      default:
        return {
          icon: <FileText size={14} />,
          tone: toneForMinimalIcons(descriptor.tone),
        };
    }
  }

  switch (descriptor.kind) {
    case "secure":
      return {
        icon: <FileLock size={14} />,
        tone: descriptor.tone,
      };
    case "docker":
    case "script":
      return {
        icon: <FileTerminal size={14} />,
        tone: descriptor.tone,
      };
    case "code":
      return {
        icon: <FileCode size={14} />,
        tone: descriptor.tone,
      };
    case "sheet":
      return {
        icon: <FileSpreadsheet size={14} />,
        tone: descriptor.tone,
      };
    case "media":
      return {
        icon: <FileImage size={14} />,
        tone: descriptor.tone,
      };
    case "archive":
      return {
        icon: <FileArchive size={14} />,
        tone: descriptor.tone,
      };
    case "config":
      return {
        icon: <FileCog size={14} />,
        tone: descriptor.tone,
      };
    case "doc-markdown":
      return {
        icon: <FilePenLine size={14} />,
        tone: descriptor.tone,
      };
    case "doc":
      return {
        icon: <FileText size={14} />,
        tone: descriptor.tone,
      };
    case "schema":
      return {
        icon: <FileType size={14} />,
        tone: descriptor.tone,
      };
    default:
      return {
        icon: <File size={14} />,
        tone: descriptor.tone,
      };
  }
}

function App() {
  const [workspace, setWorkspaceState] = useState<WorkspaceInfo | null>(null);

  const [treeByPath, setTreeByPath] = useState<Record<string, FileNode[]>>({});
  const [expandedByPath, setExpandedByPath] = useState<Record<string, boolean>>({});
  const [loadingByPath, setLoadingByPath] = useState<Record<string, boolean>>({});
  const [openingFilesByPath, setOpeningFilesByPath] = useState<Record<string, boolean>>({});

  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tabsRef = useRef<EditorTab[]>([]);
  const openFileRequestsRef = useRef<Record<string, Promise<string | null>>>({});

  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const activeTerminalIdRef = useRef<string | null>(null);
  const [terminalBuffers, setTerminalBuffers] = useState<Record<string, string>>({});
  const terminalBuffersRef = useRef<Record<string, string>>({});
  const terminalWriteQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const terminalResizeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const terminalSizeKeyBySessionRef = useRef<Record<string, string>>({});
  const syncTerminalSizeRef = useRef<(force?: boolean) => void>(() => {});

  const [pendingPosition, setPendingPosition] = useState<PendingPosition | null>(null);
  const [editorReadySeq, setEditorReadySeq] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isExplorerVisible, setIsExplorerVisible] = useState(true);
  const [isTerminalVisible, setIsTerminalVisible] = useState(true);
  const [activeColorThemeId, setActiveColorThemeId] = useState<ColorThemeId>(() => readStoredColorThemeId());
  const [activeFileIconThemeId, setActiveFileIconThemeId] = useState<FileIconThemeId>(() =>
    readStoredFileIconThemeId(),
  );

  const appWindow = useMemo(() => getCurrentWindow(), []);
  const activeColorTheme = useMemo(
    () => colorThemeConfigById[activeColorThemeId],
    [activeColorThemeId],
  );

  const monacoEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoApiRef = useRef<typeof import("monaco-editor") | null>(null);
  const monacoThemesRegisteredRef = useRef(false);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTerminalIdRef.current = activeTerminalId;
  }, [activeTerminalId]);

  useEffect(() => {
    terminalBuffersRef.current = terminalBuffers;
  }, [terminalBuffers]);

  useEffect(() => {
    document.documentElement.setAttribute("data-color-theme", activeColorThemeId);
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, activeColorThemeId);
  }, [activeColorThemeId]);

  useEffect(() => {
    const selectedTheme = resolveColorThemeById(activeColorThemeId);

    const monacoApi = monacoApiRef.current;
    if (monacoApi) {
      try {
        monacoApi.editor.setTheme(selectedTheme.monacoThemeName);
      } catch (error) {
        setStatusMessage(`Failed to apply editor theme: ${String(error)}`);
      }
    }
  }, [activeColorThemeId]);

  useEffect(() => {
    const selectedTheme = resolveColorThemeById(activeColorThemeId);
    const terminal = terminalRef.current;
    if (terminal) {
      try {
        terminal.options.theme = selectedTheme.terminalTheme;
      } catch (error) {
        setStatusMessage(`Failed to apply terminal theme: ${String(error)}`);
      }
    }
  }, [activeColorThemeId]);

  useEffect(() => {
    localStorage.setItem(FILE_ICON_THEME_STORAGE_KEY, activeFileIconThemeId);
  }, [activeFileIconThemeId]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  const activeTerminal = useMemo(
    () => terminals.find((session) => session.id === activeTerminalId) ?? null,
    [terminals, activeTerminalId],
  );

  const hasDirtyTabs = useMemo(
    () => tabs.some((tab) => tab.content !== tab.savedContent),
    [tabs],
  );

  function tabIsDirty(tab: EditorTab): boolean {
    return tab.content !== tab.savedContent;
  }

  function setDirectoryLoading(path: string, loading: boolean): void {
    setLoadingByPath((previous) => ({
      ...previous,
      [path]: loading,
    }));
  }

  function setFileOpening(path: string, opening: boolean): void {
    setOpeningFilesByPath((previous) => {
      if (opening) {
        return {
          ...previous,
          [path]: true,
        };
      }

      if (!previous[path]) {
        return previous;
      }

      const next = { ...previous };
      delete next[path];
      return next;
    });
  }

  async function loadDirectory(path: string): Promise<void> {
    setDirectoryLoading(path, true);
    try {
      const nodes = await listDirectory(path, false);
      setTreeByPath((previous) => ({
        ...previous,
        [path]: nodes,
      }));
    } catch (error) {
      setStatusMessage(`Failed to list directory: ${String(error)}`);
    } finally {
      setDirectoryLoading(path, false);
    }
  }

  const redrawTerminal = useCallback((sessionId: string | null): void => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.reset();
    terminal.clear();

    if (!sessionId) {
      terminal.writeln("No active terminal session.");
      return;
    }

    const buffer = terminalBuffersRef.current[sessionId] ?? "";
    if (buffer) {
      terminal.write(buffer);
    }

    fitAddonRef.current?.fit();
  }, []);

  function mergeTerminalSnapshot(snapshot: TerminalSessionSnapshot): void {
    terminalSizeKeyBySessionRef.current[snapshot.session.id] = `${snapshot.session.cols}x${snapshot.session.rows}`;

    setTerminals((previous) => {
      const next = [...previous];
      const existingIndex = next.findIndex((item) => item.id === snapshot.session.id);
      if (existingIndex >= 0) {
        next[existingIndex] = snapshot.session;
      } else {
        next.push(snapshot.session);
      }
      next.sort((left, right) => left.id.localeCompare(right.id));
      return next;
    });

    setTerminalBuffers((previous) => {
      const next = {
        ...previous,
        [snapshot.session.id]: snapshot.buffer,
      };
      terminalBuffersRef.current = next;
      return next;
    });
  }

  async function createTerminalSession(): Promise<void> {
    try {
      const snapshot = await terminalCreate();
      mergeTerminalSnapshot(snapshot);
      activeTerminalIdRef.current = snapshot.session.id;
      setActiveTerminalId(snapshot.session.id);
      redrawTerminal(snapshot.session.id);
      window.requestAnimationFrame(() => {
        syncTerminalSizeRef.current(true);
        terminalRef.current?.focus();
      });
      setStatusMessage(`Created ${snapshot.session.title}`);
    } catch (error) {
      setStatusMessage(`Failed to create terminal: ${String(error)}`);
    }
  }

  async function refreshTerminalSessions(): Promise<void> {
    try {
      const sessions = await terminalList();
      if (sessions.length === 0) {
        await createTerminalSession();
        return;
      }

      setTerminals(sessions);
      terminalSizeKeyBySessionRef.current = sessions.reduce<Record<string, string>>((accumulator, session) => {
        accumulator[session.id] = `${session.cols}x${session.rows}`;
        return accumulator;
      }, {});

      const buffers: Record<string, string> = {};
      for (const session of sessions) {
        const snapshot = await terminalSnapshot(session.id);
        buffers[session.id] = snapshot.buffer;
      }

      setTerminalBuffers(() => {
        terminalBuffersRef.current = buffers;
        return buffers;
      });

      const current = activeTerminalIdRef.current;
      const nextActive = current && sessions.some((session) => session.id === current)
        ? current
        : sessions[0].id;

      activeTerminalIdRef.current = nextActive;
      setActiveTerminalId(nextActive);
      redrawTerminal(nextActive);
      window.requestAnimationFrame(() => {
        syncTerminalSizeRef.current(true);
      });
    } catch (error) {
      setStatusMessage(`Failed to load terminals: ${String(error)}`);
    }
  }

  async function openWorkspaceByPath(path: string, skipDirtyConfirm = false): Promise<void> {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      setStatusMessage("Please provide a workspace path.");
      return;
    }

    if (!skipDirtyConfirm && hasDirtyTabs) {
      const confirmed = window.confirm("You have unsaved tabs. Continue and switch workspace?");
      if (!confirmed) {
        return;
      }
    }

    try {
      const info = await setWorkspace(normalizedPath);
      setWorkspaceState(info);
      localStorage.setItem(WORKSPACE_STORAGE_KEY, info.rootPath);

      setTabs([]);
      setActiveTabId(null);
      openFileRequestsRef.current = {};
      setOpeningFilesByPath({});

      setTreeByPath({});
      setExpandedByPath({ [info.rootPath]: true });
      await loadDirectory(info.rootPath);

      const existingSessions = await terminalList();
      for (const session of existingSessions) {
        await terminalClose(session.id);
      }

      setTerminals([]);
      setTerminalBuffers({});
      terminalBuffersRef.current = {};
      terminalSizeKeyBySessionRef.current = {};
      terminalResizeQueueRef.current = Promise.resolve();
      setActiveTerminalId(null);
      activeTerminalIdRef.current = null;
      redrawTerminal(null);
      await refreshTerminalSessions();

      setStatusMessage(`Workspace ready: ${info.rootName}`);
    } catch (error) {
      setStatusMessage(`Failed to open workspace: ${String(error)}`);
    }
  }

  async function openFile(path: string, caret?: { line: number; column: number }): Promise<string | null> {
    const existing = tabsRef.current.find((tab) => tab.path === path);
    if (existing) {
      setActiveTabId(existing.id);
      if (caret) {
        setPendingPosition({ tabId: existing.id, line: caret.line, column: caret.column });
      }
      return existing.id;
    }

    const inFlightRequest = openFileRequestsRef.current[path];
    if (inFlightRequest) {
      const tabId = await inFlightRequest;
      if (tabId && caret) {
        setPendingPosition({ tabId, line: caret.line, column: caret.column });
      }
      return tabId;
    }

    const request = (async (): Promise<string | null> => {
      setFileOpening(path, true);
      setStatusMessage(`Opening ${fileNameFromPath(path)}...`);

      try {
        const file = await readFile(path);
        const tab: EditorTab = {
          id: file.path,
          path: file.path,
          title: fileNameFromPath(file.path),
          content: file.content,
          savedContent: file.content,
          language: detectLanguage(file.path),
        };

        setTabs((previous) => [...previous, tab]);
        setActiveTabId(tab.id);
        setStatusMessage(`Opened ${tab.title}`);

        if (caret) {
          setPendingPosition({ tabId: tab.id, line: caret.line, column: caret.column });
        }

        return tab.id;
      } catch (error) {
        setStatusMessage(`Failed to open file: ${String(error)}`);
        return null;
      } finally {
        setFileOpening(path, false);
      }
    })();

    openFileRequestsRef.current[path] = request;
    try {
      return await request;
    } finally {
      delete openFileRequestsRef.current[path];
    }
  }

  async function saveTab(tabId?: string): Promise<void> {
    const targetId = tabId ?? activeTabId;
    if (!targetId) {
      setStatusMessage("No active file to save.");
      return;
    }

    const tab = tabsRef.current.find((item) => item.id === targetId);
    if (!tab) {
      setStatusMessage("Tab not found.");
      return;
    }

    try {
      await writeFile(tab.path, tab.content);
      setTabs((previous) =>
        previous.map((item) =>
          item.id === targetId
            ? {
                ...item,
                savedContent: item.content,
              }
            : item,
        ),
      );
      setStatusMessage(`Saved ${tab.title}`);
    } catch (error) {
      setStatusMessage(`Save failed: ${String(error)}`);
    }
  }

  function closeTab(tabId: string): void {
    const target = tabsRef.current.find((tab) => tab.id === tabId);
    if (!target) {
      return;
    }

    if (tabIsDirty(target)) {
      const confirmed = window.confirm(`Discard unsaved changes in ${target.title}?`);
      if (!confirmed) {
        return;
      }
    }

    const existingTabs = tabsRef.current;
    const removeIndex = existingTabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = existingTabs.filter((tab) => tab.id !== tabId);

    setTabs(nextTabs);

    if (activeTabId === tabId) {
      if (nextTabs.length === 0) {
        setActiveTabId(null);
      } else {
        const fallbackIndex = Math.max(0, removeIndex - 1);
        setActiveTabId(nextTabs[fallbackIndex].id);
      }
    }
  }

  function updateActiveTabContent(value: string): void {
    if (!activeTabId) {
      return;
    }

    setTabs((previous) =>
      previous.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              content: value,
            }
          : tab,
      ),
    );
  }

  async function selectTerminal(sessionId: string): Promise<void> {
    activeTerminalIdRef.current = sessionId;
    setActiveTerminalId(sessionId);
    try {
      const snapshot = await terminalSnapshot(sessionId);
      mergeTerminalSnapshot(snapshot);
      redrawTerminal(sessionId);
      window.requestAnimationFrame(() => {
        syncTerminalSizeRef.current(true);
        terminalRef.current?.focus();
      });
    } catch (error) {
      setStatusMessage(`Failed to refresh terminal session: ${String(error)}`);
    }
  }

  async function clearActiveTerminalOutput(): Promise<void> {
    const sessionId = activeTerminalIdRef.current;
    if (!sessionId) {
      return;
    }

    try {
      const snapshot = await terminalClear(sessionId);
      mergeTerminalSnapshot(snapshot);
      redrawTerminal(sessionId);
      setStatusMessage("Terminal output cleared.");
    } catch (error) {
      setStatusMessage(`Failed to clear terminal output: ${String(error)}`);
    }
  }

  function interruptActiveTerminal(): void {
    queueTerminalInput("\u0003");
    setStatusMessage("Sent Ctrl+C to terminal.");
  }

  async function closeActiveTerminal(): Promise<void> {
    const closeId = activeTerminalIdRef.current;
    if (!closeId) {
      return;
    }

    try {
      await terminalClose(closeId);
      delete terminalSizeKeyBySessionRef.current[closeId];
      await refreshTerminalSessions();
      setStatusMessage("Terminal closed.");
    } catch (error) {
      setStatusMessage(`Failed to close terminal: ${String(error)}`);
    }
  }

  function queueTerminalInput(data: string): void {
    const sessionId = activeTerminalIdRef.current;
    if (!sessionId || data.length === 0) {
      return;
    }

    terminalWriteQueueRef.current = terminalWriteQueueRef.current
      .then(() => terminalWrite(sessionId, data))
      .catch((error) => {
        setStatusMessage(`Terminal write failed: ${String(error)}`);
      });
  }

  async function restoreWorkspaceAndState(): Promise<void> {
    const savedWorkspace = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (savedWorkspace) {
      await openWorkspaceByPath(savedWorkspace, true);
      return;
    }

    try {
      const existingWorkspace = await getWorkspace();
      if (existingWorkspace) {
        await openWorkspaceByPath(existingWorkspace.rootPath, true);
      } else {
        await refreshTerminalSessions();
      }
    } catch (error) {
      setStatusMessage(`Bootstrap failed: ${String(error)}`);
      await refreshTerminalSessions();
    }
  }

  function handleEditorMount(
    editor: MonacoEditor.IStandaloneCodeEditor,
    monacoApi: typeof import("monaco-editor"),
  ): void {
    monacoEditorRef.current = editor;
    monacoApiRef.current = monacoApi;
    setEditorReadySeq((value) => value + 1);

    if (!monacoThemesRegisteredRef.current) {
      for (const theme of colorThemeOptions) {
        monacoApi.editor.defineTheme(theme.monacoThemeName, theme.monacoThemeData);
      }
      monacoThemesRegisteredRef.current = true;
    }

    try {
      monacoApi.editor.setTheme(activeColorTheme.monacoThemeName);
    } catch (error) {
      setStatusMessage(`Failed to apply editor theme: ${String(error)}`);
    }

    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => {
      void saveTab();
    });
  }

  async function promptWorkspacePath(): Promise<void> {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择工作区目录",
      });

      if (selected && typeof selected === "string") {
        await openWorkspaceByPath(selected);
      }
    } catch (error) {
      setStatusMessage(`Failed to open directory dialog: ${String(error)}`);
    }
  }

  async function refreshWindowMaximizedState(): Promise<void> {
    try {
      const maximized = await appWindow.isMaximized();
      setIsWindowMaximized(maximized);
    } catch {
      setIsWindowMaximized(false);
    }
  }

  async function handleWindowMinimize(): Promise<void> {
    try {
      await appWindow.minimize();
    } catch (error) {
      setStatusMessage(`Failed to minimize window: ${String(error)}`);
    }
  }

  async function handleWindowToggleMaximize(): Promise<void> {
    try {
      await appWindow.toggleMaximize();
      await refreshWindowMaximizedState();
    } catch (error) {
      setStatusMessage(`Failed to toggle maximize: ${String(error)}`);
    }
  }

  async function handleWindowClose(): Promise<void> {
    if (hasDirtyTabs) {
      const confirmed = window.confirm("You have unsaved tabs. Close the window anyway?");
      if (!confirmed) {
        return;
      }
    }

    try {
      await appWindow.close();
    } catch (error) {
      setStatusMessage(`Failed to close window: ${String(error)}`);
    }
  }

  function renderTree(nodes: FileNode[], depth: number): ReactElement[] {
    return nodes.map((node) => {
      const isDirectory = node.kind === "directory";
      const expanded = Boolean(expandedByPath[node.path]);
      const loading = Boolean(loadingByPath[node.path]);
      const openingFile = !isDirectory && Boolean(openingFilesByPath[node.path]);
      const visual = isDirectory
        ? resolveDirectoryVisual(node.name, expanded, activeFileIconThemeId)
        : resolveFileVisual(node.name, activeFileIconThemeId);

      return (
        <div key={node.path}>
          <button
            type="button"
            className={`tree-item ${activeTab?.path === node.path ? "active" : ""}`}
            style={{ paddingLeft: `${6 + depth * 11}px` }}
            disabled={loading || openingFile}
            onClick={() => {
              if (isDirectory) {
                const nextExpanded = !expanded;
                setExpandedByPath((previous) => ({
                  ...previous,
                  [node.path]: nextExpanded,
                }));

                if (nextExpanded && !treeByPath[node.path]) {
                  void loadDirectory(node.path);
                }
                return;
              }

              void openFile(node.path);
            }}
          >
            <span className={`tree-marker tone-${visual.tone}`}>{visual.icon}</span>
            <span className="tree-label">{node.name}</span>
            {isDirectory && loading ? <span className="tree-loading">loading...</span> : null}
            {openingFile ? <span className="tree-loading">opening...</span> : null}
          </button>

          {isDirectory && expanded && treeByPath[node.path]
            ? renderTree(treeByPath[node.path], depth + 1)
            : null}
        </div>
      );
    });
  }

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) {
      return;
    }

    const terminal = new XtermTerminal({
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      allowTransparency: true,
      rightClickSelectsWord: true,
      theme: activeColorTheme.terminalTheme,
      scrollback: 20000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    let lastResizeKey = "";
    const syncTerminalSize = (force = false): void => {
      const sessionId = activeTerminalIdRef.current;
      if (!sessionId) {
        return;
      }

      const cols = terminal.cols;
      const rows = terminal.rows;
      if (cols <= 0 || rows <= 0) {
        return;
      }

      const sessionSizeKey = `${sessionId}:${cols}x${rows}`;
      if (!force && sessionSizeKey === lastResizeKey) {
        return;
      }

      lastResizeKey = sessionSizeKey;
      terminalSizeKeyBySessionRef.current[sessionId] = `${cols}x${rows}`;
      setTerminals((previous) =>
        previous.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                cols,
                rows,
              }
            : session,
        ),
      );

      terminalResizeQueueRef.current = terminalResizeQueueRef.current
        .then(() => terminalResize(sessionId, cols, rows))
        .catch((error) => {
          setStatusMessage(`Terminal resize failed: ${String(error)}`);
        });
    };

    syncTerminalSizeRef.current = syncTerminalSize;

    const fitAndSync = (force = false): void => {
      fitAddon.fit();
      syncTerminalSize(force);
    };

    const resizeObserver = new ResizeObserver(() => {
      fitAndSync(false);
    });
    resizeObserver.observe(host);

    const resizeDisposable = terminal.onResize(() => {
      syncTerminalSize(false);
    });

    const dataDisposable = terminal.onData((data: string) => {
      queueTerminalInput(data);
    });

    const clickHandler = () => {
      terminal.focus();
    };
    host.addEventListener("click", clickHandler);

    redrawTerminal(activeTerminalIdRef.current);
    window.requestAnimationFrame(() => {
      fitAndSync(true);
    });

    return () => {
      host.removeEventListener("click", clickHandler);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      resizeObserver.disconnect();
      syncTerminalSizeRef.current = () => {};
      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    void listen<TerminalOutputEvent>("terminal://output", (event) => {
      const payload = event.payload;
      setTerminalBuffers((previous) => {
        const next = {
          ...previous,
          [payload.sessionId]: `${previous[payload.sessionId] ?? ""}${payload.chunk}`,
        };
        terminalBuffersRef.current = next;
        return next;
      });

      if (payload.sessionId === activeTerminalIdRef.current && terminalRef.current) {
        terminalRef.current.write(payload.chunk);
      }
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    void restoreWorkspaceAndState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshWindowMaximizedState();

    const focusHandler = () => {
      void refreshWindowMaximizedState();
    };

    window.addEventListener("focus", focusHandler);
    return () => {
      window.removeEventListener("focus", focusHandler);
    };
  }, [appWindow]);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      const terminalHasFocus = Boolean(
        terminalHostRef.current && document.activeElement && terminalHostRef.current.contains(document.activeElement),
      );

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveTab();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "`") {
        event.preventDefault();
        terminalRef.current?.focus();
        return;
      }

      if (terminalHasFocus && (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (text) {
              queueTerminalInput(text);
            }
          })
          .catch((error) => {
            setStatusMessage(`Paste failed: ${String(error)}`);
          });
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [activeTabId]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirtyTabs) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [hasDirtyTabs]);

  useEffect(() => {
    if (!pendingPosition) {
      return;
    }

    if (activeTabId !== pendingPosition.tabId) {
      return;
    }

    const editor = monacoEditorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) {
      return;
    }

    const line = Math.max(1, Math.min(pendingPosition.line, model.getLineCount()));
    const column = Math.max(1, Math.min(pendingPosition.column, model.getLineMaxColumn(line)));
    editor.focus();
    editor.setPosition({ lineNumber: line, column });
    editor.revealPositionInCenter({ lineNumber: line, column });
    setPendingPosition(null);
  }, [pendingPosition, activeTabId, editorReadySeq]);

  useEffect(() => {
    redrawTerminal(activeTerminalId);

    if (!activeTerminalId) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      syncTerminalSizeRef.current(true);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeTerminalId, redrawTerminal]);

  useEffect(() => {
    if (!isTerminalVisible) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      redrawTerminal(activeTerminalIdRef.current);
      syncTerminalSizeRef.current(true);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [isTerminalVisible, redrawTerminal]);

  const workbenchClassName = `workbench-grid${isExplorerVisible ? "" : " explorer-hidden"}`;
  const mainPanelClassName = `main-panel${isTerminalVisible ? "" : " terminal-hidden"}`;
  const rootExpanded = workspace ? Boolean(expandedByPath[workspace.rootPath]) : false;
  const rootVisual = workspace
    ? resolveDirectoryVisual(workspace.rootName, rootExpanded, activeFileIconThemeId, true)
    : null;

  return (
    <div className="app-shell">
      <header className="window-bar">
        <div className="window-drag" data-tauri-drag-region>
          <span className="brand-label">VEXC</span>
          <span className="workspace-current">{workspace ? workspace.rootName : "No workspace"}</span>
        </div>

        <div className="workspace-controls">
          <button type="button" className="primary" onClick={() => void promptWorkspacePath()}>
            选择目录
          </button>
          <button type="button" className="secondary" onClick={() => void createTerminalSession()}>
            新建终端
          </button>
          <button
            type="button"
            className="secondary visibility-toggle"
            aria-label={isExplorerVisible ? "隐藏文件树" : "显示文件树"}
            aria-pressed={isExplorerVisible}
            title={isExplorerVisible ? "隐藏文件树" : "显示文件树"}
            onClick={() => setIsExplorerVisible((previous) => !previous)}
          >
            {isExplorerVisible ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
            <span>文件树</span>
          </button>
          <button
            type="button"
            className="secondary visibility-toggle"
            aria-label={isTerminalVisible ? "隐藏终端面板" : "显示终端面板"}
            aria-pressed={isTerminalVisible}
            title={isTerminalVisible ? "隐藏终端面板" : "显示终端面板"}
            onClick={() => setIsTerminalVisible((previous) => !previous)}
          >
            {isTerminalVisible ? <PanelBottomClose size={14} /> : <PanelBottomOpen size={14} />}
            <span>终端</span>
          </button>
          <label className="theme-select-wrap" title="选择颜色主题">
            <span className="theme-select-label">颜色</span>
            <select
              className="theme-select"
              aria-label="颜色主题"
              value={activeColorThemeId}
              onChange={(event) => {
                const nextThemeId = event.target.value;
                if (isColorThemeId(nextThemeId)) {
                  setActiveColorThemeId(nextThemeId);
                  return;
                }

                setStatusMessage(`Ignored unsupported color theme: ${nextThemeId}`);
              }}
            >
              {colorThemeOptions.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
                </option>
              ))}
            </select>
          </label>
          <label className="theme-select-wrap" title="选择文件图标主题">
            <span className="theme-select-label">图标</span>
            <select
              className="theme-select"
              aria-label="文件图标主题"
              value={activeFileIconThemeId}
              onChange={(event) => setActiveFileIconThemeId(event.target.value as FileIconThemeId)}
            >
              {fileIconThemeOptions.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="primary" onClick={() => void saveTab()} disabled={!activeTab}>
            保存
          </button>
        </div>

        <div className="window-controls">
          <button
            type="button"
            className="window-control"
            aria-label="Minimize window"
            onClick={() => void handleWindowMinimize()}
          >
            <span className="window-glyph min" />
          </button>
          <button
            type="button"
            className="window-control"
            aria-label={isWindowMaximized ? "Restore window" : "Maximize window"}
            onClick={() => void handleWindowToggleMaximize()}
          >
            <span className={`window-glyph ${isWindowMaximized ? "restore" : "max"}`} />
          </button>
          <button
            type="button"
            className="window-control close"
            aria-label="Close window"
            onClick={() => void handleWindowClose()}
          >
            <span className="window-glyph close" />
          </button>
        </div>
      </header>

      <div className={workbenchClassName}>
        <aside className="explorer-panel">
          <div className="panel-title">Explorer</div>
          {workspace ? (
            <div className="explorer-root">
              <button
                type="button"
                className="tree-item root"
                onClick={() => {
                  const expanded = !rootExpanded;
                  setExpandedByPath((previous) => ({
                    ...previous,
                    [workspace.rootPath]: expanded,
                  }));
                  if (expanded && !treeByPath[workspace.rootPath]) {
                    void loadDirectory(workspace.rootPath);
                  }
                }}
              >
                <span className={`tree-marker tone-${rootVisual?.tone ?? "default"}`}>
                  {rootVisual?.icon ?? <Folder size={14} />}
                </span>
                <span className="tree-label">{workspace.rootName}</span>
              </button>
              {rootExpanded ? (
                <div>{renderTree(treeByPath[workspace.rootPath] ?? [], 1)}</div>
              ) : null}
            </div>
          ) : (
            <p className="empty-text">Open a workspace to browse files.</p>
          )}
        </aside>

        <section className={mainPanelClassName}>
          <section className="editor-panel">
            <div className="tab-strip">
              {tabs.map((tab) => (
                <div key={tab.id} className={`tab-item ${tab.id === activeTabId ? "active" : ""}`}>
                  <button type="button" className="tab-button" onClick={() => setActiveTabId(tab.id)}>
                    {tab.title}
                    {tabIsDirty(tab) ? " *" : ""}
                  </button>
                  <button type="button" className="tab-close" onClick={() => closeTab(tab.id)}>
                    x
                  </button>
                </div>
              ))}
            </div>

            <div className="editor-surface">
              {activeTab ? (
                <Editor
                  path={activeTab.path}
                  language={activeTab.language}
                  value={activeTab.content}
                  onMount={handleEditorMount}
                  onChange={(value) => updateActiveTabContent(value ?? "")}
                  theme={activeColorTheme.monacoThemeName}
                  className="editor-monaco"
                  height="100%"
                  options={{
                    automaticLayout: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineHeight: 20,
                    tabSize: 2,
                    insertSpaces: true,
                    wordWrap: "on",
                    renderWhitespace: "selection",
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                  }}
                />
              ) : (
                <div className="empty-state">
                  <h3>Ready for coding</h3>
                  <p>Open a file from the explorer to start editing.</p>
                </div>
              )}
            </div>
          </section>

          <section className="terminal-panel">
            <div className="terminal-toolbar">
              <div className="terminal-tabs">
                {terminals.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={`terminal-tab ${session.id === activeTerminalId ? "active" : ""}`}
                    onClick={() => void selectTerminal(session.id)}
                    title={session.cwd}
                  >
                    <span
                      className={`terminal-tab-dot ${session.status === "running" ? "running" : "stopped"}`}
                    />
                    <span className="terminal-tab-title">{session.title}</span>
                  </button>
                ))}
              </div>
              <div className="terminal-actions">
                <button type="button" onClick={() => void createTerminalSession()}>
                  +
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!activeTerminal}
                  onClick={() => interruptActiveTerminal()}
                >
                  Ctrl+C
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!activeTerminal}
                  onClick={() => void clearActiveTerminalOutput()}
                >
                  清屏
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!activeTerminal}
                  onClick={() => void closeActiveTerminal()}
                >
                  关闭
                </button>
              </div>
            </div>

            <div ref={terminalHostRef} className="terminal-host" />
          </section>
        </section>
      </div>

      <footer className="statusbar">
        <div className="statusbar-section statusbar-left">
          <span className="statusbar-icon">ℹ️</span>
          <span>{statusMessage || "Ready"}</span>
        </div>

        <div className="statusbar-section statusbar-center">
          <span className="statusbar-path">{workspace?.rootPath || "No workspace"}</span>
        </div>

        <div className="statusbar-section statusbar-right">
          {/* 预留空间，可显示编码、语言、行列等信息 */}
        </div>
      </footer>
    </div>
  );
}

export default App;
