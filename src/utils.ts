import { detectLanguageFromPath } from "./editor/languageRegistry";
import type { LanguageId } from "./types";

export function fileNameFromPath(path: string): string {
  const normalized = path.split("\\").join("/");
  const segments = normalized.split("/").filter((segment: string) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

export function detectLanguage(path: string): LanguageId {
  return detectLanguageFromPath(path);
}

export function splitArgs(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  let match = pattern.exec(input);
  while (match !== null) {
    const token = match[1] ?? match[2] ?? match[3];
    if (token) {
      tokens.push(token);
    }
    match = pattern.exec(input);
  }
  return tokens;
}
