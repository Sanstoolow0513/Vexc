import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { FileKind } from "../../types";

const TREE_DROP_TARGET_SELECTOR = "[data-tree-drop-path]";
const CLICK_SUPPRESSION_TIMEOUT_MS = 0;
const DROP_TARGET_GRACE_MS = 80;

export interface TreeDragSource {
  path: string;
  kind: FileKind;
}

export type TreeDnDStatus = "idle" | "arming" | "dragging" | "committing";

export type TreeDropRejectionReason =
  | "missing-source"
  | "same-path"
  | "same-parent"
  | "target-inside-source";

export interface DropValidationResult {
  ok: boolean;
  reason: TreeDropRejectionReason | null;
}

export interface TreeDnDState {
  status: TreeDnDStatus;
  dragSourcePath: string | null;
  dragSourceKind: FileKind | null;
  dropTargetPath: string | null;
  invalidDropTargetPath: string | null;
  dropRejectionReason: TreeDropRejectionReason | null;
}

interface UseTreeDragDropOptions {
  dragThresholdPx: number;
  isSamePath: (left: string, right: string) => boolean;
  validateDrop: (source: TreeDragSource | null, targetDirectoryPath: string) => DropValidationResult;
  onDrop: (source: TreeDragSource, targetDirectoryPath: string) => void | Promise<void>;
  onDragStart?: (source: TreeDragSource) => void;
  onDropRejected?: (
    reason: TreeDropRejectionReason,
    source: TreeDragSource | null,
    targetDirectoryPath: string,
  ) => void;
  resolveDropTargetPathFromPoint?: (clientX: number, clientY: number) => string | null;
}

interface UseTreeDragDropResult {
  dndState: TreeDnDState;
  consumeClickSuppression: () => boolean;
  clearTreeDragDropState: () => void;
  handleTreePointerDown: (event: ReactPointerEvent<HTMLElement>, source: TreeDragSource) => void;
}

const INITIAL_TREE_DND_STATE: TreeDnDState = {
  status: "idle",
  dragSourcePath: null,
  dragSourceKind: null,
  dropTargetPath: null,
  invalidDropTargetPath: null,
  dropRejectionReason: null,
};

function resolveDropTargetPathFromDom(clientX: number, clientY: number): string | null {
  const elementAtPointer = document.elementFromPoint(clientX, clientY);
  if (!(elementAtPointer instanceof Element)) {
    return null;
  }

  const dropTargetElement = elementAtPointer.closest<HTMLElement>(TREE_DROP_TARGET_SELECTOR);
  const targetDirectoryPath = dropTargetElement?.dataset.treeDropPath;
  if (!targetDirectoryPath || !targetDirectoryPath.trim()) {
    return null;
  }

  return targetDirectoryPath;
}

function buildDropRejectionSignature(
  reason: TreeDropRejectionReason,
  source: TreeDragSource | null,
  targetDirectoryPath: string,
): string {
  const sourcePath = source?.path ?? "<none>";
  return `${reason}:${sourcePath}->${targetDirectoryPath}`;
}

export function useTreeDragDrop(options: UseTreeDragDropOptions): UseTreeDragDropResult {
  const {
    dragThresholdPx,
    isSamePath,
    validateDrop,
    onDrop,
    onDragStart,
    onDropRejected,
    resolveDropTargetPathFromPoint = resolveDropTargetPathFromDom,
  } = options;
  const [dndState, setDndState] = useState<TreeDnDState>(INITIAL_TREE_DND_STATE);
  const dndStateRef = useRef(INITIAL_TREE_DND_STATE);
  const pointerCleanupRef = useRef<(() => void) | null>(null);
  const clickSuppressionRef = useRef(false);
  const clickSuppressionTimeoutRef = useRef<number | null>(null);
  const rejectionSignatureRef = useRef<string | null>(null);
  const lastValidDropTargetRef = useRef<{ path: string; timestamp: number } | null>(null);

  useEffect(() => {
    dndStateRef.current = dndState;
  }, [dndState]);

  const clearClickSuppression = useCallback((): void => {
    const timeoutId = clickSuppressionTimeoutRef.current;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      clickSuppressionTimeoutRef.current = null;
    }

    clickSuppressionRef.current = false;
  }, []);

  const scheduleClickSuppression = useCallback((): void => {
    clearClickSuppression();
    clickSuppressionRef.current = true;
    clickSuppressionTimeoutRef.current = window.setTimeout(() => {
      clickSuppressionRef.current = false;
      clickSuppressionTimeoutRef.current = null;
    }, CLICK_SUPPRESSION_TIMEOUT_MS);
  }, [clearClickSuppression]);

  const consumeClickSuppression = useCallback((): boolean => {
    if (!clickSuppressionRef.current) {
      return false;
    }

    clearClickSuppression();
    return true;
  }, [clearClickSuppression]);

  const clearPointerDragListeners = useCallback((): void => {
    const cleanup = pointerCleanupRef.current;
    if (!cleanup) {
      return;
    }

    cleanup();
    pointerCleanupRef.current = null;
  }, []);

  const clearTreeDragDropState = useCallback((): void => {
    clearPointerDragListeners();
    clearClickSuppression();
    rejectionSignatureRef.current = null;
    lastValidDropTargetRef.current = null;
    setDndState(INITIAL_TREE_DND_STATE);
  }, [clearClickSuppression, clearPointerDragListeners]);

  useEffect(() => {
    return () => {
      clearTreeDragDropState();
    };
  }, [clearTreeDragDropState]);

  const updateDropTargets = useCallback(
    (
      nextDropTargetPath: string | null,
      nextInvalidDropTargetPath: string | null,
      nextDropRejectionReason: TreeDropRejectionReason | null,
    ): void => {
      setDndState((previous) => {
        const hasSameDropTarget = previous.dropTargetPath
          ? nextDropTargetPath
            ? isSamePath(previous.dropTargetPath, nextDropTargetPath)
            : false
          : nextDropTargetPath === null;
        const hasSameInvalidTarget = previous.invalidDropTargetPath
          ? nextInvalidDropTargetPath
            ? isSamePath(previous.invalidDropTargetPath, nextInvalidDropTargetPath)
            : false
          : nextInvalidDropTargetPath === null;

        if (
          hasSameDropTarget &&
          hasSameInvalidTarget &&
          previous.dropRejectionReason === nextDropRejectionReason
        ) {
          return previous;
        }

        return {
          ...previous,
          dropTargetPath: nextDropTargetPath,
          invalidDropTargetPath: nextInvalidDropTargetPath,
          dropRejectionReason: nextDropRejectionReason,
        };
      });
    },
    [isSamePath],
  );

  const reportDropRejection = useCallback(
    (
      reason: TreeDropRejectionReason,
      source: TreeDragSource | null,
      targetDirectoryPath: string,
    ): void => {
      const signature = buildDropRejectionSignature(reason, source, targetDirectoryPath);
      if (rejectionSignatureRef.current === signature) {
        return;
      }

      rejectionSignatureRef.current = signature;
      console.debug("[tree-dnd] drop rejected", {
        reason,
        sourcePath: source?.path ?? null,
        sourceKind: source?.kind ?? null,
        targetDirectoryPath,
      });
      onDropRejected?.(reason, source, targetDirectoryPath);
    },
    [onDropRejected],
  );

  const evaluateDropTarget = useCallback(
    (source: TreeDragSource, clientX: number, clientY: number): string | null => {
      const targetDirectoryPath = resolveDropTargetPathFromPoint(clientX, clientY);
      if (!targetDirectoryPath) {
        const lastValidDropTarget = lastValidDropTargetRef.current;
        if (lastValidDropTarget && performance.now() - lastValidDropTarget.timestamp <= DROP_TARGET_GRACE_MS) {
          return lastValidDropTarget.path;
        }

        updateDropTargets(null, null, null);
        return null;
      }

      const validation = validateDrop(source, targetDirectoryPath);
      if (!validation.ok && validation.reason) {
        reportDropRejection(validation.reason, source, targetDirectoryPath);
        updateDropTargets(null, targetDirectoryPath, validation.reason);
        return targetDirectoryPath;
      }

      rejectionSignatureRef.current = null;
      lastValidDropTargetRef.current = {
        path: targetDirectoryPath,
        timestamp: performance.now(),
      };
      updateDropTargets(targetDirectoryPath, null, null);
      return targetDirectoryPath;
    },
    [reportDropRejection, resolveDropTargetPathFromPoint, updateDropTargets, validateDrop],
  );

  const handleTreePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, source: TreeDragSource): void => {
      if (event.button !== 0) {
        return;
      }

      if (dndStateRef.current.status === "committing") {
        return;
      }

      clearPointerDragListeners();

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let dropTargetPath: string | null = null;

      setDndState({
        status: "arming",
        dragSourcePath: source.path,
        dragSourceKind: source.kind,
        dropTargetPath: null,
        invalidDropTargetPath: null,
        dropRejectionReason: null,
      });

      const releasePointerTracking = (): void => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerEnd);
        window.removeEventListener("pointercancel", handlePointerEnd);
        if (pointerCleanupRef.current === releasePointerTracking) {
          pointerCleanupRef.current = null;
        }
      };

      const handlePointerMove = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId !== pointerId) {
          return;
        }

        if (!dragging) {
          const distance = Math.hypot(pointerEvent.clientX - startX, pointerEvent.clientY - startY);
          if (distance < dragThresholdPx) {
            return;
          }

          dragging = true;
          onDragStart?.(source);
          setDndState((previous) => ({
            ...previous,
            status: "dragging",
            dragSourcePath: source.path,
            dragSourceKind: source.kind,
          }));
        }

        dropTargetPath = evaluateDropTarget(source, pointerEvent.clientX, pointerEvent.clientY);
        pointerEvent.preventDefault();
      };

      const handlePointerEnd = (pointerEvent: PointerEvent): void => {
        if (pointerEvent.pointerId !== pointerId) {
          return;
        }

        releasePointerTracking();

        const hasDragged = dragging;
        const finalDropTargetPath = dropTargetPath;

        rejectionSignatureRef.current = null;
        lastValidDropTargetRef.current = null;
        updateDropTargets(null, null, null);

        if (!hasDragged) {
          setDndState(INITIAL_TREE_DND_STATE);
          return;
        }

        scheduleClickSuppression();
        setDndState((previous) => ({
          ...previous,
          status: "committing",
        }));

        if (!finalDropTargetPath) {
          setDndState(INITIAL_TREE_DND_STATE);
          return;
        }

        const validation = validateDrop(source, finalDropTargetPath);
        if (!validation.ok && validation.reason) {
          reportDropRejection(validation.reason, source, finalDropTargetPath);
          setDndState(INITIAL_TREE_DND_STATE);
          return;
        }

        void Promise.resolve(onDrop(source, finalDropTargetPath))
          .catch(() => {
            // Caller handles status/error side-effects.
          })
          .finally(() => {
            setDndState(INITIAL_TREE_DND_STATE);
          });
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerEnd);
      window.addEventListener("pointercancel", handlePointerEnd);
      pointerCleanupRef.current = releasePointerTracking;
    },
    [
      clearPointerDragListeners,
      dragThresholdPx,
      evaluateDropTarget,
      onDragStart,
      onDrop,
      reportDropRejection,
      scheduleClickSuppression,
      updateDropTargets,
      validateDrop,
    ],
  );

  return {
    dndState,
    consumeClickSuppression,
    clearTreeDragDropState,
    handleTreePointerDown,
  };
}
