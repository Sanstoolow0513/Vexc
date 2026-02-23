import { lspSend, lspStart, lspStop } from "../../api";
import type {
  EditorDiagnostic,
  LanguageId,
  LspMessageEvent,
  LspServerStatus,
  LspSessionInfo,
  OutputChannel,
  OutputLevel,
} from "../../types";
import { getLanguageDefinition, getLanguageDefinitions } from "../languageRegistry";
import type {
  InitializeResult,
  JsonRpcErrorResponse,
  JsonRpcMessage,
  JsonRpcMethodMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  LspCompletionList,
  LspDiagnostic,
  LspHover,
  LspLocation,
  LspRange,
  LspSignatureHelp,
  PublishDiagnosticsParams,
  ServerCapabilities,
} from "./protocol";
import { fromFileUri, normalizePathForLspKey, toFileUri } from "./uri";

interface OutputSink {
  channel: OutputChannel;
  level: OutputLevel;
  message: string;
  dedupeKey?: string;
}

interface PendingRequest {
  timeoutId: number;
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface CreateManagedLanguageClientOptions {
  languageId: LanguageId;
  server: string;
  args: readonly string[];
  onDiagnostics: (path: string, languageId: LanguageId, diagnostics: EditorDiagnostic[]) => void;
  onOutput: (entry: OutputSink) => void;
  onStatusChanged: () => void;
}

interface LspLocationLink {
  targetUri?: string;
  targetRange?: LspRange;
  targetSelectionRange?: LspRange;
}

interface LspMessageParams {
  type?: number;
  message?: string;
}

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

const REQUEST_TIMEOUT_MS = 15000;
const SHUTDOWN_TIMEOUT_MS = 4000;

function stringifyUnknownError(error: unknown): string {
  return typeof error === "string" ? error : String(error);
}

function isDeadLspSessionError(error: unknown): boolean {
  const message = stringifyUnknownError(error).toLowerCase();
  return DEAD_LSP_SESSION_ERROR_FRAGMENTS.some((fragment) => message.includes(fragment));
}

function workspaceFolderNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
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

function stringifyDiagnosticCode(value: LspDiagnostic["code"]): string | undefined {
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

function capabilityEnabled(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return Boolean(value);
}

function toNumericResponseId(id: unknown): number | null {
  if (typeof id === "number" && Number.isFinite(id)) {
    return id;
  }
  if (typeof id === "string" && id.length > 0) {
    const parsed = Number.parseInt(id, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseLspMessage(payload: string): JsonRpcMessage | null {
  try {
    return JSON.parse(payload) as JsonRpcMessage;
  } catch {
    return null;
  }
}

function locationFromUnknown(value: unknown): LspLocation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if ("targetUri" in value || "targetRange" in value) {
    const link = value as LspLocationLink;
    if (!link.targetUri) {
      return null;
    }

    return {
      uri: link.targetUri,
      range: link.targetSelectionRange ?? link.targetRange,
    };
  }

  const location = value as LspLocation;
  if (!location.uri || !location.range) {
    return null;
  }
  return location;
}

function normalizeLocations(result: unknown): LspLocation[] {
  if (!result) {
    return [];
  }

  const raw = Array.isArray(result) ? result : [result];
  return raw
    .map((entry) => locationFromUnknown(entry))
    .filter((entry): entry is LspLocation => entry !== null);
}

class ManagedLanguageClient {
  private readonly languageId: LanguageId;
  private readonly server: string;
  private readonly args: readonly string[];
  private readonly onDiagnostics: CreateManagedLanguageClientOptions["onDiagnostics"];
  private readonly onOutput: CreateManagedLanguageClientOptions["onOutput"];
  private readonly onStatusChanged: CreateManagedLanguageClientOptions["onStatusChanged"];

  private session: LspSessionInfo | null = null;
  private workspaceRoot: string | null = null;
  private nextRequestId = 1;
  private initialized = false;
  private capabilities: ServerCapabilities = {};
  private readonly openedDocumentKeys = new Set<string>();
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private nextStartAllowedAt = 0;
  private state: LspServerStatus["state"] = "idle";
  private lastError: string | null = null;
  private lastUpdatedAt = Date.now();

  constructor(options: CreateManagedLanguageClientOptions) {
    this.languageId = options.languageId;
    this.server = options.server;
    this.args = options.args;
    this.onDiagnostics = options.onDiagnostics;
    this.onOutput = options.onOutput;
    this.onStatusChanged = options.onStatusChanged;
  }

  getLanguageId(): LanguageId {
    return this.languageId;
  }

  getSessionId(): string | null {
    return this.session?.id ?? null;
  }

  snapshotStatus(): LspServerStatus {
    const nextRetryAt = this.nextStartAllowedAt > Date.now() ? this.nextStartAllowedAt : null;
    return {
      languageId: this.languageId,
      server: this.server,
      state: this.state,
      sessionId: this.session?.id ?? null,
      workspaceRoot: this.workspaceRoot,
      openedDocumentCount: this.openedDocumentKeys.size,
      lastError: this.lastError,
      nextRetryAt,
      updatedAt: this.lastUpdatedAt,
    };
  }

  private setState(nextState: LspServerStatus["state"], lastError?: string | null): void {
    const resolvedLastError = lastError === undefined ? this.lastError : lastError;
    if (this.state === nextState && this.lastError === resolvedLastError) {
      return;
    }

    this.state = nextState;
    if (lastError !== undefined) {
      this.lastError = lastError;
    }
    this.lastUpdatedAt = Date.now();
    this.onStatusChanged();
  }

  getCompletionTriggerCharacters(): string[] {
    return this.capabilities.completionProvider?.triggerCharacters ?? [];
  }

  getSignatureHelpTriggerCharacters(): string[] {
    return this.capabilities.signatureHelpProvider?.triggerCharacters ?? [];
  }

  supportsHover(): boolean {
    return capabilityEnabled(this.capabilities.hoverProvider);
  }

  supportsDefinition(): boolean {
    return capabilityEnabled(this.capabilities.definitionProvider);
  }

  supportsReferences(): boolean {
    return capabilityEnabled(this.capabilities.referencesProvider);
  }

  supportsCompletion(): boolean {
    return capabilityEnabled(this.capabilities.completionProvider);
  }

  supportsSignatureHelp(): boolean {
    return capabilityEnabled(this.capabilities.signatureHelpProvider);
  }

  async ensureStarted(nextWorkspaceRoot: string): Promise<boolean> {
    if (this.session && this.workspaceRoot === nextWorkspaceRoot && this.initialized) {
      return true;
    }

    if (!this.session && Date.now() < this.nextStartAllowedAt) {
      this.setState("backoff");
      return false;
    }

    if (this.session && this.workspaceRoot !== nextWorkspaceRoot) {
      await this.stop();
    }

    this.workspaceRoot = nextWorkspaceRoot;
    this.setState("starting");

    try {
      this.session = await lspStart(this.server, [...this.args], nextWorkspaceRoot);
      this.nextStartAllowedAt = 0;
      this.initialized = false;
      this.capabilities = {};

      const initializeResult = await this.requestInternal<InitializeResult>(
        "initialize",
        {
          processId: null,
          clientInfo: {
            name: "vexc",
            version: "0.1.0",
          },
          rootUri: toFileUri(nextWorkspaceRoot),
          workspaceFolders: [
            {
              uri: toFileUri(nextWorkspaceRoot),
              name: workspaceFolderNameFromPath(nextWorkspaceRoot),
            },
          ],
          capabilities: {
            workspace: {
              workspaceFolders: true,
            },
            textDocument: {
              hover: {
                contentFormat: ["markdown", "plaintext"],
              },
              completion: {
                completionItem: {
                  snippetSupport: true,
                  documentationFormat: ["markdown", "plaintext"],
                },
              },
              signatureHelp: {
                signatureInformation: {
                  documentationFormat: ["markdown", "plaintext"],
                },
              },
              publishDiagnostics: {
                relatedInformation: true,
              },
            },
          },
        },
        {
          allowBeforeInitialized: true,
        },
      );

      this.capabilities = initializeResult?.capabilities ?? {};
      await this.notifyInternal("initialized", {}, { allowBeforeInitialized: true });
      this.initialized = true;
      this.setState("running", null);

      this.onOutput({
        channel: "lsp",
        level: "info",
        message: `Language service connected (${this.languageId}): ${this.session.server}`,
        dedupeKey: `lsp-start:${this.languageId}:${nextWorkspaceRoot}`,
      });

      return true;
    } catch (error) {
      this.nextStartAllowedAt = Date.now() + 5000;
      const message = stringifyUnknownError(error);
      this.clearSessionState(false, message);
      this.setState("backoff", message);
      this.onOutput({
        channel: "lsp",
        level: "warning",
        message: `Language service unavailable for ${this.languageId}. Install ${this.server} and ensure it is on PATH. (${message})`,
        dedupeKey: `lsp-missing:${this.languageId}:${this.server}`,
      });
      return false;
    }
  }

  async syncDocument(path: string, text: string, version: number): Promise<void> {
    if (!this.session || !this.workspaceRoot || !this.initialized) {
      return;
    }

    try {
      await this.sendDocumentSync(path, text, version);
      return;
    } catch (error) {
      if (!isDeadLspSessionError(error)) {
        this.onOutput({
          channel: "lsp",
          level: "warning",
          message: `Failed to sync ${this.languageId} document with language service: ${stringifyUnknownError(error)}`,
          dedupeKey: `lsp-sync-failure:${this.languageId}`,
        });
        return;
      }
    }

    const restartRoot = this.workspaceRoot;
    if (!restartRoot) {
      return;
    }

    const restarted = await this.ensureStarted(restartRoot);
    if (!restarted) {
      return;
    }

    try {
      await this.sendDocumentSync(path, text, version);
    } catch (error) {
      this.onOutput({
        channel: "lsp",
        level: "warning",
        message: `Failed to sync ${this.languageId} document after restarting language service: ${stringifyUnknownError(error)}`,
        dedupeKey: `lsp-sync-retry-failure:${this.languageId}`,
      });
    }
  }

  async saveDocument(path: string): Promise<void> {
    if (!this.session || !this.initialized) {
      return;
    }

    const key = normalizePathForLspKey(path);
    if (!this.openedDocumentKeys.has(key)) {
      return;
    }

    try {
      await this.notifyInternal("textDocument/didSave", {
        textDocument: {
          uri: toFileUri(path),
        },
      });
    } catch (error) {
      if (!isDeadLspSessionError(error)) {
        this.onOutput({
          channel: "lsp",
          level: "warning",
          message: `Failed to notify ${this.languageId} language service about save: ${stringifyUnknownError(error)}`,
          dedupeKey: `lsp-save-failure:${this.languageId}`,
        });
      }
    }
  }

  async closeDocument(path: string): Promise<void> {
    if (!this.session || !this.initialized) {
      return;
    }

    const key = normalizePathForLspKey(path);
    if (!this.openedDocumentKeys.has(key)) {
      return;
    }

    try {
      await this.notifyInternal("textDocument/didClose", {
        textDocument: {
          uri: toFileUri(path),
        },
      });
    } catch (error) {
      if (!isDeadLspSessionError(error)) {
        this.onOutput({
          channel: "lsp",
          level: "warning",
          message: `Failed to close ${this.languageId} document in language service: ${stringifyUnknownError(error)}`,
          dedupeKey: `lsp-close-failure:${this.languageId}`,
        });
      }
    } finally {
      this.openedDocumentKeys.delete(key);
      this.onStatusChanged();
    }
  }

  async requestHover(path: string, line: number, character: number): Promise<LspHover | null> {
    if (!this.supportsHover()) {
      return null;
    }
    const result = await this.requestInternal<unknown>("textDocument/hover", {
      textDocument: {
        uri: toFileUri(path),
      },
      position: { line, character },
    });
    return (result ?? null) as LspHover | null;
  }

  async requestDefinition(path: string, line: number, character: number): Promise<LspLocation[]> {
    if (!this.supportsDefinition()) {
      return [];
    }
    const result = await this.requestInternal<unknown>("textDocument/definition", {
      textDocument: {
        uri: toFileUri(path),
      },
      position: { line, character },
    });
    return normalizeLocations(result);
  }

  async requestReferences(
    path: string,
    line: number,
    character: number,
    includeDeclaration: boolean,
  ): Promise<LspLocation[]> {
    if (!this.supportsReferences()) {
      return [];
    }
    const result = await this.requestInternal<unknown>("textDocument/references", {
      textDocument: {
        uri: toFileUri(path),
      },
      position: { line, character },
      context: {
        includeDeclaration,
      },
    });
    return normalizeLocations(result);
  }

  async requestCompletion(
    path: string,
    line: number,
    character: number,
    triggerCharacter: string | undefined,
  ): Promise<LspCompletionList | null> {
    if (!this.supportsCompletion()) {
      return null;
    }
    const result = await this.requestInternal<unknown>("textDocument/completion", {
      textDocument: {
        uri: toFileUri(path),
      },
      position: { line, character },
      context: {
        triggerKind: triggerCharacter ? 2 : 1,
        triggerCharacter,
      },
    });

    if (Array.isArray(result)) {
      return {
        isIncomplete: false,
        items: result,
      } as LspCompletionList;
    }

    return (result ?? null) as LspCompletionList | null;
  }

  async requestSignatureHelp(
    path: string,
    line: number,
    character: number,
    triggerCharacter: string | undefined,
  ): Promise<LspSignatureHelp | null> {
    if (!this.supportsSignatureHelp()) {
      return null;
    }

    const result = await this.requestInternal<unknown>("textDocument/signatureHelp", {
      textDocument: {
        uri: toFileUri(path),
      },
      position: { line, character },
      context: {
        triggerKind: triggerCharacter ? 2 : 1,
        triggerCharacter,
        isRetrigger: false,
      },
    });

    return (result ?? null) as LspSignatureHelp | null;
  }

  handleMessage(event: LspMessageEvent): void {
    const activeSession = this.session;
    if (!activeSession || event.sessionId !== activeSession.id) {
      return;
    }

    if (event.channel === "system") {
      if (event.isError) {
        this.markSessionDisconnected(event.payload);
      }
      return;
    }

    if (event.channel === "stderr") {
      const stderr = event.payload.trim();
      if (stderr.length > 0) {
        this.onOutput({
          channel: "lsp",
          level: event.isError ? "error" : "warning",
          message: stderr,
          dedupeKey: `lsp-stderr:${this.languageId}:${stderr}`,
        });
      }
      return;
    }

    const message = parseLspMessage(event.payload);
    if (!message) {
      return;
    }

    const responseId = toNumericResponseId(message.id);
    if (responseId !== null && this.pendingRequests.has(responseId)) {
      this.resolvePendingRequest(responseId, message);
      return;
    }

    const methodMessage = message as JsonRpcMethodMessage;

    if (methodMessage.method === "textDocument/publishDiagnostics") {
      this.handlePublishDiagnostics((methodMessage.params ?? {}) as PublishDiagnosticsParams);
      return;
    }

    if (methodMessage.method === "window/showMessage" || methodMessage.method === "window/logMessage") {
      const params = (methodMessage.params ?? {}) as LspMessageParams;
      if (params.message && params.message.trim().length > 0) {
        this.onOutput({
          channel: "lsp",
          level: params.type === 1 ? "error" : params.type === 2 ? "warning" : "info",
          message: params.message,
          dedupeKey: `lsp-log:${this.languageId}:${params.type ?? 0}:${params.message}`,
        });
      }
      return;
    }

    if ((message as JsonRpcErrorResponse).error?.message) {
      const errorMessage = (message as JsonRpcErrorResponse).error?.message ?? "Unknown LSP error";
      this.onOutput({
        channel: "lsp",
        level: "error",
        message: errorMessage,
        dedupeKey: `lsp-error:${this.languageId}:${errorMessage}`,
      });
    }
  }

  async stop(): Promise<void> {
    const activeSession = this.session;
    if (!activeSession) {
      return;
    }

    if (this.initialized) {
      try {
        await this.requestInternal("shutdown", null, {
          allowBeforeInitialized: true,
          timeoutMs: SHUTDOWN_TIMEOUT_MS,
        });
      } catch {
        // Ignore graceful shutdown failures, hard stop below.
      }

      try {
        await this.notifyInternal("exit", undefined, {
          allowBeforeInitialized: true,
        });
      } catch {
        // Ignore exit notification failures, hard stop below.
      }
    }

    try {
      await lspStop(activeSession.id);
    } catch (error) {
      this.onOutput({
        channel: "lsp",
        level: "warning",
        message: `Failed to stop ${this.languageId} language service: ${stringifyUnknownError(error)}`,
        dedupeKey: `lsp-stop-failure:${this.languageId}`,
      });
    }

    this.clearSessionState(true, "Language service stopped");
    this.nextStartAllowedAt = 0;
    this.setState("idle", null);
  }

  private async sendDocumentSync(path: string, text: string, version: number): Promise<void> {
    const key = normalizePathForLspKey(path);
    if (!this.openedDocumentKeys.has(key)) {
      await this.notifyInternal("textDocument/didOpen", {
        textDocument: {
          uri: toFileUri(path),
          languageId: this.languageId,
          version,
          text,
        },
      });
      this.openedDocumentKeys.add(key);
      this.onStatusChanged();
      return;
    }

    await this.notifyInternal("textDocument/didChange", {
      textDocument: {
        uri: toFileUri(path),
        version,
      },
      contentChanges: [
        {
          text,
        },
      ],
    });
  }

  private resolvePendingRequest(id: number, message: JsonRpcMessage): void {
    const pending = this.pendingRequests.get(id);
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(id);

    const responseError = (message as JsonRpcErrorResponse).error;
    if (responseError?.message) {
      pending.reject(new Error(responseError.message));
      return;
    }

    const responseResult = (message as { result?: unknown }).result;
    pending.resolve(responseResult);
  }

  private handlePublishDiagnostics(payload: PublishDiagnosticsParams): void {
    const path = payload.uri ? fromFileUri(payload.uri) : null;
    if (!path) {
      return;
    }

    const diagnostics: EditorDiagnostic[] = (payload.diagnostics ?? []).map((item: LspDiagnostic, index) => {
      const startLine = (item.range?.start.line ?? 0) + 1;
      const startColumn = (item.range?.start.character ?? 0) + 1;
      const endLine = (item.range?.end.line ?? item.range?.start.line ?? 0) + 1;
      const endColumn = (item.range?.end.character ?? (item.range?.start.character ?? 0) + 1) + 1;
      const code = stringifyDiagnosticCode(item.code);
      const message = item.message ?? `Unknown ${this.languageId} diagnostic`;
      const id = `${this.languageId}:${path}:${startLine}:${startColumn}:${message}:${index}`;

      return {
        id,
        path,
        line: startLine,
        column: startColumn,
        endLine,
        endColumn,
        severity: mapSeverity(item.severity),
        source: item.source ?? this.server,
        message,
        code: code ?? null,
      };
    });

    this.onDiagnostics(path, this.languageId, diagnostics);
  }

  private async sendRaw(payload: string): Promise<void> {
    const activeSession = this.session;
    if (!activeSession) {
      throw new Error("LSP session is not running");
    }

    try {
      await lspSend(activeSession.id, payload);
    } catch (error) {
      if (isDeadLspSessionError(error)) {
        this.markSessionDisconnected(error);
      }
      throw error;
    }
  }

  private async requestInternal<T>(
    method: string,
    params: unknown,
    options?: {
      allowBeforeInitialized?: boolean;
      timeoutMs?: number;
    },
  ): Promise<T> {
    if (!this.session) {
      throw new Error("LSP session is not running");
    }
    if (!options?.allowBeforeInitialized && !this.initialized) {
      throw new Error("LSP session is initializing");
    }

    const id = this.nextRequestId++;
    const timeoutMs = Math.max(1000, options?.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const response = new Promise<T>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, timeoutMs);

      const resolveUnknown = (value: unknown): void => {
        resolve(value as T);
      };

      this.pendingRequests.set(id, {
        timeoutId,
        method,
        resolve: resolveUnknown,
        reject,
      });
    });

    try {
      await this.sendRaw(JSON.stringify(request));
    } catch (error) {
      const pending = this.pendingRequests.get(id);
      if (pending) {
        window.clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(id);
      }
      throw error;
    }

    return response;
  }

  private async notifyInternal(
    method: string,
    params: unknown,
    options?: { allowBeforeInitialized?: boolean },
  ): Promise<void> {
    if (!this.session) {
      throw new Error("LSP session is not running");
    }
    if (!options?.allowBeforeInitialized && !this.initialized) {
      throw new Error("LSP session is initializing");
    }

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    await this.sendRaw(JSON.stringify(notification));
  }

  private markSessionDisconnected(reason: unknown): void {
    if (!this.session) {
      return;
    }

    const disconnectedSession = this.session;
    const message = stringifyUnknownError(reason).trim();
    this.nextStartAllowedAt = Date.now() + 1500;
    this.clearSessionState(false, message.length > 0 ? message : "Language service disconnected");
    this.setState("backoff", message.length > 0 ? message : null);

    this.onOutput({
      channel: "lsp",
      level: "warning",
      message:
        message.length > 0
          ? `Language service disconnected (${this.languageId}) and will restart automatically. (${message})`
          : `Language service disconnected (${this.languageId}) and will restart automatically.`,
      dedupeKey: `lsp-disconnected:${this.languageId}:${disconnectedSession.id}`,
    });
  }

  private clearSessionState(shouldClearWorkspaceRoot: boolean, reason?: string): void {
    this.rejectAllPendingRequests(reason ?? "LSP session closed");
    this.session = null;
    if (shouldClearWorkspaceRoot) {
      this.workspaceRoot = null;
    }
    this.initialized = false;
    this.capabilities = {};
    this.openedDocumentKeys.clear();
    this.onStatusChanged();
  }

  private rejectAllPendingRequests(reason: string): void {
    for (const pending of this.pendingRequests.values()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error(`${pending.method} aborted: ${reason}`));
    }
    this.pendingRequests.clear();
  }
}

export interface LspManagerOutputEntry {
  channel: OutputChannel;
  level: OutputLevel;
  message: string;
  dedupeKey?: string;
}

export interface LspDocumentSyncInput {
  languageId: LanguageId;
  workspaceRoot: string;
  path: string;
  text: string;
  version: number;
}

export interface LspPositionInput extends LspDocumentSyncInput {
  line: number;
  character: number;
}

export interface CreateLspManagerOptions {
  onDiagnostics: (path: string, diagnostics: EditorDiagnostic[]) => void;
  onOutput: (entry: LspManagerOutputEntry) => void;
  onServerStatusesChanged?: (statuses: LspServerStatus[]) => void;
}

export interface LspManager {
  syncDocument: (input: LspDocumentSyncInput) => Promise<void>;
  ensureServer: (languageId: LanguageId, workspaceRoot: string) => Promise<boolean>;
  restartServer: (languageId: LanguageId, workspaceRoot: string) => Promise<boolean>;
  stopServer: (languageId: LanguageId) => Promise<void>;
  saveDocument: (languageId: LanguageId, workspaceRoot: string, path: string) => Promise<void>;
  closeDocument: (languageId: LanguageId, path: string) => Promise<void>;
  closeDocumentsByPath: (path: string) => Promise<void>;
  handleMessage: (event: LspMessageEvent) => void;
  stopAll: () => Promise<void>;
  requestHover: (input: LspPositionInput) => Promise<LspHover | null>;
  requestDefinition: (input: LspPositionInput) => Promise<LspLocation[]>;
  requestReferences: (input: LspPositionInput, includeDeclaration?: boolean) => Promise<LspLocation[]>;
  requestCompletion: (
    input: LspPositionInput,
    triggerCharacter?: string,
  ) => Promise<LspCompletionList | null>;
  requestSignatureHelp: (
    input: LspPositionInput,
    triggerCharacter?: string,
  ) => Promise<LspSignatureHelp | null>;
  getCompletionTriggerCharacters: (languageId: LanguageId) => string[];
  getSignatureHelpTriggerCharacters: (languageId: LanguageId) => string[];
  getServerStatuses: () => LspServerStatus[];
}

export function createLspManager(options: CreateLspManagerOptions): LspManager {
  const clientsByLanguage = new Map<LanguageId, ManagedLanguageClient>();
  const lspDefinitions = getLanguageDefinitions().filter((definition) => Boolean(definition.lspServerCommand));

  function getServerStatuses(): LspServerStatus[] {
    const now = Date.now();
    return lspDefinitions.map((definition) => {
      const client = clientsByLanguage.get(definition.id);
      if (client) {
        return client.snapshotStatus();
      }

      return {
        languageId: definition.id,
        server: definition.lspServerCommand ?? "",
        state: "idle",
        sessionId: null,
        workspaceRoot: null,
        openedDocumentCount: 0,
        lastError: null,
        nextRetryAt: null,
        updatedAt: now,
      } satisfies LspServerStatus;
    });
  }

  function emitServerStatuses(): void {
    options.onServerStatusesChanged?.(getServerStatuses());
  }

  function resolveClient(languageId: LanguageId): ManagedLanguageClient | null {
    const cached = clientsByLanguage.get(languageId);
    if (cached) {
      return cached;
    }

    const definition = getLanguageDefinition(languageId);
    if (!definition.lspServerCommand) {
      return null;
    }

    const created = new ManagedLanguageClient({
      languageId,
      server: definition.lspServerCommand,
      args: definition.lspServerArgs ?? [],
      onStatusChanged: emitServerStatuses,
      onDiagnostics: (path, _language, diagnostics) => {
        options.onDiagnostics(path, diagnostics);
      },
      onOutput: (entry) => {
        options.onOutput(entry);
      },
    });

    clientsByLanguage.set(languageId, created);
    emitServerStatuses();
    return created;
  }

  async function prepareClient(input: LspDocumentSyncInput): Promise<ManagedLanguageClient | null> {
    const client = resolveClient(input.languageId);
    if (!client) {
      return null;
    }

    const started = await client.ensureStarted(input.workspaceRoot);
    if (!started) {
      return null;
    }

    await client.syncDocument(input.path, input.text, input.version);
    return client;
  }

  async function syncDocument(input: LspDocumentSyncInput): Promise<void> {
    await prepareClient(input);
  }

  async function ensureServer(languageId: LanguageId, workspaceRoot: string): Promise<boolean> {
    const client = resolveClient(languageId);
    if (!client) {
      return false;
    }

    const started = await client.ensureStarted(workspaceRoot);
    emitServerStatuses();
    return started;
  }

  async function restartServer(languageId: LanguageId, workspaceRoot: string): Promise<boolean> {
    const client = resolveClient(languageId);
    if (!client) {
      return false;
    }

    await client.stop();
    const started = await client.ensureStarted(workspaceRoot);
    emitServerStatuses();
    return started;
  }

  async function stopServer(languageId: LanguageId): Promise<void> {
    const client = clientsByLanguage.get(languageId);
    if (!client) {
      return;
    }

    await client.stop();
    emitServerStatuses();
  }

  async function saveDocument(languageId: LanguageId, workspaceRoot: string, path: string): Promise<void> {
    const client = resolveClient(languageId);
    if (!client) {
      return;
    }

    const started = await client.ensureStarted(workspaceRoot);
    if (!started) {
      return;
    }
    await client.saveDocument(path);
  }

  async function closeDocument(languageId: LanguageId, path: string): Promise<void> {
    const client = clientsByLanguage.get(languageId);
    if (!client) {
      return;
    }
    await client.closeDocument(path);
  }

  async function closeDocumentsByPath(path: string): Promise<void> {
    await Promise.all(
      [...clientsByLanguage.values()].map((client) => client.closeDocument(path)),
    );
  }

  function handleMessage(event: LspMessageEvent): void {
    for (const client of clientsByLanguage.values()) {
      if (client.getSessionId() === event.sessionId) {
        client.handleMessage(event);
        return;
      }
    }
  }

  async function stopAll(): Promise<void> {
    await Promise.all([...clientsByLanguage.values()].map((client) => client.stop()));
    clientsByLanguage.clear();
    emitServerStatuses();
  }

  async function requestHover(input: LspPositionInput): Promise<LspHover | null> {
    const client = await prepareClient(input);
    if (!client) {
      return null;
    }
    return client.requestHover(input.path, input.line, input.character);
  }

  async function requestDefinition(input: LspPositionInput): Promise<LspLocation[]> {
    const client = await prepareClient(input);
    if (!client) {
      return [];
    }
    return client.requestDefinition(input.path, input.line, input.character);
  }

  async function requestReferences(
    input: LspPositionInput,
    includeDeclaration = true,
  ): Promise<LspLocation[]> {
    const client = await prepareClient(input);
    if (!client) {
      return [];
    }
    return client.requestReferences(input.path, input.line, input.character, includeDeclaration);
  }

  async function requestCompletion(
    input: LspPositionInput,
    triggerCharacter?: string,
  ): Promise<LspCompletionList | null> {
    const client = await prepareClient(input);
    if (!client) {
      return null;
    }
    return client.requestCompletion(input.path, input.line, input.character, triggerCharacter);
  }

  async function requestSignatureHelp(
    input: LspPositionInput,
    triggerCharacter?: string,
  ): Promise<LspSignatureHelp | null> {
    const client = await prepareClient(input);
    if (!client) {
      return null;
    }
    return client.requestSignatureHelp(input.path, input.line, input.character, triggerCharacter);
  }

  function getCompletionTriggerCharacters(languageId: LanguageId): string[] {
    return clientsByLanguage.get(languageId)?.getCompletionTriggerCharacters() ?? [];
  }

  function getSignatureHelpTriggerCharacters(languageId: LanguageId): string[] {
    return clientsByLanguage.get(languageId)?.getSignatureHelpTriggerCharacters() ?? [];
  }

  emitServerStatuses();

  return {
    syncDocument,
    ensureServer,
    restartServer,
    stopServer,
    saveDocument,
    closeDocument,
    closeDocumentsByPath,
    handleMessage,
    stopAll,
    requestHover,
    requestDefinition,
    requestReferences,
    requestCompletion,
    requestSignatureHelp,
    getCompletionTriggerCharacters,
    getSignatureHelpTriggerCharacters,
    getServerStatuses,
  };
}
