export type FileKind = "file" | "directory";

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
  lines: string[];
  lastResult: TerminalCommandResult | null;
}

export interface TerminalOutputEvent {
  sessionId: string;
  chunk: string;
  isError: boolean;
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
  language: string;
}

export interface HintSuggestion {
  id: string;
  title: string;
  message: string;
  insertText: string;
}
