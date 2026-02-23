import { AlertTriangle, Bell, CircleAlert } from "lucide-react";
import { ICON_SIZE_SM } from "../iconSizes";

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
      title="Errors"
      aria-label="Open errors panel"
      aria-haspopup="dialog"
      aria-expanded={signal.panelOpen}
      onClick={onTogglePanel}
    >
      {errorCount > 0
        ? <CircleAlert size={ICON_SIZE_SM} aria-hidden="true" />
        : warningCount > 0
          ? <AlertTriangle size={ICON_SIZE_SM} aria-hidden="true" />
          : <Bell size={ICON_SIZE_SM} aria-hidden="true" />}
      {totalBadge > 0 ? (
        <span className={`signals-badge ${severityClassName}`}>
          {totalBadge > 99 ? "99+" : totalBadge}
        </span>
      ) : null}
    </button>
  );
}

