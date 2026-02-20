import type {
  EditorDiagnostic,
  OutputEntry,
  OutputLevel,
  SignalsPanelTab,
} from "../types";

type OutputLevelFilter = OutputLevel | "all";

interface SignalsPanelProps {
  open: boolean;
  activeTab: SignalsPanelTab;
  statusMessage: string;
  problems: readonly EditorDiagnostic[];
  outputEntries: readonly OutputEntry[];
  outputLevelFilter: OutputLevelFilter;
  onClose: () => void;
  onTabChange: (tab: SignalsPanelTab) => void;
  onOutputLevelFilterChange: (nextFilter: OutputLevelFilter) => void;
  onSelectProblem: (diagnostic: EditorDiagnostic) => void;
  onClearOutput: () => void;
}

function formatTimestamp(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch {
    return "";
  }
}

function formatProblemLocation(problem: EditorDiagnostic): string {
  return `${problem.path}:${problem.line}:${problem.column}`;
}

export function SignalsPanel({
  open,
  activeTab,
  statusMessage,
  problems,
  outputEntries,
  outputLevelFilter,
  onClose,
  onTabChange,
  onOutputLevelFilterChange,
  onSelectProblem,
  onClearOutput,
}: SignalsPanelProps) {
  if (!open) {
    return null;
  }

  return (
    <section className="signals-panel" role="dialog" aria-modal="false" aria-label="Problems and output">
      <header className="signals-panel-header">
        <div className="signals-panel-tabs">
          <button
            type="button"
            className={`signals-tab ${activeTab === "problems" ? "active" : ""}`}
            onClick={() => onTabChange("problems")}
          >
            Problems
            <span className="signals-count">{problems.length}</span>
          </button>
          <button
            type="button"
            className={`signals-tab ${activeTab === "output" ? "active" : ""}`}
            onClick={() => onTabChange("output")}
          >
            Output
            <span className="signals-count">{outputEntries.length}</span>
          </button>
        </div>
        <button type="button" className="signals-close" onClick={onClose} aria-label="Close signals panel">
          Esc
        </button>
      </header>

      <div className="signals-panel-subheader">
        <span className="signals-status-message">{statusMessage}</span>
        {activeTab === "output" ? (
          <div className="signals-tools">
            <select
              value={outputLevelFilter}
              className="signals-filter"
              onChange={(event) => onOutputLevelFilterChange(event.target.value as OutputLevelFilter)}
            >
              <option value="all">All Levels</option>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
            <button type="button" className="signals-clear" onClick={onClearOutput}>
              Clear
            </button>
          </div>
        ) : null}
      </div>

      <div className="signals-panel-body">
        {activeTab === "problems" ? (
          problems.length > 0 ? (
            <ul className="signals-list">
              {problems.map((problem) => (
                <li key={problem.id}>
                  <button
                    type="button"
                    className={`signals-item severity-${problem.severity}`}
                    onClick={() => onSelectProblem(problem)}
                  >
                    <span className="signals-item-title">{problem.message}</span>
                    <span className="signals-item-meta">{formatProblemLocation(problem)}</span>
                    <span className="signals-item-meta">{problem.source}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="signals-empty">No problems.</div>
          )
        ) : outputEntries.length > 0 ? (
          <ul className="signals-list">
            {outputEntries.map((entry) => (
              <li key={entry.id}>
                <div className={`signals-item severity-${entry.level}`}>
                  <span className="signals-item-title">{entry.message}</span>
                  <span className="signals-item-meta">
                    [{entry.channel}] {formatTimestamp(entry.timestamp)}{entry.count > 1 ? ` x${entry.count}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="signals-empty">No output.</div>
        )}
      </div>
    </section>
  );
}
