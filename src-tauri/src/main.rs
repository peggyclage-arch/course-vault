// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod media_server;
mod scanner;

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use scanner::{scan_library as scan_library_impl, srt_to_vtt, strip_srt_timestamps, Course};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

// ---------------------------------------------------------------------------
// Local state (JSON in the OS app-data folder). Same shape as the Electron
// build: { libraryPath, progress }. No server, no cloud, no accounts.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEntry {
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub completed: bool,
    #[serde(default)]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateFile {
    pub library_path: Option<String>,
    pub progress: HashMap<String, ProgressEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub library_path: Option<String>,
    pub courses: Vec<Course>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub lesson_id: String,
    pub course: String,
    pub module: String,
    pub lesson: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressUpdate {
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub completed: Option<bool>,
}

#[derive(Clone)]
struct SearchEntry {
    lesson_id: String,
    course: String,
    module: String,
    lesson: String,
    text: String,
}

struct AppState {
    inner: Mutex<StateFile>,
    search_index: Mutex<Vec<SearchEntry>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    watch_tx: Mutex<Option<mpsc::Sender<()>>>,
    /// Loopback port of the media server (0 if it failed to start).
    media_port: u16,
    /// Library root the media server is allowed to serve from.
    media_root: media_server::SharedRoot,
}

/// Keep the media server's allowed root in sync with the picked library.
fn sync_media_root(state: &State<AppState>) {
    let root = state.library_root();
    if let Ok(mut guard) = state.media_root.lock() {
        *guard = root;
    }
}

impl AppState {
    fn state_file_path(app: &AppHandle) -> PathBuf {
        app.path()
            .app_data_dir()
            .expect("app data dir")
            .join("coursevault-state.json")
    }

    fn load(app: &AppHandle) -> StateFile {
        let path = Self::state_file_path(app);
        fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    fn save(&self, app: &AppHandle) {
        let path = Self::state_file_path(app);
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(inner) = self.inner.lock() {
            let _ = fs::write(&path, serde_json::to_string_pretty(&*inner).unwrap());
        }
    }

    fn library_root(&self) -> Option<PathBuf> {
        self.inner
            .lock()
            .ok()?
            .library_path
            .clone()
            .map(PathBuf::from)
    }
}

fn build_search_index(courses: &[Course]) -> Vec<SearchEntry> {
    let mut index = Vec::new();
    for course in courses {
        for module in &course.modules {
            for lesson in &module.lessons {
                let mut haystack = format!("{} {} {}", course.name, module.name, lesson.name);
                if let Some(note) = &lesson.note {
                    if let Ok(text) = fs::read_to_string(note) {
                        haystack.push(' ');
                        haystack.push_str(&text);
                    }
                }
                for sub in &lesson.subtitles {
                    if let Ok(raw) = fs::read_to_string(&sub.path) {
                        haystack.push(' ');
                        if sub.lang == "srt" {
                            haystack.push_str(&strip_srt_timestamps(&raw));
                        } else {
                            haystack.push_str(&raw);
                        }
                    }
                }
                index.push(SearchEntry {
                    lesson_id: lesson.id.clone(),
                    course: course.name.clone(),
                    module: module.name.clone(),
                    lesson: lesson.name.clone(),
                    text: haystack,
                });
            }
        }
    }
    index
}

fn search_index(state: &State<AppState>, query: &str) -> Vec<SearchResult> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Vec::new();
    }
    let words: Vec<&str> = q.split_whitespace().collect();
    let Ok(index) = state.search_index.lock() else {
        return Vec::new();
    };
    index
        .iter()
        .filter(|e| {
            let hay = e.text.to_lowercase();
            words.iter().all(|w| hay.contains(w))
        })
        .map(|e| {
            let lower = e.text.to_lowercase();
            let idx = lower.find(words[0]).unwrap_or(0);
            let start = idx.saturating_sub(60);
            let snippet: String = e.text.chars().skip(start).take(180).collect();
            SearchResult {
                lesson_id: e.lesson_id.clone(),
                course: e.course.clone(),
                module: e.module.clone(),
                lesson: e.lesson.clone(),
                snippet: format!(
                    "{}{}",
                    if start > 0 { "…" } else { "" },
                    snippet.split_whitespace().collect::<Vec<_>>().join(" ")
                ),
            }
        })
        .take(50)
        .collect()
}

fn is_inside_library(file_path: &Path, library_root: &Option<PathBuf>) -> bool {
    let Some(root) = library_root else {
        return false;
    };
    file_path.starts_with(root)
}

// ---------------------------------------------------------------------------
// Folder watcher — re-scan when the library changes (debounced 600ms).
// ---------------------------------------------------------------------------

fn start_watcher(app: &AppHandle, state: &State<AppState>, root: &Path) {
    // One debounce thread per app lifetime; it owns a receiver and emits
    // "library-changed" after 600ms without events.
    let tx = {
        let mut slot = state.watch_tx.lock().unwrap();
        if slot.is_none() {
            let (tx, rx) = mpsc::channel::<()>();
            let app_handle = app.clone();
            std::thread::spawn(move || loop {
                // Wait for the first event, then drain for 600ms of quiet.
                if rx.recv().is_err() {
                    return;
                }
                loop {
                    match rx.recv_timeout(Duration::from_millis(600)) {
                        Ok(()) => continue,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            let _ = app_handle.emit("library-changed", ());
                            break;
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => return,
                    }
                }
            });
            *slot = Some(tx.clone());
        }
        slot.clone().unwrap()
    };

    let mut watcher = RecommendedWatcher::new(
        move |_res: Result<notify::Event, notify::Error>| {
            let _ = tx.send(());
        },
        Config::default(),
    )
    .expect("watcher");
    let _ = watcher.watch(root, RecursiveMode::Recursive);
    *state.watcher.lock().unwrap() = Some(watcher);
}

fn stop_watcher(state: &State<AppState>) {
    *state.watcher.lock().unwrap() = None;
}

// ---------------------------------------------------------------------------
// Tauri commands (called from src/lib/bridge.js)
// ---------------------------------------------------------------------------

#[tauri::command]
fn pick_library(app: AppHandle, state: State<AppState>) -> Option<String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};
    let picked = app
        .dialog()
        .file()
        .set_title("Choose your course library folder")
        .blocking_pick_folder()?;
    // blocking_pick_folder returns a FilePath enum, not a PathBuf.
    let picked_path: PathBuf = match picked {
        FilePath::Path(p) => p,
        FilePath::Url(u) => PathBuf::from(u.to_string()),
    };
    let path = picked_path.to_string_lossy().to_string();
    {
        let mut inner = state.inner.lock().unwrap();
        inner.library_path = Some(path.clone());
    }
    state.save(&app);
    stop_watcher(&state);
    start_watcher(&app, &state, &picked_path);
    sync_media_root(&state);
    Some(path)
}

#[tauri::command]
fn get_media_port(state: State<AppState>) -> u16 {
    state.media_port
}

#[tauri::command]
fn scan_library(state: State<AppState>) -> ScanResult {
    let root = state.library_root();
    sync_media_root(&state);
    let courses = root
        .as_ref()
        .map(|r| scan_library_impl(r))
        .unwrap_or_default();
    let index = build_search_index(&courses);
    *state.search_index.lock().unwrap() = index;
    ScanResult {
        library_path: root.map(|p| p.to_string_lossy().to_string()),
        courses,
    }
}

#[tauri::command]
fn get_state(state: State<AppState>) -> StateFile {
    state.inner.lock().unwrap().clone()
}

#[tauri::command]
fn clear_library(app: AppHandle, state: State<AppState>) -> bool {
    stop_watcher(&state);
    {
        let mut inner = state.inner.lock().unwrap();
        inner.library_path = None;
    }
    state.save(&app);
    sync_media_root(&state);
    true
}

#[tauri::command]
fn save_progress(app: AppHandle, state: State<AppState>, lesson_id: String, data: ProgressUpdate) {
    let mut inner = state.inner.lock().unwrap();
    let entry = inner.progress.entry(lesson_id).or_default();
    if let Some(p) = data.position {
        entry.position = p;
    }
    if let Some(d) = data.duration {
        entry.duration = d;
    }
    if let Some(c) = data.completed {
        entry.completed = c;
    }
    entry.updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    drop(inner);
    state.save(&app);
}

#[tauri::command]
fn get_progress(state: State<AppState>) -> HashMap<String, ProgressEntry> {
    state.inner.lock().unwrap().progress.clone()
}

#[tauri::command]
fn get_note(state: State<AppState>, file_path: String) -> Option<String> {
    let path = Path::new(&file_path);
    if !is_inside_library(path, &state.library_root()) || !path.is_file() {
        return None;
    }
    fs::read_to_string(path).ok()
}

#[tauri::command]
fn get_subtitles(state: State<AppState>, file_path: String) -> Option<String> {
    let path = Path::new(&file_path);
    if !is_inside_library(path, &state.library_root()) || !path.is_file() {
        return None;
    }
    let raw = fs::read_to_string(path).ok()?;
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    Some(if ext == "srt" { srt_to_vtt(&raw) } else { raw })
}

#[tauri::command]
fn open_file(app: AppHandle, state: State<AppState>, file_path: String) -> bool {
    use tauri_plugin_opener::OpenerExt;
    let path = Path::new(&file_path);
    if !is_inside_library(path, &state.library_root()) || !path.is_file() {
        return false;
    }
    app.opener()
        .open_path(file_path, None::<&str>)
        .is_ok()
}

#[tauri::command]
fn search_library(state: State<AppState>, query: String) -> Vec<SearchResult> {
    search_index(&state, &query)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Loopback media server (see media_server.rs): <video> cannot
            // play asset:// URLs under WebKitGTK on Linux, so lesson media
            // is streamed over http://127.0.0.1:<port>/... instead.
            let (media_port, media_root) = match media_server::start() {
                Ok((port, root)) => (port, root),
                Err(e) => {
                    eprintln!("[media-server] failed to start: {e}");
                    (
                        0,
                        std::sync::Arc::new(std::sync::Mutex::new(None)),
                    )
                }
            };
            let state = AppState {
                inner: Mutex::new(AppState::load(&app.handle())),
                search_index: Mutex::new(Vec::new()),
                watcher: Mutex::new(None),
                watch_tx: Mutex::new(None),
                media_port,
                media_root,
            };
            app.manage(state);
            // Start watching the previously picked library, if any.
            let app_handle = app.handle().clone();
            let state = app_handle.state::<AppState>();
            sync_media_root(&state);
            if let Some(root) = state.library_root() {
                if root.is_dir() {
                    start_watcher(&app_handle, &state, &root);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_library,
            scan_library,
            get_state,
            clear_library,
            get_media_port,
            save_progress,
            get_progress,
            get_note,
            get_subtitles,
            open_file,
            search_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
