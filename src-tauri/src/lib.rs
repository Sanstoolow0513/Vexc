use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::Emitter;

type TerminalSessionMap = Arc<Mutex<HashMap<String, Arc<Mutex<TerminalState>>>>>;
type LspSessionMap = Arc<Mutex<HashMap<String, Arc<Mutex<LspSessionState>>>>>;

#[derive(Default)]
struct AppState {
    workspace_root: Mutex<Option<PathBuf>>,
    terminals: TerminalSessionMap,
    terminal_counter: AtomicU64,
    lsp_sessions: LspSessionMap,
    lsp_counter: AtomicU64,
}

struct TerminalState {
    id: String,
    title: String,
    shell: String,
    cwd: PathBuf,
    status: String,
    cols: u16,
    rows: u16,
    buffer: String,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    process: Box<dyn portable_pty::Child + Send>,
}

struct LspSessionState {
    id: String,
    server: String,
    root_path: PathBuf,
    status: String,
    writer: ChildStdin,
    process: Child,
}

const MAX_EDITOR_FILE_BYTES: u64 = 1024 * 1024;
const MAX_TERMINAL_BUFFER_BYTES: usize = 1024 * 1024;
const MAX_LSP_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;
const DEFAULT_TERMINAL_COLS: u16 = 120;
const DEFAULT_TERMINAL_ROWS: u16 = 30;
const IGNORED_DIRECTORY_NAMES: &[&str] = &["node_modules", "dist", "target"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceInfo {
    root_path: String,
    root_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileNode {
    path: String,
    name: String,
    kind: String,
    has_children: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileContent {
    path: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult {
    path: String,
    bytes_written: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PathResult {
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchHit {
    path: String,
    line: usize,
    column: usize,
    preview: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalSession {
    id: String,
    title: String,
    shell: String,
    cwd: String,
    status: String,
    cols: u16,
    rows: u16,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalCommandResult {
    command: String,
    output: String,
    error: String,
    exit_code: i32,
    cwd: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionSnapshot {
    session: TerminalSession,
    buffer: String,
    last_result: Option<TerminalCommandResult>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEvent {
    session_id: String,
    chunk: String,
    is_error: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitRepoStatus {
    is_repo: bool,
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    has_changes: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LspSessionInfo {
    id: String,
    server: String,
    root_path: String,
    status: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitChange {
    path: String,
    old_path: Option<String>,
    index_status: String,
    worktree_status: String,
    status_code: String,
    staged: bool,
    unstaged: bool,
    untracked: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitBranchInfo {
    name: String,
    is_current: bool,
    is_remote: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitBranchSnapshot {
    current_branch: Option<String>,
    branches: Vec<GitBranchInfo>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitCommandResult {
    command: String,
    args: Vec<String>,
    stdout: String,
    stderr: String,
    exit_code: i32,
    success: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitCommitResult {
    summary: String,
    commit_hash: Option<String>,
    command_result: GitCommandResult,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitDiffResult {
    path: String,
    staged: bool,
    diff: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LspMessageEvent {
    session_id: String,
    channel: String,
    payload: String,
    is_error: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Ack {
    ok: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiProviderSuggestion {
    id: String,
    command: String,
    args_template: Vec<String>,
    description: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiRunRequest {
    command: String,
    args: Option<Vec<String>>,
    prompt: String,
    cwd: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiRunResult {
    command: String,
    args: Vec<String>,
    stdout: String,
    stderr: String,
    exit_code: i32,
    success: bool,
}

#[tauri::command]
fn set_workspace(path: String, state: tauri::State<AppState>) -> Result<WorkspaceInfo, String> {
    let root = canonicalize_dir_path(&path)?;
    let info = WorkspaceInfo {
        root_path: root.to_string_lossy().to_string(),
        root_name: root
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| root.to_string_lossy().to_string()),
    };

    let mut workspace_guard = state
        .workspace_root
        .lock()
        .map_err(|_| String::from("Failed to lock workspace state"))?;
    *workspace_guard = Some(root);

    Ok(info)
}

#[tauri::command]
fn get_workspace(state: tauri::State<AppState>) -> Result<Option<WorkspaceInfo>, String> {
    let workspace_guard = state
        .workspace_root
        .lock()
        .map_err(|_| String::from("Failed to lock workspace state"))?;

    Ok(workspace_guard.as_ref().map(|root| WorkspaceInfo {
        root_path: root.to_string_lossy().to_string(),
        root_name: root
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| root.to_string_lossy().to_string()),
    }))
}

#[tauri::command]
fn list_directory(
    path: Option<String>,
    include_hidden: Option<bool>,
    state: tauri::State<AppState>,
) -> Result<Vec<FileNode>, String> {
    let root = get_workspace_root(&state)?;
    let include_hidden_files = include_hidden.unwrap_or(false);

    let directory_path = match path {
        Some(value) if !value.trim().is_empty() => resolve_existing_workspace_path(&value, &root)?,
        _ => root,
    };

    if !directory_path.is_dir() {
        return Err(String::from("Requested path is not a directory"));
    }

    let mut children = Vec::new();
    for entry in fs::read_dir(&directory_path)
        .map_err(|error| format!("Failed to read directory: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
        let entry_path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to read entry type: {error}"))?;
        let name = entry.file_name().to_string_lossy().to_string();

        if !include_hidden_files && name.starts_with('.') {
            continue;
        }

        let is_directory = file_type.is_dir();
        if is_directory && is_ignored_directory_name(&name) {
            continue;
        }

        let has_children = if is_directory {
            fs::read_dir(&entry_path)
                .ok()
                .map(|mut iterator| iterator.next().is_some())
                .unwrap_or(false)
        } else {
            false
        };

        children.push(FileNode {
            path: entry_path.to_string_lossy().to_string(),
            name,
            kind: if is_directory {
                String::from("directory")
            } else {
                String::from("file")
            },
            has_children,
        });
    }

    children.sort_by(|left, right| {
        let left_dir = left.kind == "directory";
        let right_dir = right.kind == "directory";
        match (left_dir, right_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
        }
    });

    Ok(children)
}

#[tauri::command]
fn read_file(path: String, state: tauri::State<AppState>) -> Result<FileContent, String> {
    let root = get_workspace_root(&state)?;
    let file_path = resolve_existing_workspace_path(&path, &root)?;

    if !file_path.is_file() {
        return Err(String::from("Requested path is not a file"));
    }

    let metadata = fs::metadata(&file_path)
        .map_err(|error| format!("Failed to read file metadata: {error}"))?;
    if metadata.len() > MAX_EDITOR_FILE_BYTES {
        return Err(format!(
            "File is too large to open in text editor ({} KB > {} KB)",
            kb_rounded_up(metadata.len()),
            kb_rounded_up(MAX_EDITOR_FILE_BYTES)
        ));
    }

    let bytes = fs::read(&file_path).map_err(|error| format!("Failed to read file: {error}"))?;
    if is_probably_binary(&bytes) {
        return Err(String::from("Binary file cannot be opened in text editor"));
    }

    Ok(FileContent {
        path: file_path.to_string_lossy().to_string(),
        content: String::from_utf8_lossy(&bytes).to_string(),
    })
}

#[tauri::command]
fn write_file(
    path: String,
    content: String,
    state: tauri::State<AppState>,
) -> Result<SaveResult, String> {
    let root = get_workspace_root(&state)?;
    let file_path = resolve_write_workspace_path(&path, &root)?;

    fs::write(&file_path, content.as_bytes())
        .map_err(|error| format!("Failed to write file: {error}"))?;

    Ok(SaveResult {
        path: file_path.to_string_lossy().to_string(),
        bytes_written: content.len(),
    })
}

#[tauri::command]
fn create_file(path: String, state: tauri::State<AppState>) -> Result<PathResult, String> {
    let root = get_workspace_root(&state)?;
    let file_path = resolve_write_workspace_path(&path, &root)?;

    if file_path.exists() {
        return Err(String::from("Target path already exists"));
    }

    fs::write(&file_path, []).map_err(|error| format!("Failed to create file: {error}"))?;

    let canonical = canonicalize_path(&file_path, "Failed to resolve created file path")?;
    Ok(PathResult {
        path: canonical.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn create_directory(path: String, state: tauri::State<AppState>) -> Result<PathResult, String> {
    let root = get_workspace_root(&state)?;
    let directory_path = resolve_write_workspace_path(&path, &root)?;

    if directory_path.exists() {
        return Err(String::from("Target path already exists"));
    }

    fs::create_dir(&directory_path)
        .map_err(|error| format!("Failed to create directory: {error}"))?;

    let canonical = canonicalize_path(&directory_path, "Failed to resolve created directory path")?;
    Ok(PathResult {
        path: canonical.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn rename_path(
    path: String,
    new_name: String,
    state: tauri::State<AppState>,
) -> Result<PathResult, String> {
    let root = get_workspace_root(&state)?;
    let source_path = resolve_existing_workspace_path(&path, &root)?;

    if source_path == root {
        return Err(String::from("Cannot rename workspace root directory"));
    }

    let trimmed_name = validate_path_segment_name(&new_name)?;
    let parent_directory = source_path
        .parent()
        .ok_or_else(|| String::from("Source path has no parent directory"))?;
    let target_path = parent_directory.join(trimmed_name);

    if target_path == source_path {
        return Ok(PathResult {
            path: source_path.to_string_lossy().to_string(),
        });
    }

    if target_path.exists() {
        return Err(String::from("Target path already exists"));
    }

    fs::rename(&source_path, &target_path)
        .map_err(|error| format!("Failed to rename path: {error}"))?;

    let canonical = canonicalize_path(&target_path, "Failed to resolve renamed path")?;
    Ok(PathResult {
        path: canonical.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn delete_path(path: String, state: tauri::State<AppState>) -> Result<Ack, String> {
    let root = get_workspace_root(&state)?;
    let target_path = resolve_existing_workspace_path(&path, &root)?;

    if target_path == root {
        return Err(String::from("Cannot delete workspace root directory"));
    }

    let metadata = fs::metadata(&target_path)
        .map_err(|error| format!("Failed to inspect target path: {error}"))?;

    if metadata.is_dir() {
        fs::remove_dir_all(&target_path)
            .map_err(|error| format!("Failed to delete directory: {error}"))?;
    } else if metadata.is_file() {
        fs::remove_file(&target_path).map_err(|error| format!("Failed to delete file: {error}"))?;
    } else {
        return Err(String::from("Unsupported file system entry type"));
    }

    Ok(Ack { ok: true })
}

#[tauri::command]
fn move_path(
    source_path: String,
    target_directory_path: String,
    state: tauri::State<AppState>,
) -> Result<PathResult, String> {
    let root = get_workspace_root(&state)?;
    let source = resolve_existing_workspace_path(&source_path, &root)?;
    let target_directory = resolve_existing_workspace_path(&target_directory_path, &root)?;

    if source == root {
        return Err(String::from("MOVE_SOURCE_IS_ROOT"));
    }

    if !target_directory.is_dir() {
        return Err(String::from("MOVE_TARGET_NOT_DIRECTORY"));
    }

    let source_name = source
        .file_name()
        .ok_or_else(|| String::from("MOVE_IO_ERROR:Source path is missing file name"))?;
    let target_path = target_directory.join(source_name);

    if target_path == source {
        return Ok(PathResult {
            path: source.to_string_lossy().to_string(),
        });
    }

    if target_path.exists() {
        return Err(String::from("MOVE_TARGET_EXISTS"));
    }

    let source_metadata = fs::metadata(&source)
        .map_err(|error| format!("MOVE_IO_ERROR:Failed to inspect source path: {error}"))?;
    if source_metadata.is_dir() && target_directory.starts_with(&source) {
        return Err(String::from("MOVE_TARGET_INSIDE_SOURCE"));
    }

    fs::rename(&source, &target_path)
        .map_err(|error| format!("MOVE_IO_ERROR:Failed to move path: {error}"))?;

    let canonical = canonicalize_path(&target_path, "Failed to resolve moved path")?;
    Ok(PathResult {
        path: canonical.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn search_workspace(
    query: String,
    max_results: Option<usize>,
    include_hidden: Option<bool>,
    state: tauri::State<AppState>,
) -> Result<Vec<SearchHit>, String> {
    let query_trimmed = query.trim();
    if query_trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let root = get_workspace_root(&state)?;
    let max_hits = max_results.unwrap_or(200);
    let include_hidden_files = include_hidden.unwrap_or(false);
    let query_lower = query_trimmed.to_lowercase();
    let mut hits = Vec::new();

    search_directory(
        &root,
        &query_lower,
        &mut hits,
        max_hits,
        include_hidden_files,
    )?;

    Ok(hits)
}

#[tauri::command]
fn terminal_create(
    shell: Option<String>,
    state: tauri::State<AppState>,
    app: tauri::AppHandle,
) -> Result<TerminalSessionSnapshot, String> {
    let root = get_workspace_root_optional(&state)?;
    let cwd = match root {
        Some(path) => path,
        None => normalize_windows_verbatim_path(
            std::env::current_dir()
                .map_err(|error| format!("Failed to resolve current directory: {error}"))?,
        ),
    };

    let shell_value = shell
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| String::from("powershell.exe"));

    let id = format!(
        "terminal-{}",
        state.terminal_counter.fetch_add(1, Ordering::SeqCst) + 1
    );
    let title = format!("Terminal {}", id.replace("terminal-", ""));

    let pty_system = native_pty_system();
    let pty_size = PtySize {
        rows: DEFAULT_TERMINAL_ROWS,
        cols: DEFAULT_TERMINAL_COLS,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pty_pair = pty_system
        .openpty(pty_size)
        .map_err(|error| format!("Failed to open terminal PTY: {error}"))?;

    let spawn_command = build_terminal_spawn_command(&shell_value, &cwd);
    let process = pty_pair
        .slave
        .spawn_command(spawn_command)
        .map_err(|error| format!("Failed to start terminal process: {error}"))?;
    drop(pty_pair.slave);

    let reader = pty_pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Failed to capture terminal output: {error}"))?;
    let writer = pty_pair
        .master
        .take_writer()
        .map_err(|error| format!("Failed to capture terminal input: {error}"))?;

    let terminal_state = Arc::new(Mutex::new(TerminalState {
        id: id.clone(),
        title,
        shell: shell_value,
        cwd: cwd.clone(),
        status: String::from("running"),
        cols: DEFAULT_TERMINAL_COLS,
        rows: DEFAULT_TERMINAL_ROWS,
        buffer: String::new(),
        master: pty_pair.master,
        writer,
        process,
    }));

    {
        let mut terminal_guard = state
            .terminals
            .lock()
            .map_err(|_| String::from("Failed to lock terminal state"))?;
        terminal_guard.insert(id.clone(), terminal_state.clone());
    }

    spawn_terminal_reader(id, reader, state.terminals.clone(), app);

    let session = terminal_state
        .lock()
        .map_err(|_| String::from("Failed to lock terminal session"))?;
    let snapshot = terminal_state_to_snapshot(&session, None);

    Ok(snapshot)
}

#[tauri::command]
fn terminal_list(state: tauri::State<AppState>) -> Result<Vec<TerminalSession>, String> {
    let terminal_guard = state
        .terminals
        .lock()
        .map_err(|_| String::from("Failed to lock terminal state"))?;

    let mut sessions: Vec<TerminalSession> = terminal_guard
        .values()
        .filter_map(|session| {
            let guard = session.lock().ok()?;
            Some(terminal_state_to_session(&guard))
        })
        .collect();
    sessions.sort_by(|left, right| left.id.cmp(&right.id));

    Ok(sessions)
}

#[tauri::command]
fn terminal_snapshot(
    session_id: String,
    state: tauri::State<AppState>,
) -> Result<TerminalSessionSnapshot, String> {
    let session = get_terminal_session(&state, &session_id)?;
    let session_guard = session
        .lock()
        .map_err(|_| String::from("Failed to lock terminal session"))?;

    Ok(terminal_state_to_snapshot(&session_guard, None))
}

#[tauri::command]
fn terminal_write(
    session_id: String,
    input: String,
    state: tauri::State<AppState>,
) -> Result<Ack, String> {
    if input.is_empty() {
        return Ok(Ack { ok: true });
    }

    let session = get_terminal_session(&state, &session_id)?;
    let mut session_guard = session
        .lock()
        .map_err(|_| String::from("Failed to lock terminal session"))?;

    if session_guard.status != "running" {
        return Err(String::from("Terminal session has already exited"));
    }

    session_guard
        .writer
        .write_all(input.as_bytes())
        .map_err(|error| format!("Failed to write to terminal: {error}"))?;
    session_guard
        .writer
        .flush()
        .map_err(|error| format!("Failed to flush terminal input: {error}"))?;

    Ok(Ack { ok: true })
}

#[tauri::command]
fn terminal_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<AppState>,
) -> Result<Ack, String> {
    if cols == 0 || rows == 0 {
        return Err(String::from("Terminal size must be greater than zero"));
    }

    let session = get_terminal_session(&state, &session_id)?;
    let mut session_guard = session
        .lock()
        .map_err(|_| String::from("Failed to lock terminal session"))?;

    session_guard
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Failed to resize terminal: {error}"))?;
    session_guard.cols = cols;
    session_guard.rows = rows;

    Ok(Ack { ok: true })
}

#[tauri::command]
fn terminal_clear(
    session_id: String,
    state: tauri::State<AppState>,
) -> Result<TerminalSessionSnapshot, String> {
    let session = get_terminal_session(&state, &session_id)?;
    let mut session_guard = session
        .lock()
        .map_err(|_| String::from("Failed to lock terminal session"))?;

    session_guard.buffer.clear();

    Ok(terminal_state_to_snapshot(&session_guard, None))
}

#[tauri::command]
fn terminal_close(session_id: String, state: tauri::State<AppState>) -> Result<Ack, String> {
    let removed = {
        let mut terminal_guard = state
            .terminals
            .lock()
            .map_err(|_| String::from("Failed to lock terminal state"))?;
        terminal_guard.remove(&session_id)
    };

    if let Some(session) = removed {
        let mut guard = session
            .lock()
            .map_err(|_| String::from("Failed to lock terminal session"))?;
        guard.status = String::from("closed");

        let _ = guard.process.kill();
        let _ = guard.process.wait();
    }

    Ok(Ack { ok: true })
}

#[tauri::command]
fn git_repo_status(state: tauri::State<AppState>) -> Result<GitRepoStatus, String> {
    let root = get_workspace_root(&state)?;
    let (status, _) = get_git_status_snapshot(&root)?;
    Ok(status)
}

#[tauri::command]
fn git_changes(state: tauri::State<AppState>) -> Result<Vec<GitChange>, String> {
    let root = get_workspace_root(&state)?;
    let (_, changes) = get_git_status_snapshot(&root)?;
    Ok(changes)
}

#[tauri::command]
fn git_stage(paths: Vec<String>, state: tauri::State<AppState>) -> Result<Ack, String> {
    let root = get_workspace_root(&state)?;
    ensure_workspace_is_git_repository(&root)?;

    let normalized_paths = normalize_git_paths(&paths, &root)?;
    let mut args = vec![String::from("add"), String::from("--")];
    args.extend(normalized_paths.into_iter().map(|path| path.relative));

    run_git_command_expect_success(&root, &args, "Failed to stage files")?;
    Ok(Ack { ok: true })
}

#[tauri::command]
fn git_unstage(paths: Vec<String>, state: tauri::State<AppState>) -> Result<Ack, String> {
    let root = get_workspace_root(&state)?;
    ensure_workspace_is_git_repository(&root)?;

    let normalized_paths = normalize_git_paths(&paths, &root)?;
    let mut args = vec![
        String::from("restore"),
        String::from("--staged"),
        String::from("--"),
    ];
    args.extend(normalized_paths.into_iter().map(|path| path.relative));

    run_git_command_expect_success(&root, &args, "Failed to unstage files")?;
    Ok(Ack { ok: true })
}

#[tauri::command]
fn git_discard(paths: Vec<String>, state: tauri::State<AppState>) -> Result<Ack, String> {
    let root = get_workspace_root(&state)?;
    ensure_workspace_is_git_repository(&root)?;

    let normalized_paths = normalize_git_paths(&paths, &root)?;
    for path in normalized_paths {
        let restore_args = vec![
            String::from("restore"),
            String::from("--worktree"),
            String::from("--"),
            path.relative.clone(),
        ];
        let restore_result = run_git_command(&root, &restore_args)?;
        if restore_result.success {
            continue;
        }

        if is_restore_unknown_path_error(&restore_result) {
            let clean_args = vec![
                String::from("clean"),
                String::from("-f"),
                String::from("--"),
                path.relative.clone(),
            ];
            run_git_command_expect_success(
                &root,
                &clean_args,
                "Failed to discard untracked files",
            )?;
            continue;
        }

        return Err(format!(
            "Failed to discard changes for {}: {}",
            path.relative,
            summarize_git_failure(&restore_result)
        ));
    }

    Ok(Ack { ok: true })
}

#[tauri::command]
fn git_commit(message: String, state: tauri::State<AppState>) -> Result<GitCommitResult, String> {
    let root = get_workspace_root(&state)?;
    ensure_workspace_is_git_repository(&root)?;

    let trimmed_message = message.trim();
    if trimmed_message.is_empty() {
        return Err(String::from("Commit message cannot be empty"));
    }

    let args = vec![
        String::from("commit"),
        String::from("-m"),
        trimmed_message.to_string(),
    ];
    let command_result = run_git_command_expect_success(&root, &args, "Failed to create commit")?;
    let summary = command_result
        .stdout
        .lines()
        .next()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .unwrap_or_else(|| String::from("Commit created"));

    Ok(GitCommitResult {
        summary,
        commit_hash: extract_git_commit_hash(&command_result.stdout),
        command_result,
    })
}

#[tauri::command]
fn git_branches(state: tauri::State<AppState>) -> Result<GitBranchSnapshot, String> {
    let root = get_workspace_root(&state)?;
    let (status, _) = get_git_status_snapshot(&root)?;
    if !status.is_repo {
        return Ok(GitBranchSnapshot {
            current_branch: None,
            branches: Vec::new(),
        });
    }

    let args = vec![
        String::from("branch"),
        String::from("--all"),
        String::from("--no-color"),
    ];
    let result = run_git_command_expect_success(&root, &args, "Failed to list git branches")?;
    let current_branch = status.branch.clone();
    let branches = parse_git_branches_output(&result.stdout, current_branch.as_deref());

    Ok(GitBranchSnapshot {
        current_branch,
        branches,
    })
}

#[tauri::command]
fn git_checkout(
    branch: String,
    create: Option<bool>,
    state: tauri::State<AppState>,
) -> Result<Ack, String> {
    let root = get_workspace_root(&state)?;
    ensure_workspace_is_git_repository(&root)?;

    let branch_name = validate_git_branch_name(&branch)?;
    let mut args = vec![String::from("checkout")];
    if create.unwrap_or(false) {
        args.push(String::from("-b"));
    }
    args.push(branch_name.to_string());

    run_git_command_expect_success(&root, &args, "Failed to checkout branch")?;
    Ok(Ack { ok: true })
}

#[tauri::command]
fn lsp_start(
    server: String,
    args: Option<Vec<String>>,
    root_path: String,
    state: tauri::State<AppState>,
    app: tauri::AppHandle,
) -> Result<LspSessionInfo, String> {
    let server_name = server.trim();
    if server_name.is_empty() {
        return Err(String::from("LSP server command cannot be empty"));
    }

    let resolved_root = if root_path.trim().is_empty() {
        get_workspace_root(&state)?
    } else {
        canonicalize_dir_path(&root_path)?
    };

    if let Some(workspace_root) = get_workspace_root_optional(&state)? {
        ensure_inside_workspace(&resolved_root, &workspace_root)?;
    }

    let mut command = Command::new(server_name);
    if let Some(values) = args {
        command.args(values);
    }
    command
        .current_dir(&resolved_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut process = command
        .spawn()
        .map_err(|error| format!("Failed to start LSP server `{server_name}`: {error}"))?;

    let writer = process
        .stdin
        .take()
        .ok_or_else(|| String::from("Failed to capture LSP server stdin"))?;
    let stdout = process
        .stdout
        .take()
        .ok_or_else(|| String::from("Failed to capture LSP server stdout"))?;
    let stderr = process
        .stderr
        .take()
        .ok_or_else(|| String::from("Failed to capture LSP server stderr"))?;

    let id = format!(
        "lsp-{}",
        state.lsp_counter.fetch_add(1, Ordering::SeqCst) + 1
    );
    let lsp_session = Arc::new(Mutex::new(LspSessionState {
        id: id.clone(),
        server: server_name.to_string(),
        root_path: resolved_root.clone(),
        status: String::from("running"),
        writer,
        process,
    }));

    {
        let mut lsp_guard = state
            .lsp_sessions
            .lock()
            .map_err(|_| String::from("Failed to lock LSP state"))?;
        lsp_guard.insert(id.clone(), lsp_session.clone());
    }

    spawn_lsp_stdout_reader(id.clone(), stdout, state.lsp_sessions.clone(), app.clone());
    spawn_lsp_stderr_reader(id.clone(), stderr, state.lsp_sessions.clone(), app.clone());

    let session_guard = lsp_session
        .lock()
        .map_err(|_| String::from("Failed to lock LSP session"))?;

    Ok(lsp_state_to_info(&session_guard))
}

#[tauri::command]
fn lsp_send(
    session_id: String,
    payload: String,
    state: tauri::State<AppState>,
) -> Result<Ack, String> {
    if payload.trim().is_empty() {
        return Err(String::from("LSP payload cannot be empty"));
    }

    let session = get_lsp_session(&state, &session_id)?;
    let mut session_guard = session
        .lock()
        .map_err(|_| String::from("Failed to lock LSP session"))?;

    if session_guard.status != "running" {
        return Err(String::from("LSP session is not running"));
    }

    let payload_bytes = payload.as_bytes();
    let header = format!("Content-Length: {}\r\n\r\n", payload_bytes.len());
    session_guard
        .writer
        .write_all(header.as_bytes())
        .map_err(|error| format!("Failed to write LSP header: {error}"))?;
    session_guard
        .writer
        .write_all(payload_bytes)
        .map_err(|error| format!("Failed to write LSP payload: {error}"))?;
    session_guard
        .writer
        .flush()
        .map_err(|error| format!("Failed to flush LSP payload: {error}"))?;

    Ok(Ack { ok: true })
}

#[tauri::command]
fn git_pull(state: tauri::State<AppState>) -> Result<GitCommandResult, String> {
    let root = get_workspace_root(&state)?;
    ensure_workspace_is_git_repository(&root)?;

    let args = vec![String::from("pull")];
    run_git_command_expect_success(&root, &args, "Git pull failed")
}

#[tauri::command]
fn git_push(state: tauri::State<AppState>) -> Result<GitCommandResult, String> {
    let root = get_workspace_root(&state)?;
    ensure_workspace_is_git_repository(&root)?;

    let args = vec![String::from("push")];
    run_git_command_expect_success(&root, &args, "Git push failed")
}

#[tauri::command]
fn git_diff(
    path: String,
    staged: Option<bool>,
    state: tauri::State<AppState>,
) -> Result<GitDiffResult, String> {
    let root = get_workspace_root(&state)?;
    ensure_workspace_is_git_repository(&root)?;

    let normalized_paths = normalize_git_paths(&[path], &root)?;
    let normalized_path = normalized_paths
        .into_iter()
        .next()
        .ok_or_else(|| String::from("No path provided for diff"))?;
    let is_staged = staged.unwrap_or(false);

    let mut args = vec![String::from("diff")];
    if is_staged {
        args.push(String::from("--staged"));
    }
    args.push(String::from("--"));
    args.push(normalized_path.relative.clone());

    let command_result =
        run_git_command_expect_success(&root, &args, "Failed to generate git diff")?;
    Ok(GitDiffResult {
        path: normalized_path.absolute.to_string_lossy().to_string(),
        staged: is_staged,
        diff: command_result.stdout,
    })
}

#[tauri::command]
fn lsp_stop(session_id: String, state: tauri::State<AppState>) -> Result<Ack, String> {
    let removed = {
        let mut lsp_guard = state
            .lsp_sessions
            .lock()
            .map_err(|_| String::from("Failed to lock LSP state"))?;
        lsp_guard.remove(&session_id)
    };

    if let Some(session) = removed {
        let mut guard = session
            .lock()
            .map_err(|_| String::from("Failed to lock LSP session"))?;
        guard.status = String::from("closed");
        let _ = guard.process.kill();
        let _ = guard.process.wait();
    }

    Ok(Ack { ok: true })
}

#[tauri::command]
fn ai_provider_suggestions() -> Vec<AiProviderSuggestion> {
    vec![
        AiProviderSuggestion {
            id: String::from("codex"),
            command: String::from("codex"),
            args_template: vec![String::from("{prompt}")],
            description: String::from("OpenAI Codex CLI"),
        },
        AiProviderSuggestion {
            id: String::from("claude"),
            command: String::from("claude"),
            args_template: vec![String::from("{prompt}")],
            description: String::from("Claude CLI"),
        },
        AiProviderSuggestion {
            id: String::from("gemini"),
            command: String::from("gemini"),
            args_template: vec![String::from("{prompt}")],
            description: String::from("Gemini CLI"),
        },
    ]
}

#[tauri::command]
fn ai_run(request: AiRunRequest, state: tauri::State<AppState>) -> Result<AiRunResult, String> {
    let command = request.command.trim();
    if command.is_empty() {
        return Err(String::from("AI command cannot be empty"));
    }

    let workspace = get_workspace_root_optional(&state)?;
    let cwd = match request.cwd {
        Some(path) if !path.trim().is_empty() => {
            let provided_path = PathBuf::from(path);
            let canonical =
                canonicalize_path(&provided_path, "Failed to resolve AI working directory")?;

            if !canonical.is_dir() {
                return Err(String::from("AI working directory is not a directory"));
            }

            if let Some(root) = workspace.as_ref() {
                ensure_inside_workspace(&canonical, root)?;
            }
            canonical
        }
        _ => match workspace {
            Some(path) => path,
            None => normalize_windows_verbatim_path(
                std::env::current_dir()
                    .map_err(|error| format!("Failed to resolve current directory: {error}"))?,
            ),
        },
    };

    let workspace_placeholder = get_workspace_root_optional(&state)?
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();

    let mut args = request.args.unwrap_or_default();
    if args.is_empty() {
        args.push(String::from("{prompt}"));
    }

    let resolved_args: Vec<String> = args
        .iter()
        .map(|arg| {
            arg.replace("{prompt}", &request.prompt)
                .replace("{workspace}", &workspace_placeholder)
        })
        .collect();

    let output = Command::new(command)
        .args(&resolved_args)
        .current_dir(&cwd)
        .output()
        .map_err(|error| format!("Failed to run AI command: {error}"))?;

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    Ok(AiRunResult {
        command: command.to_string(),
        args: resolved_args,
        stdout,
        stderr,
        exit_code,
        success: output.status.success(),
    })
}

fn terminal_state_to_session(state: &TerminalState) -> TerminalSession {
    TerminalSession {
        id: state.id.clone(),
        title: state.title.clone(),
        shell: state.shell.clone(),
        cwd: state.cwd.to_string_lossy().to_string(),
        status: state.status.clone(),
        cols: state.cols,
        rows: state.rows,
    }
}

fn terminal_state_to_snapshot(
    state: &TerminalState,
    last_result: Option<TerminalCommandResult>,
) -> TerminalSessionSnapshot {
    TerminalSessionSnapshot {
        session: terminal_state_to_session(state),
        buffer: state.buffer.clone(),
        last_result,
    }
}

fn get_terminal_session(
    state: &tauri::State<AppState>,
    session_id: &str,
) -> Result<Arc<Mutex<TerminalState>>, String> {
    let terminal_guard = state
        .terminals
        .lock()
        .map_err(|_| String::from("Failed to lock terminal state"))?;

    terminal_guard
        .get(session_id)
        .cloned()
        .ok_or_else(|| String::from("Terminal session not found"))
}

fn lsp_state_to_info(state: &LspSessionState) -> LspSessionInfo {
    LspSessionInfo {
        id: state.id.clone(),
        server: state.server.clone(),
        root_path: state.root_path.to_string_lossy().to_string(),
        status: state.status.clone(),
    }
}

fn get_lsp_session(
    state: &tauri::State<AppState>,
    session_id: &str,
) -> Result<Arc<Mutex<LspSessionState>>, String> {
    let lsp_guard = state
        .lsp_sessions
        .lock()
        .map_err(|_| String::from("Failed to lock LSP state"))?;

    lsp_guard
        .get(session_id)
        .cloned()
        .ok_or_else(|| String::from("LSP session not found"))
}

fn cleanup_lsp_session_on_disconnect(sessions: &LspSessionMap, session_id: &str) {
    let removed = match sessions.lock() {
        Ok(mut session_guard) => session_guard.remove(session_id),
        Err(_) => None,
    };

    if let Some(session) = removed {
        if let Ok(mut lsp_guard) = session.lock() {
            if lsp_guard.status == "running" {
                lsp_guard.status = String::from("disconnected");
            }
            let _ = lsp_guard.process.kill();
            let _ = lsp_guard.process.wait();
        }
    }
}

fn build_terminal_spawn_command(shell: &str, cwd: &Path) -> CommandBuilder {
    let shell_lower = shell.to_lowercase();
    let mut command = CommandBuilder::new(shell);

    if shell_lower.contains("powershell") || shell_lower.contains("pwsh") {
        command.args(["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"]);
    }

    command.cwd(cwd);

    command
}

fn spawn_terminal_reader(
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    terminals: TerminalSessionMap,
    app: tauri::AppHandle,
) {
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        let mut pending_utf8_bytes: Vec<u8> = Vec::new();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let chunk =
                        decode_terminal_output_chunk(&mut pending_utf8_bytes, &buffer[..size]);
                    if chunk.is_empty() {
                        continue;
                    }

                    if let Ok(terminal_guard) = terminals.lock() {
                        if let Some(session) = terminal_guard.get(&session_id).cloned() {
                            drop(terminal_guard);
                            if let Ok(mut session_guard) = session.lock() {
                                append_terminal_output(&mut session_guard.buffer, &chunk);
                            }
                        }
                    }

                    let _ = app.emit(
                        "terminal://output",
                        TerminalOutputEvent {
                            session_id: session_id.clone(),
                            chunk,
                            is_error: false,
                        },
                    );
                }
                Err(_) => break,
            }
        }

        if !pending_utf8_bytes.is_empty() {
            let chunk = String::from_utf8_lossy(&pending_utf8_bytes).to_string();
            if !chunk.is_empty() {
                if let Ok(terminal_guard) = terminals.lock() {
                    if let Some(session) = terminal_guard.get(&session_id).cloned() {
                        drop(terminal_guard);
                        if let Ok(mut session_guard) = session.lock() {
                            append_terminal_output(&mut session_guard.buffer, &chunk);
                        }
                    }
                }

                let _ = app.emit(
                    "terminal://output",
                    TerminalOutputEvent {
                        session_id: session_id.clone(),
                        chunk,
                        is_error: false,
                    },
                );
            }
        }

        if let Ok(terminal_guard) = terminals.lock() {
            if let Some(session) = terminal_guard.get(&session_id).cloned() {
                drop(terminal_guard);
                if let Ok(mut session_guard) = session.lock() {
                    if session_guard.status == "running" {
                        session_guard.status = String::from("disconnected");
                    }
                }
            }
        }
    });
}

fn spawn_lsp_stdout_reader(
    session_id: String,
    stdout: ChildStdout,
    sessions: LspSessionMap,
    app: tauri::AppHandle,
) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);

        loop {
            match read_lsp_payload(&mut reader) {
                Ok(Some(payload)) => {
                    let _ = app.emit(
                        "lsp://message",
                        LspMessageEvent {
                            session_id: session_id.clone(),
                            channel: String::from("stdout"),
                            payload,
                            is_error: false,
                        },
                    );
                }
                Ok(None) => break,
                Err(error) => {
                    let _ = app.emit(
                        "lsp://message",
                        LspMessageEvent {
                            session_id: session_id.clone(),
                            channel: String::from("system"),
                            payload: error,
                            is_error: true,
                        },
                    );
                    break;
                }
            }
        }

        cleanup_lsp_session_on_disconnect(&sessions, &session_id);
    });
}

fn spawn_lsp_stderr_reader(
    session_id: String,
    stderr: ChildStderr,
    sessions: LspSessionMap,
    app: tauri::AppHandle,
) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let payload = line.trim().to_string();
                    if payload.is_empty() {
                        continue;
                    }

                    let _ = app.emit(
                        "lsp://message",
                        LspMessageEvent {
                            session_id: session_id.clone(),
                            channel: String::from("stderr"),
                            payload,
                            is_error: true,
                        },
                    );
                }
                Err(error) => {
                    let _ = app.emit(
                        "lsp://message",
                        LspMessageEvent {
                            session_id: session_id.clone(),
                            channel: String::from("system"),
                            payload: format!("Failed to read LSP stderr: {error}"),
                            is_error: true,
                        },
                    );
                    break;
                }
            }
        }

        cleanup_lsp_session_on_disconnect(&sessions, &session_id);
    });
}

fn read_lsp_payload(reader: &mut BufReader<ChildStdout>) -> Result<Option<String>, String> {
    let mut content_length: Option<usize> = None;

    loop {
        let mut header_line = String::new();
        let read = reader
            .read_line(&mut header_line)
            .map_err(|error| format!("Failed to read LSP header: {error}"))?;
        if read == 0 {
            return Ok(None);
        }

        if header_line == "\r\n" || header_line == "\n" {
            break;
        }

        let trimmed = header_line.trim();
        if let Some(length_text) = trimmed.strip_prefix("Content-Length:") {
            let parsed = length_text
                .trim()
                .parse::<usize>()
                .map_err(|error| format!("Invalid LSP Content-Length header: {error}"))?;
            content_length = Some(parsed);
        }
    }

    let message_size =
        content_length.ok_or_else(|| String::from("LSP frame missing Content-Length"))?;
    if message_size > MAX_LSP_PAYLOAD_BYTES {
        return Err(format!(
            "LSP payload exceeds maximum size: {message_size} bytes (limit: {MAX_LSP_PAYLOAD_BYTES} bytes)",
        ));
    }
    let mut payload_bytes = vec![0_u8; message_size];
    reader
        .read_exact(&mut payload_bytes)
        .map_err(|error| format!("Failed to read LSP payload: {error}"))?;

    Ok(Some(String::from_utf8_lossy(&payload_bytes).to_string()))
}

fn append_terminal_output(output: &mut String, chunk: &str) {
    output.push_str(chunk);

    if output.len() > MAX_TERMINAL_BUFFER_BYTES {
        let overflow = output.len() - MAX_TERMINAL_BUFFER_BYTES;
        let mut drain_to = overflow;
        while drain_to < output.len() && !output.is_char_boundary(drain_to) {
            drain_to += 1;
        }
        output.drain(..drain_to);
    }
}

fn decode_terminal_output_chunk(pending_utf8_bytes: &mut Vec<u8>, chunk_bytes: &[u8]) -> String {
    pending_utf8_bytes.extend_from_slice(chunk_bytes);

    let mut decoded = String::new();
    loop {
        match std::str::from_utf8(pending_utf8_bytes) {
            Ok(valid) => {
                decoded.push_str(valid);
                pending_utf8_bytes.clear();
                break;
            }
            Err(error) => {
                let valid_up_to = error.valid_up_to();
                let error_len = error.error_len();

                if valid_up_to > 0 {
                    if let Ok(valid_prefix) =
                        std::str::from_utf8(&pending_utf8_bytes[..valid_up_to])
                    {
                        decoded.push_str(valid_prefix);
                    }
                    pending_utf8_bytes.drain(..valid_up_to);
                }

                match error_len {
                    Some(length) => {
                        let invalid_len = length.min(pending_utf8_bytes.len());
                        if invalid_len == 0 {
                            break;
                        }

                        decoded
                            .push_str(&String::from_utf8_lossy(&pending_utf8_bytes[..invalid_len]));
                        pending_utf8_bytes.drain(..invalid_len);
                    }
                    None => break,
                }
            }
        }
    }

    decoded
}

#[derive(Clone)]
struct NormalizedGitPath {
    absolute: PathBuf,
    relative: String,
}

fn ensure_workspace_is_git_repository(root: &Path) -> Result<(), String> {
    let (status, _) = get_git_status_snapshot(root)?;
    if status.is_repo {
        Ok(())
    } else {
        Err(String::from("Workspace is not a git repository"))
    }
}

fn get_git_status_snapshot(root: &Path) -> Result<(GitRepoStatus, Vec<GitChange>), String> {
    let args = vec![
        String::from("-c"),
        String::from("core.quotepath=false"),
        String::from("status"),
        String::from("--porcelain=v1"),
        String::from("--branch"),
    ];
    let result = run_git_command(root, &args)?;
    if !result.success {
        let combined_output = format!("{}\n{}", result.stderr, result.stdout);
        if is_not_git_repository_error(&combined_output) {
            return Ok((
                GitRepoStatus {
                    is_repo: false,
                    branch: None,
                    upstream: None,
                    ahead: 0,
                    behind: 0,
                    has_changes: false,
                },
                Vec::new(),
            ));
        }

        return Err(format!(
            "Failed to read git status: {}",
            summarize_git_failure(&result)
        ));
    }

    Ok(parse_git_status_porcelain(&result.stdout, root))
}

fn run_git_command(root: &Path, args: &[String]) -> Result<GitCommandResult, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .map_err(|error| format!("Failed to run git command: {error}"))?;
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(GitCommandResult {
        command: String::from("git"),
        args: args.to_vec(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code,
        success: output.status.success(),
    })
}

fn run_git_command_expect_success(
    root: &Path,
    args: &[String],
    context: &str,
) -> Result<GitCommandResult, String> {
    let result = run_git_command(root, args)?;
    if result.success {
        return Ok(result);
    }

    Err(format!("{context}: {}", summarize_git_failure(&result)))
}

fn summarize_git_failure(result: &GitCommandResult) -> String {
    let stderr = result.stderr.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }

    let stdout = result.stdout.trim();
    if !stdout.is_empty() {
        return stdout.to_string();
    }

    format!("command exited with code {}", result.exit_code)
}

fn is_not_git_repository_error(text: &str) -> bool {
    let normalized = text.to_lowercase();
    normalized.contains("not a git repository")
}

fn is_restore_unknown_path_error(result: &GitCommandResult) -> bool {
    let text = format!("{}\n{}", result.stderr, result.stdout).to_lowercase();
    text.contains("did not match any file")
        || text.contains("pathspec")
        || text.contains("could not resolve")
}

fn validate_git_branch_name(value: &str) -> Result<&str, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(String::from("Branch name cannot be empty"));
    }

    if trimmed.starts_with('-') {
        return Err(String::from("Branch name cannot start with '-'"));
    }

    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err(String::from("Branch name is not valid"));
    }

    Ok(trimmed)
}

fn normalize_git_paths(paths: &[String], root: &Path) -> Result<Vec<NormalizedGitPath>, String> {
    if paths.is_empty() {
        return Err(String::from("No paths provided"));
    }

    let mut normalized_paths = Vec::with_capacity(paths.len());
    for raw_path in paths {
        let trimmed_path = raw_path.trim();
        if trimmed_path.is_empty() {
            return Err(String::from("Path cannot be empty"));
        }

        let absolute_path = resolve_write_workspace_path(trimmed_path, root)?;
        if absolute_path == root {
            return Err(String::from("Git path cannot be workspace root"));
        }

        let relative_path = absolute_path
            .strip_prefix(root)
            .map_err(|_| String::from("Path is outside workspace boundary"))?
            .to_string_lossy()
            .replace('\\', "/");
        if relative_path.is_empty() {
            return Err(String::from("Git path cannot be workspace root"));
        }

        normalized_paths.push(NormalizedGitPath {
            absolute: absolute_path,
            relative: relative_path,
        });
    }

    Ok(normalized_paths)
}

fn parse_git_status_porcelain(output: &str, root: &Path) -> (GitRepoStatus, Vec<GitChange>) {
    let mut status = GitRepoStatus {
        is_repo: true,
        branch: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        has_changes: false,
    };
    let mut changes = Vec::new();

    for raw_line in output.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.starts_with("## ") {
            parse_git_branch_header(line, &mut status);
            continue;
        }

        if let Some(change) = parse_git_change_line(line, root) {
            changes.push(change);
        }
    }

    status.has_changes = !changes.is_empty();
    (status, changes)
}

fn parse_git_branch_header(line: &str, status: &mut GitRepoStatus) {
    let mut content = line.trim_start_matches("## ").trim();

    if let Some(bracket_start) = content.rfind(" [") {
        if content.ends_with(']') {
            let details = &content[(bracket_start + 2)..(content.len() - 1)];
            for token in details.split(',') {
                let trimmed = token.trim();
                if let Some(value) = trimmed.strip_prefix("ahead ") {
                    status.ahead = value.parse::<u32>().unwrap_or(0);
                } else if let Some(value) = trimmed.strip_prefix("behind ") {
                    status.behind = value.parse::<u32>().unwrap_or(0);
                }
            }
            content = &content[..bracket_start];
        }
    }

    if let Some((branch, upstream)) = content.split_once("...") {
        status.branch = parse_git_branch_name(branch);
        let upstream_name = upstream.trim();
        status.upstream = if upstream_name.is_empty() {
            None
        } else {
            Some(upstream_name.to_string())
        };
        return;
    }

    status.branch = parse_git_branch_name(content);
    status.upstream = None;
}

fn parse_git_branch_name(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(branch) = trimmed.strip_prefix("No commits yet on ") {
        let branch_name = branch.trim();
        return if branch_name.is_empty() {
            None
        } else {
            Some(branch_name.to_string())
        };
    }

    if trimmed == "HEAD (no branch)" {
        return Some(String::from("HEAD"));
    }

    let branch_candidate = trimmed.split(' ').next().unwrap_or(trimmed).trim();
    if branch_candidate.is_empty() {
        None
    } else {
        Some(branch_candidate.to_string())
    }
}

fn parse_git_change_line(line: &str, root: &Path) -> Option<GitChange> {
    let mut chars = line.chars();
    let index_status = chars.next()?;
    let worktree_status = chars.next()?;
    let separator = chars.next()?;
    if separator != ' ' {
        return None;
    }

    let payload = chars.as_str().trim();
    if payload.is_empty() {
        return None;
    }

    let (old_path_relative, path_relative) =
        if let Some((old_path, new_path)) = payload.split_once(" -> ") {
            (Some(old_path.trim()), new_path.trim())
        } else {
            (None, payload)
        };
    if path_relative.is_empty() {
        return None;
    }

    let absolute_path = normalize_windows_verbatim_path(root.join(path_relative))
        .to_string_lossy()
        .to_string();
    let absolute_old_path = old_path_relative.map(|value| {
        normalize_windows_verbatim_path(root.join(value))
            .to_string_lossy()
            .to_string()
    });
    let untracked = index_status == '?' && worktree_status == '?';

    Some(GitChange {
        path: absolute_path,
        old_path: absolute_old_path,
        index_status: index_status.to_string(),
        worktree_status: worktree_status.to_string(),
        status_code: format!("{index_status}{worktree_status}"),
        staged: index_status != ' ' && index_status != '?',
        unstaged: worktree_status != ' ',
        untracked,
    })
}

fn parse_git_branches_output(output: &str, current_branch: Option<&str>) -> Vec<GitBranchInfo> {
    let mut branches = Vec::new();
    for raw_line in output.lines() {
        let line = raw_line.trim_end_matches('\r');
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let is_current_marker = trimmed.starts_with('*');
        let mut branch_name = if is_current_marker {
            trimmed.trim_start_matches('*').trim()
        } else {
            trimmed
        };
        if branch_name.contains(" -> ") {
            continue;
        }

        let is_remote = branch_name.starts_with("remotes/");
        if is_remote {
            branch_name = branch_name.trim_start_matches("remotes/");
        }

        let branch_name = branch_name.trim();
        if branch_name.is_empty() {
            continue;
        }

        let is_current = current_branch
            .map(|value| value == branch_name)
            .unwrap_or(false)
            || is_current_marker;
        if branches
            .iter()
            .any(|item: &GitBranchInfo| item.name == branch_name && item.is_remote == is_remote)
        {
            continue;
        }

        branches.push(GitBranchInfo {
            name: branch_name.to_string(),
            is_current,
            is_remote,
        });
    }

    branches.sort_by(|left, right| match (left.is_remote, right.is_remote) {
        (false, true) => std::cmp::Ordering::Less,
        (true, false) => std::cmp::Ordering::Greater,
        _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
    });
    branches
}

fn extract_git_commit_hash(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('[') {
            continue;
        }

        let closing = trimmed.find(']')?;
        let payload = &trimmed[1..closing];
        let mut segments = payload.split_whitespace();
        let _branch = segments.next();
        let hash = segments.next()?;
        if hash.chars().all(|value| value.is_ascii_hexdigit()) {
            return Some(hash.to_string());
        }
    }

    None
}

fn search_directory(
    directory: &Path,
    query_lower: &str,
    hits: &mut Vec<SearchHit>,
    max_hits: usize,
    include_hidden: bool,
) -> Result<(), String> {
    for entry in
        fs::read_dir(directory).map_err(|error| format!("Failed to read directory: {error}"))?
    {
        if hits.len() >= max_hits {
            return Ok(());
        }

        let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to read entry type: {error}"))?;
        let name = entry.file_name().to_string_lossy().to_string();

        if !include_hidden && name.starts_with('.') {
            continue;
        }

        if file_type.is_dir() {
            if is_ignored_directory_name(&name) {
                continue;
            }
            search_directory(&path, query_lower, hits, max_hits, include_hidden)?;
            continue;
        }

        if !file_type.is_file() {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(value) => value,
            Err(_) => continue,
        };

        if metadata.len() > 2 * 1024 * 1024 {
            continue;
        }

        let bytes = match fs::read(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };

        if is_probably_binary(&bytes) {
            continue;
        }

        let content = String::from_utf8_lossy(&bytes).to_string();
        for (line_index, line) in content.lines().enumerate() {
            if hits.len() >= max_hits {
                return Ok(());
            }

            let line_lower = line.to_lowercase();
            if let Some(position) = line_lower.find(query_lower) {
                hits.push(SearchHit {
                    path: path.to_string_lossy().to_string(),
                    line: line_index + 1,
                    column: position + 1,
                    preview: truncate_line(line),
                });
            }
        }
    }

    Ok(())
}

fn truncate_line(value: &str) -> String {
    let trimmed = value.trim();
    let mut result = String::new();
    for (index, character) in trimmed.chars().enumerate() {
        if index >= 180 {
            result.push_str("...");
            break;
        }
        result.push(character);
    }
    result
}

fn canonicalize_dir_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err(String::from("Workspace path cannot be empty"));
    }

    let canonical = canonicalize_path(Path::new(path), "Failed to resolve workspace path")?;

    if !canonical.is_dir() {
        return Err(String::from("Workspace path must point to a directory"));
    }

    Ok(canonical)
}

fn get_workspace_root(state: &tauri::State<AppState>) -> Result<PathBuf, String> {
    let workspace_guard = state
        .workspace_root
        .lock()
        .map_err(|_| String::from("Failed to lock workspace state"))?;

    workspace_guard
        .clone()
        .ok_or_else(|| String::from("Workspace is not selected"))
}

fn get_workspace_root_optional(state: &tauri::State<AppState>) -> Result<Option<PathBuf>, String> {
    let workspace_guard = state
        .workspace_root
        .lock()
        .map_err(|_| String::from("Failed to lock workspace state"))?;
    Ok(workspace_guard.clone())
}

fn resolve_existing_workspace_path(path: &str, root: &Path) -> Result<PathBuf, String> {
    let candidate = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        root.join(path)
    };

    let canonical = canonicalize_path(&candidate, "Failed to resolve path")?;
    ensure_inside_workspace(&canonical, root)?;

    Ok(canonical)
}

fn resolve_write_workspace_path(path: &str, root: &Path) -> Result<PathBuf, String> {
    let candidate = if Path::new(path).is_absolute() {
        PathBuf::from(path)
    } else {
        root.join(path)
    };

    if candidate.exists() {
        let canonical = canonicalize_path(&candidate, "Failed to resolve path")?;
        ensure_inside_workspace(&canonical, root)?;
        return Ok(canonical);
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| String::from("Target file path has no parent directory"))?;
    let canonical_parent = canonicalize_path(parent, "Failed to resolve parent directory")?;
    ensure_inside_workspace(&canonical_parent, root)?;

    let file_name = candidate
        .file_name()
        .ok_or_else(|| String::from("Target file path is missing file name"))?;

    Ok(canonical_parent.join(file_name))
}

fn validate_path_segment_name(value: &str) -> Result<&str, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(String::from("Name cannot be empty"));
    }

    if trimmed == "." || trimmed == ".." {
        return Err(String::from("Name is not valid"));
    }

    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(String::from("Name cannot contain path separators"));
    }

    Ok(trimmed)
}

fn ensure_inside_workspace(candidate: &Path, workspace_root: &Path) -> Result<(), String> {
    if candidate.starts_with(workspace_root) {
        Ok(())
    } else {
        Err(String::from("Path is outside workspace boundary"))
    }
}

fn canonicalize_path(path: &Path, error_context: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|error| format!("{error_context}: {error}"))?;
    Ok(normalize_windows_verbatim_path(canonical))
}

fn normalize_windows_verbatim_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{stripped}"));
        }
        if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            return PathBuf::from(stripped);
        }
    }

    path
}

fn is_ignored_directory_name(name: &str) -> bool {
    IGNORED_DIRECTORY_NAMES
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(name))
}

fn kb_rounded_up(bytes: u64) -> u64 {
    (bytes + 1023) / 1024
}

fn is_probably_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(1024).any(|value| *value == 0)
}

#[cfg(test)]
mod tests {
    use super::{normalize_git_paths, parse_git_branches_output, parse_git_status_porcelain};
    use std::{
        fs,
        path::Path,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_temp_directory_name(prefix: &str) -> String {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        format!("{prefix}-{timestamp}")
    }

    #[test]
    fn parse_git_status_reads_branch_and_changes() {
        let root = Path::new("/workspace");
        let output = "\
## main...origin/main [ahead 2, behind 1]
M  src/lib.rs
 M README.md
R  old.txt -> new.txt
?? notes.txt
";

        let (status, changes) = parse_git_status_porcelain(output, root);
        assert!(status.is_repo);
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 1);
        assert!(status.has_changes);
        assert_eq!(changes.len(), 4);

        let rename_change = changes
            .iter()
            .find(|change| change.status_code == "R ")
            .expect("rename change should exist");
        assert!(rename_change.staged);
        assert!(rename_change
            .old_path
            .as_deref()
            .map(|path| path.ends_with("old.txt"))
            .unwrap_or(false));
        assert!(rename_change.path.ends_with("new.txt"));

        let untracked_change = changes
            .iter()
            .find(|change| change.untracked)
            .expect("untracked change should exist");
        assert!(!untracked_change.staged);
        assert!(untracked_change.unstaged);
    }

    #[test]
    fn parse_git_branches_marks_local_and_remote() {
        let output = "\
* main
  feature/ui
  remotes/origin/main
  remotes/origin/feature/ui
  remotes/origin/HEAD -> origin/main
";

        let branches = parse_git_branches_output(output, Some("main"));
        assert_eq!(branches.len(), 4);

        let main_branch = branches
            .iter()
            .find(|branch| branch.name == "main" && !branch.is_remote)
            .expect("local main branch should exist");
        assert!(main_branch.is_current);

        let remote_main = branches
            .iter()
            .find(|branch| branch.name == "origin/main" && branch.is_remote)
            .expect("remote main branch should exist");
        assert!(!remote_main.is_current);
    }

    #[test]
    fn normalize_git_paths_rejects_workspace_root() {
        let temp_root =
            std::env::temp_dir().join(unique_temp_directory_name("vexc-normalize-git-paths"));
        fs::create_dir_all(&temp_root).expect("temporary root should be created");
        let root_string = temp_root.to_string_lossy().to_string();

        let result = normalize_git_paths(&[root_string], &temp_root);
        assert!(result.is_err());

        let _ = fs::remove_dir_all(&temp_root);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            set_workspace,
            get_workspace,
            list_directory,
            read_file,
            write_file,
            create_file,
            create_directory,
            rename_path,
            delete_path,
            move_path,
            search_workspace,
            terminal_create,
            terminal_list,
            terminal_snapshot,
            terminal_write,
            terminal_resize,
            terminal_clear,
            terminal_close,
            git_repo_status,
            git_changes,
            git_stage,
            git_unstage,
            git_discard,
            git_commit,
            git_branches,
            git_checkout,
            git_pull,
            git_push,
            git_diff,
            lsp_start,
            lsp_send,
            lsp_stop,
            ai_provider_suggestions,
            ai_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
