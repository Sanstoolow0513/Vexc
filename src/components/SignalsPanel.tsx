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

  const countBySeverity = problems.reduce<Record<EditorDiagnostic["severity"], number>>((accumulator, problem) => {
    accumulator[problem.severity] += 1;
    return accumulator;
  }, {
    error: 0,
    warning: 0,
    info: 0,
    hint: 0,
  });

  return (
    <section className="signals-panel" role="dialog" aria-modal="false" aria-label="Problems">
      <header className="signals-panel-header">
        <h2 className="signals-panel-title">
          Problems
          <span className="signals-count">{problems.length}</span>
        </h2>
        <div className="signals-summary" aria-hidden="true">
          <span className="signals-summary-item severity-error">E {countBySeverity.error}</span>
          <span className="signals-summary-item severity-warning">W {countBySeverity.warning}</span>
          <span className="signals-summary-item severity-info">I {countBySeverity.info}</span>
          <span className="signals-summary-item">H {countBySeverity.hint}</span>
        </div>
        <button type="button" className="signals-close" onClick={onClose} aria-label="Close signals panel">
          Esc
        </button>
      </header>

      <div className="signals-panel-body">
        {problems.length > 0 ? (
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
                  <span className="signals-item-meta">{problem.source} · {problem.severity}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="signals-empty">No problems.</div>
        )}
      </div>
    </section>
  );
}
