#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{io::Write, path::Path};

#[derive(serde::Serialize)]
struct Document { name: String, content: String }

fn checked_path(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
    if !["md", "markdown", "txt"].contains(&ext.as_str()) {
        return Err("请选择 Markdown 或文本文件。".into());
    }
    Ok(p)
}

#[tauri::command]
fn read_document(path: String) -> Result<Document, String> {
    let p = checked_path(&path)?;
    let content = std::fs::read_to_string(p).map_err(|e| format!("无法读取文件：{e}"))?;
    Ok(Document { name: p.file_name().unwrap_or_default().to_string_lossy().into_owned(), content })
}

#[tauri::command]
fn save_document(path: String, content: String, expected: Option<String>) -> Result<(), String> {
    let p = checked_path(&path)?;
    if let Some(expected) = expected {
        let existing = std::fs::read_to_string(p).map_err(|e| format!("无法读取原文件：{e}"))?;
        if existing != expected { return Err("文件已在外部更改，未保存。请先备份编辑内容，再重新打开文件。".into()); }
        let metadata = std::fs::metadata(p).map_err(|e| format!("无法读取文件属性：{e}"))?;
        let mut temp = tempfile::NamedTempFile::new_in(p.parent().unwrap_or(Path::new(".")))
            .map_err(|e| format!("无法创建临时文件：{e}"))?;
        temp.write_all(content.as_bytes()).and_then(|_| temp.flush()).map_err(|e| format!("保存失败：{e}"))?;
        temp.as_file().set_permissions(metadata.permissions()).map_err(|e| format!("无法设置文件权限：{e}"))?;
        temp.persist(p).map_err(|e| format!("无法替换文件：{}", e.error))?;
    } else {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(p)
            .map_err(|e| format!("无法创建文件（文件可能已存在）：{e}"))?;
        file.write_all(content.as_bytes()).map_err(|e| format!("保存失败：{e}"))?;
    }
    Ok(())
}
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args_os().skip(1).map(std::path::PathBuf::from)
        .find(|p| p.is_file()).map(|p| p.to_string_lossy().into_owned())
}
fn main() {
    tauri::Builder::default().plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_document, save_document, startup_file])
        .run(tauri::generate_context!()).expect("failed to start SigmaDown");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saving_detects_external_changes_and_preserves_original_on_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("document.md");
        std::fs::write(&file, "original\r\n").unwrap();
        let path = file.to_str().unwrap().to_owned();
        save_document(path.clone(), "updated 中文".into(), Some("original\r\n".into())).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "updated 中文");
        std::fs::write(&file, "external").unwrap();
        assert!(save_document(path, "mine".into(), Some("updated 中文".into())).is_err());
        assert_eq!(std::fs::read_to_string(file).unwrap(), "external");
    }

    #[test]
    fn new_file_never_overwrites_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("new.md");
        let path = file.to_str().unwrap().to_owned();
        save_document(path.clone(), "first".into(), None).unwrap();
        assert!(save_document(path, "second".into(), None).is_err());
        assert_eq!(std::fs::read_to_string(file).unwrap(), "first");
    }
}
