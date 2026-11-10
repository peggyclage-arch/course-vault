//! Minimal loopback HTTP server that streams lesson media files.
//!
//! Why this exists: on Linux, WebKitGTK's media pipeline (GStreamer) cannot
//! play `asset://` URLs — the <video> element reports
//! MEDIA_ERR_SRC_NOT_SUPPORTED (code 4) for them, even though the asset
//! protocol works for images and fetch. Serving the same files over
//! http://127.0.0.1 with Range support makes <video> work on every
//! platform, with no network exposure: the listener binds loopback only and
//! only serves files inside the current library root.
//!
//! Implemented with std only (no extra crates): one accept thread plus a
//! short-lived thread per request. Seeking works via `Range: bytes=` (206).

use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Shared, mutable library root the server is allowed to serve from.
pub type SharedRoot = Arc<Mutex<Option<PathBuf>>>;

/// Start the server on an ephemeral loopback port.
/// Returns the port and the shared root handle (set it to the library path
/// once a library is picked; `None` means "serve nothing").
pub fn start() -> std::io::Result<(u16, SharedRoot)> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let root: SharedRoot = Arc::new(Mutex::new(None));
    let root_clone = root.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(s) => {
                    let r = root_clone.clone();
                    std::thread::spawn(move || {
                        if let Err(e) = handle(s, &r) {
                            eprintln!("[media-server] request error: {e}");
                        }
                    });
                }
                Err(e) => eprintln!("[media-server] accept error: {e}"),
            }
        }
    });
    Ok((port, root))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .as_deref()
    {
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("mov") => "video/quicktime",
        Some("avi") => "video/x-msvideo",
        Some("mp3") => "audio/mpeg",
        Some("m4a") => "audio/mp4",
        Some("ogg") | Some("oga") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("flac") => "audio/flac",
        Some("srt") => "text/plain",
        Some("vtt") => "text/vtt",
        _ => "application/octet-stream",
    }
}

fn handle(mut stream: TcpStream, root: &SharedRoot) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 {
        return write_status(&mut stream, 400, "Bad Request", &[], &[]);
    }
    let method = parts[0];
    let raw_path = parts[1];

    // Read headers; we only care about Range.
    let mut range: Option<(u64, Option<u64>)> = None;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line)?;
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some(v) = line.strip_prefix("Range:") {
            let v = v.trim();
            if let Some(spec) = v.strip_prefix("bytes=") {
                if let Some((start, end)) = spec.split_once('-') {
                    if let Ok(s) = start.parse::<u64>() {
                        let e = if end.is_empty() {
                            None
                        } else {
                            end.parse::<u64>().ok()
                        };
                        range = Some((s, e));
                    }
                }
            }
        }
    }

    if method != "GET" && method != "HEAD" {
        return write_status(&mut stream, 405, "Method Not Allowed", &[], &[]);
    }

    // Resolve the requested file: percent-decode, join under the library
    // root, canonicalise, and reject anything that escapes the root.
    let decoded = percent_decode(raw_path.trim_start_matches('/'));
    let root_guard = root.lock().unwrap();
    let Some(root_path) = root_guard.clone() else {
        return write_status(&mut stream, 404, "Not Found", &[], &[]);
    };
    drop(root_guard);
    let candidate = root_path.join(&decoded);
    let Ok(canonical) = candidate.canonicalize() else {
        return write_status(&mut stream, 404, "Not Found", &[], &[]);
    };
    let Ok(root_canonical) = root_path.canonicalize() else {
        return write_status(&mut stream, 404, "Not Found", &[], &[]);
    };
    if !canonical.starts_with(&root_canonical) || !canonical.is_file() {
        return write_status(&mut stream, 404, "Not Found", &[], &[]);
    }

    let mut file = File::open(&canonical)?;
    let len = file.metadata()?.len();
    let (start, end) = match range {
        Some((s, e)) if s < len => {
            let end = e.map(|v| v.min(len - 1)).unwrap_or(len - 1);
            if end < s {
                return write_status(&mut stream, 416, "Range Not Satisfiable", &[], &[]);
            }
            (s, end)
        }
        Some(_) => {
            return write_status(
                &mut stream,
                416,
                "Range Not Satisfiable",
                &[("Content-Range", format!("bytes */{len}"))],
                &[],
            );
        }
        None => (0, len.saturating_sub(1)),
    };
    let body_len = end - start + 1;

    let mut headers: Vec<(String, String)> = vec![
        ("Content-Type".into(), content_type(&canonical).into()),
        ("Accept-Ranges".into(), "bytes".into()),
        ("Content-Length".into(), body_len.to_string()),
    ];
    let status = if range.is_some() {
        headers.push((
            "Content-Range".into(),
            format!("bytes {start}-{end}/{len}"),
        ));
        (206, "Partial Content")
    } else {
        (200, "OK")
    };

    let mut header_block = format!("HTTP/1.1 {} {}\r\n", status.0, status.1);
    for (k, v) in &headers {
        header_block.push_str(&format!("{k}: {v}\r\n"));
    }
    header_block.push_str("Connection: close\r\n\r\n");
    stream.write_all(header_block.as_bytes())?;

    if method == "HEAD" {
        return Ok(());
    }
    file.seek(SeekFrom::Start(start))?;
    let mut remaining = body_len;
    let mut buf = [0u8; 65536];
    while remaining > 0 {
        let chunk = (remaining as usize).min(buf.len());
        let n = file.read(&mut buf[..chunk])?;
        if n == 0 {
            break;
        }
        stream.write_all(&buf[..n])?;
        remaining -= n as u64;
    }
    Ok(())
}

fn write_status(
    stream: &mut TcpStream,
    code: u16,
    reason: &str,
    headers: &[(&str, String)],
    body: &[u8],
) -> std::io::Result<()> {
    let mut out = format!("HTTP/1.1 {code} {reason}\r\nContent-Length: {}\r\n", body.len());
    for (k, v) in headers {
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    out.push_str("Connection: close\r\n\r\n");
    stream.write_all(out.as_bytes())?;
    stream.write_all(body)?;
    Ok(())
}
