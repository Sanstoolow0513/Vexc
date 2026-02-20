import { AlertTriangle, Bell, CircleAlert } from "lucide-react";

import type { EditorSignalState } from "../types";

interface HeaderSignalsProps {
  signal: EditorSignalState;
  problemCount: number;
  errorCount: number;
  warningCount: number;
  onTogglePanel: () => void;
}

export function HeaderSignals({
  signal,
  problemCount,
  errorCount,
  warningCount,
  onTogglePanel,
}: HeaderSignalsProps) {
  const totalBadge = signal.unread + problemCount;
  const severityClassName = errorCount > 0
    ? "severity-error"
    : warningCount > 0
      ? "severity-warning"
      : "severity-info";

  return (
    <button
      type="button"
      className={`menu-tab signals-trigger ${signal.panelOpen ? "active" : ""} ${severityClassName}`}
      title="Problems / Output"
      aria-label="Open problems and output panel"
      aria-haspopup="dialog"
      aria-expanded={signal.panelOpen}
      onClick={onTogglePanel}
    >
      {errorCount > 0
        ? <CircleAlert size={14} aria-hidden="true" />
        : warningCount > 0
          ? <AlertTriangle size={14} aria-hidden="true" />
          : <Bell size={14} aria-hidden="true" />}
      {totalBadge > 0 ? (
        <span className={`signals-badge ${severityClassName}`}>
          {totalBadge > 99 ? "99+" : totalBadge}
        </span>
      ) : null}
    </button>
  );
}
