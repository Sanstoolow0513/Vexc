import { fileNameFromPath } from "../../utils";
import { lspSend, lspStart, lspStop } from "../../api";
import type {
  EditorDiagnostic,
  LspMessageEvent,
  LspSessionInfo,
  OutputChannel,
  OutputLevel,
} from "../../types";

interface OutputSink {
  channel: OutputChannel;
  level: OutputLevel;
  message: string;
  dedupeKey?: string;
}

interface PublishDiagnosticsPayload {
  uri?: string;
  diagnostics?: Array<{
    range?: {
      start?: { line?: number; character?: number };
      end?: { line?: number; character?: number };
    };
    severity?: number;
    message?: string;
    source?: string;
    code?: string | number | { value?: string | number };
  }>;
}

type DiagnosticCode = string | number | { value?: string | number } | undefined;

const DEAD_LSP_SESSION_ERROR_FRAGMENTS = [
  "lsp session is not running",
  "lsp session not found",
  "failed to write lsp header",
  "failed to write lsp payload",
  "failed to flush lsp payload",
  "broken pipe",
  "pipe is being closed",
  "pipe has been ended",
];

export interface RustLspClient {
  ensureStarted: (workspaceRoot: string) => Promise<boolean>;
  syncDocument: (path: string, text: string, version: number) => Promise<void>;
  closeDocument: (path: string) => Promise<void>;
  handleMessage: (event: LspMessageEvent) => void;
  stop: () => Promise<void>;
}

interface CreateRustLspClientOptions {
  onDiagnostics: (path: string, diagnostics: EditorDiagnostic[]) => void;
  onOutput: (entry: OutputSink) => void;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
}

function toFileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").map((segment) => encodeURIComponent(segment));
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${segments.join("/")}`;
  }
  if (normalized.startsWith("//")) {
    return `file:${segments.join("/")}`;
  }
  return `file://${segments.join("/")}`;
}

function fromFileUri(uri: string): string | null {
  if (!uri.startsWith("file://")) {
    return null;
  }

  try {
    const parsed = new URL(uri);
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (/^\/[a-zA-Z]:/.test(decodedPath)) {
      return decodedPath.slice(1).replace(/\//g, "\\");
    }
    if (parsed.host) {
      return `\\\\${parsed.host}${decodedPath.replace(/\//g, "\\")}`;
    }
    return decodedPath;
  } catch {
    return null;
  }
}

function mapSeverity(rawSeverity: number | undefined): EditorDiagnostic["severity"] {
  switch (rawSeverity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    case 4:
      return "hint";
    default:
      return "warning";
  }
}

function stringifyDiagnosticCode(value: DiagnosticCode): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (value && typeof value === "object" && "value" in value) {
    const codeValue = value.value;
    if (typeof codeValue === "string" || typeof codeValue === "number") {
      return String(codeValue);
    }
  }
  return undefined;
}

function stringifyUnknownError(error: unknown): string {
  return typeof error === "string" ? error : String(error);
}

function isDeadLspSessionError(error: unknown): boolean {
  const message = stringifyUnknownError(error).toLowerCase();
  return DEAD_LSP_SESSION_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment));
}

export function createRustLspClient(options: CreateRustLspClientOptions): RustLspClient {
  let session: LspSessionInfo | null = null;
  let workspaceRoot: string | null = null;
  let nextRequestId = 1;
  let initializeRequestId: number | null = null;
  const openedDocuments = new Set<string>();

  function clearSessionState(shouldClearWorkspaceRoot: boolean): void {
    session = null;
    if (shouldClearWorkspaceRoot) {
      workspaceRoot = null;
    }
    initializeRequestId = null;
    openedDocuments.clear();
  }

  function markSessionDisconnected(reason: unknown): void {
    if (!session) {
      return;
    }

    const disconnectedSession = session;
    const message = stringifyUnknownError(reason).trim();
    clearSessionState(false);

    options.onOutput({
      channel: "lsp",
      level: "warning",
      message:
        message.length > 0
          ? `Rust language service disconnected and will restart automatically. (${message})`
          : "Rust language service disconnected and will restart automatically.",
      dedupeKey: `rust-lsp-disconnected:${disconnectedSession.id}`,
    });
  }

  async function sendJsonRpc(message: JsonRpcMessage): Promise<void> {
    const activeSession = session;
    if (!activeSession) {
      return;
    }

    try {
      await lspSend(activeSession.id, JSON.stringify(message));
    } catch (error) {
      if (isDeadLspSessionError(error)) {
        markSessionDisconnected(error);
      }
      throw error;
    }
  }

  async function sendInitialize(): Promise<void> {
    if (!session || !workspaceRoot) {
      return;
    }

    const rootUri = toFileUri(workspaceRoot);
    const requestId = nextRequestId++;
    initializeRequestId = requestId;

    await sendJsonRpc({
      jsonrpc: "2.0",
      id: requestId,
      method: "initialize",
      params: {
        processId: null,
        clientInfo: {
          name: "vexc",
          version: "0.1.0",
        },
        rootUri,
        workspaceFolders: [
          {
            uri: rootUri,
            name: fileNameFromPath(workspaceRoot),
          },
        ],
        capabilities: {
          workspace: {
            workspaceFolders: true,
          },
          textDocument: {
            publishDiagnostics: {
              relatedInformation: true,
            },
          },
        },
      },
    });
  }

  async function ensureStarted(nextWorkspaceRoot: string): Promise<boolean> {
    if (session && workspaceRoot === nextWorkspaceRoot) {
      return true;
    }

    if (session && workspaceRoot !== nextWorkspaceRoot) {
      await stop();
    }

    try {
      session = await lspStart("rust-analyzer", [], nextWorkspaceRoot);
      workspaceRoot = nextWorkspaceRoot;
      await sendInitialize();
      options.onOutput({
        channel: "lsp",
        level: "info",
        message: `Rust language service connected: ${session.server}`,
        dedupeKey: `lsp-start:${session.server}:${nextWorkspaceRoot}`,
      });
      return true;
    } catch (error) {
      clearSessionState(true);
      options.onOutput({
        channel: "lsp",
        level: "warning",
        message: `Rust language service unavailable. Install rust-analyzer and make sure it is on PATH. (${stringifyUnknownError(error)})`,
        dedupeKey: "rust-analyzer-missing",
      });
      return false;
    }
  }

  async function sendDocumentSync(path: string, text: string, version: number): Promise<void> {
    const uri = toFileUri(path);
    if (!openedDocuments.has(path)) {
      await sendJsonRpc({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri,
            languageId: "rust",
            version,
            text,
          },
        },
      });
      openedDocuments.add(path);
      return;
    }

    await sendJsonRpc({
      jsonrpc: "2.0",
      method: "textDocument/didChange",
      params: {
        textDocument: {
          uri,
          version,
        },
        contentChanges: [
          {
            text,
          },
        ],
      },
    });
  }

  async function syncDocument(path: string, text: string, version: number): Promise<void> {
    if (!session) {
      return;
    }

    try {
      await sendDocumentSync(path, text, version);
      return;
    } catch (error) {
      if (!isDeadLspSessionError(error)) {
        options.onOutput({
          channel: "lsp",
          level: "warning",
          message: `Failed to sync Rust document with language service: ${stringifyUnknownError(error)}`,
          dedupeKey: "rust-lsp-sync-failure",
        });
        return;
      }
    }

    const restartRoot = workspaceRoot;
    if (!restartRoot) {
      return;
    }

    const restarted = await ensureStarted(restartRoot);
    if (!restarted) {
      return;
    }

    try {
      await sendDocumentSync(path, text, version);
    } catch (error) {
      options.onOutput({
        channel: "lsp",
        level: "warning",
        message: `Failed to sync Rust document after restarting language service: ${stringifyUnknownError(error)}`,
        dedupeKey: "rust-lsp-sync-retry-failure",
      });
    }
  }

  async function closeDocument(path: string): Promise<void> {
    if (!session || !openedDocuments.has(path)) {
      return;
    }

    try {
      await sendJsonRpc({
        jsonrpc: "2.0",
        method: "textDocument/didClose",
        params: {
          textDocument: {
            uri: toFileUri(path),
          },
        },
      });
    } catch (error) {
      if (!isDeadLspSessionError(error)) {
        options.onOutput({
          channel: "lsp",
          level: "warning",
          message: `Failed to close Rust document in language service: ${stringifyUnknownError(error)}`,
          dedupeKey: "rust-lsp-close-failure",
        });
      }
      return;
    }

    openedDocuments.delete(path);
  }

  function handlePublishDiagnostics(payload: PublishDiagnosticsPayload): void {
    const path = payload.uri ? fromFileUri(payload.uri) : null;
    if (!path) {
      return;
    }

    const diagnostics: EditorDiagnostic[] = (payload.diagnostics ?? []).map((item, index) => {
      const line = (item.range?.start?.line ?? 0) + 1;
      const column = (item.range?.start?.character ?? 0) + 1;
      const code = stringifyDiagnosticCode(item.code);
      const message = item.message ?? "Unknown Rust diagnostic";
      const id = `${path}:${line}:${column}:${message}:${index}`;

      return {
        id,
        path,
        line,
        column,
        severity: mapSeverity(item.severity),
        source: item.source ?? "rust-analyzer",
        message,
        code: code ?? null,
      };
    });

    options.onDiagnostics(path, diagnostics);
  }

  function handleMessage(event: LspMessageEvent): void {
    if (!session || event.sessionId !== session.id) {
      return;
    }

    if (event.channel === "system") {
      if (event.isError) {
        markSessionDisconnected(event.payload);
      }
      return;
    }

    if (event.channel === "stderr") {
      const stderr = event.payload.trim();
      if (stderr.length > 0) {
        options.onOutput({
          channel: "lsp",
          level: event.isError ? "error" : "warning",
          message: stderr,
          dedupeKey: `lsp-stderr:${stderr}`,
        });
      }
      return;
    }

    let message: JsonRpcMessage;
    try {
      message = JSON.parse(event.payload) as JsonRpcMessage;
    } catch {
      return;
    }

    if (typeof message.id === "number" && message.id === initializeRequestId) {
      initializeRequestId = null;
      void sendJsonRpc({
        jsonrpc: "2.0",
        method: "initialized",
        params: {},
      });
      return;
    }

    if (message.error?.message) {
      options.onOutput({
        channel: "lsp",
        level: "error",
        message: message.error.message,
        dedupeKey: `lsp-error:${message.error.code ?? "unknown"}:${message.error.message}`,
      });
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") {
      handlePublishDiagnostics((message.params ?? {}) as PublishDiagnosticsPayload);
    }
  }

  async function stop(): Promise<void> {
    const activeSession = session;
    if (!activeSession) {
      return;
    }

    try {
      await lspStop(activeSession.id);
    } catch (error) {
      options.onOutput({
        channel: "lsp",
        level: "warning",
        message: `Failed to stop Rust language service: ${stringifyUnknownError(error)}`,
        dedupeKey: "rust-lsp-stop-failure",
      });
    }

    clearSessionState(true);
  }

  return {
    ensureStarted,
    syncDocument,
    closeDocument,
    handleMessage,
    stop,
  };
}
