import {
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Editor from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  getWorkspace,
  listDirectory,
  readFile,
  setWorkspace,
  terminalClose,
  terminalCreate,
  terminalList,
  terminalSnapshot,
  terminalWrite,
  writeFile,
} from "./api";
import type {
  EditorTab,
  FileNode,
  TerminalOutputEvent,
  TerminalSession,
  TerminalSessionSnapshot,
  WorkspaceInfo,
} from "./types";
import { detectLanguage, fileNameFromPath } from "./utils";
import "./App.css";

const WORKSPACE_STORAGE_KEY = "vexc.workspacePath";

interface PendingPosition {
  tabId: string;
  line: number;
  column: number;
}

function App() {
  const [workspace, setWorkspaceState] = useState<WorkspaceInfo | null>(null);
  const [workspaceInput, setWorkspaceInput] = useState("");

  const [treeByPath, setTreeByPath] = useState<Record<string, FileNode[]>>({});
  const [expandedByPath, setExpandedByPath] = useState<Record<string, boolean>>({});
  const [loadingByPath, setLoadingByPath] = useState<Record<string, boolean>>({});

  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tabsRef = useRef<EditorTab[]>([]);

  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const activeTerminalIdRef = useRef<string | null>(null);
  const [terminalBuffers, setTerminalBuffers] = useState<Record<string, string>>({});
  const terminalBuffersRef = useRef<Record<string, string>>({});
  const terminalWriteQueueRef = useRef<Promise<unknown>>(Promise.resolve());

  const [pendingPosition, setPendingPosition] = useState<PendingPosition | null>(null);
  const [editorReadySeq, setEditorReadySeq] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Ready");

  const monacoEditorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    activeTerminalIdRef.current = activeTerminalId;
  }, [activeTerminalId]);

  useEffect(() => {
    terminalBuffersRef.current = terminalBuffers;
  }, [terminalBuffers]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  const activeTerminal = useMemo(
    () => terminals.find((session) => session.id === activeTerminalId) ?? null,
    [terminals, activeTerminalId],
  );

  const hasDirtyTabs = useMemo(
    () => tabs.some((tab) => tab.content !== tab.savedContent),
    [tabs],
  );

  function tabIsDirty(tab: EditorTab): boolean {
    return tab.content !== tab.savedContent;
  }

  function setDirectoryLoading(path: string, loading: boolean): void {
    setLoadingByPath((previous) => ({
      ...previous,
      [path]: loading,
    }));
  }

  async function loadDirectory(path: string): Promise<void> {
    setDirectoryLoading(path, true);
    try {
      const nodes = await listDirectory(path, false);
      setTreeByPath((previous) => ({
        ...previous,
        [path]: nodes,
      }));
    } catch (error) {
      setStatusMessage(`Failed to list directory: ${String(error)}`);
    } finally {
      setDirectoryLoading(path, false);
    }
  }

  function redrawTerminal(sessionId: string | null): void {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    terminal.reset();
    terminal.clear();

    if (!sessionId) {
      terminal.writeln("No active terminal session.");
      return;
    }

    const buffer = terminalBuffersRef.current[sessionId] ?? "";
    if (buffer) {
      terminal.write(buffer);
    }

    fitAddonRef.current?.fit();
  }

  function mergeTerminalSnapshot(snapshot: TerminalSessionSnapshot): void {
    setTerminals((previous) => {
      const next = [...previous];
      const existingIndex = next.findIndex((item) => item.id === snapshot.session.id);
      if (existingIndex >= 0) {
        next[existingIndex] = snapshot.session;
      } else {
        next.push(snapshot.session);
      }
      next.sort((left, right) => left.id.localeCompare(right.id));
      return next;
    });

    setTerminalBuffers((previous) => {
      const next = {
        ...previous,
        [snapshot.session.id]: snapshot.lines.join("\r\n"),
      };
      terminalBuffersRef.current = next;
      return next;
    });
  }

  async function createTerminalSession(): Promise<void> {
    try {
      const snapshot = await terminalCreate("powershell.exe");
      mergeTerminalSnapshot(snapshot);
      activeTerminalIdRef.current = snapshot.session.id;
      setActiveTerminalId(snapshot.session.id);
      redrawTerminal(snapshot.session.id);
      setStatusMessage(`Created ${snapshot.session.title}`);
    } catch (error) {
      setStatusMessage(`Failed to create terminal: ${String(error)}`);
    }
  }

  async function refreshTerminalSessions(): Promise<void> {
    try {
      const sessions = await terminalList();
      if (sessions.length === 0) {
        await createTerminalSession();
        return;
      }

      setTerminals(sessions);

      const buffers: Record<string, string> = {};
      for (const session of sessions) {
        const snapshot = await terminalSnapshot(session.id);
        buffers[session.id] = snapshot.lines.join("\r\n");
      }

      setTerminalBuffers(() => {
        terminalBuffersRef.current = buffers;
        return buffers;
      });

      const current = activeTerminalIdRef.current;
      const nextActive = current && sessions.some((session) => session.id === current)
        ? current
        : sessions[0].id;

      activeTerminalIdRef.current = nextActive;
      setActiveTerminalId(nextActive);
      redrawTerminal(nextActive);
    } catch (error) {
      setStatusMessage(`Failed to load terminals: ${String(error)}`);
    }
  }

  async function openWorkspaceByPath(path: string, skipDirtyConfirm = false): Promise<void> {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      setStatusMessage("Please provide a workspace path.");
      return;
    }

    if (!skipDirtyConfirm && hasDirtyTabs) {
      const confirmed = window.confirm("You have unsaved tabs. Continue and switch workspace?");
      if (!confirmed) {
        return;
      }
    }

    try {
      const info = await setWorkspace(normalizedPath);
      setWorkspaceState(info);
      setWorkspaceInput(info.rootPath);
      localStorage.setItem(WORKSPACE_STORAGE_KEY, info.rootPath);

      setTabs([]);
      setActiveTabId(null);

      setTreeByPath({});
      setExpandedByPath({ [info.rootPath]: true });
      await loadDirectory(info.rootPath);

      const existingSessions = await terminalList();
      for (const session of existingSessions) {
        await terminalClose(session.id);
      }

      setTerminals([]);
      setTerminalBuffers({});
      terminalBuffersRef.current = {};
      setActiveTerminalId(null);
      activeTerminalIdRef.current = null;
      redrawTerminal(null);
      await refreshTerminalSessions();

      setStatusMessage(`Workspace ready: ${info.rootName}`);
    } catch (error) {
      setStatusMessage(`Failed to open workspace: ${String(error)}`);
    }
  }

  async function openFile(path: string, caret?: { line: number; column: number }): Promise<string | null> {
    const existing = tabsRef.current.find((tab) => tab.path === path);
    if (existing) {
      setActiveTabId(existing.id);
      if (caret) {
        setPendingPosition({ tabId: existing.id, line: caret.line, column: caret.column });
      }
      return existing.id;
    }

    try {
      const file = await readFile(path);
      const tab: EditorTab = {
        id: file.path,
        path: file.path,
        title: fileNameFromPath(file.path),
        content: file.content,
        savedContent: file.content,
        language: detectLanguage(file.path),
      };

      setTabs((previous) => [...previous, tab]);
      setActiveTabId(tab.id);

      if (caret) {
        setPendingPosition({ tabId: tab.id, line: caret.line, column: caret.column });
      }

      return tab.id;
    } catch (error) {
      setStatusMessage(`Failed to open file: ${String(error)}`);
      return null;
    }
  }

  async function saveTab(tabId?: string): Promise<void> {
    const targetId = tabId ?? activeTabId;
    if (!targetId) {
      setStatusMessage("No active file to save.");
      return;
    }

    const tab = tabsRef.current.find((item) => item.id === targetId);
    if (!tab) {
      setStatusMessage("Tab not found.");
      return;
    }

    try {
      await writeFile(tab.path, tab.content);
      setTabs((previous) =>
        previous.map((item) =>
          item.id === targetId
            ? {
                ...item,
                savedContent: item.content,
              }
            : item,
        ),
      );
      setStatusMessage(`Saved ${tab.title}`);
    } catch (error) {
      setStatusMessage(`Save failed: ${String(error)}`);
    }
  }

  function closeTab(tabId: string): void {
    const target = tabsRef.current.find((tab) => tab.id === tabId);
    if (!target) {
      return;
    }

    if (tabIsDirty(target)) {
      const confirmed = window.confirm(`Discard unsaved changes in ${target.title}?`);
      if (!confirmed) {
        return;
      }
    }

    const existingTabs = tabsRef.current;
    const removeIndex = existingTabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = existingTabs.filter((tab) => tab.id !== tabId);

    setTabs(nextTabs);

    if (activeTabId === tabId) {
      if (nextTabs.length === 0) {
        setActiveTabId(null);
      } else {
        const fallbackIndex = Math.max(0, removeIndex - 1);
        setActiveTabId(nextTabs[fallbackIndex].id);
      }
    }
  }

  function updateActiveTabContent(value: string): void {
    if (!activeTabId) {
      return;
    }

    setTabs((previous) =>
      previous.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              content: value,
            }
          : tab,
      ),
    );
  }

  async function selectTerminal(sessionId: string): Promise<void> {
    activeTerminalIdRef.current = sessionId;
    setActiveTerminalId(sessionId);
    try {
      const snapshot = await terminalSnapshot(sessionId);
      mergeTerminalSnapshot(snapshot);
      redrawTerminal(sessionId);
    } catch (error) {
      setStatusMessage(`Failed to refresh terminal session: ${String(error)}`);
    }
  }

  async function closeActiveTerminal(): Promise<void> {
    const closeId = activeTerminalIdRef.current;
    if (!closeId) {
      return;
    }

    try {
      await terminalClose(closeId);
      await refreshTerminalSessions();
      setStatusMessage("Terminal closed.");
    } catch (error) {
      setStatusMessage(`Failed to close terminal: ${String(error)}`);
    }
  }

  function queueTerminalInput(data: string): void {
    const sessionId = activeTerminalIdRef.current;
    if (!sessionId || data.length === 0) {
      return;
    }

    terminalWriteQueueRef.current = terminalWriteQueueRef.current
      .then(() => terminalWrite(sessionId, data))
      .catch((error) => {
        setStatusMessage(`Terminal write failed: ${String(error)}`);
      });
  }

  async function restoreWorkspaceAndState(): Promise<void> {
    const savedWorkspace = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (savedWorkspace) {
      await openWorkspaceByPath(savedWorkspace, true);
      return;
    }

    try {
      const existingWorkspace = await getWorkspace();
      if (existingWorkspace) {
        await openWorkspaceByPath(existingWorkspace.rootPath, true);
      } else {
        await refreshTerminalSessions();
      }
    } catch (error) {
      setStatusMessage(`Bootstrap failed: ${String(error)}`);
      await refreshTerminalSessions();
    }
  }

  function handleEditorMount(
    editor: MonacoEditor.IStandaloneCodeEditor,
    monacoApi: typeof import("monaco-editor"),
  ): void {
    monacoEditorRef.current = editor;
    setEditorReadySeq((value) => value + 1);

    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => {
      void saveTab();
    });
  }

  function promptWorkspacePath(): void {
    const suggested = workspaceInput || workspace?.rootPath || "";
    const path = window.prompt("Enter workspace absolute path", suggested);
    if (path && path.trim()) {
      setWorkspaceInput(path);
      void openWorkspaceByPath(path);
    }
  }

  function renderTree(nodes: FileNode[], depth: number): ReactElement[] {
    return nodes.map((node) => {
      const isDirectory = node.kind === "directory";
      const expanded = Boolean(expandedByPath[node.path]);
      const loading = Boolean(loadingByPath[node.path]);

      return (
        <div key={node.path}>
          <button
            type="button"
            className={`tree-item ${activeTab?.path === node.path ? "active" : ""}`}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => {
              if (isDirectory) {
                const nextExpanded = !expanded;
                setExpandedByPath((previous) => ({
                  ...previous,
                  [node.path]: nextExpanded,
                }));

                if (nextExpanded && !treeByPath[node.path]) {
                  void loadDirectory(node.path);
                }
                return;
              }

              void openFile(node.path);
            }}
          >
            <span className="tree-marker">{isDirectory ? (expanded ? "-" : "+") : "|"}</span>
            <span className="tree-label">{node.name}</span>
            {isDirectory && loading ? <span className="tree-loading">loading...</span> : null}
          </button>

          {isDirectory && expanded && treeByPath[node.path]
            ? renderTree(treeByPath[node.path], depth + 1)
            : null}
        </div>
      );
    });
  }

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) {
      return;
    }

    const terminal = new XtermTerminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      allowTransparency: true,
      theme: {
        background: "#090d14",
        foreground: "#d9e3f8",
        cursor: "#f5d076",
      },
      scrollback: 20000,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(host);

    const dataDisposable = terminal.onData((data: string) => {
      queueTerminalInput(data);
    });

    const clickHandler = () => {
      terminal.focus();
    };
    host.addEventListener("click", clickHandler);

    redrawTerminal(activeTerminalIdRef.current);

    return () => {
      host.removeEventListener("click", clickHandler);
      dataDisposable.dispose();
      resizeObserver.disconnect();
      fitAddonRef.current = null;
      terminalRef.current = null;
      terminal.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    void listen<TerminalOutputEvent>("terminal://output", (event) => {
      const payload = event.payload;
      setTerminalBuffers((previous) => {
        const next = {
          ...previous,
          [payload.sessionId]: `${previous[payload.sessionId] ?? ""}${payload.chunk}`,
        };
        terminalBuffersRef.current = next;
        return next;
      });

      if (payload.sessionId === activeTerminalIdRef.current && terminalRef.current) {
        terminalRef.current.write(payload.chunk);
      }
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    void restoreWorkspaceAndState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveTab();
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
    };
  }, [activeTabId]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirtyTabs) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [hasDirtyTabs]);

  useEffect(() => {
    if (!pendingPosition) {
      return;
    }

    if (activeTabId !== pendingPosition.tabId) {
      return;
    }

    const editor = monacoEditorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) {
      return;
    }

    const line = Math.max(1, Math.min(pendingPosition.line, model.getLineCount()));
    const column = Math.max(1, Math.min(pendingPosition.column, model.getLineMaxColumn(line)));
    editor.focus();
    editor.setPosition({ lineNumber: line, column });
    editor.revealPositionInCenter({ lineNumber: line, column });
    setPendingPosition(null);
  }, [pendingPosition, activeTabId, editorReadySeq]);

  useEffect(() => {
    redrawTerminal(activeTerminalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTerminalId]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="workspace-controls">
          <label htmlFor="workspace-path">Workspace</label>
          <input
            id="workspace-path"
            value={workspaceInput}
            onChange={(event) => setWorkspaceInput(event.currentTarget.value)}
            placeholder="C:\\Users\\...\\project"
          />
          <button type="button" onClick={() => void openWorkspaceByPath(workspaceInput)}>
            Open
          </button>
          <button type="button" className="secondary" onClick={promptWorkspacePath}>
            Prompt
          </button>
        </div>

        <div className="topbar-actions">
          <button type="button" className="secondary" onClick={() => void createTerminalSession()}>
            New Terminal
          </button>
          <button type="button" onClick={() => void saveTab()} disabled={!activeTab}>
            Save
          </button>
          <span className="workspace-name">{workspace ? workspace.rootName : "No workspace"}</span>
        </div>
      </header>

      <div className="workbench-grid">
        <aside className="explorer-panel">
          <div className="panel-title">Explorer</div>
          {workspace ? (
            <div className="explorer-root">
              <button
                type="button"
                className="tree-item root"
                onClick={() => {
                  const expanded = !expandedByPath[workspace.rootPath];
                  setExpandedByPath((previous) => ({
                    ...previous,
                    [workspace.rootPath]: expanded,
                  }));
                  if (expanded && !treeByPath[workspace.rootPath]) {
                    void loadDirectory(workspace.rootPath);
                  }
                }}
              >
                <span className="tree-marker">{expandedByPath[workspace.rootPath] ? "-" : "+"}</span>
                <span className="tree-label">{workspace.rootName}</span>
              </button>
              {expandedByPath[workspace.rootPath] ? (
                <div>{renderTree(treeByPath[workspace.rootPath] ?? [], 1)}</div>
              ) : null}
            </div>
          ) : (
            <p className="empty-text">Open a workspace to browse files.</p>
          )}
        </aside>

        <section className="main-panel">
          <section className="editor-panel">
            <div className="tab-strip">
              {tabs.map((tab) => (
                <div key={tab.id} className={`tab-item ${tab.id === activeTabId ? "active" : ""}`}>
                  <button type="button" className="tab-button" onClick={() => setActiveTabId(tab.id)}>
                    {tab.title}
                    {tabIsDirty(tab) ? " *" : ""}
                  </button>
                  <button type="button" className="tab-close" onClick={() => closeTab(tab.id)}>
                    x
                  </button>
                </div>
              ))}
            </div>

            <div className="editor-surface">
              {activeTab ? (
                <Editor
                  path={activeTab.path}
                  language={activeTab.language}
                  value={activeTab.content}
                  onMount={handleEditorMount}
                  onChange={(value) => updateActiveTabContent(value ?? "")}
                  theme="vs-dark"
                  className="editor-monaco"
                  height="100%"
                  options={{
                    automaticLayout: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineHeight: 20,
                    tabSize: 2,
                    insertSpaces: true,
                    wordWrap: "on",
                    renderWhitespace: "selection",
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                  }}
                />
              ) : (
                <div className="empty-state">
                  <h3>Ready for coding</h3>
                  <p>Open a file from the explorer to start editing.</p>
                </div>
              )}
            </div>
          </section>

          <section className="terminal-panel">
            <div className="terminal-toolbar">
              <div className="terminal-tabs">
                {terminals.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    className={`terminal-tab ${session.id === activeTerminalId ? "active" : ""}`}
                    onClick={() => void selectTerminal(session.id)}
                  >
                    {session.title}
                  </button>
                ))}
              </div>
              <div className="terminal-actions">
                <button type="button" onClick={() => void createTerminalSession()}>
                  New
                </button>
                <button type="button" className="secondary" onClick={() => void closeActiveTerminal()}>
                  Close
                </button>
              </div>
            </div>

            <div className="terminal-meta-row">
              <span className="terminal-meta">
                {activeTerminal ? `${activeTerminal.shell} | ${activeTerminal.cwd}` : "No active terminal"}
              </span>
              <span className="terminal-meta">Type directly after focusing terminal</span>
            </div>

            <div ref={terminalHostRef} className="terminal-host" />
          </section>
        </section>
      </div>

      <footer className="statusbar">{statusMessage}</footer>
    </div>
  );
}

export default App;
