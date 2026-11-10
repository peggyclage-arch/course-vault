//! CourseVault — library scanner, ported from electron/main.js.
//!
//! Accepts three layouts:
//!   Library/<Course>/<Module>/<Lesson files>   (the documented convention)
//!   Library/<Course>/<Lesson files>            (videos directly in a course)
//!   Library/<Lesson files>                     (videos directly in the picked folder)
//! Grouping, ordering, course.md handling and the "resources-only stem is
//! not a lesson" rule match the Electron scanner exactly.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub const VIDEO_EXTS: [&str; 4] = ["mp4", "mkv", "webm", "mov"];
pub const SUB_EXTS: [&str; 2] = ["srt", "vtt"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtitle {
    pub path: String,
    pub lang: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lesson {
    pub id: String,
    pub name: String,
    pub order: i64,
    /// Filename stem, e.g. "01 - Intro".
    pub path: String,
    pub video: Option<String>,
    pub note: Option<String>,
    pub subtitles: Vec<Subtitle>,
    pub resources_dir: Option<String>,
    pub resources: Vec<ResourceFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Module {
    pub id: String,
    pub name: String,
    pub order: i64,
    pub path: String,
    pub lessons: Vec<Lesson>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: String,
    pub name: String,
    pub order: i64,
    pub path: String,
    pub description: String,
    pub modules: Vec<Module>,
}

/// "01 - Intro to X" -> (1, "Intro to X"); no numeric prefix -> (9999, name).
pub fn split_prefix(name: &str) -> (i64, String) {
    let bytes = name.as_bytes();
    let mut i = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == 0 {
        return (9999, name.to_string());
    }
    let mut j = i;
    while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
        j += 1;
    }
    if j >= bytes.len() || !(bytes[j] == b'-' || bytes[j] == b'_' || bytes[j] == b'.') {
        return (9999, name.to_string());
    }
    j += 1;
    while j < bytes.len() && (bytes[j] == b' ' || bytes[j] == b'\t') {
        j += 1;
    }
    let order: i64 = name[..i].parse().unwrap_or(9999);
    (order, name[j..].to_string())
}

fn sort_key(order: i64, title: &str) -> (i64, String) {
    (order, title.to_lowercase())
}

fn list_files_recursive(dir: &Path, base: &Path) -> Vec<ResourceFile> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return out;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let full = entry.path();
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_dir() {
            out.extend(list_files_recursive(&full, base));
        } else if ft.is_file() {
            let name = full
                .strip_prefix(base)
                .unwrap_or(&full)
                .to_string_lossy()
                .replace('\\', "/");
            let size = fs::metadata(&full).map(|m| m.len()).unwrap_or(0);
            out.push(ResourceFile {
                name,
                path: full.to_string_lossy().to_string(),
                size,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[derive(Default)]
struct StemGroup {
    video: Option<String>,
    note: Option<String>,
    subtitles: Vec<Subtitle>,
    resources_dir: Option<PathBuf>,
}

/// Group the files directly inside one folder into lessons, by filename
/// stem. `exclude_files` holds lowercase filenames to skip (e.g. course.md).
fn build_lessons_from_dir(
    dir: &Path,
    module_id: &str,
    exclude_files: &HashSet<String>,
) -> Vec<Lesson> {
    let mut by_stem: HashMap<String, StemGroup> = HashMap::new();
    let mut stems: Vec<String> = Vec::new();
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let full = entry.path();
        let ft = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if ft.is_dir() {
            // A folder named like a lesson stem holds that lesson's resources.
            if !by_stem.contains_key(&name) {
                stems.push(name.clone());
                by_stem.insert(name.clone(), StemGroup::default());
            }
            by_stem.get_mut(&name).unwrap().resources_dir = Some(full);
            continue;
        }
        if exclude_files.contains(&name.to_lowercase()) {
            continue;
        }
        let ext = Path::new(&name)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let stem = Path::new(&name)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| name.clone());
        if !by_stem.contains_key(&stem) {
            stems.push(stem.clone());
            by_stem.insert(stem.clone(), StemGroup::default());
        }
        let g = by_stem.get_mut(&stem).unwrap();
        if VIDEO_EXTS.contains(&ext.as_str()) {
            g.video = Some(full.to_string_lossy().to_string());
        } else if ext == "md" {
            g.note = Some(full.to_string_lossy().to_string());
        } else if SUB_EXTS.contains(&ext.as_str()) {
            g.subtitles.push(Subtitle {
                path: full.to_string_lossy().to_string(),
                lang: if ext == "vtt" { "vtt".into() } else { "srt".into() },
            });
        }
        // Anything else loose in the folder is ignored.
    }

    let mut lessons: Vec<Lesson> = Vec::new();
    for stem in stems {
        let g = by_stem.remove(&stem).unwrap();
        if g.video.is_none() && g.note.is_none() && g.subtitles.is_empty() {
            continue; // a stem that is only a resources folder is not a lesson
        }
        let (order, title) = split_prefix(&stem);
        lessons.push(Lesson {
            id: format!("{module_id}/{stem}"),
            name: title,
            order,
            path: stem,
            video: g.video,
            note: g.note,
            subtitles: g.subtitles,
            resources_dir: g
                .resources_dir
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
            resources: g
                .resources_dir
                .as_ref()
                .map(|d| list_files_recursive(d, d))
                .unwrap_or_default(),
        });
    }
    lessons.sort_by(|a, b| sort_key(a.order, &a.name).cmp(&sort_key(b.order, &b.name)));
    lessons
}

/// Read a course.md file: first "# Heading" is the display title.
fn read_course_md(course_md: &Path, name: &mut String, description: &mut String) {
    let Ok(raw) = fs::read_to_string(course_md) else {
        return;
    };
    let mut lines = raw.lines();
    match lines.next() {
        Some(first) if first.starts_with("# ") => {
            *name = first.trim_start_matches("# ").trim().to_string();
            *description = lines.collect::<Vec<_>>().join("\n").trim().to_string();
        }
        _ => *description = raw.trim().to_string(),
    }
}

pub fn scan_library(root: &Path) -> Vec<Course> {
    let mut courses: Vec<Course> = Vec::new();
    if !root.is_dir() {
        return courses;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return courses;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());

    for course_entry in entries {
        let name = course_entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let ft = match course_entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if !ft.is_dir() {
            continue;
        }
        let course_path = course_entry.path();
        let (order, title) = split_prefix(&name);
        let mut course = Course {
            id: name.clone(),
            name: title,
            order,
            path: course_path.to_string_lossy().to_string(),
            description: String::new(),
            modules: Vec::new(),
        };
        read_course_md(
            &course_path.join("course.md"),
            &mut course.name,
            &mut course.description,
        );

        // Module subfolders.
        if let Ok(mod_entries) = fs::read_dir(&course_path) {
            let mut mod_entries: Vec<_> = mod_entries.flatten().collect();
            mod_entries.sort_by_key(|e| e.file_name());
            for mod_entry in mod_entries {
                let mod_name = mod_entry.file_name().to_string_lossy().to_string();
                if mod_name.starts_with('.') {
                    continue;
                }
                let Ok(mft) = mod_entry.file_type() else {
                    continue;
                };
                if !mft.is_dir() {
                    continue;
                }
                let mod_path = mod_entry.path();
                let (mod_order, mod_title) = split_prefix(&mod_name);
                let module_id = format!("{}/{mod_name}", course.id);
                let lessons = build_lessons_from_dir(&mod_path, &module_id, &HashSet::new());
                if !lessons.is_empty() {
                    course.modules.push(Module {
                        id: module_id,
                        name: mod_title,
                        order: mod_order,
                        path: mod_path.to_string_lossy().to_string(),
                        lessons,
                    });
                }
            }
        }

        // Flatter layout: lesson files directly inside the course folder.
        let flat_lessons = build_lessons_from_dir(
            &course_path,
            &format!("{}/Lessons", course.id),
            &["course.md".to_string()].into_iter().collect(),
        );
        if !flat_lessons.is_empty() {
            course.modules.push(Module {
                id: format!("{}/Lessons", course.id),
                name: "Lessons".to_string(),
                order: 9999,
                path: course_path.to_string_lossy().to_string(),
                lessons: flat_lessons,
            });
        }

        course
            .modules
            .sort_by(|a, b| sort_key(a.order, &a.name).cmp(&sort_key(b.order, &b.name)));
        if !course.modules.is_empty() {
            courses.push(course);
        }
    }

    // Flattest layout: lesson files directly inside the picked folder.
    let root_name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Library".to_string());
    let root_lessons = build_lessons_from_dir(
        root,
        &format!("{root_name}/Lessons"),
        &["course.md".to_string()].into_iter().collect(),
    );
    if !root_lessons.is_empty() {
        let (root_order, root_title) = split_prefix(&root_name);
        let _ = root_order;
        let mut root_course = Course {
            id: root_name.clone(),
            name: root_title,
            order: 9999,
            path: root.to_string_lossy().to_string(),
            description: String::new(),
            modules: vec![Module {
                id: format!("{root_name}/Lessons"),
                name: "Lessons".to_string(),
                order: 9999,
                path: root.to_string_lossy().to_string(),
                lessons: root_lessons,
            }],
        };
        read_course_md(
            &root.join("course.md"),
            &mut root_course.name,
            &mut root_course.description,
        );
        courses.push(root_course);
    }

    courses.sort_by(|a, b| sort_key(a.order, &a.name).cmp(&sort_key(b.order, &b.name)));
    courses
}

/// Strip SRT cue numbers and timestamps, leaving the spoken text.
pub fn strip_srt_timestamps(text: &str) -> String {
    text.lines()
        .filter(|line| {
            let t = line.trim();
            !t.is_empty() && !t.chars().all(|c| c.is_ascii_digit()) && !t.contains("-->")
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn srt_to_vtt(srt: &str) -> String {
    let mut out = String::from("WEBVTT\n\n");
    let body = srt.replace("\r\n", "\n");
    // 00:00:01,000 -> 00:00:01.000 (only in timestamp lines, but the
    // pattern only matches the HH:MM:SS,mmm shape anyway).
    let mut rest = body.as_str();
    loop {
        // Find the next timestamp-shaped comma and replace it with a dot.
        let Some(pos) = find_timestamp_comma(rest) else {
            break;
        };
        out.push_str(&rest[..pos]);
        out.push('.');
        rest = &rest[pos + 1..];
    }
    out.push_str(rest);
    out
}

fn find_timestamp_comma(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let mut i = 0;
    while i + 12 < b.len() {
        // HH:MM:SS,mmm
        if b[i].is_ascii_digit()
            && b[i + 1].is_ascii_digit()
            && b[i + 2] == b':'
            && b[i + 3].is_ascii_digit()
            && b[i + 4].is_ascii_digit()
            && b[i + 5] == b':'
            && b[i + 6].is_ascii_digit()
            && b[i + 7].is_ascii_digit()
            && b[i + 8] == b','
            && b[i + 9].is_ascii_digit()
            && b[i + 10].is_ascii_digit()
            && b[i + 11].is_ascii_digit()
        {
            return Some(i + 8);
        }
        i += 1;
    }
    None
}
