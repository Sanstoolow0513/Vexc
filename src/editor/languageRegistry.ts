import type { LanguageId } from "../types";

export interface LanguageDefinition {
  id: LanguageId;
  extensions: readonly string[];
  monacoLanguageId: string;
  lspServerCommand?: string;
  lspServerArgs?: readonly string[];
}

const LANGUAGE_DEFINITIONS: readonly LanguageDefinition[] = [
  {
    id: "typescript",
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    monacoLanguageId: "typescript",
  },
  {
    id: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    monacoLanguageId: "javascript",
  },
  {
    id: "json",
    extensions: [".json", ".jsonc"],
    monacoLanguageId: "json",
  },
  {
    id: "css",
    extensions: [".css", ".scss", ".less"],
    monacoLanguageId: "css",
  },
  {
    id: "html",
    extensions: [".html", ".htm", ".xhtml"],
    monacoLanguageId: "html",
  },
  {
    id: "markdown",
    extensions: [".md", ".markdown", ".mdx"],
    monacoLanguageId: "markdown",
  },
  {
    id: "rust",
    extensions: [".rs"],
    monacoLanguageId: "rust",
    lspServerCommand: "rust-analyzer",
    lspServerArgs: [],
  },
];

const EXTENSION_TO_LANGUAGE_ID = LANGUAGE_DEFINITIONS.reduce<Record<string, LanguageId>>(
  (accumulator, language) => {
    for (const extension of language.extensions) {
      accumulator[extension] = language.id;
    }
    return accumulator;
  },
  {},
);

const LANGUAGE_ID_TO_DEFINITION = LANGUAGE_DEFINITIONS.reduce<Record<LanguageId, LanguageDefinition>>(
  (accumulator, language) => {
    accumulator[language.id] = language;
    return accumulator;
  },
  {
    plaintext: {
      id: "plaintext",
      extensions: [],
      monacoLanguageId: "plaintext",
    },
    javascript: {
      id: "javascript",
      extensions: [],
      monacoLanguageId: "javascript",
    },
    typescript: {
      id: "typescript",
      extensions: [],
      monacoLanguageId: "typescript",
    },
    json: {
      id: "json",
      extensions: [],
      monacoLanguageId: "json",
    },
    css: {
      id: "css",
      extensions: [],
      monacoLanguageId: "css",
    },
    html: {
      id: "html",
      extensions: [],
      monacoLanguageId: "html",
    },
    markdown: {
      id: "markdown",
      extensions: [],
      monacoLanguageId: "markdown",
    },
    rust: {
      id: "rust",
      extensions: [],
      monacoLanguageId: "rust",
      lspServerCommand: "rust-analyzer",
      lspServerArgs: [],
    },
  },
);

function extensionFromPath(path: string): string {
  const normalized = path.trim().toLowerCase();
  const lastDotIndex = normalized.lastIndexOf(".");
  if (lastDotIndex < 0) {
    return "";
  }
  return normalized.slice(lastDotIndex);
}

export function detectLanguageFromPath(path: string): LanguageId {
  const extension = extensionFromPath(path);
  if (!extension) {
    return "plaintext";
  }
  return EXTENSION_TO_LANGUAGE_ID[extension] ?? "plaintext";
}

export function getLanguageDefinition(languageId: LanguageId): LanguageDefinition {
  return LANGUAGE_ID_TO_DEFINITION[languageId];
}

export function getLanguageDefinitions(): readonly LanguageDefinition[] {
  return LANGUAGE_DEFINITIONS;
}
