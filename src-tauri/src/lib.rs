use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::Emitter;

#[derive(Default)]
struct AppState {
    workspace_root: Mutex<Option<PathBuf>>,
    terminals: Arc<Mutex<HashMap<String, Arc<Mutex<TerminalState>>>>>,
    terminal_counter: AtomicU64,
}

struct TerminalState {
    id: String,
    title: String,
    shell: String,
    cwd: PathBuf,
    status: String,
    lines: Vec<String>,
    stdin: ChildStdin,
    process: Child,
}

const MAX_EDITOR_FILE_BYTES: u64 = 1024 * 1024;
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
    lines: Vec<String>,
    last_result: Option<TerminalCommandResult>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEvent {
    session_id: String,
    chunk: String,
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
        None => std::env::current_dir()
            .map_err(|error| format!("Failed to resolve current directory: {error}"))?,
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

    let mut spawn_command = build_terminal_spawn_command(&shell_value, &cwd);
    let mut process = spawn_command
        .spawn()
        .map_err(|error| format!("Failed to start terminal process: {error}"))?;

    let stdin = process
        .stdin
        .take()
        .ok_or_else(|| String::from("Failed to capture terminal stdin"))?;
    let stdout = process
        .stdout
        .take()
        .ok_or_else(|| String::from("Failed to capture terminal stdout"))?;
    let stderr = process
        .stderr
        .take()
        .ok_or_else(|| String::from("Failed to capture terminal stderr"))?;

    let terminal_state = Arc::new(Mutex::new(TerminalState {
        id: id.clone(),
        title,
        shell: shell_value,
        cwd: cwd.clone(),
        status: String::from("running"),
        lines: vec![format!("Started session in {}", cwd.to_string_lossy())],
        stdin,
        process,
    }));

    {
        let mut terminal_guard = state
            .terminals
            .lock()
            .map_err(|_| String::from("Failed to lock terminal state"))?;
        terminal_guard.insert(id.clone(), terminal_state.clone());
    }

    spawn_terminal_reader(
        id.clone(),
        false,
        stdout,
        state.terminals.clone(),
        app.clone(),
    );
    spawn_terminal_reader(id, true, stderr, state.terminals.clone(), app);

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
) -> Result<TerminalSessionSnapshot, String> {
    if input.is_empty() {
        return Err(String::from("Terminal input cannot be empty"));
    }

    let session = get_terminal_session(&state, &session_id)?;
    let mut session_guard = session
        .lock()
        .map_err(|_| String::from("Failed to lock terminal session"))?;

    if let Some(status) = session_guard
        .process
        .try_wait()
        .map_err(|error| format!("Failed to inspect terminal process: {error}"))?
    {
        let exit_code = status.code().unwrap_or(-1);
        session_guard.status = format!("exited ({exit_code})");
        return Err(String::from("Terminal session has already exited"));
    }

    session_guard
        .stdin
        .write_all(input.as_bytes())
        .map_err(|error| format!("Failed to write to terminal: {error}"))?;
    session_guard
        .stdin
        .flush()
        .map_err(|error| format!("Failed to flush terminal input: {error}"))?;

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

        let _ = guard.stdin.write_all(b"exit\n");
        let _ = guard.stdin.flush();
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
            let canonical = fs::canonicalize(&provided_path)
                .map_err(|error| format!("Failed to resolve AI working directory: {error}"))?;

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
            None => std::env::current_dir()
                .map_err(|error| format!("Failed to resolve current directory: {error}"))?,
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
    }
}

fn terminal_state_to_snapshot(
    state: &TerminalState,
    last_result: Option<TerminalCommandResult>,
) -> TerminalSessionSnapshot {
    TerminalSessionSnapshot {
        session: terminal_state_to_session(state),
        lines: state.lines.clone(),
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

fn build_terminal_spawn_command(shell: &str, cwd: &Path) -> Command {
    let shell_lower = shell.to_lowercase();
    let mut command = Command::new(shell);

    if shell_lower.contains("powershell") || shell_lower.contains("pwsh") {
        command.args(["-NoLogo", "-NoProfile"]);
    }

    command
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    command
}

fn spawn_terminal_reader<R>(
    session_id: String,
    is_error: bool,
    mut reader: R,
    terminals: Arc<Mutex<HashMap<String, Arc<Mutex<TerminalState>>>>>,
    app: tauri::AppHandle,
) where
    R: Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                    if chunk.is_empty() {
                        continue;
                    }

                    if let Ok(terminal_guard) = terminals.lock() {
                        if let Some(session) = terminal_guard.get(&session_id).cloned() {
                            drop(terminal_guard);
                            if let Ok(mut session_guard) = session.lock() {
                                append_terminal_lines(&mut session_guard.lines, &chunk, is_error);
                            }
                        }
                    }

                    let _ = app.emit(
                        "terminal://output",
                        TerminalOutputEvent {
                            session_id: session_id.clone(),
                            chunk,
                            is_error,
                        },
                    );
                }
                Err(_) => break,
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

fn append_terminal_lines(lines: &mut Vec<String>, chunk: &str, is_error: bool) {
    let normalized = chunk.replace("\r\n", "\n").replace('\r', "\n");
    for line in normalized.split('\n') {
        if is_error {
            lines.push(format!("[stderr] {line}"));
        } else {
            lines.push(line.to_string());
        }
    }

    if lines.len() > 1800 {
        let overflow = lines.len() - 1800;
        lines.drain(0..overflow);
    }
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

    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("Failed to resolve workspace path: {error}"))?;

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

    let canonical =
        fs::canonicalize(candidate).map_err(|error| format!("Failed to resolve path: {error}"))?;
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
        let canonical = fs::canonicalize(candidate)
            .map_err(|error| format!("Failed to resolve path: {error}"))?;
        ensure_inside_workspace(&canonical, root)?;
        return Ok(canonical);
    }

    let parent = candidate
        .parent()
        .ok_or_else(|| String::from("Target file path has no parent directory"))?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Failed to resolve parent directory: {error}"))?;
    ensure_inside_workspace(&canonical_parent, root)?;

    let file_name = candidate
        .file_name()
        .ok_or_else(|| String::from("Target file path is missing file name"))?;

    Ok(canonical_parent.join(file_name))
}

fn ensure_inside_workspace(candidate: &Path, workspace_root: &Path) -> Result<(), String> {
    if candidate.starts_with(workspace_root) {
        Ok(())
    } else {
        Err(String::from("Path is outside workspace boundary"))
    }
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
            search_workspace,
            terminal_create,
            terminal_list,
            terminal_snapshot,
            terminal_write,
            terminal_close,
            ai_provider_suggestions,
            ai_run
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
