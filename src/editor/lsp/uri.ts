export function toFileUri(path: string): string {
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

export function fromFileUri(uri: string): string | null {
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

export function normalizePathForLspKey(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")) {
    return normalized.toLowerCase();
  }
  return normalized || path;
}
