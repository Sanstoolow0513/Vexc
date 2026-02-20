import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
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
  AArrowDown,
  AArrowUp,
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
  Minus,
  Pencil,
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
  gitBranches,
  gitCheckout,
  gitCommit,
  gitDiff,
  gitDiscard,
  gitPull,
  gitPush,
  gitRepoStatus,
  gitStage,
  gitUnstage,
  gitChanges as listGitChanges,
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
  EditorDiagnostic,
  EditorTab,
  FeedbackLevel,
  LspMessageEvent,
  FileKind,
  FileNode,
  GitBranchSnapshot,
  GitChange,
  GitCommitResult,
  GitRepoStatus,
  MovePathErrorCode,
  OutputLevel,
  StatusBarFileInfo,
  StatusBarTerminalInfo,
  SignalsPanelTab,
  ToastNotification,
  TerminalOutputEvent,
  TerminalSession,
  TerminalSessionSnapshot,
  WorkspaceInfo,
} from "./types";
import {
  type DropValidationResult,
  type TreeDragSource,
  type TreeDropRejectionReason,
  useTreeDragDrop,
} from "./features/explorer/useTreeDragDrop";
import { HeaderSignals } from "./components/HeaderSignals";
import { StatusBar } from "./components/StatusBar";
import { SignalsPanel } from "./components/SignalsPanel";
import { ToastViewport } from "./components/ToastViewport";
import { createRustLspClient } from "./editor/lsp/rustLspClient";
import { MONACO_THEME_NAME, mountMonacoEditor } from "./editor/monacoSetup";
import {
  appendOutputEntry,
  buildSignalState,
  clearOutputEntries,
  createInitialOutputStoreState,
  inferOutputLevelFromMessage,
  setOutputPanelOpen,
  setOutputPanelTab,
} from "./editor/outputStore";
import { detectLanguage, fileNameFromPath } from "./utils";
import "./App.css";
import "./ide-layout-refresh.css";

const WORKSPACE_STORAGE_KEY = "vexc.workspacePath";
const FONT_SIZE_STORAGE_KEY = "vexc.fontSize";

type HeaderMenuId = "file";

const DEFAULT_FONT_SIZE = 13;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;
const CODE_FONT_FAMILY = '"JetBrains Mono", "Cascadia Code", Consolas, monospace';
const CODE_FONT_SIZE = 13;
const CODE_LINE_HEIGHT = 18;
const CODE_LINE_HEIGHT_RATIO = CODE_LINE_HEIGHT / CODE_FONT_SIZE;
const TERMINAL_LINE_HEIGHT_RATIO = 1;
const MAX_TERMINAL_BUFFER_CHARS = 1024 * 1024;
const EXPLORER_DEFAULT_WIDTH = 288;
const EXPLORER_MIN_WIDTH = 220;
const EXPLORER_RESIZER_WIDTH = 4;
const EXPLORER_MAIN_PANEL_MIN_WIDTH = 360;
const TREE_POINTER_DRAG_THRESHOLD_PX = 6;
const MAX_VISIBLE_TOASTS = 4;
const DEFAULT_TOAST_DURATION_MS = 3400;

const TOAST_DURATION_MS_BY_LEVEL: Record<FeedbackLevel, number> = {
  success: 2800,
  info: DEFAULT_TOAST_DURATION_MS,
  warning: 4500,
  error: 6000,
};

function clampTerminalBuffer(value: string): string {
  if (value.length <= MAX_TERMINAL_BUFFER_CHARS) {
    return value;
  }
  return value.slice(value.length - MAX_TERMINAL_BUFFER_CHARS);
}

const DEFAULT_TERMINAL_THEME: ITheme = {
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
};

function readStoredFontSize(): number {
  const stored = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
  const size = stored ? Number.parseInt(stored, 10) : DEFAULT_FONT_SIZE;
  return Number.isFinite(size) && size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE ? size : DEFAULT_FONT_SIZE;
}

interface PendingPosition {
  tabId: string;
  line: number;
  column: number;
}

type WorkbenchTabKind = "file" | "terminal";
type SidebarView = "explorer" | "scm";

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

interface TreeInlineCreateState {
  id: number;
  mode: "create-file" | "create-directory";
  targetDirectoryPath: string;
  value: string;
}

interface TreeInlineRenameState {
  id: number;
  mode: "rename";
  targetPath: string;
  targetKind: FileKind;
  originalName: string;
  value: string;
}

type TreeInlineEditState = TreeInlineCreateState | TreeInlineRenameState;

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
  const candidate = trimmed || normalized;
  const isWindowsPath = /^[a-zA-Z]:\//.test(candidate) || candidate.startsWith("//");
  return isWindowsPath ? candidate.toLowerCase() : candidate;
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

function replacePathPrefix(path: string, previousPrefix: string, nextPrefix: string): string {
  if (!isSameOrDescendantPath(path, previousPrefix)) {
    return path;
  }

  // Preserve the original suffix casing from the source path.
  const prevLen = previousPrefix.length;
  let suffixStart = prevLen;

  if (suffixStart < path.length && (path[suffixStart] === "/" || path[suffixStart] === "\\")) {
    suffixStart++;
  }

  const originalSuffix = path.substring(suffixStart);
  const separator = inferPathSeparator(nextPrefix);
  let result = nextPrefix;

  if (originalSuffix) {
    if (
      !nextPrefix.endsWith("/") &&
      !nextPrefix.endsWith("\\") &&
      !originalSuffix.startsWith("/") &&
      !originalSuffix.startsWith("\\")
    ) {
      result += separator;
    }
    result += originalSuffix;
  }

  return result;
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

const MOVE_PATH_ERROR_MESSAGES: Record<MovePathErrorCode, string> = {
  MOVE_SOURCE_IS_ROOT: "不能移动工作区根目录。",
  MOVE_TARGET_NOT_DIRECTORY: "拖拽目标不是文件夹。",
  MOVE_TARGET_EXISTS: "目标位置已存在同名文件或文件夹。",
  MOVE_TARGET_INSIDE_SOURCE: "不能将文件夹移动到其自身内部。",
  MOVE_IO_ERROR: "移动失败：文件系统操作出错。",
};

function parseMovePathErrorCode(error: unknown): MovePathErrorCode | null {
  const message = String(error ?? "");
  if (message.startsWith("MOVE_SOURCE_IS_ROOT")) {
    return "MOVE_SOURCE_IS_ROOT";
  }
  if (message.startsWith("MOVE_TARGET_NOT_DIRECTORY")) {
    return "MOVE_TARGET_NOT_DIRECTORY";
  }
  if (message.startsWith("MOVE_TARGET_EXISTS")) {
    return "MOVE_TARGET_EXISTS";
  }
  if (message.startsWith("MOVE_TARGET_INSIDE_SOURCE")) {
    return "MOVE_TARGET_INSIDE_SOURCE";
  }
  if (message.startsWith("MOVE_IO_ERROR")) {
    return "MOVE_IO_ERROR";
  }

  return null;
}

function toDropValidationResult(reason: TreeDropRejectionReason | null): DropValidationResult {
  if (!reason) {
    return { ok: true, reason: null };
  }

  return { ok: false, reason };
}

function relativePathWithinWorkspace(path: string, workspaceRootPath: string): string {
  if (!isSameOrDescendantPath(path, workspaceRootPath)) {
    return fileNameFromPath(path);
  }

  let suffix = path.slice(workspaceRootPath.length);
  suffix = suffix.replace(/^[\\/]+/, "");
  return suffix || fileNameFromPath(path);
}

function labelForGitChange(change: GitChange): string {
  if (change.untracked) {
    return "U";
  }

  const code = change.statusCode.trim();
  if (code) {
    return code;
  }

  return "M";
}

function summaryFromGitCommitResult(result: GitCommitResult): string {
  if (result.summary.trim()) {
    return result.summary.trim();
  }

  if (result.commitHash) {
    return `Committed ${result.commitHash}`;
  }

  return "Commit created.";
}

const DIAGNOSTIC_SEVERITY_ORDER: Record<EditorDiagnostic["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

const OUTPUT_LEVEL_ORDER: Record<OutputLevel, number> = {
  error: 0,
  warning: 1,
  info: 2,
  debug: 3,
};

function markerSeverityToDiagnosticSeverity(severity: number): EditorDiagnostic["severity"] {
  switch (severity) {
    case 8:
      return "error";
    case 4:
      return "warning";
    case 2:
      return "info";
    case 1:
      return "hint";
    default:
      return "warning";
  }
}

const SUCCESS_STATUS_PATTERNS: RegExp[] = [
  /\b(saved?|opened?|created?|renamed?|deleted?|moved?|staged|unstaged|committed?|checked out|completed|ready|applied)\b/i,
  /成功|完成|已(创建|打开|保存|重命名|删除|移动)/,
];

function inferFeedbackLevelFromStatus(
  message: string,
  outputLevel: OutputLevel,
): FeedbackLevel {
  if (outputLevel === "error") {
    return "error";
  }

  if (outputLevel === "warning") {
    return "warning";
  }

  if (SUCCESS_STATUS_PATTERNS.some((pattern) => pattern.test(message))) {
    return "success";
  }

  return "info";
}

function shouldShowToastForStatus(message: string, outputLevel: OutputLevel): boolean {
  if (outputLevel === "debug") {
    return false;
  }

  return !message.trim().endsWith("...");
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

type FileIconThemeId = "vscode-colored" | "vscode-minimal";

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
  const activeTabIdRef = useRef<string | null>(null);
  const tabsRef = useRef<EditorTab[]>([]);
  const saveInFlightByTabRef = useRef<Record<string, Promise<void>>>({});
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
  const [statusMessage, setStatusMessageState] = useState("Ready");
  const [statusLevel, setStatusLevel] = useState<FeedbackLevel>("info");
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const [outputState, setOutputState] = useState(() => createInitialOutputStoreState());
  const [outputLevelFilter, setOutputLevelFilter] = useState<OutputLevel | "all">("all");
  const [monacoDiagnosticsByPath, setMonacoDiagnosticsByPath] = useState<Record<string, EditorDiagnostic[]>>({});
  const [lspDiagnosticsByPath, setLspDiagnosticsByPath] = useState<Record<string, EditorDiagnostic[]>>({});
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isExplorerVisible, setIsExplorerVisible] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(EXPLORER_DEFAULT_WIDTH);
  const [isExplorerResizing, setIsExplorerResizing] = useState(false);
  const [sidebarView, setSidebarView] = useState<SidebarView>("explorer");
  const [activeWorkbenchTabKind, setActiveWorkbenchTabKind] = useState<WorkbenchTabKind>("file");
  const [fontSize, setFontSize] = useState<number>(() => readStoredFontSize());
  const [activeHeaderMenuId, setActiveHeaderMenuId] = useState<HeaderMenuId | null>(null);
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [selectedTreeKind, setSelectedTreeKind] = useState<FileKind | null>(null);
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState | null>(null);
  const [treeInlineEdit, setTreeInlineEdit] = useState<TreeInlineEditState | null>(null);
  const [isTreeInlineEditSubmitting, setIsTreeInlineEditSubmitting] = useState(false);
  const [gitRepo, setGitRepo] = useState<GitRepoStatus | null>(null);
  const [gitChangesState, setGitChangesState] = useState<GitChange[]>([]);
  const [gitBranchState, setGitBranchState] = useState<GitBranchSnapshot>({
    currentBranch: null,
    branches: [],
  });
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [gitSelectedDiffPath, setGitSelectedDiffPath] = useState<string | null>(null);
  const [gitSelectedDiffStaged, setGitSelectedDiffStaged] = useState(false);
  const [gitDiffText, setGitDiffText] = useState("");
  const [isGitRefreshing, setIsGitRefreshing] = useState(false);
  const [gitLoadingByAction, setGitLoadingByAction] = useState<Record<string, boolean>>({});

  const appWindow = useMemo(() => getCurrentWindow(), []);

  const monacoEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoApiRef = useRef<typeof import("monaco-editor") | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const treeContextMenuRef = useRef<HTMLDivElement | null>(null);
  const treeInlineInputRef = useRef<HTMLInputElement | null>(null);
  const workbenchGridRef = useRef<HTMLDivElement | null>(null);
  const signalsPanelRef = useRef<HTMLElement | null>(null);
  const explorerResizePointerIdRef = useRef<number | null>(null);
  const explorerLastVisibleWidthRef = useRef(EXPLORER_DEFAULT_WIDTH);
  const treeInlineEditIdRef = useRef(0);
  const toastTimeoutByIdRef = useRef<Record<string, number>>({});
  const rustLspVersionByPathRef = useRef<Record<string, number>>({});
  const rustLspLastPathRef = useRef<string | null>(null);
  const rustLspClientRef = useRef<ReturnType<typeof createRustLspClient> | null>(null);

  const {
    dndState: treeDnDState,
    consumeClickSuppression: consumeTreeDragClickSuppression,
    clearTreeDragDropState,
    handleTreePointerDown,
  } = useTreeDragDrop({
    dragThresholdPx: TREE_POINTER_DRAG_THRESHOLD_PX,
    isSamePath,
    validateDrop: (source, targetDirectoryPath) =>
      toDropValidationResult(getTreeDropRejectionReason(source, targetDirectoryPath)),
    onDrop: (source, targetDirectoryPath) => handleMoveTreePath(source, targetDirectoryPath),
    onDragStart: () => {
      closeTreeContextMenu();
    },
  });

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );
  const isFileTabActive = activeWorkbenchTabKind === "file";
  const activeFileTab = isFileTabActive ? activeTab : null;
  const hasDirtyTabs = useMemo(
    () => tabs.some((tab) => tab.content !== tab.savedContent),
    [tabs],
  );

  const appendOutput = useCallback((
    message: string,
    level: OutputLevel,
    channel: "system" | "lsp" | "terminal" | "workspace",
    options?: {
      dedupeKey?: string;
      path?: string;
      line?: number;
      column?: number;
    },
  ) => {
    setOutputState((previous) =>
      appendOutputEntry(previous, {
        channel,
        level,
        message,
        dedupeKey: options?.dedupeKey,
        path: options?.path,
        line: options?.line,
        column: options?.column,
      }),
    );
  }, []);

  const dismissToast = useCallback((id: string) => {
    const timeoutId = toastTimeoutByIdRef.current[id];
    if (typeof timeoutId === "number") {
      window.clearTimeout(timeoutId);
      delete toastTimeoutByIdRef.current[id];
    }

    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((
    message: string,
    level: FeedbackLevel,
    durationMs?: number,
  ) => {
    const resolvedDurationMs = Math.max(
      1200,
      durationMs ?? TOAST_DURATION_MS_BY_LEVEL[level] ?? DEFAULT_TOAST_DURATION_MS,
    );
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setToasts((previous) => [
      ...previous.slice(-(MAX_VISIBLE_TOASTS - 1)),
      {
        id,
        level,
        message,
        createdAt: Date.now(),
        durationMs: resolvedDurationMs,
      },
    ]);

    const timeoutId = window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
      delete toastTimeoutByIdRef.current[id];
    }, resolvedDurationMs);
    toastTimeoutByIdRef.current[id] = timeoutId;
  }, []);

  const setStatusMessage = useCallback((
    message: string,
    level?: OutputLevel,
    channel: "system" | "lsp" | "terminal" | "workspace" = "system",
    options?: {
      feedbackLevel?: FeedbackLevel;
      toastDurationMs?: number;
      showToast?: boolean;
    },
  ) => {
    const resolvedOutputLevel = level ?? inferOutputLevelFromMessage(message);
    const resolvedFeedbackLevel = options?.feedbackLevel ?? inferFeedbackLevelFromStatus(
      message,
      resolvedOutputLevel,
    );
    setStatusMessageState(message);
    setStatusLevel(resolvedFeedbackLevel);
    appendOutput(message, resolvedOutputLevel, channel, {
      dedupeKey: `${channel}:${message}`,
    });
    const shouldShowToast = options?.showToast ?? shouldShowToastForStatus(message, resolvedOutputLevel);
    if (shouldShowToast) {
      pushToast(message, resolvedFeedbackLevel, options?.toastDurationMs);
    }
  }, [appendOutput, pushToast]);

  const syncActiveMonacoDiagnostics = useCallback(() => {
    const monacoApi = monacoApiRef.current;
    const editor = monacoEditorRef.current;
    const model = editor?.getModel();
    if (!monacoApi || !editor || !model || !activeTab) {
      return;
    }

    const markers = monacoApi.editor.getModelMarkers({ resource: model.uri });
    const mapped: EditorDiagnostic[] = markers
      .filter((marker) => marker.owner !== "vexc-rust-lsp")
      .map((marker, index) => ({
        id: `marker:${activeTab.path}:${marker.startLineNumber}:${marker.startColumn}:${index}`,
        path: activeTab.path,
        line: marker.startLineNumber,
        column: marker.startColumn,
        severity: markerSeverityToDiagnosticSeverity(marker.severity),
        source: marker.source ?? "monaco",
        message: marker.message,
        code: marker.code ? String(marker.code) : null,
      }));

    const key = normalizePathForComparison(activeTab.path);
    setMonacoDiagnosticsByPath((previous) => ({
      ...previous,
      [key]: mapped,
    }));
  }, [activeTab]);

  const applyRustLspMarkers = useCallback(() => {
    const monacoApi = monacoApiRef.current;
    const editor = monacoEditorRef.current;
    const model = editor?.getModel();
    if (!monacoApi || !editor || !model || !activeTab) {
      return;
    }

    const diagnostics = lspDiagnosticsByPath[normalizePathForComparison(activeTab.path)] ?? [];
    const markers = diagnostics.map((diagnostic) => ({
      severity:
        diagnostic.severity === "error"
          ? monacoApi.MarkerSeverity.Error
          : diagnostic.severity === "warning"
            ? monacoApi.MarkerSeverity.Warning
            : diagnostic.severity === "info"
              ? monacoApi.MarkerSeverity.Info
              : monacoApi.MarkerSeverity.Hint,
      message: diagnostic.message,
      source: diagnostic.source,
      code: diagnostic.code ?? undefined,
      startLineNumber: diagnostic.line,
      startColumn: diagnostic.column,
      endLineNumber: diagnostic.line,
      endColumn: diagnostic.column + 1,
    }));

    monacoApi.editor.setModelMarkers(model, "vexc-rust-lsp", markers);
  }, [activeTab, lspDiagnosticsByPath]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

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
    return () => {
      const timeoutIds = Object.values(toastTimeoutByIdRef.current);
      timeoutIds.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      toastTimeoutByIdRef.current = {};
    };
  }, []);

  useEffect(() => {
    // 设置默认暗色主题
    document.documentElement.setAttribute("data-color-theme", "dark-plus");
  }, []);

  useEffect(() => {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));

    const monacoApi = monacoApiRef.current;
    const editor = monacoEditorRef.current;
    if (monacoApi && editor) {
      try {
        const lineHeight = Math.round(fontSize * CODE_LINE_HEIGHT_RATIO);
        editor.updateOptions({
          fontSize: fontSize,
          lineHeight: lineHeight,
        });
      } catch (error) {
        setStatusMessage(`Failed to apply font size: ${String(error)}`);
      }
    }

    // Also update the terminal font size if terminal is initialized
    const terminal = terminalRef.current;
    if (terminal) {
      try {
        terminal.options.fontSize = fontSize;
        // Trigger a resize to ensure the terminal adapts to the new font size
        setTimeout(() => {
          fitAddonRef.current?.fit();
        }, 0);
      } catch (error) {
        setStatusMessage(`Failed to apply terminal font size: ${String(error)}`);
      }
    }
  }, [fontSize]);

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
    if (!outputState.panelOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (target instanceof Element && target.closest(".signals-trigger")) {
        return;
      }
      if (signalsPanelRef.current?.contains(target)) {
        return;
      }
      closeSignalsPanel();
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      closeSignalsPanel();
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeSignalsPanel, outputState.panelOpen]);

  useEffect(() => {
    if (!treeInlineEdit) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const input = treeInlineInputRef.current;
      if (!input) {
        return;
      }

      input.focus();
      if (treeInlineEdit.mode === "rename") {
        input.select();
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [treeInlineEdit?.id]);

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

  const problems = useMemo(() => {
    const all = [
      ...Object.values(monacoDiagnosticsByPath).flat(),
      ...Object.values(lspDiagnosticsByPath).flat(),
    ];

    all.sort((left, right) => {
      const severityCompare = DIAGNOSTIC_SEVERITY_ORDER[left.severity] - DIAGNOSTIC_SEVERITY_ORDER[right.severity];
      if (severityCompare !== 0) {
        return severityCompare;
      }
      const pathCompare = left.path.localeCompare(right.path);
      if (pathCompare !== 0) {
        return pathCompare;
      }
      if (left.line !== right.line) {
        return left.line - right.line;
      }
      return left.column - right.column;
    });

    return all;
  }, [lspDiagnosticsByPath, monacoDiagnosticsByPath]);

  const problemErrorCount = useMemo(
    () => problems.filter((problem) => problem.severity === "error").length,
    [problems],
  );
  const problemWarningCount = useMemo(
    () => problems.filter((problem) => problem.severity === "warning").length,
    [problems],
  );

  const visibleOutputEntries = useMemo(() => {
    const entries = [...outputState.entries];
    entries.sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return right.timestamp - left.timestamp;
      }
      return OUTPUT_LEVEL_ORDER[left.level] - OUTPUT_LEVEL_ORDER[right.level];
    });
    if (outputLevelFilter === "all") {
      return entries;
    }
    return entries.filter((entry) => entry.level === outputLevelFilter);
  }, [outputLevelFilter, outputState.entries]);

  const signalState = useMemo(
    () => buildSignalState(outputState, problemErrorCount, problemWarningCount),
    [outputState, problemErrorCount, problemWarningCount],
  );
  const gitStagedChanges = useMemo(
    () => gitChangesState.filter((change) => change.staged),
    [gitChangesState],
  );
  const gitUnstagedChanges = useMemo(
    () => gitChangesState.filter((change) => change.unstaged && !change.untracked),
    [gitChangesState],
  );
  const gitUntrackedChanges = useMemo(
    () => gitChangesState.filter((change) => change.untracked),
    [gitChangesState],
  );
  const isGitActionPending = useMemo(
    () => Object.values(gitLoadingByAction).some((value) => value),
    [gitLoadingByAction],
  );
  const activeTerminalSession = useMemo(
    () => terminals.find((session) => session.id === activeTerminalId) ?? null,
    [terminals, activeTerminalId],
  );
  const statusBarFileInfo = useMemo<StatusBarFileInfo | null>(() => {
    if (!activeFileTab) {
      return null;
    }

    const relativePath = workspace
      ? relativePathWithinWorkspace(activeFileTab.path, workspace.rootPath)
      : activeFileTab.path;
    return {
      title: activeFileTab.title,
      path: relativePath,
      language: activeFileTab.language,
      isDirty: tabIsDirty(activeFileTab),
    };
  }, [activeFileTab, workspace]);
  const statusBarTerminalInfo = useMemo<StatusBarTerminalInfo | null>(() => {
    if (!activeTerminalSession) {
      return null;
    }

    return {
      title: activeTerminalSession.title,
      cwd: activeTerminalSession.cwd,
      status: activeTerminalSession.status,
    };
  }, [activeTerminalSession]);

  useEffect(() => {
    const client = createRustLspClient({
      onDiagnostics: (path, diagnostics) => {
        const key = normalizePathForComparison(path);
        setLspDiagnosticsByPath((previous) => ({
          ...previous,
          [key]: diagnostics,
        }));
      },
      onOutput: (entry) => {
        appendOutput(entry.message, entry.level, entry.channel, {
          dedupeKey: entry.dedupeKey,
        });
      },
    });

    rustLspClientRef.current = client;

    return () => {
      void client.stop();
      rustLspClientRef.current = null;
    };
  }, [appendOutput]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    void listen<LspMessageEvent>("lsp://message", (event) => {
      rustLspClientRef.current?.handleMessage(event.payload);
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
    const client = rustLspClientRef.current;
    if (!client) {
      return;
    }

    if (!workspace || activeWorkbenchTabKind !== "file" || !activeTab || activeTab.language !== "rust") {
      const previousPath = rustLspLastPathRef.current;
      if (previousPath) {
        void client.closeDocument(previousPath);
        rustLspLastPathRef.current = null;
      }
      return;
    }

    const run = async () => {
      const started = await client.ensureStarted(workspace.rootPath);
      if (!started) {
        return;
      }

      const previousPath = rustLspLastPathRef.current;
      if (previousPath && !isSamePath(previousPath, activeTab.path)) {
        await client.closeDocument(previousPath);
      }

      const key = normalizePathForComparison(activeTab.path);
      const nextVersion = (rustLspVersionByPathRef.current[key] ?? 0) + 1;
      rustLspVersionByPathRef.current[key] = nextVersion;

      await client.syncDocument(activeTab.path, activeTab.content, nextVersion);
      rustLspLastPathRef.current = activeTab.path;
    };

    void run();
  }, [activeTab, activeWorkbenchTabKind, workspace]);

  useEffect(() => {
    const monacoApi = monacoApiRef.current;
    const editor = monacoEditorRef.current;
    const model = editor?.getModel();
    if (!monacoApi || !editor || !model || !activeTab) {
      return;
    }

    syncActiveMonacoDiagnostics();
    applyRustLspMarkers();

    const modelUri = model.uri.toString();
    const disposable = monacoApi.editor.onDidChangeMarkers((resources) => {
      if (resources.some((resource) => resource.toString() === modelUri)) {
        syncActiveMonacoDiagnostics();
      }
    });

    return () => {
      disposable.dispose();
    };
  }, [activeTab, applyRustLspMarkers, editorReadySeq, syncActiveMonacoDiagnostics]);

  function tabIsDirty(tab: EditorTab): boolean {
    return tab.content !== tab.savedContent;
  }

  function resetGitState(): void {
    setGitRepo(null);
    setGitChangesState([]);
    setGitBranchState({
      currentBranch: null,
      branches: [],
    });
    setGitCommitMessage("");
    setGitSelectedDiffPath(null);
    setGitSelectedDiffStaged(false);
    setGitDiffText("");
  }

  function setGitActionLoading(actionKey: string, loading: boolean): void {
    setGitLoadingByAction((previous) => ({
      ...previous,
      [actionKey]: loading,
    }));
  }

  async function refreshGitState(showErrors = true): Promise<void> {
    if (!workspace) {
      resetGitState();
      return;
    }

    setIsGitRefreshing(true);
    setGitActionLoading("refresh", true);
    try {
      const [repo, changes, branches] = await Promise.all([
        gitRepoStatus(),
        listGitChanges(),
        gitBranches(),
      ]);

      setGitRepo(repo);
      setGitChangesState(changes);
      setGitBranchState(branches);

      if (!repo.isRepo) {
        setGitSelectedDiffPath(null);
        setGitSelectedDiffStaged(false);
        setGitDiffText("");
        return;
      }

      if (
        gitSelectedDiffPath
        && !changes.some((change) => isSamePath(change.path, gitSelectedDiffPath))
      ) {
        setGitSelectedDiffPath(null);
        setGitSelectedDiffStaged(false);
        setGitDiffText("");
      }
    } catch (error) {
      if (showErrors) {
        setStatusMessage(`Failed to refresh Git state: ${String(error)}`);
      }
    } finally {
      setIsGitRefreshing(false);
      setGitActionLoading("refresh", false);
    }
  }

  async function loadGitDiffPreview(path: string, staged: boolean): Promise<void> {
    if (!workspace || !gitRepo?.isRepo) {
      return;
    }

    setGitActionLoading("diff", true);
    try {
      const result = await gitDiff(path, staged);
      setGitSelectedDiffPath(path);
      setGitSelectedDiffStaged(staged);
      setGitDiffText(result.diff || "No diff content for this file.");
    } catch (error) {
      setStatusMessage(`Failed to load diff: ${String(error)}`);
    } finally {
      setGitActionLoading("diff", false);
    }
  }

  async function stageGitPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    setGitActionLoading("stage", true);
    try {
      await gitStage(paths);
      await refreshGitState(false);
      if (gitSelectedDiffPath) {
        await loadGitDiffPreview(gitSelectedDiffPath, gitSelectedDiffStaged);
      }
      setStatusMessage(`Staged ${paths.length} path(s).`);
    } catch (error) {
      setStatusMessage(`Failed to stage changes: ${String(error)}`);
    } finally {
      setGitActionLoading("stage", false);
    }
  }

  async function unstageGitPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    setGitActionLoading("unstage", true);
    try {
      await gitUnstage(paths);
      await refreshGitState(false);
      if (gitSelectedDiffPath) {
        await loadGitDiffPreview(gitSelectedDiffPath, gitSelectedDiffStaged);
      }
      setStatusMessage(`Unstaged ${paths.length} path(s).`);
    } catch (error) {
      setStatusMessage(`Failed to unstage changes: ${String(error)}`);
    } finally {
      setGitActionLoading("unstage", false);
    }
  }

  async function discardGitPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Discard changes for ${paths.length} path(s)? This cannot be undone.`,
    );
    if (!confirmed) {
      return;
    }

    setGitActionLoading("discard", true);
    try {
      await gitDiscard(paths);
      await refreshGitState(false);
      if (gitSelectedDiffPath) {
        await loadGitDiffPreview(gitSelectedDiffPath, gitSelectedDiffStaged);
      }
      setStatusMessage(`Discarded ${paths.length} path(s).`);
    } catch (error) {
      setStatusMessage(`Failed to discard changes: ${String(error)}`);
    } finally {
      setGitActionLoading("discard", false);
    }
  }

  async function handleGitCommitSubmit(): Promise<void> {
    const message = gitCommitMessage.trim();
    if (!message) {
      setStatusMessage("Commit message cannot be empty.");
      return;
    }

    setGitActionLoading("commit", true);
    try {
      const result = await gitCommit(message);
      setGitCommitMessage("");
      await refreshGitState(false);
      setStatusMessage(summaryFromGitCommitResult(result));
    } catch (error) {
      setStatusMessage(`Commit failed: ${String(error)}`);
    } finally {
      setGitActionLoading("commit", false);
    }
  }

  async function handleGitCheckoutBranch(branchName: string): Promise<void> {
    if (!branchName || (gitBranchState.currentBranch && branchName === gitBranchState.currentBranch)) {
      return;
    }

    setGitActionLoading("checkout", true);
    try {
      await gitCheckout(branchName, false);
      await refreshGitState(false);
      setStatusMessage(`Checked out ${branchName}.`);
    } catch (error) {
      setStatusMessage(`Failed to checkout branch: ${String(error)}`);
    } finally {
      setGitActionLoading("checkout", false);
    }
  }

  async function handleGitPullAction(): Promise<void> {
    setGitActionLoading("pull", true);
    try {
      const result = await gitPull();
      await refreshGitState(false);
      setStatusMessage(result.stdout.trim() || "Git pull completed.");
    } catch (error) {
      setStatusMessage(`Git pull failed: ${String(error)}`);
    } finally {
      setGitActionLoading("pull", false);
    }
  }

  async function handleGitPushAction(): Promise<void> {
    setGitActionLoading("push", true);
    try {
      const result = await gitPush();
      await refreshGitState(false);
      setStatusMessage(result.stdout.trim() || "Git push completed.");
    } catch (error) {
      setStatusMessage(`Git push failed: ${String(error)}`);
    } finally {
      setGitActionLoading("push", false);
    }
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

  function activateSidebarView(view: SidebarView): void {
    setSidebarView(view);
    closeTreeContextMenu();
    if (!isExplorerVisible) {
      showExplorerPanel();
    }
    if (view === "scm" && workspace) {
      void refreshGitState(false);
    }
  }

  function adjustFontSize(delta: number): void {
    setFontSize((previous) => Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, previous + delta)));
  }

  function toggleSignalsPanel(): void {
    setOutputState((previous) => {
      const nextPanelOpen = !previous.panelOpen;
      let next = setOutputPanelOpen(previous, nextPanelOpen);
      if (nextPanelOpen && problems.length > 0) {
        next = setOutputPanelTab(next, "problems");
      }
      return next;
    });
  }

  function closeSignalsPanel(): void {
    setOutputState((previous) => setOutputPanelOpen(previous, false));
    monacoEditorRef.current?.focus();
  }

  function selectSignalsTab(tab: SignalsPanelTab): void {
    setOutputState((previous) => setOutputPanelTab(previous, tab));
  }

  function clearSignalOutputs(): void {
    setOutputState((previous) => clearOutputEntries(previous));
  }

  function jumpToProblem(problem: EditorDiagnostic): void {
    closeSignalsPanel();
    void openFile(problem.path, { line: problem.line, column: problem.column });
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
      const nodes = await listDirectory(path, true);
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

    setMonacoDiagnosticsByPath((previous) => {
      const next: Record<string, EditorDiagnostic[]> = {};
      for (const [key, diagnostics] of Object.entries(previous)) {
        const mappedKey = replacePathPrefix(key, previousPath, nextPath);
        next[mappedKey] = diagnostics.map((diagnostic) =>
          isSameOrDescendantPath(diagnostic.path, previousPath)
            ? { ...diagnostic, path: replacePathPrefix(diagnostic.path, previousPath, nextPath) }
            : diagnostic
        );
      }
      return next;
    });

    setLspDiagnosticsByPath((previous) => {
      const next: Record<string, EditorDiagnostic[]> = {};
      for (const [key, diagnostics] of Object.entries(previous)) {
        const mappedKey = replacePathPrefix(key, previousPath, nextPath);
        next[mappedKey] = diagnostics.map((diagnostic) =>
          isSameOrDescendantPath(diagnostic.path, previousPath)
            ? { ...diagnostic, path: replacePathPrefix(diagnostic.path, previousPath, nextPath) }
            : diagnostic
        );
      }
      return next;
    });
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

    setTreeContextMenu((previous) =>
      previous && isSameOrDescendantPath(previous.path, path) ? null : previous,
    );

    setTreeInlineEdit((previous) => {
      if (!previous) {
        return previous;
      }

      if (previous.mode === "rename") {
        return isSameOrDescendantPath(previous.targetPath, path) ? null : previous;
      }

      return isSameOrDescendantPath(previous.targetDirectoryPath, path) ? null : previous;
    });
  }

  function removeTabsByPath(path: string): void {
    const existingTabs = tabsRef.current;
    const tabsToRemove = existingTabs.filter((tab) => isSameOrDescendantPath(tab.path, path));
    if (tabsToRemove.length === 0) {
      return;
    }

    const nextTabs = existingTabs.filter((tab) => !isSameOrDescendantPath(tab.path, path));
    setTabs(nextTabs);

    setMonacoDiagnosticsByPath((previous) => {
      const next: Record<string, EditorDiagnostic[]> = {};
      for (const [key, diagnostics] of Object.entries(previous)) {
        if (!isSameOrDescendantPath(key, path)) {
          next[key] = diagnostics;
        }
      }
      return next;
    });

    setLspDiagnosticsByPath((previous) => {
      const next: Record<string, EditorDiagnostic[]> = {};
      for (const [key, diagnostics] of Object.entries(previous)) {
        if (!isSameOrDescendantPath(key, path)) {
          next[key] = diagnostics;
        }
      }
      return next;
    });

    if (!activeTabId || !isSameOrDescendantPath(activeTabId, path)) {
      return;
    }

    const activeIndex = existingTabs.findIndex((tab) => tab.id === activeTabId);
    const fallbackIndex = Math.max(0, activeIndex - 1);
    const fallbackTab = nextTabs[fallbackIndex] ?? nextTabs[nextTabs.length - 1] ?? null;
    setActiveTabId(fallbackTab ? fallbackTab.id : null);
  }

  function createTreeInlineEditSessionId(): number {
    treeInlineEditIdRef.current += 1;
    return treeInlineEditIdRef.current;
  }

  function cancelTreeInlineEdit(): void {
    if (isTreeInlineEditSubmitting) {
      return;
    }

    setTreeInlineEdit(null);
  }

  function updateTreeInlineEditValue(value: string): void {
    setTreeInlineEdit((previous) => (previous ? { ...previous, value } : previous));
  }

  async function submitTreeInlineEdit(): Promise<void> {
    if (!treeInlineEdit || isTreeInlineEditSubmitting) {
      return;
    }

    const value = treeInlineEdit.value.trim();
    if (!isValidNodeName(value)) {
      setStatusMessage("名称无效：不能为空，且不能包含路径分隔符。");
      return;
    }

    setIsTreeInlineEditSubmitting(true);

    try {
      if (treeInlineEdit.mode === "rename") {
        if (workspace && isSamePath(treeInlineEdit.targetPath, workspace.rootPath)) {
          setStatusMessage("Workspace root cannot be renamed.");
          return;
        }

        if (value === treeInlineEdit.originalName) {
          setTreeInlineEdit(null);
          return;
        }

        const result = await renamePath(treeInlineEdit.targetPath, value);
        remapPathInExplorerState(treeInlineEdit.targetPath, result.path);
        remapPathInTabs(treeInlineEdit.targetPath, result.path);

        const sourceParentPath = parentPath(treeInlineEdit.targetPath);
        const targetParentPath = parentPath(result.path);
        refreshDirectoryEntries([sourceParentPath ?? "", targetParentPath ?? ""]);

        setSelectedTreePath(result.path);
        setSelectedTreeKind(treeInlineEdit.targetKind);
        setStatusMessage(`Renamed to ${fileNameFromPath(result.path)}`);
        await refreshGitState(false);
        setTreeInlineEdit(null);
        return;
      }

      const kind: FileKind = treeInlineEdit.mode === "create-file" ? "file" : "directory";
      const label = kind === "file" ? "文件" : "文件夹";
      const targetPath = joinPath(treeInlineEdit.targetDirectoryPath, value);
      const result = kind === "file"
        ? await createFile(targetPath)
        : await createDirectory(targetPath);

      refreshDirectoryEntries([treeInlineEdit.targetDirectoryPath]);

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

      setStatusMessage(`Created ${label}: ${fileNameFromPath(result.path)}`);
      await refreshGitState(false);
      setTreeInlineEdit(null);
    } catch (error) {
      if (treeInlineEdit.mode === "rename") {
        setStatusMessage(`Rename failed: ${String(error)}`);
      } else {
        const label = treeInlineEdit.mode === "create-file" ? "文件" : "文件夹";
        setStatusMessage(`Failed to create ${label}: ${String(error)}`);
      }
    } finally {
      setIsTreeInlineEditSubmitting(false);
    }
  }

  function promptCreateNode(
    kind: FileKind,
    preferredPath?: string,
    preferredKind?: FileKind,
  ): void {
    const targetDirectoryPath = resolveCreationDirectoryPath(preferredPath, preferredKind);
    if (!targetDirectoryPath) {
      setStatusMessage("No workspace selected.");
      return;
    }

    closeTreeContextMenu();
    setExpandedByPath((previous) => ({
      ...previous,
      [targetDirectoryPath]: true,
    }));
    if (!treeByPath[targetDirectoryPath]) {
      void loadDirectory(targetDirectoryPath);
    }

    setSelectedTreePath(targetDirectoryPath);
    setSelectedTreeKind("directory");
    setIsTreeInlineEditSubmitting(false);
    setTreeInlineEdit({
      id: createTreeInlineEditSessionId(),
      mode: kind === "file" ? "create-file" : "create-directory",
      targetDirectoryPath,
      value: "",
    });
  }

  function handleRenameTreePath(path: string, kind: FileKind): void {
    if (workspace && isSamePath(path, workspace.rootPath)) {
      setStatusMessage("Workspace root cannot be renamed.");
      return;
    }

    closeTreeContextMenu();
    setSelectedTreePath(path);
    setSelectedTreeKind(kind);
    setIsTreeInlineEditSubmitting(false);
    setTreeInlineEdit({
      id: createTreeInlineEditSessionId(),
      mode: "rename",
      targetPath: path,
      targetKind: kind,
      originalName: fileNameFromPath(path),
      value: fileNameFromPath(path),
    });
  }

  function handleTreeInlineInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    event.stopPropagation();

    if (event.key === "Escape") {
      event.preventDefault();
      cancelTreeInlineEdit();
      return;
    }

    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submitTreeInlineEdit();
    }
  }

  function renderTreeInlineEditor(
    edit: TreeInlineEditState,
    depth: number,
    kind: FileKind,
  ): ReactElement {
    return (
      <div
        className="tree-item inline-edit"
        style={{ paddingLeft: `${6 + depth * 11}px` }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="tree-marker tone-default">
          {kind === "directory" ? <Folder size={14} /> : <File size={14} />}
        </span>
        <input
          ref={treeInlineInputRef}
          className="tree-inline-input"
          value={edit.value}
          aria-label={edit.mode === "rename" ? "重命名" : "新建名称"}
          disabled={isTreeInlineEditSubmitting}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => updateTreeInlineEditValue(event.target.value)}
          onKeyDown={handleTreeInlineInputKeyDown}
        />
        {isTreeInlineEditSubmitting ? <span className="tree-loading">saving...</span> : null}
      </div>
    );
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
      await refreshGitState(false);
    } catch (error) {
      setStatusMessage(`Delete failed: ${String(error)}`);
    }
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

  async function handleMoveTreePath(source: TreeDragSource, targetDirectoryPath: string): Promise<void> {
    const rejectionReason = getTreeDropRejectionReason(source, targetDirectoryPath);
    if (rejectionReason) {
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
      await refreshGitState(false);
    } catch (error) {
      const errorCode = parseMovePathErrorCode(error);
      if (errorCode) {
        setStatusMessage(MOVE_PATH_ERROR_MESSAGES[errorCode]);
        return;
      }

      setStatusMessage(`Move failed: ${String(error)}`);
    }
  }

  function openTreeContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    path: string,
    kind: FileKind,
  ): void {
    event.preventDefault();
    setTreeInlineEdit(null);
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
      await rustLspClientRef.current?.stop();
      const info = await setWorkspace(normalizedPath);
      setWorkspaceState(info);
      resetGitState();
      localStorage.setItem(WORKSPACE_STORAGE_KEY, info.rootPath);

      setTabs([]);
      setActiveTabId(null);
      setActiveWorkbenchTabKind("file");
      setMonacoDiagnosticsByPath({});
      setLspDiagnosticsByPath({});
      rustLspVersionByPathRef.current = {};
      rustLspLastPathRef.current = null;
      openFileRequestsRef.current = {};
      setOpeningFilesByPath({});

      setTreeByPath({});
      setExpandedByPath({ [info.rootPath]: true });
      setSelectedTreePath(info.rootPath);
      setSelectedTreeKind("directory");
      setTreeContextMenu(null);
      setTreeInlineEdit(null);
      setIsTreeInlineEditSubmitting(false);
      clearTreeDragDropState();
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

      setStatusMessage(`Workspace ready: ${info.rootName}`, "info", "workspace");
    } catch (error) {
      setStatusMessage(`Failed to open workspace: ${String(error)}`, "error", "workspace");
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
    const targetId = tabId ?? activeTabIdRef.current;
    if (!targetId) {
      setStatusMessage("No active file to save.");
      return;
    }

    const existingSave = saveInFlightByTabRef.current[targetId];
    if (existingSave) {
      await existingSave;
      return;
    }

    const request = (async (): Promise<void> => {
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
    })();

    saveInFlightByTabRef.current[targetId] = request;
    try {
      await request;
      await refreshGitState(false);
    } finally {
      delete saveInFlightByTabRef.current[targetId];
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
        resetGitState();
        await clearAllTerminalSessions();
      }
    } catch (error) {
      setStatusMessage(`Bootstrap failed: ${String(error)}`);
      resetGitState();
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

    try {
      mountMonacoEditor(editor, monacoApi, () => {
        void saveTab();
      });
    } catch (error) {
      setStatusMessage(`Failed to apply editor theme: ${String(error)}`);
    }
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

  function renderTree(
    nodes: FileNode[],
    depth: number,
    parentDirectoryPath: string,
  ): ReactElement[] {
    const elements: ReactElement[] = [];

    if (
      treeInlineEdit &&
      treeInlineEdit.mode !== "rename" &&
      isSamePath(treeInlineEdit.targetDirectoryPath, parentDirectoryPath)
    ) {
      const createKind: FileKind = treeInlineEdit.mode === "create-file" ? "file" : "directory";
      elements.push(
        <div key={`inline-create:${parentDirectoryPath}:${treeInlineEdit.id}`}>
          {renderTreeInlineEditor(treeInlineEdit, depth, createKind)}
        </div>,
      );
    }

    for (const node of nodes) {
      const isDirectory = node.kind === "directory";
      const expanded = Boolean(expandedByPath[node.path]);
      const loading = Boolean(loadingByPath[node.path]);
      const openingFile = !isDirectory && Boolean(openingFilesByPath[node.path]);
      const selected = selectedTreePath ? isSamePath(selectedTreePath, node.path) : false;
      const isValidDropTarget = isDirectory && treeDnDState.dropTargetPath
        ? isSamePath(treeDnDState.dropTargetPath, node.path)
        : false;
      const isInvalidDropTarget = isDirectory && treeDnDState.invalidDropTargetPath
        ? isSamePath(treeDnDState.invalidDropTargetPath, node.path)
        : false;
      const isDraggingSource = treeDnDState.dragSourcePath
        ? isSamePath(treeDnDState.dragSourcePath, node.path)
        : false;
      const visual = isDirectory
        ? resolveDirectoryVisual(node.name, expanded, "vscode-colored")
        : resolveFileVisual(node.name, "vscode-colored");
      const isRenamingNode = treeInlineEdit?.mode === "rename" && isSamePath(treeInlineEdit.targetPath, node.path);

      elements.push(
        <div
          key={node.path}
          data-tree-drop-path={isDirectory ? node.path : undefined}
        >
          {isRenamingNode
            ? renderTreeInlineEditor(treeInlineEdit, depth, node.kind)
            : (
              <button
                type="button"
                className={`tree-item ${activeTab?.path === node.path ? "active" : ""} ${
                  selected ? "selected" : ""
                } ${isDraggingSource ? "dragging-source" : ""} ${
                  isValidDropTarget ? "drop-target-valid drop-target" : ""
                } ${isInvalidDropTarget ? "drop-target-invalid" : ""}`}
                style={{ paddingLeft: `${6 + depth * 11}px` }}
                disabled={loading || openingFile}
                onPointerDown={(event) => handleTreePointerDown(event, { path: node.path, kind: node.kind })}
                onContextMenu={(event) => openTreeContextMenu(event, node.path, node.kind)}
                onClick={() => {
                  if (consumeTreeDragClickSuppression()) {
                    return;
                  }

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
            )}

          {isDirectory && expanded
            ? renderTree(treeByPath[node.path] ?? [], depth + 1, node.path)
            : null}
        </div>,
      );
    }

    return elements;
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
      fontSize: fontSize,
      lineHeight: TERMINAL_LINE_HEIGHT_RATIO,
      allowTransparency: true,
      rightClickSelectsWord: true,
      theme: DEFAULT_TERMINAL_THEME,
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

      if (payload.isError) {
        appendOutput(payload.chunk.trim(), "warning", "terminal", {
          dedupeKey: `terminal-error:${payload.sessionId}:${payload.chunk.slice(0, 120)}`,
        });
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
  }, [appendOutput]);

  useEffect(() => {
    void restoreWorkspaceAndState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!workspace) {
      resetGitState();
      return;
    }

    void refreshGitState(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.rootPath]);

  useEffect(() => {
    void refreshWindowMaximizedState();

    const focusHandler = () => {
      void refreshWindowMaximizedState();
      if (workspace) {
        void refreshGitState(false);
      }
    };

    window.addEventListener("focus", focusHandler);
    return () => {
      window.removeEventListener("focus", focusHandler);
    };
  }, [appWindow, workspace]);

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
  const rootValidDropTarget = workspace && treeDnDState.dropTargetPath
    ? isSamePath(treeDnDState.dropTargetPath, workspace.rootPath)
    : false;
  const rootInvalidDropTarget = workspace && treeDnDState.invalidDropTargetPath
    ? isSamePath(treeDnDState.invalidDropTargetPath, workspace.rootPath)
    : false;
  const rootDraggingSource = workspace && treeDnDState.dragSourcePath
    ? isSamePath(treeDnDState.dragSourcePath, workspace.rootPath)
    : false;
  const rootVisual = workspace
    ? resolveDirectoryVisual(workspace.rootName, rootExpanded, "vscode-colored", true)
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
              </div>
            ) : null}
          </div>

          <div className="titlebar-actions">
            <button
              type="button"
              className="menu-tab titlebar-action-button"
              title={`减小字体 (${fontSize}px)`}
              aria-label="减小字体"
              onClick={() => adjustFontSize(-1)}
              disabled={fontSize <= MIN_FONT_SIZE}
            >
              <AArrowDown size={14} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="menu-tab titlebar-action-button"
              title={`增大字体 (${fontSize}px)`}
              aria-label="增大字体"
              onClick={() => adjustFontSize(1)}
              disabled={fontSize >= MAX_FONT_SIZE}
            >
              <AArrowUp size={14} aria-hidden="true" />
            </button>

            <button
              type="button"
              className="menu-tab titlebar-action-button"
              title={isExplorerVisible ? "隐藏侧边栏" : "显示侧边栏"}
              aria-label="切换侧边栏"
              onClick={() => toggleExplorerVisibility()}
            >
              <FolderSearch size={14} aria-hidden="true" />
            </button>

            <HeaderSignals
              signal={signalState}
              problemCount={problems.length}
              errorCount={problemErrorCount}
              warningCount={problemWarningCount}
              onTogglePanel={toggleSignalsPanel}
            />
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
        <nav className="activity-bar" aria-label="侧边栏视图">
          <button
            type="button"
            className={`activity-button ${sidebarView === "explorer" ? "active" : ""}`}
            aria-label="资源管理器"
            title="资源管理器"
            onClick={() => activateSidebarView("explorer")}
          >
            <FolderSearch size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`activity-button ${sidebarView === "scm" ? "active" : ""}`}
            aria-label="源代码管理"
            title="源代码管理"
            onClick={() => activateSidebarView("scm")}
          >
            <FolderGit2 size={18} aria-hidden="true" />
            {gitChangesState.length > 0 ? (
              <span className="activity-badge">{gitChangesState.length > 99 ? "99+" : gitChangesState.length}</span>
            ) : null}
          </button>
        </nav>

        <aside className="explorer-panel">
          {sidebarView === "explorer" ? (
            <>
              <div className="explorer-toolbar">
                <span className="sidebar-section-title">资源管理器</span>
                <div className="explorer-toolbar-actions">
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
              </div>

              {workspace ? (
                <div className="explorer-root">
                  <div
                    data-tree-drop-path={workspace.rootPath}
                  >
                    <button
                      type="button"
                      className={`tree-item root ${rootSelected ? "selected" : ""} ${
                        rootDraggingSource ? "dragging-source" : ""
                      } ${rootValidDropTarget ? "drop-target-valid drop-target" : ""} ${
                        rootInvalidDropTarget ? "drop-target-invalid" : ""
                      }`}
                      onPointerDown={(event) =>
                        handleTreePointerDown(event, { path: workspace.rootPath, kind: "directory" })}
                      onContextMenu={(event) => openTreeContextMenu(event, workspace.rootPath, "directory")}
                      onClick={() => {
                        if (consumeTreeDragClickSuppression()) {
                          return;
                        }

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
                  </div>
                  {rootExpanded ? (
                    <div>{renderTree(treeByPath[workspace.rootPath] ?? [], 1, workspace.rootPath)}</div>
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
            </>
          ) : (
            <div className="scm-panel">
              <div className="scm-panel-header">
                <span className="sidebar-section-title">源代码管理</span>
              </div>
              {!workspace ? (
                <p className="empty-text">Open a workspace to use source control.</p>
              ) : (
                <>
                  <div className="scm-toolbar">
                    <span className="scm-branch-label">
                      {gitRepo?.isRepo ? (gitRepo.branch ?? "HEAD") : "No Git Repository"}
                    </span>
                    <button
                      type="button"
                      className="scm-button"
                      disabled={isGitActionPending || isGitRefreshing}
                      onClick={() => void refreshGitState()}
                    >
                      刷新
                    </button>
                  </div>

                  {gitRepo?.isRepo ? (
                    <>
                      <div className="scm-sync-row">
                        <span className="scm-sync-meta">
                          ↑ {gitRepo.ahead} / ↓ {gitRepo.behind}
                        </span>
                        <div className="scm-sync-actions">
                          <button
                            type="button"
                            className="scm-button"
                            disabled={isGitActionPending || isGitRefreshing}
                            onClick={() => void handleGitPullAction()}
                          >
                            Pull
                          </button>
                          <button
                            type="button"
                            className="scm-button"
                            disabled={isGitActionPending || isGitRefreshing}
                            onClick={() => void handleGitPushAction()}
                          >
                            Push
                          </button>
                        </div>
                      </div>

                      <div className="scm-branch-row">
                        <select
                          className="scm-branch-select"
                          value={gitBranchState.currentBranch ?? ""}
                          disabled={
                            isGitActionPending
                            || isGitRefreshing
                            || gitBranchState.branches.length === 0
                          }
                          onChange={(event) => void handleGitCheckoutBranch(event.target.value)}
                        >
                          {gitBranchState.currentBranch ? null : (
                            <option value="" disabled>
                              Select branch
                            </option>
                          )}
                          {gitBranchState.branches.map((branch) => (
                            <option
                              key={`${branch.isRemote ? "remote" : "local"}:${branch.name}`}
                              value={branch.name}
                            >
                              {branch.isRemote ? `remote/${branch.name}` : branch.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="scm-commit">
                        <textarea
                          className="scm-commit-input"
                          value={gitCommitMessage}
                          placeholder="Commit message"
                          disabled={isGitActionPending || isGitRefreshing}
                          onChange={(event) => setGitCommitMessage(event.target.value)}
                        />
                        <button
                          type="button"
                          className="scm-button scm-button-primary"
                          disabled={!gitCommitMessage.trim() || isGitActionPending || isGitRefreshing}
                          onClick={() => void handleGitCommitSubmit()}
                        >
                          Commit
                        </button>
                      </div>

                      <div className="scm-section">
                        <div className="scm-section-head">
                          <span>Staged ({gitStagedChanges.length})</span>
                          <button
                            type="button"
                            className="scm-button"
                            disabled={gitStagedChanges.length === 0 || isGitActionPending || isGitRefreshing}
                            onClick={() => void unstageGitPaths(gitStagedChanges.map((change) => change.path))}
                          >
                            Unstage All
                          </button>
                        </div>
                        {gitStagedChanges.length > 0 ? (
                          <div className="scm-change-list">
                            {gitStagedChanges.map((change) => {
                              const selected = Boolean(
                                gitSelectedDiffPath
                                  && isSamePath(gitSelectedDiffPath, change.path)
                                  && gitSelectedDiffStaged,
                              );
                              return (
                                <div
                                  key={`staged:${change.path}:${change.statusCode}`}
                                  className={`scm-change-item ${selected ? "selected" : ""}`}
                                >
                                  <button
                                    type="button"
                                    className="scm-change-main"
                                    title={change.path}
                                    onClick={() => void loadGitDiffPreview(change.path, true)}
                                  >
                                    <span className="scm-change-code">{labelForGitChange(change)}</span>
                                    <span className="scm-change-name">
                                      {relativePathWithinWorkspace(change.path, workspace.rootPath)}
                                    </span>
                                  </button>
                                  <div className="scm-change-actions">
                                    <button
                                      type="button"
                                      className="scm-button"
                                      disabled={isGitActionPending || isGitRefreshing}
                                      onClick={() => void unstageGitPaths([change.path])}
                                    >
                                      Unstage
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="empty-text">No staged changes.</p>
                        )}
                      </div>

                      <div className="scm-section">
                        <div className="scm-section-head">
                          <span>Changes ({gitUnstagedChanges.length})</span>
                          <button
                            type="button"
                            className="scm-button"
                            disabled={gitUnstagedChanges.length === 0 || isGitActionPending || isGitRefreshing}
                            onClick={() => void stageGitPaths(gitUnstagedChanges.map((change) => change.path))}
                          >
                            Stage All
                          </button>
                        </div>
                        {gitUnstagedChanges.length > 0 ? (
                          <div className="scm-change-list">
                            {gitUnstagedChanges.map((change) => {
                              const selected = Boolean(
                                gitSelectedDiffPath
                                  && isSamePath(gitSelectedDiffPath, change.path)
                                  && !gitSelectedDiffStaged,
                              );
                              return (
                                <div
                                  key={`changes:${change.path}:${change.statusCode}`}
                                  className={`scm-change-item ${selected ? "selected" : ""}`}
                                >
                                  <button
                                    type="button"
                                    className="scm-change-main"
                                    title={change.path}
                                    onClick={() => void loadGitDiffPreview(change.path, false)}
                                  >
                                    <span className="scm-change-code">{labelForGitChange(change)}</span>
                                    <span className="scm-change-name">
                                      {relativePathWithinWorkspace(change.path, workspace.rootPath)}
                                    </span>
                                  </button>
                                  <div className="scm-change-actions">
                                    <button
                                      type="button"
                                      className="scm-button"
                                      disabled={isGitActionPending || isGitRefreshing}
                                      onClick={() => void stageGitPaths([change.path])}
                                    >
                                      Stage
                                    </button>
                                    <button
                                      type="button"
                                      className="scm-button danger"
                                      disabled={isGitActionPending || isGitRefreshing}
                                      onClick={() => void discardGitPaths([change.path])}
                                    >
                                      Discard
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="empty-text">No unstaged changes.</p>
                        )}
                      </div>

                      <div className="scm-section">
                        <div className="scm-section-head">
                          <span>Untracked ({gitUntrackedChanges.length})</span>
                        </div>
                        {gitUntrackedChanges.length > 0 ? (
                          <div className="scm-change-list">
                            {gitUntrackedChanges.map((change) => (
                              <div
                                key={`untracked:${change.path}:${change.statusCode}`}
                                className="scm-change-item"
                              >
                                <button
                                  type="button"
                                  className="scm-change-main"
                                  title={change.path}
                                  onClick={() => void loadGitDiffPreview(change.path, false)}
                                >
                                  <span className="scm-change-code">{labelForGitChange(change)}</span>
                                  <span className="scm-change-name">
                                    {relativePathWithinWorkspace(change.path, workspace.rootPath)}
                                  </span>
                                </button>
                                <div className="scm-change-actions">
                                  <button
                                    type="button"
                                    className="scm-button"
                                    disabled={isGitActionPending || isGitRefreshing}
                                    onClick={() => void stageGitPaths([change.path])}
                                  >
                                    Stage
                                  </button>
                                  <button
                                    type="button"
                                    className="scm-button danger"
                                    disabled={isGitActionPending || isGitRefreshing}
                                    onClick={() => void discardGitPaths([change.path])}
                                  >
                                    Discard
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="empty-text">No untracked files.</p>
                        )}
                      </div>

                      <div className="scm-diff-panel">
                        <div className="scm-section-head">
                          <span>Diff Preview</span>
                          {gitSelectedDiffPath ? (
                            <button
                              type="button"
                              className="scm-button"
                              disabled={isGitActionPending || isGitRefreshing}
                              onClick={() => void openFile(gitSelectedDiffPath)}
                            >
                              Open File
                            </button>
                          ) : null}
                        </div>
                        {gitSelectedDiffPath ? (
                          <>
                            <p className="scm-diff-path">
                              {relativePathWithinWorkspace(gitSelectedDiffPath, workspace.rootPath)}
                              {gitSelectedDiffStaged ? " (staged)" : " (working tree)"}
                            </p>
                            <pre className="scm-diff-content">
                              {gitDiffText || "No diff content for this file."}
                            </pre>
                          </>
                        ) : (
                          <p className="empty-text">Select a change to preview its diff.</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="empty-text">Current workspace is not a Git repository.</p>
                  )}
                </>
              )}
            </div>
          )}
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
                  theme={MONACO_THEME_NAME}
                  className="editor-monaco"
                  height="100%"
                  options={{
                    automaticLayout: true,
                    minimap: { enabled: false },
                    fontFamily: CODE_FONT_FAMILY,
                    fontSize: fontSize,
                    lineHeight: Math.round(fontSize * CODE_LINE_HEIGHT_RATIO),
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

      <StatusBar
        statusMessage={statusMessage}
        statusLevel={statusLevel}
        workspaceName={workspace?.rootName ?? null}
        activeWorkbenchTabKind={activeWorkbenchTabKind}
        activeFile={statusBarFileInfo}
        activeTerminal={statusBarTerminalInfo}
      />

      <ToastViewport toasts={toasts} onDismiss={dismissToast} />

      <section ref={signalsPanelRef} className="signals-panel-anchor">
        <SignalsPanel
          open={outputState.panelOpen}
          activeTab={outputState.activeTab}
          statusMessage={statusMessage}
          problems={problems}
          outputEntries={visibleOutputEntries}
          outputLevelFilter={outputLevelFilter}
          onClose={closeSignalsPanel}
          onTabChange={selectSignalsTab}
          onOutputLevelFilterChange={setOutputLevelFilter}
          onSelectProblem={jumpToProblem}
          onClearOutput={clearSignalOutputs}
        />
      </section>

    </div>
  );
}

export default App;
