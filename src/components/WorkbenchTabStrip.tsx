import { FileTerminal, X } from "lucide-react";

import type { EditorTab, TerminalSession } from "../types";

interface WorkbenchTabStripProps {
  tabs: readonly EditorTab[];
  terminals: readonly TerminalSession[];
  isFileTabActive: boolean;
  activeTabId: string | null;
  activeWorkbenchTabKind: "file" | "terminal";
  activeTerminalId: string | null;
  tabIsDirty: (tab: EditorTab) => boolean;
  onSelectFileTab: (tabId: string) => void;
  onCloseFileTab: (tabId: string) => void;
  onSelectTerminal: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onCreateTerminal: () => void;
}

export function WorkbenchTabStrip({
  tabs,
  terminals,
  isFileTabActive,
  activeTabId,
  activeWorkbenchTabKind,
  activeTerminalId,
  tabIsDirty,
  onSelectFileTab,
  onCloseFileTab,
  onSelectTerminal,
  onCloseTerminal,
  onCreateTerminal,
}: WorkbenchTabStripProps) {
  return (
    <div className="tab-strip">
      <div className="tab-strip-scroll">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab-item ${isFileTabActive && tab.id === activeTabId ? "active" : ""}`}
          >
            <button
              type="button"
              className="tab-button"
              onClick={() => onSelectFileTab(tab.id)}
            >
              {tab.title}
              {tabIsDirty(tab) ? " *" : ""}
            </button>
            <button type="button" className="tab-close" onClick={() => onCloseFileTab(tab.id)}>
              <X size={14} className="tab-close-icon" />
            </button>
          </div>
        ))}

        {terminals.map((session) => (
          <div
            key={session.id}
            className={`tab-item terminal ${
              activeWorkbenchTabKind === "terminal" && session.id === activeTerminalId ? "active" : ""
            }`}
          >
            <button
              type="button"
              className="tab-button terminal"
              onClick={() => onSelectTerminal(session.id)}
              title={session.cwd}
            >
              <span className={`tab-dot ${session.status === "running" ? "running" : "stopped"}`} />
              <span className="tab-title-text">{session.title}</span>
            </button>
            <button type="button" className="tab-close" onClick={() => onCloseTerminal(session.id)}>
              <X size={14} className="tab-close-icon" />
            </button>
          </div>
        ))}
      </div>

      <div className="tab-strip-actions">
        <button
          type="button"
          className="tab-add"
          title="新建终端"
          aria-label="新建终端"
          onClick={onCreateTerminal}
        >
          <FileTerminal size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
