export type FileKind = "file" | "directory";
export type LanguageId =
  | "plaintext"
  | "typescript"
  | "javascript"
  | "json"
  | "css"
  | "html"
  | "markdown"
  | "rust";

export interface WorkspaceInfo {
  rootPath: string;
  rootName: string;
}

export interface FileNode {
  path: string;
  name: string;
  kind: FileKind;
  hasChildren: boolean;
}

export interface FileContent {
  path: string;
  content: string;
}

export interface SaveResult {
  path: string;
  bytesWritten: number;
}

export interface PathResult {
  path: string;
}

export type MovePathErrorCode =
  | "MOVE_SOURCE_IS_ROOT"
  | "MOVE_TARGET_NOT_DIRECTORY"
  | "MOVE_TARGET_EXISTS"
  | "MOVE_TARGET_INSIDE_SOURCE"
  | "MOVE_IO_ERROR";

export interface SearchHit {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface TerminalSession {
  id: string;
  title: string;
  shell: string;
  cwd: string;
  status: string;
  cols: number;
  rows: number;
}

export interface TerminalCommandResult {
  command: string;
  output: string;
  error: string;
  exitCode: number;
  cwd: string;
}

export interface TerminalSessionSnapshot {
  session: TerminalSession;
  buffer: string;
  lastResult: TerminalCommandResult | null;
}

export interface TerminalOutputEvent {
  sessionId: string;
  chunk: string;
  isError: boolean;
}

export type GitFileStatusCode =
  | "M"
  | "A"
  | "D"
  | "R"
  | "C"
  | "T"
  | "U"
  | "?"
  | "!"
  | "??"
  | "!!"
  | " ";

export interface GitChange {
  path: string;
  oldPath: string | null;
  indexStatus: GitFileStatusCode;
  worktreeStatus: GitFileStatusCode;
  statusCode: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface GitRepoStatus {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  hasChanges: boolean;
}

export interface GitBranchInfo {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

export interface GitBranchSnapshot {
  currentBranch: string | null;
  branches: GitBranchInfo[];
}

export interface GitCommandResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface GitCommitResult {
  summary: string;
  commitHash: string | null;
  commandResult: GitCommandResult;
}

export interface GitDiffResult {
  path: string;
  staged: boolean;
  diff: string;
}

export interface Ack {
  ok: boolean;
}

export interface AiProviderSuggestion {
  id: string;
  command: string;
  argsTemplate: string[];
  description: string;
}

export interface AiRunRequest {
  command: string;
  args: string[];
  prompt: string;
  cwd?: string;
}

export interface AiRunResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface EditorTab {
  id: string;
  path: string;
  title: string;
  content: string;
  savedContent: string;
  language: LanguageId;
}

export interface HintSuggestion {
  id: string;
  title: string;
  message: string;
  insertText: string;
}

export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

export interface EditorDiagnostic {
  id: string;
  path: string;
  line: number;
  column: number;
  severity: DiagnosticSeverity;
  source: string;
  message: string;
  code?: string | null;
}

export type OutputChannel = "system" | "lsp" | "terminal" | "workspace";
export type OutputLevel = "error" | "warning" | "info" | "debug";
export type SignalsPanelTab = "problems" | "output";

export interface OutputEntry {
  id: string;
  channel: OutputChannel;
  level: OutputLevel;
  message: string;
  timestamp: number;
  path?: string;
  line?: number;
  column?: number;
  dedupeKey?: string;
  count: number;
}

export interface EditorSignalState {
  unread: number;
  hasError: boolean;
  hasWarning: boolean;
  panelOpen: boolean;
  activeTab: SignalsPanelTab;
}

export type FeedbackLevel = "success" | "error" | "warning" | "info";

export interface ToastNotification {
  id: string;
  level: FeedbackLevel;
  message: string;
  createdAt: number;
  durationMs: number;
}

export interface StatusBarFileInfo {
  title: string;
  path: string;
  language: LanguageId;
  isDirty: boolean;
}

export interface StatusBarTerminalInfo {
  title: string;
  cwd: string;
  status: string;
}

export interface LspSessionInfo {
  id: string;
  server: string;
  rootPath: string;
  status: string;
}

export interface LspMessageEvent {
  sessionId: string;
  channel: "stdout" | "stderr" | "system";
  payload: string;
  isError: boolean;
}
