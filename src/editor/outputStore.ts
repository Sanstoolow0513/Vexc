import type {
  EditorSignalState,
  OutputChannel,
  OutputEntry,
  OutputLevel,
  SignalsPanelTab,
} from "../types";

const OUTPUT_DEDUPE_WINDOW_MS = 2000;
const MAX_OUTPUT_ENTRIES = 500;

export interface OutputStoreState {
  entries: OutputEntry[];
  panelOpen: boolean;
  activeTab: SignalsPanelTab;
  unread: number;
}

export interface OutputEntryInput {
  channel: OutputChannel;
  level: OutputLevel;
  message: string;
  dedupeKey?: string;
  path?: string;
  line?: number;
  column?: number;
}

export function createInitialOutputStoreState(): OutputStoreState {
  return {
    entries: [],
    panelOpen: false,
    activeTab: "output",
    unread: 0,
  };
}

export function inferOutputLevelFromMessage(message: string): OutputLevel {
  const lowered = message.toLowerCase();
  if (lowered.includes("failed") || lowered.includes("error")) {
    return "error";
  }
  if (lowered.includes("warn")) {
    return "warning";
  }
  if (lowered.includes("debug")) {
    return "debug";
  }
  return "info";
}

export function appendOutputEntry(
  state: OutputStoreState,
  input: OutputEntryInput,
  timestamp = Date.now(),
): OutputStoreState {
  const dedupeKey = input.dedupeKey ?? `${input.channel}:${input.level}:${input.message}`;
  const lastEntry = state.entries[state.entries.length - 1];
  const shouldDedupe = Boolean(
    lastEntry &&
      lastEntry.dedupeKey === dedupeKey &&
      timestamp - lastEntry.timestamp <= OUTPUT_DEDUPE_WINDOW_MS,
  );

  const entries = shouldDedupe
    ? state.entries.map((entry, index) =>
      index === state.entries.length - 1
        ? {
            ...entry,
            count: entry.count + 1,
            timestamp,
          }
        : entry,
    )
    : [
        ...state.entries,
        {
          id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          channel: input.channel,
          level: input.level,
          message: input.message,
          timestamp,
          path: input.path,
          line: input.line,
          column: input.column,
          dedupeKey,
          count: 1,
        },
      ];

  const trimmedEntries = entries.slice(Math.max(entries.length - MAX_OUTPUT_ENTRIES, 0));
  return {
    ...state,
    entries: trimmedEntries,
    unread: state.panelOpen ? 0 : state.unread + (shouldDedupe ? 0 : 1),
  };
}

export function setOutputPanelOpen(state: OutputStoreState, open: boolean): OutputStoreState {
  return {
    ...state,
    panelOpen: open,
    unread: open ? 0 : state.unread,
  };
}

export function setOutputPanelTab(state: OutputStoreState, tab: SignalsPanelTab): OutputStoreState {
  return {
    ...state,
    activeTab: tab,
  };
}

export function clearOutputEntries(state: OutputStoreState): OutputStoreState {
  return {
    ...state,
    entries: [],
    unread: 0,
  };
}

export function buildSignalState(
  state: OutputStoreState,
  problemErrorCount: number,
  problemWarningCount: number,
): EditorSignalState {
  return {
    unread: state.unread,
    hasError: problemErrorCount > 0,
    hasWarning: problemWarningCount > 0,
    panelOpen: state.panelOpen,
    activeTab: state.activeTab,
  };
}
