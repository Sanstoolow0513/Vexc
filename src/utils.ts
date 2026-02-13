export function fileNameFromPath(path: string): string {
  const normalized = path.split("\\").join("/");
  const segments = normalized.split("/").filter((segment: string) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

export function detectLanguage(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".ts") || normalized.endsWith(".tsx")) {
    return "typescript";
  }
  if (normalized.endsWith(".js") || normalized.endsWith(".jsx")) {
    return "javascript";
  }
  if (normalized.endsWith(".rs")) {
    return "rust";
  }
  if (normalized.endsWith(".json")) {
    return "json";
  }
  if (normalized.endsWith(".md")) {
    return "markdown";
  }
  if (normalized.endsWith(".css")) {
    return "css";
  }
  if (normalized.endsWith(".html")) {
    return "html";
  }
  return "plaintext";
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
