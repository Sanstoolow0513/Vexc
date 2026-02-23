import { FolderGit2, FolderSearch, Server } from "lucide-react";

interface ActivitySidebarProps {
  sidebarView: "explorer" | "scm" | "lsp";
  gitChangeCount: number;
  lspIssueCount: number;
  onActivateSidebarView: (view: "explorer" | "scm" | "lsp") => void;
}

export function ActivitySidebar({
  sidebarView,
  gitChangeCount,
  lspIssueCount,
  onActivateSidebarView,
}: ActivitySidebarProps) {
  return (
    <nav className="activity-bar" aria-label="侧边栏视图">
      <button
        type="button"
        className={`activity-button ${sidebarView === "explorer" ? "active" : ""}`}
        aria-label="资源管理器"
        title="资源管理器"
        onClick={() => onActivateSidebarView("explorer")}
      >
        <FolderSearch aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`activity-button ${sidebarView === "scm" ? "active" : ""}`}
        aria-label="源代码管理"
        title="源代码管理"
        onClick={() => onActivateSidebarView("scm")}
      >
        <FolderGit2 aria-hidden="true" />
        {gitChangeCount > 0 ? (
          <span className="activity-badge">{gitChangeCount > 99 ? "99+" : gitChangeCount}</span>
        ) : null}
      </button>
      <button
        type="button"
        className={`activity-button ${sidebarView === "lsp" ? "active" : ""}`}
        aria-label="语言服务"
        title="语言服务"
        onClick={() => onActivateSidebarView("lsp")}
      >
        <Server aria-hidden="true" />
        {lspIssueCount > 0 ? (
          <span className="activity-badge">{lspIssueCount > 99 ? "99+" : lspIssueCount}</span>
        ) : null}
      </button>
    </nav>
  );
}

