#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::path::Path;

#[derive(serde::Serialize)]
struct Document { name: String, content: String }

#[tauri::command]
fn read_document(path: String) -> Result<Document, String> {
    let p = Path::new(&path);
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["md", "markdown", "txt"].contains(&ext.as_str()) { return Err("请选择 Markdown 或文本文件。".into()); }
    let content = std::fs::read_to_string(p).map_err(|e| format!("无法读取文件：{e}"))?;
    Ok(Document { name: p.file_name().unwrap_or_default().to_string_lossy().into_owned(), content })
}
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args_os().skip(1).map(std::path::PathBuf::from)
        .find(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned())
}
fn main() {
    tauri::Builder::default().plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_document, startup_file])
        .run(tauri::generate_context!()).expect("failed to start SigmaDown");
}
