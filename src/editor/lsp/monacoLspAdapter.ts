import type { Uri, editor as MonacoEditor, IDisposable, languages as MonacoLanguages } from "monaco-editor";

import type { LanguageId } from "../../types";
import { getLanguageDefinitions } from "../languageRegistry";
import type {
  LspCompletionItem,
  LspCompletionList,
  LspHover,
  LspLocation,
  LspMarkupContent,
  LspSignatureHelp,
} from "./protocol";
import { fromFileUri } from "./uri";

const DEFAULT_COMPLETION_TRIGGER_CHARACTERS = [".", ":", "/", "'", "\"", "@", "#"];
const DEFAULT_SIGNATURE_TRIGGER_CHARACTERS = ["(", ","];

interface MonacoRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface MonacoLspRequestInput {
  languageId: LanguageId;
  workspaceRoot: string;
  path: string;
  text: string;
  version: number;
  line: number;
  character: number;
}

export interface MonacoLspBridge {
  getWorkspaceRoot: () => string | null;
  getActivePath: () => string | null;
  requestHover: (input: MonacoLspRequestInput) => Promise<LspHover | null>;
  requestDefinition: (input: MonacoLspRequestInput) => Promise<LspLocation[]>;
  requestReferences: (
    input: MonacoLspRequestInput,
    includeDeclaration?: boolean,
  ) => Promise<LspLocation[]>;
  requestCompletion: (
    input: MonacoLspRequestInput,
    triggerCharacter?: string,
  ) => Promise<LspCompletionList | null>;
  requestSignatureHelp: (
    input: MonacoLspRequestInput,
    triggerCharacter?: string,
  ) => Promise<LspSignatureHelp | null>;
  getCompletionTriggerCharacters: (languageId: LanguageId) => string[];
  getSignatureHelpTriggerCharacters: (languageId: LanguageId) => string[];
}

function isMarkupContent(value: unknown): value is LspMarkupContent {
  return Boolean(value && typeof value === "object" && "value" in value);
}

function markdownValueFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => markdownValueFromUnknown(item)).filter((item) => item.length > 0).join("\n\n");
  }

  if (isMarkupContent(value)) {
    return typeof value.value === "string" ? value.value : "";
  }

  if (value && typeof value === "object" && "language" in value && "value" in value) {
    const entry = value as { language?: string; value?: string };
    if (entry.value && entry.language) {
      return `\`\`\`${entry.language}\n${entry.value}\n\`\`\``;
    }
    return entry.value ?? "";
  }

  return "";
}

function toMonacoRange(range: LspLocation["range"], monacoApi: typeof import("monaco-editor")): MonacoRange | null {
  if (!range) {
    return null;
  }

  return new monacoApi.Range(
    (range.start.line ?? 0) + 1,
    (range.start.character ?? 0) + 1,
    (range.end.line ?? range.start.line ?? 0) + 1,
    (range.end.character ?? range.start.character ?? 0) + 1,
  );
}

function toMonacoUri(location: LspLocation, monacoApi: typeof import("monaco-editor")): Uri | null {
  if (!location.uri) {
    return null;
  }

  try {
    return monacoApi.Uri.parse(location.uri);
  } catch {
    return null;
  }
}

function mapCompletionKind(kind: number | undefined, monacoApi: typeof import("monaco-editor")): MonacoLanguages.CompletionItemKind {
  switch (kind) {
    case 2:
      return monacoApi.languages.CompletionItemKind.Method;
    case 3:
      return monacoApi.languages.CompletionItemKind.Function;
    case 4:
      return monacoApi.languages.CompletionItemKind.Constructor;
    case 5:
      return monacoApi.languages.CompletionItemKind.Field;
    case 6:
      return monacoApi.languages.CompletionItemKind.Variable;
    case 7:
      return monacoApi.languages.CompletionItemKind.Class;
    case 8:
      return monacoApi.languages.CompletionItemKind.Interface;
    case 9:
      return monacoApi.languages.CompletionItemKind.Module;
    case 10:
      return monacoApi.languages.CompletionItemKind.Property;
    case 11:
      return monacoApi.languages.CompletionItemKind.Unit;
    case 12:
      return monacoApi.languages.CompletionItemKind.Value;
    case 13:
      return monacoApi.languages.CompletionItemKind.Enum;
    case 14:
      return monacoApi.languages.CompletionItemKind.Keyword;
    case 15:
      return monacoApi.languages.CompletionItemKind.Snippet;
    case 16:
      return monacoApi.languages.CompletionItemKind.Color;
    case 17:
      return monacoApi.languages.CompletionItemKind.File;
    case 18:
      return monacoApi.languages.CompletionItemKind.Reference;
    case 19:
      return monacoApi.languages.CompletionItemKind.Folder;
    case 20:
      return monacoApi.languages.CompletionItemKind.EnumMember;
    case 21:
      return monacoApi.languages.CompletionItemKind.Constant;
    case 22:
      return monacoApi.languages.CompletionItemKind.Struct;
    case 23:
      return monacoApi.languages.CompletionItemKind.Event;
    case 24:
      return monacoApi.languages.CompletionItemKind.Operator;
    case 25:
      return monacoApi.languages.CompletionItemKind.TypeParameter;
    default:
      return monacoApi.languages.CompletionItemKind.Text;
  }
}

function completionItemLabel(item: LspCompletionItem): MonacoLanguages.CompletionItemLabel | string | null {
  const label = item.label;
  if (typeof label === "string") {
    return label;
  }
  if (label && typeof label === "object") {
    if (!label.label) {
      return null;
    }
    return {
      label: label.label,
      detail: label.detail,
      description: label.description,
    };
  }
  return null;
}

function completionItemPrimaryLabel(item: LspCompletionItem): string {
  if (typeof item.label === "string") {
    return item.label;
  }
  if (item.label && typeof item.label === "object" && item.label.label) {
    return item.label.label;
  }
  return "";
}

function resolveModelPath(
  model: MonacoEditor.ITextModel,
  getActivePath: () => string | null,
): string | null {
  const modelUri = model.uri.toString();
  const fromUri = fromFileUri(modelUri);
  if (fromUri) {
    return fromUri;
  }

  if (model.uri.scheme === "file") {
    const normalized = decodeURIComponent(model.uri.path);
    if (/^\/[a-zA-Z]:/.test(normalized)) {
      return normalized.slice(1).replace(/\//g, "\\");
    }
  }

  return getActivePath();
}

function buildRequestInput(
  model: MonacoEditor.ITextModel,
  position: { lineNumber: number; column: number },
  languageId: LanguageId,
  bridge: MonacoLspBridge,
): MonacoLspRequestInput | null {
  const workspaceRoot = bridge.getWorkspaceRoot();
  if (!workspaceRoot) {
    return null;
  }

  const path = resolveModelPath(model, bridge.getActivePath);
  if (!path) {
    return null;
  }

  return {
    languageId,
    workspaceRoot,
    path,
    text: model.getValue(),
    version: model.getVersionId(),
    line: Math.max(0, position.lineNumber - 1),
    character: Math.max(0, position.column - 1),
  };
}

function mapLspCompletionItems(
  list: LspCompletionList,
  model: MonacoEditor.ITextModel,
  position: { lineNumber: number; column: number },
  monacoApi: typeof import("monaco-editor"),
): MonacoLanguages.CompletionList {
  const fallbackWord = model.getWordUntilPosition(position);
  const fallbackRange = new monacoApi.Range(
    position.lineNumber,
    fallbackWord.startColumn,
    position.lineNumber,
    fallbackWord.endColumn,
  );

  const suggestions = (list.items ?? [])
    .map((item): MonacoLanguages.CompletionItem | null => {
      const label = completionItemLabel(item);
      if (!label) {
        return null;
      }

      const labelText = completionItemPrimaryLabel(item);
      if (!labelText) {
        return null;
      }

      const textEditRange = item.textEdit?.range
        ? toMonacoRange(item.textEdit.range, monacoApi)
        : null;

      const insertText = item.textEdit?.newText ?? item.insertText ?? labelText;

      return {
        label,
        kind: mapCompletionKind(item.kind, monacoApi),
        insertText,
        insertTextRules:
          item.insertTextFormat === 2
            ? monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : monacoApi.languages.CompletionItemInsertTextRule.None,
        detail: item.detail,
        documentation: markdownValueFromUnknown(item.documentation),
        sortText: item.sortText,
        filterText: item.filterText,
        range: textEditRange ?? fallbackRange,
      };
    })
    .filter((item): item is MonacoLanguages.CompletionItem => item !== null);

  return {
    suggestions,
    incomplete: Boolean(list.isIncomplete),
  };
}

export function registerMonacoLspProviders(
  monacoApi: typeof import("monaco-editor"),
  bridge: MonacoLspBridge,
): IDisposable[] {
  const languageByMonacoId = new Map<string, LanguageId>();
  for (const definition of getLanguageDefinitions()) {
    if (!definition.lspServerCommand) {
      continue;
    }
    if (!languageByMonacoId.has(definition.monacoLanguageId)) {
      languageByMonacoId.set(definition.monacoLanguageId, definition.id);
    }
  }

  const disposables: IDisposable[] = [];

  for (const [monacoLanguageId, languageId] of languageByMonacoId.entries()) {
    const completionTriggerCharacters = Array.from(
      new Set([
        ...DEFAULT_COMPLETION_TRIGGER_CHARACTERS,
        ...bridge.getCompletionTriggerCharacters(languageId),
      ]),
    );
    const signatureTriggerCharacters = Array.from(
      new Set([
        ...DEFAULT_SIGNATURE_TRIGGER_CHARACTERS,
        ...bridge.getSignatureHelpTriggerCharacters(languageId),
      ]),
    );

    disposables.push(
      monacoApi.languages.registerHoverProvider(monacoLanguageId, {
        provideHover: async (model, position): Promise<MonacoLanguages.Hover | null> => {
          const input = buildRequestInput(model, position, languageId, bridge);
          if (!input) {
            return null;
          }

          const hover = await bridge.requestHover(input);
          if (!hover) {
            return null;
          }

          const value = markdownValueFromUnknown(hover.contents);
          if (!value) {
            return null;
          }

          return {
            range: toMonacoRange(hover.range, monacoApi) ?? undefined,
            contents: [{ value }],
          };
        },
      }),
    );

    disposables.push(
      monacoApi.languages.registerDefinitionProvider(monacoLanguageId, {
        provideDefinition: async (model, position): Promise<MonacoLanguages.Location[]> => {
          const input = buildRequestInput(model, position, languageId, bridge);
          if (!input) {
            return [];
          }

          const locations = await bridge.requestDefinition(input);
          return locations
            .map((location): MonacoLanguages.Location | null => {
              const uri = toMonacoUri(location, monacoApi);
              const range = toMonacoRange(location.range, monacoApi);
              if (!uri || !range) {
                return null;
              }
              return {
                uri,
                range,
              };
            })
            .filter((entry): entry is MonacoLanguages.Location => entry !== null);
        },
      }),
    );

    disposables.push(
      monacoApi.languages.registerReferenceProvider(monacoLanguageId, {
        provideReferences: async (
          model,
          position,
          context,
        ): Promise<MonacoLanguages.Location[]> => {
          const input = buildRequestInput(model, position, languageId, bridge);
          if (!input) {
            return [];
          }

          const references = await bridge.requestReferences(input, context.includeDeclaration);
          return references
            .map((location): MonacoLanguages.Location | null => {
              const uri = toMonacoUri(location, monacoApi);
              const range = toMonacoRange(location.range, monacoApi);
              if (!uri || !range) {
                return null;
              }
              return {
                uri,
                range,
              };
            })
            .filter((entry): entry is MonacoLanguages.Location => entry !== null);
        },
      }),
    );

    disposables.push(
      monacoApi.languages.registerCompletionItemProvider(monacoLanguageId, {
        triggerCharacters: completionTriggerCharacters,
        provideCompletionItems: async (
          model,
          position,
          context,
        ): Promise<MonacoLanguages.CompletionList> => {
          const input = buildRequestInput(model, position, languageId, bridge);
          if (!input) {
            return { suggestions: [] };
          }

          const completionList = await bridge.requestCompletion(input, context.triggerCharacter);
          if (!completionList) {
            return { suggestions: [] };
          }

          return mapLspCompletionItems(completionList, model, position, monacoApi);
        },
      }),
    );

    disposables.push(
      monacoApi.languages.registerSignatureHelpProvider(monacoLanguageId, {
        signatureHelpTriggerCharacters: signatureTriggerCharacters,
        provideSignatureHelp: async (
          model,
          position,
          _token,
          context,
        ): Promise<MonacoLanguages.SignatureHelpResult | null> => {
          const input = buildRequestInput(model, position, languageId, bridge);
          if (!input) {
            return null;
          }

          const signatureHelp = await bridge.requestSignatureHelp(input, context.triggerCharacter);
          if (!signatureHelp || !signatureHelp.signatures || signatureHelp.signatures.length === 0) {
            return null;
          }

          const signatures: MonacoLanguages.SignatureInformation[] = signatureHelp.signatures
            .map((signature) => {
              const params = (signature.parameters ?? []).map((parameter) => {
                let parameterLabel = "";
                if (typeof parameter.label === "string") {
                  parameterLabel = parameter.label;
                } else if (
                  Array.isArray(parameter.label)
                  && parameter.label.length === 2
                  && typeof signature.label === "string"
                ) {
                  parameterLabel = signature.label.slice(parameter.label[0], parameter.label[1]);
                }

                return {
                  label: parameterLabel,
                  documentation: markdownValueFromUnknown(parameter.documentation),
                };
              });

              return {
                label: signature.label ?? "",
                documentation: markdownValueFromUnknown(signature.documentation),
                parameters: params,
              };
            })
            .filter((signature) => signature.label.length > 0);

          if (signatures.length === 0) {
            return null;
          }

          return {
            value: {
              signatures,
              activeSignature: signatureHelp.activeSignature ?? 0,
              activeParameter: signatureHelp.activeParameter ?? 0,
            },
            dispose: () => {},
          };
        },
      }),
    );
  }

  return disposables;
}
