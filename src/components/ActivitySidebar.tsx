import { FolderGit2, FolderSearch } from "lucide-react";

interface ActivitySidebarProps {
  sidebarView: "explorer" | "scm";
  gitChangeCount: number;
  onActivateSidebarView: (view: "explorer" | "scm") => void;
}

export function ActivitySidebar({
  sidebarView,
  gitChangeCount,
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
        <FolderSearch size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`activity-button ${sidebarView === "scm" ? "active" : ""}`}
        aria-label="源代码管理"
        title="源代码管理"
        onClick={() => onActivateSidebarView("scm")}
      >
        <FolderGit2 size={18} aria-hidden="true" />
        {gitChangeCount > 0 ? (
          <span className="activity-badge">{gitChangeCount > 99 ? "99+" : gitChangeCount}</span>
        ) : null}
      </button>
    </nav>
  );
}
