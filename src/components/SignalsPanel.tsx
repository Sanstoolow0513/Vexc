import type { EditorDiagnostic } from "../types";

interface SignalsPanelProps {
  open: boolean;
  problems: readonly EditorDiagnostic[];
  onClose: () => void;
  onSelectProblem: (diagnostic: EditorDiagnostic) => void;
}

function formatProblemLocation(problem: EditorDiagnostic): string {
  return `${problem.path}:${problem.line}:${problem.column}`;
}

export function SignalsPanel({
  open,
  problems,
  onClose,
  onSelectProblem,
}: SignalsPanelProps) {
  if (!open) {
    return null;
  }

  const errorProblems = problems.filter((problem) => problem.severity === "error");

  return (
    <section className="signals-panel" role="dialog" aria-modal="false" aria-label="Errors">
      <header className="signals-panel-header">
        <h2 className="signals-panel-title">
          Errors
          <span className="signals-count">{errorProblems.length}</span>
        </h2>
        <button type="button" className="signals-close" onClick={onClose} aria-label="Close signals panel">
          Esc
        </button>
      </header>

      <div className="signals-panel-body">
        {errorProblems.length > 0 ? (
          <ul className="signals-list">
            {errorProblems.map((problem) => (
              <li key={problem.id}>
                <button
                  type="button"
                  className="signals-item severity-error"
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
          <div className="signals-empty">No errors.</div>
        )}
      </div>
    </section>
  );
}
