import { invoke } from "@tauri-apps/api/core";
import type {
  Ack,
  AiProviderSuggestion,
  AiRunRequest,
  AiRunResult,
  FileContent,
  FileNode,
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

export async function aiProviderSuggestions(): Promise<AiProviderSuggestion[]> {
  return invoke<AiProviderSuggestion[]>("ai_provider_suggestions");
}

export async function aiRun(request: AiRunRequest): Promise<AiRunResult> {
  return invoke<AiRunResult>("ai_run", { request });
}
