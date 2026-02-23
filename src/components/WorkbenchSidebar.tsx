import {
  FilePlus2,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  type ReactElement,
  type RefObject,
} from "react";

import { ICON_SIZE_SM } from "../iconSizes";
import type {
  FileKind,
  FileNode,
  GitBranchSnapshot,
  GitChange,
  GitRepoStatus,
  WorkspaceInfo,
} from "../types";

interface TreeContextMenuState {
  path: string;
  kind: FileKind;
  x: number;
  y: number;
}

interface WorkbenchSidebarProps {
  sidebarView: "explorer" | "scm";
  workspace: WorkspaceInfo | null;
  treeByPath: Record<string, FileNode[]>;
  treeContextMenu: TreeContextMenuState | null;
  treeContextMenuRef: RefObject<HTMLDivElement | null>;
  gitRepo: GitRepoStatus | null;
  gitBranchState: GitBranchSnapshot;
  gitCommitMessage: string;
  gitStagedChanges: readonly GitChange[];
  gitUnstagedChanges: readonly GitChange[];
  gitUntrackedChanges: readonly GitChange[];
  gitSelectedDiffPath: string | null;
  gitSelectedDiffStaged: boolean;
  gitDiffText: string;
  isGitActionPending: boolean;
  isGitRefreshing: boolean;
  renderTree: (nodes: FileNode[], depth: number, parentDirectoryPath: string) => ReactElement[];
  onCreateNode: (kind: FileKind) => void;
  onTreeContextCreateFile: () => void;
  onTreeContextCreateDirectory: () => void;
  onTreeContextRename: () => void;
  onTreeContextDelete: () => void;
  onRefreshGit: () => void;
  onGitPull: () => void;
  onGitPush: () => void;
  onGitCheckoutBranch: (branchName: string) => void;
  onGitCommitMessageChange: (value: string) => void;
  onGitCommit: () => void;
  onStageGitPaths: (paths: string[]) => void;
  onUnstageGitPaths: (paths: string[]) => void;
  onDiscardGitPaths: (paths: string[]) => void;
  onLoadGitDiffPreview: (path: string, staged: boolean) => void;
  onOpenFile: (path: string) => void;
  relativePathWithinWorkspace: (path: string, workspaceRootPath: string) => string;
  isSamePath: (left: string, right: string) => boolean;
  labelForGitChange: (change: GitChange) => string;
}

export function WorkbenchSidebar({
  sidebarView,
  workspace,
  treeByPath,
  treeContextMenu,
  treeContextMenuRef,
  gitRepo,
  gitBranchState,
  gitCommitMessage,
  gitStagedChanges,
  gitUnstagedChanges,
  gitUntrackedChanges,
  gitSelectedDiffPath,
  gitSelectedDiffStaged,
  gitDiffText,
  isGitActionPending,
  isGitRefreshing,
  renderTree,
  onCreateNode,
  onTreeContextCreateFile,
  onTreeContextCreateDirectory,
  onTreeContextRename,
  onTreeContextDelete,
  onRefreshGit,
  onGitPull,
  onGitPush,
  onGitCheckoutBranch,
  onGitCommitMessageChange,
  onGitCommit,
  onStageGitPaths,
  onUnstageGitPaths,
  onDiscardGitPaths,
  onLoadGitDiffPreview,
  onOpenFile,
  relativePathWithinWorkspace,
  isSamePath,
  labelForGitChange,
}: WorkbenchSidebarProps) {
  return (
    <aside className="explorer-panel">
      {sidebarView === "explorer" ? (
        <>
          <div className="explorer-toolbar">
            <span className="sidebar-section-title">资源管理器</span>
            <div className="explorer-toolbar-actions">
              <button
                type="button"
                className="explorer-action icon-only"
                title="新建文件"
                aria-label="新建文件"
                disabled={!workspace}
                onClick={() => onCreateNode("file")}
              >
                <FilePlus2 size={ICON_SIZE_SM} />
              </button>
              <button
                type="button"
                className="explorer-action icon-only"
                title="新建文件夹"
                aria-label="新建文件夹"
                disabled={!workspace}
                onClick={() => onCreateNode("directory")}
              >
                <FolderPlus size={ICON_SIZE_SM} />
              </button>
            </div>
          </div>

          {workspace ? (
            <div
              className="explorer-root"
              data-explorer-root-drop-path={workspace.rootPath}
            >
              {renderTree(treeByPath[workspace.rootPath] ?? [], 0, workspace.rootPath)}
            </div>
          ) : (
            <p className="empty-text">Open a workspace to browse files.</p>
          )}

          {treeContextMenu ? (
            <div
              ref={treeContextMenuRef}
              className="tree-context-menu"
              role="menu"
              style={{ top: `${treeContextMenu.y}px`, left: `${treeContextMenu.x}px` }}
            >
              {treeContextMenu.kind === "directory" ? (
                <>
                  <button
                    type="button"
                    className="tree-context-item"
                    role="menuitem"
                    onClick={onTreeContextCreateFile}
                  >
                    <FilePlus2 size={ICON_SIZE_SM} />
                    <span>新建文件</span>
                  </button>
                  <button
                    type="button"
                    className="tree-context-item"
                    role="menuitem"
                    onClick={onTreeContextCreateDirectory}
                  >
                    <FolderPlus size={ICON_SIZE_SM} />
                    <span>新建文件夹</span>
                  </button>
                  <div className="tree-context-separator" />
                </>
              ) : null}

              <button
                type="button"
                className="tree-context-item"
                role="menuitem"
                onClick={onTreeContextRename}
              >
                <Pencil size={ICON_SIZE_SM} />
                <span>重命名</span>
              </button>

              <button
                type="button"
                className="tree-context-item danger"
                role="menuitem"
                onClick={onTreeContextDelete}
              >
                <Trash2 size={ICON_SIZE_SM} />
                <span>删除</span>
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="scm-panel">
          <div className="scm-panel-header">
            <span className="sidebar-section-title">源代码管理</span>
          </div>
          {!workspace ? (
            <p className="empty-text">Open a workspace to use source control.</p>
          ) : (
            <>
              <div className="scm-toolbar">
                <span className="scm-branch-label">
                  {gitRepo?.isRepo ? (gitRepo.branch ?? "HEAD") : "No Git Repository"}
                </span>
                <button
                  type="button"
                  className="scm-button"
                  disabled={isGitActionPending || isGitRefreshing}
                  onClick={onRefreshGit}
                >
                  刷新
                </button>
              </div>

              {gitRepo?.isRepo ? (
                <>
                  <div className="scm-sync-row">
                    <span className="scm-sync-meta">
                      ↑ {gitRepo.ahead} / ↓ {gitRepo.behind}
                    </span>
                    <div className="scm-sync-actions">
                      <button
                        type="button"
                        className="scm-button"
                        disabled={isGitActionPending || isGitRefreshing}
                        onClick={onGitPull}
                      >
                        Pull
                      </button>
                      <button
                        type="button"
                        className="scm-button"
                        disabled={isGitActionPending || isGitRefreshing}
                        onClick={onGitPush}
                      >
                        Push
                      </button>
                    </div>
                  </div>

                  <div className="scm-branch-row">
                    <select
                      className="scm-branch-select"
                      value={gitBranchState.currentBranch ?? ""}
                      disabled={
                        isGitActionPending
                        || isGitRefreshing
                        || gitBranchState.branches.length === 0
                      }
                      onChange={(event) => onGitCheckoutBranch(event.target.value)}
                    >
                      {gitBranchState.currentBranch ? null : (
                        <option value="" disabled>
                          Select branch
                        </option>
                      )}
                      {gitBranchState.branches.map((branch) => (
                        <option
                          key={`${branch.isRemote ? "remote" : "local"}:${branch.name}`}
                          value={branch.name}
                        >
                          {branch.isRemote ? `remote/${branch.name}` : branch.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="scm-commit">
                    <textarea
                      className="scm-commit-input"
                      value={gitCommitMessage}
                      placeholder="Commit message"
                      disabled={isGitActionPending || isGitRefreshing}
                      onChange={(event) => onGitCommitMessageChange(event.target.value)}
                    />
                    <button
                      type="button"
                      className="scm-button scm-button-primary"
                      disabled={!gitCommitMessage.trim() || isGitActionPending || isGitRefreshing}
                      onClick={onGitCommit}
                    >
                      Commit
                    </button>
                  </div>

                  <div className="scm-section">
                    <div className="scm-section-head">
                      <span>Staged ({gitStagedChanges.length})</span>
                      <button
                        type="button"
                        className="scm-button"
                        disabled={gitStagedChanges.length === 0 || isGitActionPending || isGitRefreshing}
                        onClick={() => onUnstageGitPaths(gitStagedChanges.map((change) => change.path))}
                      >
                        Unstage All
                      </button>
                    </div>
                    {gitStagedChanges.length > 0 ? (
                      <div className="scm-change-list">
                        {gitStagedChanges.map((change) => {
                          const selected = Boolean(
                            gitSelectedDiffPath
                            && isSamePath(gitSelectedDiffPath, change.path)
                            && gitSelectedDiffStaged,
                          );
                          return (
                            <div
                              key={`staged:${change.path}:${change.statusCode}`}
                              className={`scm-change-item ${selected ? "selected" : ""}`}
                            >
                              <button
                                type="button"
                                className="scm-change-main"
                                title={change.path}
                                onClick={() => onLoadGitDiffPreview(change.path, true)}
                              >
                                <span className="scm-change-code">{labelForGitChange(change)}</span>
                                <span className="scm-change-name">
                                  {relativePathWithinWorkspace(change.path, workspace.rootPath)}
                                </span>
                              </button>
                              <div className="scm-change-actions">
                                <button
                                  type="button"
                                  className="scm-button"
                                  disabled={isGitActionPending || isGitRefreshing}
                                  onClick={() => onUnstageGitPaths([change.path])}
                                >
                                  Unstage
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="empty-text">No staged changes.</p>
                    )}
                  </div>

                  <div className="scm-section">
                    <div className="scm-section-head">
                      <span>Changes ({gitUnstagedChanges.length})</span>
                      <button
                        type="button"
                        className="scm-button"
                        disabled={gitUnstagedChanges.length === 0 || isGitActionPending || isGitRefreshing}
                        onClick={() => onStageGitPaths(gitUnstagedChanges.map((change) => change.path))}
                      >
                        Stage All
                      </button>
                    </div>
                    {gitUnstagedChanges.length > 0 ? (
                      <div className="scm-change-list">
                        {gitUnstagedChanges.map((change) => {
                          const selected = Boolean(
                            gitSelectedDiffPath
                            && isSamePath(gitSelectedDiffPath, change.path)
                            && !gitSelectedDiffStaged,
                          );
                          return (
                            <div
                              key={`changes:${change.path}:${change.statusCode}`}
                              className={`scm-change-item ${selected ? "selected" : ""}`}
                            >
                              <button
                                type="button"
                                className="scm-change-main"
                                title={change.path}
                                onClick={() => onLoadGitDiffPreview(change.path, false)}
                              >
                                <span className="scm-change-code">{labelForGitChange(change)}</span>
                                <span className="scm-change-name">
                                  {relativePathWithinWorkspace(change.path, workspace.rootPath)}
                                </span>
                              </button>
                              <div className="scm-change-actions">
                                <button
                                  type="button"
                                  className="scm-button"
                                  disabled={isGitActionPending || isGitRefreshing}
                                  onClick={() => onStageGitPaths([change.path])}
                                >
                                  Stage
                                </button>
                                <button
                                  type="button"
                                  className="scm-button danger"
                                  disabled={isGitActionPending || isGitRefreshing}
                                  onClick={() => onDiscardGitPaths([change.path])}
                                >
                                  Discard
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="empty-text">No unstaged changes.</p>
                    )}
                  </div>

                  <div className="scm-section">
                    <div className="scm-section-head">
                      <span>Untracked ({gitUntrackedChanges.length})</span>
                    </div>
                    {gitUntrackedChanges.length > 0 ? (
                      <div className="scm-change-list">
                        {gitUntrackedChanges.map((change) => (
                          <div
                            key={`untracked:${change.path}:${change.statusCode}`}
                            className="scm-change-item"
                          >
                            <button
                              type="button"
                              className="scm-change-main"
                              title={change.path}
                              onClick={() => onLoadGitDiffPreview(change.path, false)}
                            >
                              <span className="scm-change-code">{labelForGitChange(change)}</span>
                              <span className="scm-change-name">
                                {relativePathWithinWorkspace(change.path, workspace.rootPath)}
                              </span>
                            </button>
                            <div className="scm-change-actions">
                              <button
                                type="button"
                                className="scm-button"
                                disabled={isGitActionPending || isGitRefreshing}
                                onClick={() => onStageGitPaths([change.path])}
                              >
                                Stage
                              </button>
                              <button
                                type="button"
                                className="scm-button danger"
                                disabled={isGitActionPending || isGitRefreshing}
                                onClick={() => onDiscardGitPaths([change.path])}
                              >
                                Discard
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-text">No untracked files.</p>
                    )}
                  </div>

                  <div className="scm-diff-panel">
                    <div className="scm-section-head">
                      <span>Diff Preview</span>
                      {gitSelectedDiffPath ? (
                        <button
                          type="button"
                          className="scm-button"
                          disabled={isGitActionPending || isGitRefreshing}
                          onClick={() => onOpenFile(gitSelectedDiffPath)}
                        >
                          Open File
                        </button>
                      ) : null}
                    </div>
                    {gitSelectedDiffPath ? (
                      <>
                        <p className="scm-diff-path">
                          {relativePathWithinWorkspace(gitSelectedDiffPath, workspace.rootPath)}
                          {gitSelectedDiffStaged ? " (staged)" : " (working tree)"}
                        </p>
                        <pre className="scm-diff-content">
                          {gitDiffText || "No diff content for this file."}
                        </pre>
                      </>
                    ) : (
                      <p className="empty-text">Select a change to preview its diff.</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="empty-text">Current workspace is not a Git repository.</p>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
