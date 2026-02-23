export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
}

export interface JsonRpcErrorObject {
  code?: number;
  message?: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc?: string;
  id?: number | string | null;
  error?: JsonRpcErrorObject;
}

export interface JsonRpcMethodMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcSuccessResponse | JsonRpcErrorResponse | JsonRpcMethodMessage;

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri?: string;
  range?: LspRange;
}

export interface LspTextEdit {
  range?: LspRange;
  newText?: string;
}

export type LspCompletionItemLabel =
  | string
  | {
    label?: string;
    detail?: string;
    description?: string;
  };

export interface LspMarkupContent {
  kind?: string;
  value?: string;
}

export type LspHoverContents =
  | string
  | LspMarkupContent
  | Array<string | LspMarkupContent>;

export interface LspHover {
  contents?: LspHoverContents;
  range?: LspRange;
}

export interface LspCompletionItem {
  label?: LspCompletionItemLabel;
  kind?: number;
  detail?: string;
  documentation?: string | LspMarkupContent;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: LspTextEdit;
}

export interface LspCompletionList {
  isIncomplete?: boolean;
  items?: LspCompletionItem[];
}

export interface LspSignatureInformation {
  label?: string;
  documentation?: string | LspMarkupContent;
  parameters?: Array<{
    label?: string | [number, number];
    documentation?: string | LspMarkupContent;
  }>;
}

export interface LspSignatureHelp {
  signatures?: LspSignatureInformation[];
  activeSignature?: number;
  activeParameter?: number;
}

export type LspDiagnosticCode = string | number | { value?: string | number };

export interface LspDiagnostic {
  range?: LspRange;
  severity?: number;
  message?: string;
  source?: string;
  code?: LspDiagnosticCode;
}

export interface PublishDiagnosticsParams {
  uri?: string;
  diagnostics?: LspDiagnostic[];
}

export interface InitializeResult {
  capabilities?: ServerCapabilities;
}

export interface CompletionOptions {
  triggerCharacters?: string[];
}

export interface SignatureHelpOptions {
  triggerCharacters?: string[];
}

export interface ServerCapabilities {
  hoverProvider?: boolean | Record<string, unknown>;
  definitionProvider?: boolean | Record<string, unknown>;
  referencesProvider?: boolean | Record<string, unknown>;
  completionProvider?: CompletionOptions;
  signatureHelpProvider?: SignatureHelpOptions;
  textDocumentSync?: number | { openClose?: boolean; change?: number; save?: boolean | Record<string, unknown> };
}
