import { invoke } from "@tauri-apps/api/core";
import type {
  Ack,
  AiProviderSuggestion,
  AiRunRequest,
  AiRunResult,
  FileContent,
  FileNode,
  GitBranchSnapshot,
  GitChange,
  GitCommandResult,
  GitCommitResult,
  GitDiffResult,
  GitRepoStatus,
  LspSessionInfo,
  PathResult,
  SaveResult,
  SearchHit,
  TerminalSession,
  TerminalSessionSnapshot,
  WorkspaceInfo,
} from "./types";

export async function setWorkspace(path: string): Promise<WorkspaceInfo> {
  return invoke<WorkspaceInfo>("set_workspace", { path });
}

export async function getWorkspace(): Promise<WorkspaceInfo | null> {
  return invoke<WorkspaceInfo | null>("get_workspace");
}

export async function listDirectory(path?: string, includeHidden = false): Promise<FileNode[]> {
  return invoke<FileNode[]>("list_directory", {
    path: path ?? null,
    includeHidden,
  });
}

export async function readFile(path: string): Promise<FileContent> {
  return invoke<FileContent>("read_file", { path });
}

export async function writeFile(path: string, content: string): Promise<SaveResult> {
  return invoke<SaveResult>("write_file", { path, content });
}

export async function createFile(path: string): Promise<PathResult> {
  return invoke<PathResult>("create_file", { path });
}

export async function createDirectory(path: string): Promise<PathResult> {
  return invoke<PathResult>("create_directory", { path });
}

export async function renamePath(path: string, newName: string): Promise<PathResult> {
  return invoke<PathResult>("rename_path", { path, newName });
}

export async function deletePath(path: string): Promise<Ack> {
  return invoke<Ack>("delete_path", { path });
}

export async function movePath(sourcePath: string, targetDirectoryPath: string): Promise<PathResult> {
  return invoke<PathResult>("move_path", {
    sourcePath,
    targetDirectoryPath,
  });
}

export async function searchWorkspace(
  query: string,
  maxResults = 200,
  includeHidden = false,
): Promise<SearchHit[]> {
  return invoke<SearchHit[]>("search_workspace", {
    query,
    maxResults,
    includeHidden,
  });
}

export async function terminalCreate(shell = "powershell.exe"): Promise<TerminalSessionSnapshot> {
  return invoke<TerminalSessionSnapshot>("terminal_create", { shell });
}

export async function terminalList(): Promise<TerminalSession[]> {
  return invoke<TerminalSession[]>("terminal_list");
}

export async function terminalSnapshot(sessionId: string): Promise<TerminalSessionSnapshot> {
  return invoke<TerminalSessionSnapshot>("terminal_snapshot", { sessionId });
}

export async function terminalWrite(
  sessionId: string,
  input: string,
): Promise<Ack> {
  return invoke<Ack>("terminal_write", { sessionId, input });
}

export async function terminalResize(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<Ack> {
  return invoke<Ack>("terminal_resize", { sessionId, cols, rows });
}

export async function terminalClear(sessionId: string): Promise<TerminalSessionSnapshot> {
  return invoke<TerminalSessionSnapshot>("terminal_clear", { sessionId });
}

export async function terminalClose(sessionId: string): Promise<Ack> {
  return invoke<Ack>("terminal_close", { sessionId });
}

export async function gitRepoStatus(): Promise<GitRepoStatus> {
  return invoke<GitRepoStatus>("git_repo_status");
}

export async function gitChanges(): Promise<GitChange[]> {
  return invoke<GitChange[]>("git_changes");
}

export async function gitStage(paths: string[]): Promise<Ack> {
  return invoke<Ack>("git_stage", { paths });
}

export async function gitUnstage(paths: string[]): Promise<Ack> {
  return invoke<Ack>("git_unstage", { paths });
}

export async function gitDiscard(paths: string[]): Promise<Ack> {
  return invoke<Ack>("git_discard", { paths });
}

export async function gitCommit(message: string): Promise<GitCommitResult> {
  return invoke<GitCommitResult>("git_commit", { message });
}

export async function gitBranches(): Promise<GitBranchSnapshot> {
  return invoke<GitBranchSnapshot>("git_branches");
}

export async function gitCheckout(branch: string, create = false): Promise<Ack> {
  return invoke<Ack>("git_checkout", { branch, create });
}

export async function gitPull(): Promise<GitCommandResult> {
  return invoke<GitCommandResult>("git_pull");
}

export async function gitPush(): Promise<GitCommandResult> {
  return invoke<GitCommandResult>("git_push");
}

export async function gitDiff(path: string, staged = false): Promise<GitDiffResult> {
  return invoke<GitDiffResult>("git_diff", { path, staged });
}

export async function lspStart(
  server: string,
  args: string[],
  rootPath: string,
): Promise<LspSessionInfo> {
  return invoke<LspSessionInfo>("lsp_start", { server, args, rootPath });
}

export async function lspSend(sessionId: string, payload: string): Promise<Ack> {
  return invoke<Ack>("lsp_send", { sessionId, payload });
}

export async function lspStop(sessionId: string): Promise<Ack> {
  return invoke<Ack>("lsp_stop", { sessionId });
}

export async function aiProviderSuggestions(): Promise<AiProviderSuggestion[]> {
  return invoke<AiProviderSuggestion[]>("ai_provider_suggestions");
}

export async function aiRun(request: AiRunRequest): Promise<AiRunResult> {
  return invoke<AiRunResult>("ai_run", { request });
}
