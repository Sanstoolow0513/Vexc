import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Editor from "@monaco-editor/react";
import {
  Copy,
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FilePlus2,
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
  FolderPlus,
  FolderRoot,
  FolderSearch,
  Info,
  Minus,
  Pencil,
  Save,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { editor as MonacoEditor } from "monaco-editor";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  createDirectory,
  createFile,
  deletePath,
  getWorkspace,
  listDirectory,
  movePath,
  readFile,
  renamePath,
  setWorkspace,
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
  FileKind,
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
type HeaderMenuId = "file" | "view" | "theme";

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
const CODE_FONT_FAMILY = '"JetBrains Mono", "Cascadia Code", Consolas, monospace';
const CODE_FONT_SIZE = 13;
const CODE_LINE_HEIGHT = 18;
const CODE_LINE_HEIGHT_RATIO = CODE_LINE_HEIGHT / CODE_FONT_SIZE;
const MAX_TERMINAL_BUFFER_CHARS = 1024 * 1024;
const EXPLORER_DEFAULT_WIDTH = 270;
const EXPLORER_MIN_WIDTH = 180;
const EXPLORER_RESIZER_WIDTH = 6;
const EXPLORER_MAIN_PANEL_MIN_WIDTH = 260;
const TREE_DRAG_SOURCE_MIME = "application/x-vexc-tree-drag-source";

function clampTerminalBuffer(value: string): string {
  if (value.length <= MAX_TERMINAL_BUFFER_CHARS) {
    return value;
  }
  return value.slice(value.length - MAX_TERMINAL_BUFFER_CHARS);
}

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

type WorkbenchTabKind = "file" | "terminal";

interface WorkbenchTabTarget {
  kind: WorkbenchTabKind;
  id: string;
}

interface TreeContextMenuState {
  path: string;
  kind: FileKind;
  x: number;
  y: number;
}

interface TreeDragSource {
  path: string;
  kind: FileKind;
}

type TreeDropRejectionReason =
  | "missing-source"
  | "same-path"
  | "same-parent"
  | "target-inside-source";

function parseTreeDragSourcePayload(payload: string): TreeDragSource | null {
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as Partial<TreeDragSource>;
    if (!parsed || typeof parsed.path !== "string") {
      return null;
    }

    if (parsed.kind !== "file" && parsed.kind !== "directory") {
      return null;
    }

    return {
      path: parsed.path,
      kind: parsed.kind,
    };
  } catch {
    return null;
  }
}

function resolveWorkbenchFallbackAfterClose(
  fileTabs: readonly EditorTab[],
  terminalSessions: readonly TerminalSession[],
  closedTarget: WorkbenchTabTarget,
): WorkbenchTabTarget | null {
  const orderedTargets: WorkbenchTabTarget[] = [
    ...fileTabs.map((tab) => ({ kind: "file" as const, id: tab.id })),
    ...terminalSessions.map((session) => ({ kind: "terminal" as const, id: session.id })),
  ];

  const removeIndex = orderedTargets.findIndex(
    (target) => target.kind === closedTarget.kind && target.id === closedTarget.id,
  );
  if (removeIndex < 0) {
    return orderedTargets[0] ?? null;
  }

  const remainingTargets = orderedTargets.filter(
    (target) => !(target.kind === closedTarget.kind && target.id === closedTarget.id),
  );
  if (remainingTargets.length === 0) {
    return null;
  }

  const fallbackIndex = Math.max(0, removeIndex - 1);
  return remainingTargets[fallbackIndex] ?? remainingTargets[remainingTargets.length - 1];
}

function normalizePathForComparison(path: string): string {
  if (!path) {
    return path;
  }

  const normalized = path.replace(/\\/g, "/");
  if (normalized === "/") {
    return normalized;
  }

  const trimmed = normalized.replace(/\/+$/, "");
  return trimmed || normalized;
}

function isSamePath(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

function isSameOrDescendantPath(candidatePath: string, targetPath: string): boolean {
  const normalizedCandidate = normalizePathForComparison(candidatePath);
  const normalizedTarget = normalizePathForComparison(targetPath);

  return normalizedCandidate === normalizedTarget || normalizedCandidate.startsWith(`${normalizedTarget}/`);
}

function inferPathSeparator(path: string): "/" | "\\" {
  return path.includes("\\") ? "\\" : "/";
}

function applyPathSeparator(path: string, separator: "/" | "\\"): string {
  if (separator === "\\") {
    return path.replace(/\//g, "\\");
  }
  return path;
}

function replacePathPrefix(path: string, previousPrefix: string, nextPrefix: string): string {
  if (!isSameOrDescendantPath(path, previousPrefix)) {
    return path;
  }

  const normalizedPath = normalizePathForComparison(path);
  const normalizedPrevious = normalizePathForComparison(previousPrefix);
  const normalizedNext = normalizePathForComparison(nextPrefix);
  const suffix = normalizedPath.slice(normalizedPrevious.length);
  const mappedPath = `${normalizedNext}${suffix}`;

  return applyPathSeparator(mappedPath, inferPathSeparator(nextPrefix));
}

function joinPath(basePath: string, name: string): string {
  const separator = inferPathSeparator(basePath);
  if (basePath.endsWith("/") || basePath.endsWith("\\")) {
    return `${basePath}${name}`;
  }
  return `${basePath}${separator}${name}`;
}

function parentPath(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  const lastSlashIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (lastSlashIndex < 0) {
    return null;
  }

  if (lastSlashIndex === 0) {
    return trimmed.slice(0, 1);
  }

  if (lastSlashIndex === 2 && trimmed[1] === ":") {
    return `${trimmed.slice(0, 2)}\\`;
  }

  return trimmed.slice(0, lastSlashIndex);
}

function isValidNodeName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed === "." || trimmed === "..") {
    return false;
  }

  return !/[\\/]/.test(trimmed);
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
  const terminalsRef = useRef<TerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const activeTerminalIdRef = useRef<string | null>(null);
  const [terminalBuffers, setTerminalBuffers] = useState<Record<string, string>>({});
  const terminalBuffersRef = useRef<Record<string, string>>({});
  const terminalPendingOutputBySessionRef = useRef<Record<string, string>>({});
  const terminalOutputAnimationFrameRef = useRef<number | null>(null);
  const terminalWriteQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const terminalResizeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const terminalSizeKeyBySessionRef = useRef<Record<string, string>>({});
  const syncTerminalSizeRef = useRef<(force?: boolean) => void>(() => {});

  const [pendingPosition, setPendingPosition] = useState<PendingPosition | null>(null);
  const [editorReadySeq, setEditorReadySeq] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isExplorerVisible, setIsExplorerVisible] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(EXPLORER_DEFAULT_WIDTH);
  const [isExplorerResizing, setIsExplorerResizing] = useState(false);
  const [activeWorkbenchTabKind, setActiveWorkbenchTabKind] = useState<WorkbenchTabKind>("file");
  const [activeColorThemeId, setActiveColorThemeId] = useState<ColorThemeId>(() => readStoredColorThemeId());
  const [activeFileIconThemeId, setActiveFileIconThemeId] = useState<FileIconThemeId>(() =>
    readStoredFileIconThemeId(),
  );
  const [activeHeaderMenuId, setActiveHeaderMenuId] = useState<HeaderMenuId | null>(null);
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [selectedTreeKind, setSelectedTreeKind] = useState<FileKind | null>(null);
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
  const [treeDropTargetPath, setTreeDropTargetPath] = useState<string | null>(null);

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
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const treeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const workbenchGridRef = useRef<HTMLDivElement | null>(null);
  const explorerResizePointerIdRef = useRef<number | null>(null);
  const explorerLastVisibleWidthRef = useRef(EXPLORER_DEFAULT_WIDTH);
  const treeDragSourceRef = useRef<TreeDragSource | null>(null);
  const treeDropRejectionSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);

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

  useEffect(() => {
    if (!activeHeaderMenuId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (headerMenuRef.current?.contains(target)) {
        return;
      }

      setActiveHeaderMenuId(null);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setActiveHeaderMenuId(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeHeaderMenuId]);

  useEffect(() => {
    if (!treeContextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (treeContextMenuRef.current?.contains(target)) {
        return;
      }

      setTreeContextMenu(null);
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setTreeContextMenu(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [treeContextMenu]);

  useEffect(() => {
    if (!isExplorerResizing) {
      document.body.classList.remove("explorer-resizing");
      return;
    }

    document.body.classList.add("explorer-resizing");
    return () => {
      document.body.classList.remove("explorer-resizing");
    };
  }, [isExplorerResizing]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  const isFileTabActive = activeWorkbenchTabKind === "file";
  const activeFileTab = isFileTabActive ? activeTab : null;
  const activeTerminal = useMemo(
    () => terminals.find((session) => session.id === activeTerminalId) ?? null,
    [terminals, activeTerminalId],
  );
  const contextPath = useMemo(() => {
    if (isFileTabActive && activeTab) {
      return activeTab.path;
    }

    if (activeWorkbenchTabKind === "terminal") {
      return activeTerminal?.cwd ?? workspace?.rootPath ?? null;
    }

    return selectedTreePath ?? workspace?.rootPath ?? null;
  }, [
    isFileTabActive,
    activeTab,
    activeWorkbenchTabKind,
    activeTerminal?.cwd,
    selectedTreePath,
    workspace?.rootPath,
  ]);
  const activeTabDirty = activeTab ? tabIsDirty(activeTab) : false;

  const hasDirtyTabs = useMemo(
    () => tabs.some((tab) => tab.content !== tab.savedContent),
    [tabs],
  );

  function tabIsDirty(tab: EditorTab): boolean {
    return tab.content !== tab.savedContent;
  }

  function hideExplorerPanel(): void {
    setIsExplorerVisible(false);
  }

  function showExplorerPanel(): void {
    const nextWidth = Math.max(explorerLastVisibleWidthRef.current, EXPLORER_MIN_WIDTH);
    setExplorerWidth(nextWidth);
    setIsExplorerVisible(true);
  }

  function toggleExplorerVisibility(): void {
    if (isExplorerVisible) {
      hideExplorerPanel();
      return;
    }

    showExplorerPanel();
  }

  function stopExplorerResize(handle: HTMLDivElement | null): void {
    const pointerId = explorerResizePointerIdRef.current;
    if (handle && pointerId !== null && handle.hasPointerCapture(pointerId)) {
      handle.releasePointerCapture(pointerId);
    }

    explorerResizePointerIdRef.current = null;
    setIsExplorerResizing(false);
  }

  function handleExplorerResizeStart(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || !isExplorerVisible) {
      return;
    }

    explorerResizePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsExplorerResizing(true);
    event.preventDefault();
  }

  function handleExplorerResizeMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!isExplorerResizing || explorerResizePointerIdRef.current !== event.pointerId) {
      return;
    }

    const workbenchGrid = workbenchGridRef.current;
    if (!workbenchGrid) {
      return;
    }

    const bounds = workbenchGrid.getBoundingClientRect();
    const maxWidth = Math.max(
      EXPLORER_MIN_WIDTH,
      bounds.width - EXPLORER_RESIZER_WIDTH - EXPLORER_MAIN_PANEL_MIN_WIDTH,
    );
    const requestedWidth = Math.max(0, Math.min(event.clientX - bounds.left, maxWidth));

    if (requestedWidth < EXPLORER_MIN_WIDTH) {
      hideExplorerPanel();
      stopExplorerResize(event.currentTarget);
      return;
    }

    setExplorerWidth(requestedWidth);
    explorerLastVisibleWidthRef.current = requestedWidth;
    if (!isExplorerVisible) {
      setIsExplorerVisible(true);
    }
  }

  function handleExplorerResizeEnd(event: ReactPointerEvent<HTMLDivElement>): void {
    if (explorerResizePointerIdRef.current !== event.pointerId) {
      return;
    }

    stopExplorerResize(event.currentTarget);
  }

  function activateWorkbenchTab(target: WorkbenchTabTarget | null): void {
    if (!target) {
      setActiveWorkbenchTabKind("file");
      setActiveTabId(null);
      activeTerminalIdRef.current = null;
      setActiveTerminalId(null);
      return;
    }

    if (target.kind === "file") {
      setActiveWorkbenchTabKind("file");
      setActiveTabId(target.id);
      return;
    }

    setActiveWorkbenchTabKind("terminal");
    activeTerminalIdRef.current = target.id;
    setActiveTerminalId(target.id);
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

  function closeTreeContextMenu(): void {
    setTreeContextMenu(null);
  }

  function refreshDirectoryEntries(paths: string[]): void {
    const uniquePaths = Array.from(new Set(paths.filter((value) => value.length > 0)));
    for (const path of uniquePaths) {
      setExpandedByPath((previous) => ({
        ...previous,
        [path]: true,
      }));
      void loadDirectory(path);
    }
  }

  function resolveCreationDirectoryPath(
    preferredPath?: string,
    preferredKind?: FileKind,
  ): string | null {
    if (!workspace) {
      return null;
    }

    const path = preferredPath ?? selectedTreePath;
    const kind = preferredKind ?? selectedTreeKind;

    if (!path || !kind) {
      return workspace.rootPath;
    }

    if (kind === "directory") {
      return path;
    }

    return parentPath(path) ?? workspace.rootPath;
  }

  function remapPathInExplorerState(previousPath: string, nextPath: string): void {
    setTreeByPath((previous) => {
      const next: Record<string, FileNode[]> = {};

      for (const [key, nodes] of Object.entries(previous)) {
        const mappedKey = replacePathPrefix(key, previousPath, nextPath);
        next[mappedKey] = nodes.map((node) => {
          if (!isSameOrDescendantPath(node.path, previousPath)) {
            return node;
          }

          return {
            ...node,
            path: replacePathPrefix(node.path, previousPath, nextPath),
          };
        });
      }

      return next;
    });

    setExpandedByPath((previous) => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(previous)) {
        next[replacePathPrefix(key, previousPath, nextPath)] = value;
      }
      return next;
    });

    setLoadingByPath((previous) => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(previous)) {
        next[replacePathPrefix(key, previousPath, nextPath)] = value;
      }
      return next;
    });

    setOpeningFilesByPath((previous) => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(previous)) {
        next[replacePathPrefix(key, previousPath, nextPath)] = value;
      }
      return next;
    });

    setSelectedTreePath((previous) => {
      if (!previous || !isSameOrDescendantPath(previous, previousPath)) {
        return previous;
      }
      return replacePathPrefix(previous, previousPath, nextPath);
    });

    setTreeDropTargetPath((previous) => {
      if (!previous || !isSameOrDescendantPath(previous, previousPath)) {
        return previous;
      }
      return replacePathPrefix(previous, previousPath, nextPath);
    });

    setTreeContextMenu((previous) => {
      if (!previous || !isSameOrDescendantPath(previous.path, previousPath)) {
        return previous;
      }

      return {
        ...previous,
        path: replacePathPrefix(previous.path, previousPath, nextPath),
      };
    });
  }

  function remapPathInTabs(previousPath: string, nextPath: string): void {
    setTabs((previous) =>
      previous.map((tab) => {
        if (!isSameOrDescendantPath(tab.path, previousPath)) {
          return tab;
        }

        const mappedPath = replacePathPrefix(tab.path, previousPath, nextPath);
        return {
          ...tab,
          id: mappedPath,
          path: mappedPath,
          title: fileNameFromPath(mappedPath),
          language: detectLanguage(mappedPath),
        };
      }),
    );

    if (activeTabId && isSameOrDescendantPath(activeTabId, previousPath)) {
      setActiveTabId(replacePathPrefix(activeTabId, previousPath, nextPath));
    }

    const nextRequests: Record<string, Promise<string | null>> = {};
    for (const [key, request] of Object.entries(openFileRequestsRef.current)) {
      nextRequests[replacePathPrefix(key, previousPath, nextPath)] = request;
    }
    openFileRequestsRef.current = nextRequests;
  }

  function removePathFromExplorerState(path: string): void {
    setTreeByPath((previous) => {
      const next: Record<string, FileNode[]> = {};

      for (const [key, nodes] of Object.entries(previous)) {
        if (isSameOrDescendantPath(key, path)) {
          continue;
        }

        next[key] = nodes.filter((node) => !isSameOrDescendantPath(node.path, path));
      }

      return next;
    });

    setExpandedByPath((previous) => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(previous)) {
        if (!isSameOrDescendantPath(key, path)) {
          next[key] = value;
        }
      }
      return next;
    });

    setLoadingByPath((previous) => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(previous)) {
        if (!isSameOrDescendantPath(key, path)) {
          next[key] = value;
        }
      }
      return next;
    });

    setOpeningFilesByPath((previous) => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(previous)) {
        if (!isSameOrDescendantPath(key, path)) {
          next[key] = value;
        }
      }
      return next;
    });

    if (selectedTreePath && isSameOrDescendantPath(selectedTreePath, path)) {
      setSelectedTreePath(null);
      setSelectedTreeKind(null);
    }

    setTreeDropTargetPath((previous) =>
      previous && isSameOrDescendantPath(previous, path) ? null : previous,
    );

    setTreeContextMenu((previous) =>
      previous && isSameOrDescendantPath(previous.path, path) ? null : previous,
    );
  }

  function removeTabsByPath(path: string): void {
    const existingTabs = tabsRef.current;
    const tabsToRemove = existingTabs.filter((tab) => isSameOrDescendantPath(tab.path, path));
    if (tabsToRemove.length === 0) {
      return;
    }

    const nextTabs = existingTabs.filter((tab) => !isSameOrDescendantPath(tab.path, path));
    setTabs(nextTabs);

    if (!activeTabId || !isSameOrDescendantPath(activeTabId, path)) {
      return;
    }

    const activeIndex = existingTabs.findIndex((tab) => tab.id === activeTabId);
    const fallbackIndex = Math.max(0, activeIndex - 1);
    const fallbackTab = nextTabs[fallbackIndex] ?? nextTabs[nextTabs.length - 1] ?? null;
    setActiveTabId(fallbackTab ? fallbackTab.id : null);
  }

  async function promptCreateNode(
    kind: FileKind,
    preferredPath?: string,
    preferredKind?: FileKind,
  ): Promise<void> {
    const targetDirectoryPath = resolveCreationDirectoryPath(preferredPath, preferredKind);
    if (!targetDirectoryPath) {
      setStatusMessage("No workspace selected.");
      return;
    }

    const promptLabel = kind === "file" ? "文件" : "文件夹";
    const input = window.prompt(`请输入${promptLabel}名称`);
    if (input === null) {
      return;
    }

    const name = input.trim();
    if (!isValidNodeName(name)) {
      setStatusMessage("名称无效：不能为空，且不能包含路径分隔符。");
      return;
    }

    const targetPath = joinPath(targetDirectoryPath, name);

    try {
      const result = kind === "file"
        ? await createFile(targetPath)
        : await createDirectory(targetPath);

      refreshDirectoryEntries([targetDirectoryPath]);

      if (kind === "file") {
        setSelectedTreePath(result.path);
        setSelectedTreeKind("file");
        await openFile(result.path);
      } else {
        setExpandedByPath((previous) => ({
          ...previous,
          [result.path]: true,
        }));
        setSelectedTreePath(result.path);
        setSelectedTreeKind("directory");
      }

      setStatusMessage(`Created ${promptLabel}: ${fileNameFromPath(result.path)}`);
    } catch (error) {
      setStatusMessage(`Failed to create ${promptLabel}: ${String(error)}`);
    }
  }

  async function handleRenameTreePath(path: string, kind: FileKind): Promise<void> {
    if (workspace && isSamePath(path, workspace.rootPath)) {
      setStatusMessage("Workspace root cannot be renamed.");
      return;
    }

    const currentName = fileNameFromPath(path);
    const input = window.prompt("请输入新名称", currentName);
    if (input === null) {
      return;
    }

    const nextName = input.trim();
    if (!isValidNodeName(nextName)) {
      setStatusMessage("名称无效：不能为空，且不能包含路径分隔符。");
      return;
    }

    if (nextName === currentName) {
      return;
    }

    try {
      const result = await renamePath(path, nextName);
      remapPathInExplorerState(path, result.path);
      remapPathInTabs(path, result.path);

      const sourceParentPath = parentPath(path);
      const targetParentPath = parentPath(result.path);
      refreshDirectoryEntries([sourceParentPath ?? "", targetParentPath ?? ""]);

      setSelectedTreePath(result.path);
      setSelectedTreeKind(kind);
      setStatusMessage(`Renamed to ${fileNameFromPath(result.path)}`);
    } catch (error) {
      setStatusMessage(`Rename failed: ${String(error)}`);
    }
  }

  async function handleDeleteTreePath(path: string, kind: FileKind): Promise<void> {
    if (workspace && isSamePath(path, workspace.rootPath)) {
      setStatusMessage("Workspace root cannot be deleted.");
      return;
    }

    const label = kind === "directory" ? "文件夹" : "文件";
    const confirmed = window.confirm(`确认永久删除${label}“${fileNameFromPath(path)}”？此操作不可撤销。`);
    if (!confirmed) {
      return;
    }

    try {
      await deletePath(path);
      removePathFromExplorerState(path);
      removeTabsByPath(path);

      const parentDirectoryPath = parentPath(path);
      refreshDirectoryEntries([parentDirectoryPath ?? ""]);
      setStatusMessage(`Deleted ${label}: ${fileNameFromPath(path)}`);
    } catch (error) {
      setStatusMessage(`Delete failed: ${String(error)}`);
    }
  }

  function resolveTreeDragSource(event: ReactDragEvent<HTMLElement>): TreeDragSource | null {
    const fromRef = treeDragSourceRef.current;
    if (fromRef) {
      return fromRef;
    }

    const payloadSource = parseTreeDragSourcePayload(event.dataTransfer.getData(TREE_DRAG_SOURCE_MIME));
    if (payloadSource) {
      treeDragSourceRef.current = payloadSource;
      return payloadSource;
    }

    const fallbackPath = event.dataTransfer.getData("text/plain").trim();
    if (!fallbackPath) {
      return null;
    }

    const fallbackKind = selectedTreePath && isSamePath(selectedTreePath, fallbackPath)
      ? selectedTreeKind
      : null;
    if (fallbackKind !== "file" && fallbackKind !== "directory") {
      return null;
    }

    const fallbackSource: TreeDragSource = {
      path: fallbackPath,
      kind: fallbackKind,
    };
    treeDragSourceRef.current = fallbackSource;
    return fallbackSource;
  }

  function getTreeDropRejectionReason(
    source: TreeDragSource | null,
    targetDirectoryPath: string,
  ): TreeDropRejectionReason | null {
    if (!source) {
      return "missing-source";
    }

    if (isSamePath(source.path, targetDirectoryPath)) {
      return "same-path";
    }

    const sourceParentPath = parentPath(source.path);
    if (sourceParentPath && isSamePath(sourceParentPath, targetDirectoryPath)) {
      return "same-parent";
    }

    if (source.kind === "directory" && isSameOrDescendantPath(targetDirectoryPath, source.path)) {
      return "target-inside-source";
    }

    return null;
  }

  function reportTreeDropRejection(
    reason: TreeDropRejectionReason,
    source: TreeDragSource | null,
    targetDirectoryPath: string,
  ): void {
    const sourcePath = source?.path ?? "<none>";
    const signature = `${reason}:${sourcePath}->${targetDirectoryPath}`;
    if (treeDropRejectionSignatureRef.current === signature) {
      return;
    }

    treeDropRejectionSignatureRef.current = signature;
    console.debug("[tree-dnd] drop rejected", {
      reason,
      sourcePath: source?.path ?? null,
      sourceKind: source?.kind ?? null,
      targetDirectoryPath,
    });
  }

  function clearTreeDropRejectionTrace(): void {
    treeDropRejectionSignatureRef.current = null;
  }

  function canDropTreePath(source: TreeDragSource | null, targetDirectoryPath: string): boolean {
    return getTreeDropRejectionReason(source, targetDirectoryPath) === null;
  }

  async function handleMoveTreePath(source: TreeDragSource, targetDirectoryPath: string): Promise<void> {
    if (!canDropTreePath(source, targetDirectoryPath)) {
      return;
    }

    try {
      const result = await movePath(source.path, targetDirectoryPath);
      remapPathInExplorerState(source.path, result.path);
      remapPathInTabs(source.path, result.path);

      const sourceParentPath = parentPath(source.path);
      const targetParentPath = parentPath(result.path);
      refreshDirectoryEntries([sourceParentPath ?? "", targetDirectoryPath, targetParentPath ?? ""]);

      setSelectedTreePath(result.path);
      setSelectedTreeKind(source.kind);
      setStatusMessage(`Moved: ${fileNameFromPath(source.path)} -> ${targetDirectoryPath}`);
    } catch (error) {
      setStatusMessage(`Move failed: ${String(error)}`);
    }
  }

  function handleTreeDragStart(event: ReactDragEvent<HTMLElement>, node: TreeDragSource): void {
    treeDragSourceRef.current = node;
    clearTreeDropRejectionTrace();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(TREE_DRAG_SOURCE_MIME, JSON.stringify(node));
    event.dataTransfer.setData("text/plain", node.path);
    setSelectedTreePath(node.path);
    setSelectedTreeKind(node.kind);
    closeTreeContextMenu();
  }

  function handleTreeDragEnd(): void {
    treeDragSourceRef.current = null;
    clearTreeDropRejectionTrace();
    setTreeDropTargetPath(null);
  }

  function handleTreeDragOver(event: ReactDragEvent<HTMLElement>, targetDirectoryPath: string): void {
    const source = resolveTreeDragSource(event);
    const rejectionReason = getTreeDropRejectionReason(source, targetDirectoryPath);
    if (rejectionReason) {
      reportTreeDropRejection(rejectionReason, source, targetDirectoryPath);
      if (treeDropTargetPath) {
        setTreeDropTargetPath(null);
      }
      return;
    }

    clearTreeDropRejectionTrace();
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (!treeDropTargetPath || !isSamePath(treeDropTargetPath, targetDirectoryPath)) {
      setTreeDropTargetPath(targetDirectoryPath);
    }
  }

  function handleTreeDragLeave(event: ReactDragEvent<HTMLElement>, targetDirectoryPath: string): void {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    if (!treeDropTargetPath || !isSamePath(treeDropTargetPath, targetDirectoryPath)) {
      return;
    }

    setTreeDropTargetPath(null);
  }

  function handleTreeDrop(event: ReactDragEvent<HTMLElement>, targetDirectoryPath: string): void {
    event.preventDefault();

    const source = resolveTreeDragSource(event);
    const rejectionReason = getTreeDropRejectionReason(source, targetDirectoryPath);

    treeDragSourceRef.current = null;
    clearTreeDropRejectionTrace();
    setTreeDropTargetPath(null);

    if (rejectionReason || !source) {
      reportTreeDropRejection(rejectionReason ?? "missing-source", source, targetDirectoryPath);
      return;
    }

    void handleMoveTreePath(source, targetDirectoryPath);
  }

  function openTreeContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    path: string,
    kind: FileKind,
  ): void {
    event.preventDefault();
    setSelectedTreePath(path);
    setSelectedTreeKind(kind);
    setTreeContextMenu({
      path,
      kind,
      x: event.clientX,
      y: event.clientY,
    });
  }

  function runTreeContextAction(action: () => void | Promise<void>): void {
    closeTreeContextMenu();
    void action();
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

  function cancelScheduledTerminalOutputFlush(): void {
    if (terminalOutputAnimationFrameRef.current === null) {
      return;
    }

    window.cancelAnimationFrame(terminalOutputAnimationFrameRef.current);
    terminalOutputAnimationFrameRef.current = null;
  }

  function clearPendingTerminalOutput(sessionId?: string): void {
    if (sessionId) {
      delete terminalPendingOutputBySessionRef.current[sessionId];
      return;
    }

    terminalPendingOutputBySessionRef.current = {};
    cancelScheduledTerminalOutputFlush();
  }

  function flushPendingTerminalOutput(): void {
    cancelScheduledTerminalOutputFlush();

    const pendingOutputBySession = terminalPendingOutputBySessionRef.current;
    const sessionIds = Object.keys(pendingOutputBySession);
    if (sessionIds.length === 0) {
      return;
    }

    terminalPendingOutputBySessionRef.current = {};

    const activeSessionId = activeTerminalIdRef.current;
    if (activeSessionId) {
      const activeChunk = pendingOutputBySession[activeSessionId];
      if (activeChunk && terminalRef.current) {
        terminalRef.current.write(activeChunk);
      }
    }

    setTerminalBuffers((previous) => {
      const next = { ...previous };
      let changed = false;

      for (const sessionId of sessionIds) {
        const chunk = pendingOutputBySession[sessionId];
        if (!chunk) {
          continue;
        }

        const existing = next[sessionId] ?? "";
        const merged = clampTerminalBuffer(`${existing}${chunk}`);
        if (merged === existing) {
          continue;
        }

        next[sessionId] = merged;
        changed = true;
      }

      if (!changed) {
        return previous;
      }

      terminalBuffersRef.current = next;
      return next;
    });
  }

  function scheduleTerminalOutputFlush(): void {
    if (terminalOutputAnimationFrameRef.current !== null) {
      return;
    }

    terminalOutputAnimationFrameRef.current = window.requestAnimationFrame(() => {
      terminalOutputAnimationFrameRef.current = null;
      flushPendingTerminalOutput();
    });
  }

  function mergeTerminalSnapshot(snapshot: TerminalSessionSnapshot): void {
    flushPendingTerminalOutput();

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
        [snapshot.session.id]: clampTerminalBuffer(snapshot.buffer),
      };
      terminalBuffersRef.current = next;
      return next;
    });
  }

  async function createTerminalSession(): Promise<void> {
    try {
      const snapshot = await terminalCreate();
      mergeTerminalSnapshot(snapshot);
      setActiveWorkbenchTabKind("terminal");
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
      flushPendingTerminalOutput();

      const sessions = await terminalList();
      if (sessions.length === 0) {
        setTerminals([]);
        setTerminalBuffers(() => {
          terminalBuffersRef.current = {};
          return {};
        });
        clearPendingTerminalOutput();
        terminalSizeKeyBySessionRef.current = {};
        activeTerminalIdRef.current = null;
        setActiveTerminalId(null);
        redrawTerminal(null);

        if (activeWorkbenchTabKind === "terminal") {
          const fallbackFileTab = tabsRef.current[0] ?? null;
          setActiveWorkbenchTabKind("file");
          if (fallbackFileTab) {
            setActiveTabId(fallbackFileTab.id);
          }
        }

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
        buffers[session.id] = clampTerminalBuffer(snapshot.buffer);
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
      setActiveWorkbenchTabKind("file");
      openFileRequestsRef.current = {};
      setOpeningFilesByPath({});

      setTreeByPath({});
      setExpandedByPath({ [info.rootPath]: true });
      setSelectedTreePath(info.rootPath);
      setSelectedTreeKind("directory");
      setTreeContextMenu(null);
      setTreeDropTargetPath(null);
      treeDragSourceRef.current = null;
      clearTreeDropRejectionTrace();
      await loadDirectory(info.rootPath);

      const existingSessions = await terminalList();
      for (const session of existingSessions) {
        await terminalClose(session.id);
      }

      setTerminals([]);
      setTerminalBuffers({});
      terminalBuffersRef.current = {};
      clearPendingTerminalOutput();
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
      setActiveWorkbenchTabKind("file");
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
        setActiveWorkbenchTabKind("file");
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
    const fallbackFileTab = nextTabs[Math.max(0, removeIndex - 1)] ?? null;

    const shouldResolveWorkbenchFallback = activeWorkbenchTabKind === "file" && activeTabId === tabId;
    const fallbackWorkbenchTab = shouldResolveWorkbenchFallback
      ? resolveWorkbenchFallbackAfterClose(existingTabs, terminalsRef.current, {
          kind: "file",
          id: tabId,
        })
      : null;

    setTabs(nextTabs);

    if (activeTabId === tabId) {
      setActiveTabId(fallbackFileTab ? fallbackFileTab.id : null);
    }

    if (shouldResolveWorkbenchFallback) {
      activateWorkbenchTab(fallbackWorkbenchTab);
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
    setActiveWorkbenchTabKind("terminal");
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

  async function closeTerminalTab(sessionId: string): Promise<void> {
    const existingSessions = terminalsRef.current;
    const removeIndex = existingSessions.findIndex((session) => session.id === sessionId);
    if (removeIndex < 0) {
      return;
    }

    const nextSessions = existingSessions.filter((session) => session.id !== sessionId);
    const fallbackSession = nextSessions[Math.max(0, removeIndex - 1)] ?? null;
    const shouldResolveWorkbenchFallback = activeWorkbenchTabKind === "terminal" && activeTerminalIdRef.current === sessionId;
    const fallbackWorkbenchTab = shouldResolveWorkbenchFallback
      ? resolveWorkbenchFallbackAfterClose(tabsRef.current, existingSessions, {
          kind: "terminal",
          id: sessionId,
        })
      : null;

    try {
      await terminalClose(sessionId);
      delete terminalSizeKeyBySessionRef.current[sessionId];
      clearPendingTerminalOutput(sessionId);

      setTerminals(nextSessions);
      setTerminalBuffers((previous) => {
        if (!Object.prototype.hasOwnProperty.call(previous, sessionId)) {
          return previous;
        }

        const next = { ...previous };
        delete next[sessionId];
        terminalBuffersRef.current = next;
        return next;
      });

      if (activeTerminalIdRef.current === sessionId) {
        activeTerminalIdRef.current = fallbackSession ? fallbackSession.id : null;
        setActiveTerminalId(fallbackSession ? fallbackSession.id : null);
      }

      if (shouldResolveWorkbenchFallback) {
        activateWorkbenchTab(fallbackWorkbenchTab);
      } else if (activeTerminalIdRef.current) {
        redrawTerminal(activeTerminalIdRef.current);
      } else {
        redrawTerminal(null);
      }

      setStatusMessage("Terminal closed.");
    } catch (error) {
      setStatusMessage(`Failed to close terminal: ${String(error)}`);
    }
  }

  async function focusOrCreateTerminalTab(): Promise<void> {
    const existingSessions = terminalsRef.current;
    if (existingSessions.length === 0) {
      await createTerminalSession();
      return;
    }

    const targetSessionId =
      activeTerminalIdRef.current && existingSessions.some((session) => session.id === activeTerminalIdRef.current)
        ? activeTerminalIdRef.current
        : existingSessions[0].id;

    await selectTerminal(targetSessionId);
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

  async function clearAllTerminalSessions(): Promise<void> {
    try {
      const existingSessions = await terminalList();
      for (const session of existingSessions) {
        await terminalClose(session.id);
      }
    } catch (error) {
      setStatusMessage(`Failed to reset terminals: ${String(error)}`);
    }

    setTerminals([]);
    setTerminalBuffers(() => {
      terminalBuffersRef.current = {};
      return {};
    });
    clearPendingTerminalOutput();
    terminalSizeKeyBySessionRef.current = {};
    terminalResizeQueueRef.current = Promise.resolve();
    activeTerminalIdRef.current = null;
    setActiveTerminalId(null);
    redrawTerminal(null);

    if (activeWorkbenchTabKind === "terminal") {
      const fallbackFileTab = tabsRef.current[0] ?? null;
      setActiveWorkbenchTabKind("file");
      setActiveTabId(fallbackFileTab ? fallbackFileTab.id : null);
    }
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
        await clearAllTerminalSessions();
      }
    } catch (error) {
      setStatusMessage(`Bootstrap failed: ${String(error)}`);
      await clearAllTerminalSessions();
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

  function openHeaderMenu(menuId: HeaderMenuId): void {
    setActiveHeaderMenuId(menuId);
  }

  function toggleHeaderMenu(menuId: HeaderMenuId): void {
    setActiveHeaderMenuId((previous) => (previous === menuId ? null : menuId));
  }

  function runHeaderMenuAction(action: () => void | Promise<void>): void {
    setActiveHeaderMenuId(null);
    void action();
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
      const selected = selectedTreePath ? isSamePath(selectedTreePath, node.path) : false;
      const isDropTarget = isDirectory && treeDropTargetPath ? isSamePath(treeDropTargetPath, node.path) : false;
      const visual = isDirectory
        ? resolveDirectoryVisual(node.name, expanded, activeFileIconThemeId)
        : resolveFileVisual(node.name, activeFileIconThemeId);

      return (
        <div key={node.path}>
          <button
            type="button"
            className={`tree-item ${activeTab?.path === node.path ? "active" : ""} ${
              selected ? "selected" : ""
            } ${isDropTarget ? "drop-target" : ""}`}
            style={{ paddingLeft: `${6 + depth * 11}px` }}
            disabled={loading || openingFile}
            draggable={!loading && !openingFile}
            onContextMenu={(event) => openTreeContextMenu(event, node.path, node.kind)}
            onDragStart={(event) => handleTreeDragStart(event, { path: node.path, kind: node.kind })}
            onDragEnd={handleTreeDragEnd}
            onDragOver={isDirectory ? (event) => handleTreeDragOver(event, node.path) : undefined}
            onDragLeave={isDirectory ? (event) => handleTreeDragLeave(event, node.path) : undefined}
            onDrop={isDirectory ? (event) => handleTreeDrop(event, node.path) : undefined}
            onClick={() => {
              setSelectedTreePath(node.path);
              setSelectedTreeKind(node.kind);
              closeTreeContextMenu();

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
      fontFamily: CODE_FONT_FAMILY,
      fontSize: CODE_FONT_SIZE,
      lineHeight: CODE_LINE_HEIGHT_RATIO,
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
      if (!payload.chunk) {
        return;
      }

      const pendingOutputBySession = terminalPendingOutputBySessionRef.current;
      const existingChunk = pendingOutputBySession[payload.sessionId] ?? "";
      pendingOutputBySession[payload.sessionId] = `${existingChunk}${payload.chunk}`;
      scheduleTerminalOutputFlush();
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      clearPendingTerminalOutput();
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
        if (!isFileTabActive) {
          return;
        }

        event.preventDefault();
        void saveTab();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "`") {
        event.preventDefault();
        void focusOrCreateTerminalTab();
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
  }, [isFileTabActive]);

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
    if (activeWorkbenchTabKind !== "terminal") {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      redrawTerminal(activeTerminalIdRef.current);
      syncTerminalSizeRef.current(true);
      terminalRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeWorkbenchTabKind, redrawTerminal]);

  const workbenchClassName = `workbench-grid${isExplorerVisible ? "" : " explorer-hidden"}`;
  const workbenchStyle = useMemo(
    () => ({ "--explorer-width": `${explorerWidth}px` } as CSSProperties),
    [explorerWidth],
  );
  const rootExpanded = workspace ? Boolean(expandedByPath[workspace.rootPath]) : false;
  const rootSelected = workspace && selectedTreePath
    ? isSamePath(selectedTreePath, workspace.rootPath)
    : false;
  const rootDropTarget = workspace && treeDropTargetPath
    ? isSamePath(treeDropTargetPath, workspace.rootPath)
    : false;
  const rootVisual = workspace
    ? resolveDirectoryVisual(workspace.rootName, rootExpanded, activeFileIconThemeId, true)
    : null;
  const contextMenuOnRoot = workspace && treeContextMenu
    ? isSamePath(treeContextMenu.path, workspace.rootPath)
    : false;

  return (
    <div className="app-shell">
      <header className="window-bar" data-tauri-drag-region>
        <div className="window-drag" data-tauri-drag-region>
          <img className="brand-icon" src="/icon.png" alt="VEXC" draggable={false} />
          <div className="brand-meta" aria-hidden="true">
            <span className="brand-title">VEXC</span>
            <span className="brand-subtitle">{workspace?.rootName ?? "未打开工作区"}</span>
          </div>
        </div>

        <div
          ref={headerMenuRef}
          className="header-menus"
          data-tauri-drag-region
          role="menubar"
          aria-label="工作台菜单"
          onMouseLeave={() => setActiveHeaderMenuId(null)}
        >
          <div
            className={`header-menu ${activeHeaderMenuId === "file" ? "active" : ""}`}
            onMouseEnter={() => openHeaderMenu("file")}
          >
            <button
              type="button"
              className="menu-tab"
              title="文件"
              aria-label="文件"
              aria-haspopup="menu"
              aria-expanded={activeHeaderMenuId === "file"}
              onClick={() => toggleHeaderMenu("file")}
            >
              <File size={14} aria-hidden="true" />
            </button>
            {activeHeaderMenuId === "file" ? (
              <div className="menu-panel" role="menu" aria-label="文件菜单">
                <button type="button" className="menu-item" role="menuitem" onClick={() => runHeaderMenuAction(promptWorkspacePath)}>
                  <span className="menu-item-main">
                    <span className="menu-item-indicator" aria-hidden="true" />
                    <span className="menu-item-label">打开文件夹...</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  disabled={!activeFileTab}
                  onClick={() => runHeaderMenuAction(() => saveTab())}
                >
                  <span className="menu-item-main">
                    <span className="menu-item-indicator" aria-hidden="true" />
                    <span className="menu-item-label">保存</span>
                  </span>
                  <span className="menu-item-hint">Ctrl+S</span>
                </button>
                <div className="menu-divider" />
                <button
                  type="button"
                  className="menu-item"
                  role="menuitem"
                  onClick={() => runHeaderMenuAction(createTerminalSession)}
                >
                  <span className="menu-item-main">
                    <span className="menu-item-indicator" aria-hidden="true" />
                    <span className="menu-item-label">新建终端</span>
                  </span>
                  <span className="menu-item-hint">Ctrl+`</span>
                </button>
              </div>
            ) : null}
          </div>

          <div
            className={`header-menu ${activeHeaderMenuId === "view" ? "active" : ""}`}
            onMouseEnter={() => openHeaderMenu("view")}
          >
            <button
              type="button"
              className="menu-tab"
              title="视图"
              aria-label="视图"
              aria-haspopup="menu"
              aria-expanded={activeHeaderMenuId === "view"}
              onClick={() => toggleHeaderMenu("view")}
            >
              <FolderSearch size={14} aria-hidden="true" />
            </button>
            {activeHeaderMenuId === "view" ? (
              <div className="menu-panel" role="menu" aria-label="视图菜单">
                <button
                  type="button"
                  className={`menu-item ${isExplorerVisible ? "selected" : ""}`}
                  role="menuitem"
                  onClick={() => runHeaderMenuAction(toggleExplorerVisibility)}
                >
                  <span className="menu-item-main">
                    <span className={`menu-item-indicator ${isExplorerVisible ? "selected" : ""}`} aria-hidden="true" />
                    <span className="menu-item-label">显示文件树</span>
                  </span>
                </button>
              </div>
            ) : null}
          </div>

          <div
            className={`header-menu ${activeHeaderMenuId === "theme" ? "active" : ""}`}
            onMouseEnter={() => openHeaderMenu("theme")}
          >
            <button
              type="button"
              className="menu-tab"
              title="主题"
              aria-label="主题"
              aria-haspopup="menu"
              aria-expanded={activeHeaderMenuId === "theme"}
              onClick={() => toggleHeaderMenu("theme")}
            >
              <FileCog size={14} aria-hidden="true" />
            </button>
            {activeHeaderMenuId === "theme" ? (
              <div className="menu-panel menu-panel-theme" role="menu" aria-label="主题菜单">
                <p className="menu-section-title">颜色主题</p>
                {colorThemeOptions.map((theme) => {
                  const isSelected = activeColorThemeId === theme.id;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      className={`menu-item ${isSelected ? "selected" : ""}`}
                      role="menuitem"
                      onClick={() => runHeaderMenuAction(() => setActiveColorThemeId(theme.id))}
                    >
                      <span className="menu-item-main">
                        <span className={`menu-item-indicator ${isSelected ? "selected" : ""}`} aria-hidden="true" />
                        <span className="menu-item-label">{theme.label}</span>
                      </span>
                    </button>
                  );
                })}

                <div className="menu-divider" />
                <p className="menu-section-title">文件图标</p>
                {fileIconThemeOptions.map((theme) => {
                  const isSelected = activeFileIconThemeId === theme.id;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      className={`menu-item ${isSelected ? "selected" : ""}`}
                      role="menuitem"
                      onClick={() => runHeaderMenuAction(() => setActiveFileIconThemeId(theme.id))}
                    >
                      <span className="menu-item-main">
                        <span className={`menu-item-indicator ${isSelected ? "selected" : ""}`} aria-hidden="true" />
                        <span className="menu-item-label">{theme.label}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="window-controls">
          <button
            type="button"
            className="window-control"
            aria-label="Minimize window"
            onClick={() => void handleWindowMinimize()}
          >
            <Minus size={14} strokeWidth={1.9} className="window-control-icon" />
          </button>
          <button
            type="button"
            className="window-control"
            aria-label={isWindowMaximized ? "Restore window" : "Maximize window"}
            onClick={() => void handleWindowToggleMaximize()}
          >
            {isWindowMaximized ? (
              <Copy size={14} strokeWidth={1.9} className="window-control-icon" />
            ) : (
              <Square size={13} strokeWidth={1.9} className="window-control-icon" />
            )}
          </button>
          <button
            type="button"
            className="window-control close"
            aria-label="Close window"
            onClick={() => void handleWindowClose()}
          >
            <X size={14} strokeWidth={1.9} className="window-control-icon" />
          </button>
        </div>
      </header>

      <div ref={workbenchGridRef} className={workbenchClassName} style={workbenchStyle}>
        <aside className="explorer-panel">
          <div className="explorer-toolbar">
            <button
              type="button"
              className="explorer-action icon-only"
              title="新建文件"
              aria-label="新建文件"
              disabled={!workspace}
              onClick={() => void promptCreateNode("file")}
            >
              <FilePlus2 size={14} />
            </button>
            <button
              type="button"
              className="explorer-action icon-only"
              title="新建文件夹"
              aria-label="新建文件夹"
              disabled={!workspace}
              onClick={() => void promptCreateNode("directory")}
            >
              <FolderPlus size={14} />
            </button>
          </div>

          {workspace ? (
            <div className="explorer-root">
              <button
                type="button"
                className={`tree-item root ${rootSelected ? "selected" : ""} ${
                  rootDropTarget ? "drop-target" : ""
                }`}
                onContextMenu={(event) => openTreeContextMenu(event, workspace.rootPath, "directory")}
                onDragOver={(event) => handleTreeDragOver(event, workspace.rootPath)}
                onDragLeave={(event) => handleTreeDragLeave(event, workspace.rootPath)}
                onDrop={(event) => handleTreeDrop(event, workspace.rootPath)}
                onClick={() => {
                  setSelectedTreePath(workspace.rootPath);
                  setSelectedTreeKind("directory");
                  closeTreeContextMenu();

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

          {treeContextMenu ? (
            <div
              ref={treeContextMenuRef}
              className="tree-context-menu"
              role="menu"
              style={{ top: `${treeContextMenu.y}px`, left: `${treeContextMenu.x}px` }}
            >
              {treeContextMenu.kind === "directory" ? (
                <>
                  <button
                    type="button"
                    className="tree-context-item"
                    role="menuitem"
                    onClick={() =>
                      runTreeContextAction(() =>
                        promptCreateNode("file", treeContextMenu.path, treeContextMenu.kind),
                      )}
                  >
                    <FilePlus2 size={14} />
                    <span>新建文件</span>
                  </button>
                  <button
                    type="button"
                    className="tree-context-item"
                    role="menuitem"
                    onClick={() =>
                      runTreeContextAction(() =>
                        promptCreateNode("directory", treeContextMenu.path, treeContextMenu.kind),
                      )}
                  >
                    <FolderPlus size={14} />
                    <span>新建文件夹</span>
                  </button>
                  {!contextMenuOnRoot ? <div className="tree-context-separator" /> : null}
                </>
              ) : null}

              {!contextMenuOnRoot ? (
                <button
                  type="button"
                  className="tree-context-item"
                  role="menuitem"
                  onClick={() =>
                    runTreeContextAction(() => handleRenameTreePath(treeContextMenu.path, treeContextMenu.kind))}
                >
                  <Pencil size={14} />
                  <span>重命名</span>
                </button>
              ) : null}

              {!contextMenuOnRoot ? (
                <button
                  type="button"
                  className="tree-context-item danger"
                  role="menuitem"
                  onClick={() =>
                    runTreeContextAction(() => handleDeleteTreePath(treeContextMenu.path, treeContextMenu.kind))}
                >
                  <Trash2 size={14} />
                  <span>删除</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </aside>

        <div
          className="explorer-resizer"
          role="separator"
          aria-label="调整文件树宽度"
          aria-orientation="vertical"
          onPointerDown={handleExplorerResizeStart}
          onPointerMove={handleExplorerResizeMove}
          onPointerUp={handleExplorerResizeEnd}
          onPointerCancel={handleExplorerResizeEnd}
        />

        <section className="main-panel">
          <section className="editor-panel">
            <div className="tab-strip">
              <div className="tab-strip-scroll">
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`tab-item ${isFileTabActive && tab.id === activeTabId ? "active" : ""}`}
                  >
                    <button
                      type="button"
                      className="tab-button"
                      onClick={() => {
                        setActiveWorkbenchTabKind("file");
                        setActiveTabId(tab.id);
                      }}
                    >
                      {tab.title}
                      {tabIsDirty(tab) ? " *" : ""}
                    </button>
                    <button type="button" className="tab-close" onClick={() => closeTab(tab.id)}>
                      <X size={14} className="tab-close-icon" />
                    </button>
                  </div>
                ))}

                {terminals.map((session) => (
                  <div
                    key={session.id}
                    className={`tab-item terminal ${
                      activeWorkbenchTabKind === "terminal" && session.id === activeTerminalId ? "active" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="tab-button terminal"
                      onClick={() => void selectTerminal(session.id)}
                      title={session.cwd}
                    >
                      <span className={`tab-dot ${session.status === "running" ? "running" : "stopped"}`} />
                      <span className="tab-title-text">{session.title}</span>
                    </button>
                    <button type="button" className="tab-close" onClick={() => void closeTerminalTab(session.id)}>
                      <X size={14} className="tab-close-icon" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="tab-strip-actions">
                <button
                  type="button"
                  className="tab-add"
                  title="新建终端"
                  aria-label="新建终端"
                  onClick={() => void createTerminalSession()}
                >
                  <FileTerminal size={13} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="editor-surface">
              {isFileTabActive && activeTab ? (
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
                    fontFamily: CODE_FONT_FAMILY,
                    fontSize: CODE_FONT_SIZE,
                    lineHeight: CODE_LINE_HEIGHT,
                    tabSize: 2,
                    insertSpaces: true,
                    wordWrap: "on",
                    renderWhitespace: "selection",
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                  }}
                />
              ) : isFileTabActive ? (
                <div className="empty-state">
                  <h3>Ready for coding</h3>
                  <p>Open a file from the explorer to start editing. Use + to add terminal tabs.</p>
                </div>
              ) : null}

              <div className={`terminal-surface ${activeWorkbenchTabKind === "terminal" ? "active" : ""}`}>
                <div ref={terminalHostRef} className="terminal-host" />
              </div>
            </div>
          </section>
        </section>
      </div>

      <footer className="statusbar">
        <div className="statusbar-section statusbar-left">
          <span className="statusbar-icon" aria-hidden="true">
            <Info size={13} />
          </span>
          <span>{statusMessage || "Ready"}</span>
        </div>

        <div className="statusbar-section statusbar-center">
          <span className="statusbar-path">{contextPath || workspace?.rootPath || "No workspace"}</span>
        </div>

        <div className="statusbar-section statusbar-right">
          <span
            className="statusbar-chip"
            title={activeWorkbenchTabKind === "terminal" ? "终端模式" : "编辑模式"}
            aria-label={activeWorkbenchTabKind === "terminal" ? "终端模式" : "编辑模式"}
          >
            {activeWorkbenchTabKind === "terminal" ? (
              <FileTerminal size={12} aria-hidden="true" />
            ) : (
              <FileCode size={12} aria-hidden="true" />
            )}
          </span>
          {activeTab ? (
            <span className="statusbar-chip" title={activeTab.language} aria-label={activeTab.language}>
              <File size={12} aria-hidden="true" />
            </span>
          ) : null}
          {activeTab ? (
            <span
              className={`statusbar-chip ${activeTabDirty ? "warning" : ""}`}
              title={activeTabDirty ? "未保存" : "已保存"}
              aria-label={activeTabDirty ? "未保存" : "已保存"}
            >
              {activeTabDirty ? (
                <FilePenLine size={12} aria-hidden="true" />
              ) : (
                <Save size={12} aria-hidden="true" />
              )}
            </span>
          ) : null}
          {activeWorkbenchTabKind === "terminal" && activeTerminal ? (
            <span
              className={`statusbar-chip ${activeTerminal.status === "running" ? "" : "warning"}`}
              title={activeTerminal.status === "running" ? "终端运行中" : "终端已停止"}
              aria-label={activeTerminal.status === "running" ? "终端运行中" : "终端已停止"}
            >
              <FileTerminal size={12} aria-hidden="true" />
            </span>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

export default App;
