import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { ICON_SIZE_SM } from "../iconSizes";

import type { FeedbackLevel, ToastNotification } from "../types";

interface ToastViewportProps {
  toasts: readonly ToastNotification[];
  onDismiss: (id: string) => void;
}

function roleForToastLevel(level: FeedbackLevel): "alert" | "status" {
  if (level === "error" || level === "warning") {
    return "alert";
  }
  return "status";
}

function iconForToastLevel(level: FeedbackLevel) {
  if (level === "success") {
    return <CheckCircle2 size={ICON_SIZE_SM} aria-hidden="true" />;
  }
  if (level === "error") {
    return <CircleAlert size={ICON_SIZE_SM} aria-hidden="true" />;
  }
  if (level === "warning") {
    return <AlertTriangle size={ICON_SIZE_SM} aria-hidden="true" />;
  }
  return <Info size={ICON_SIZE_SM} aria-hidden="true" />;
}

export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  return (
    <section className="toast-viewport" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => (
        <article
          key={toast.id}
          className={`toast-item toast-${toast.level}`}
          role={roleForToastLevel(toast.level)}
        >
          <span className="toast-icon">{iconForToastLevel(toast.level)}</span>
          <p className="toast-message">{toast.message}</p>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            <X size={ICON_SIZE_SM} aria-hidden="true" />
          </button>
        </article>
      ))}
    </section>
  );
}

