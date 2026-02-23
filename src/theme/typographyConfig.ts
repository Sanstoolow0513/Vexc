export interface TypographyConfig {
  uiFontFamily: string;
  codeFontFamily: string;
  uiFontSize: {
    xs: number;
    sm: number;
    base: number;
    lg: number;
  };
  codeFontSize: {
    default: number;
    min: number;
    max: number;
  };
  codeLineHeightRatio: number;
  terminalLineHeightRatio: number;
}

export const DEFAULT_TYPOGRAPHY_CONFIG: TypographyConfig = {
  uiFontFamily: '"Space Grotesk", "Inter", "Segoe UI", sans-serif',
  codeFontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
  uiFontSize: {
    xs: 11,
    sm: 12,
    base: 13,
    lg: 14,
  },
  codeFontSize: {
    default: 13,
    min: 10,
    max: 24,
  },
  codeLineHeightRatio: 18 / 13,
  terminalLineHeightRatio: 1,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function getString(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  return value;
}

function parseTypographyConfig(raw: unknown): TypographyConfig {
  if (!isRecord(raw)) {
    return DEFAULT_TYPOGRAPHY_CONFIG;
  }

  const uiFontSize = isRecord(raw.uiFontSize) ? raw.uiFontSize : {};
  const codeFontSize = isRecord(raw.codeFontSize) ? raw.codeFontSize : {};

  return {
    uiFontFamily: getString(raw.uiFontFamily, DEFAULT_TYPOGRAPHY_CONFIG.uiFontFamily),
    codeFontFamily: getString(raw.codeFontFamily, DEFAULT_TYPOGRAPHY_CONFIG.codeFontFamily),
    uiFontSize: {
      xs: getNumber(uiFontSize.xs, DEFAULT_TYPOGRAPHY_CONFIG.uiFontSize.xs),
      sm: getNumber(uiFontSize.sm, DEFAULT_TYPOGRAPHY_CONFIG.uiFontSize.sm),
      base: getNumber(uiFontSize.base, DEFAULT_TYPOGRAPHY_CONFIG.uiFontSize.base),
      lg: getNumber(uiFontSize.lg, DEFAULT_TYPOGRAPHY_CONFIG.uiFontSize.lg),
    },
    codeFontSize: {
      default: getNumber(codeFontSize.default, DEFAULT_TYPOGRAPHY_CONFIG.codeFontSize.default),
      min: getNumber(codeFontSize.min, DEFAULT_TYPOGRAPHY_CONFIG.codeFontSize.min),
      max: getNumber(codeFontSize.max, DEFAULT_TYPOGRAPHY_CONFIG.codeFontSize.max),
    },
    codeLineHeightRatio: getNumber(
      raw.codeLineHeightRatio,
      DEFAULT_TYPOGRAPHY_CONFIG.codeLineHeightRatio,
    ),
    terminalLineHeightRatio: getNumber(
      raw.terminalLineHeightRatio,
      DEFAULT_TYPOGRAPHY_CONFIG.terminalLineHeightRatio,
    ),
  };
}

export async function loadTypographyConfig(): Promise<TypographyConfig> {
  const response = await fetch("/config/typography.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to read typography config: ${response.status}`);
  }

  const raw = (await response.json()) as unknown;
  return parseTypographyConfig(raw);
}

export function applyTypographyCssVariables(config: TypographyConfig): void {
  const root = document.documentElement;
  root.style.setProperty("--sans", config.uiFontFamily);
  root.style.setProperty("--mono", config.codeFontFamily);
}
