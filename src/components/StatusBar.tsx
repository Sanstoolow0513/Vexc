import type {
  FeedbackLevel,
  StatusBarFileInfo,
  StatusBarTerminalInfo,
} from "../types";

interface StatusBarProps {
  statusMessage: string;
  statusLevel: FeedbackLevel;
  workspaceName: string | null;
  activeWorkbenchTabKind: "file" | "terminal";
  activeFile: StatusBarFileInfo | null;
  activeTerminal: StatusBarTerminalInfo | null;
}

const STATUS_LABELS: Record<FeedbackLevel, string> = {
  success: "SUCCESS",
  error: "ERROR",
  warning: "WARNING",
  info: "INFO",
};

export function StatusBar({
  statusMessage,
  statusLevel,
  workspaceName,
  activeWorkbenchTabKind,
  activeFile,
  activeTerminal,
}: StatusBarProps) {
  return (
    <footer className="status-bar" role="status" aria-live="polite">
      <div className="status-bar-main">
        <span className={`status-level-chip ${statusLevel}`}>
          {STATUS_LABELS[statusLevel]}
        </span>
        <span className="status-message" title={statusMessage}>
          {statusMessage}
        </span>
      </div>

      <div className="status-bar-meta">
        <span className="status-meta-chip">{workspaceName ?? "No Workspace"}</span>

        {activeWorkbenchTabKind === "file" ? (
          activeFile ? (
            <>
              <span className={`status-meta-chip ${activeFile.isDirty ? "dirty" : ""}`}>
                {activeFile.title}
                {activeFile.isDirty ? " *" : ""}
              </span>
              <span className="status-meta-chip status-meta-path" title={activeFile.path}>
                {activeFile.path}
              </span>
              <span className="status-meta-chip">{activeFile.language}</span>
            </>
          ) : (
            <span className="status-meta-chip muted">No Active File</span>
          )
        ) : activeTerminal ? (
          <>
            <span className="status-meta-chip">{activeTerminal.title}</span>
            <span className="status-meta-chip status-meta-path" title={activeTerminal.cwd}>
              {activeTerminal.cwd}
            </span>
            <span className={`status-meta-chip ${activeTerminal.status === "running" ? "running" : "muted"}`}>
              {activeTerminal.status}
            </span>
          </>
        ) : (
          <span className="status-meta-chip muted">No Active Terminal</span>
        )}
      </div>
    </footer>
  );
}
