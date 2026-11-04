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
    save_document_checked(path, content, expected, || {})
}

// The hook lets the test exercise a concurrent modification after the temporary
// file is prepared. Non-cooperating writers can still race the final check.
fn save_document_checked<F: FnOnce()>(path: String, content: String, expected: Option<String>, before_final_check: F) -> Result<(), String> {
    let p = checked_path(&path)?;
    if let Some(expected) = expected {
        let target = std::fs::canonicalize(p).map_err(|e| format!("无法解析原文件路径：{e}"))?;
        let existing = std::fs::read_to_string(&target).map_err(|e| format!("无法读取原文件：{e}"))?;
        if existing != expected { return Err("文件已在外部更改，未保存。请先备份编辑内容，再重新打开文件。".into()); }
        #[cfg(not(windows))]
        let metadata = std::fs::metadata(&target).map_err(|e| format!("无法读取文件属性：{e}"))?;
        let mut temp = tempfile::NamedTempFile::new_in(target.parent().unwrap_or(Path::new(".")))
            .map_err(|e| format!("无法创建临时文件：{e}"))?;
        temp.write_all(content.as_bytes()).and_then(|_| temp.flush()).map_err(|e| format!("保存失败：{e}"))?;
        #[cfg(not(windows))]
        temp.as_file().set_permissions(metadata.permissions()).map_err(|e| format!("无法设置文件权限：{e}"))?;
        before_final_check();
        let current_target = std::fs::canonicalize(p).map_err(|e| format!("无法重新检查原文件：{e}"))?;
        let current = std::fs::read_to_string(&current_target).map_err(|e| format!("无法重新检查原文件：{e}"))?;
        if current_target != target || current != expected {
            return Err("文件已在外部更改，未保存。请先备份编辑内容，再重新打开文件。".into());
        }
        replace_existing(temp, &target)?;
    } else {
        let mut temp = tempfile::NamedTempFile::new_in(p.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new(".")))
            .map_err(|e| format!("无法创建临时文件：{e}"))?;
        temp.write_all(content.as_bytes()).and_then(|_| temp.flush()).map_err(|e| format!("保存失败：{e}"))?;
        temp.persist_noclobber(p).map_err(|e| format!("无法创建文件（文件可能已存在）：{}", e.error))?;
    }
    Ok(())
}
#[cfg(not(windows))]
fn replace_existing(temp: tempfile::NamedTempFile, target: &Path) -> Result<(), String> {
    temp.persist(target).map(|_| ()).map_err(|e| format!("无法替换文件：{}", e.error))
}

#[cfg(windows)]
fn replace_existing(temp: tempfile::NamedTempFile, target: &Path) -> Result<(), String> {
    use std::{iter, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::ReplaceFileW;

    // ReplaceFileW preserves the original file's ACLs and attributes. A backup
    // in the same directory also allows recovery from partial API failures.
    let backup_dir = tempfile::tempdir_in(target.parent().unwrap_or(Path::new(".")))
        .map_err(|e| format!("无法创建保存备份：{e}"))?;
    let backup = backup_dir.path().join("original");
    let temporary = temp.into_temp_path(); // close the handle before ReplaceFileW
    let wide = |p: &Path| p.as_os_str().encode_wide().chain(iter::once(0)).collect::<Vec<_>>();
    let target_w = wide(target);
    let temp_w = wide(&temporary);
    let backup_w = wide(&backup);
    let ok = unsafe { ReplaceFileW(target_w.as_ptr(), temp_w.as_ptr(), backup_w.as_ptr(), 0, std::ptr::null_mut(), std::ptr::null_mut()) };
    if ok != 0 { return Ok(()); }
    let error = std::io::Error::last_os_error();
    if backup.exists() {
        if !target.exists() && std::fs::rename(&backup, target).is_ok() {
            return Err(format!("无法替换文件，已恢复原文件：{error}"));
        }
        let recovery = backup_dir.keep();
        return Err(format!("无法替换文件：{error}；原文件备份位于 {}", recovery.join("original").display()));
    }
    Err(format!("无法替换文件：{error}"))
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
    #[test]
    fn detects_external_change_after_preparing_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("document.md");
        std::fs::write(&file, "original").unwrap();
        let result = save_document_checked(file.to_str().unwrap().into(), "mine".into(), Some("original".into()), || {
            std::fs::write(&file, "external").unwrap();
        });
        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(file).unwrap(), "external");
    }

    #[cfg(unix)]
    #[test]
    fn saving_through_symlink_updates_target_without_replacing_link() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.md");
        let link = dir.path().join("link.md");
        std::fs::write(&target, "original").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        save_document(link.to_str().unwrap().into(), "updated".into(), Some("original".into())).unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(target).unwrap(), "updated");
    }

    #[cfg(windows)]
    #[test]
    fn saving_preserves_windows_hidden_attribute() {
        use std::{iter, os::windows::{ffi::OsStrExt, fs::MetadataExt}};
        use windows_sys::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("document.md");
        std::fs::write(&file, "original").unwrap();
        let wide: Vec<u16> = file.as_os_str().encode_wide().chain(iter::once(0)).collect();
        assert_ne!(unsafe { SetFileAttributesW(wide.as_ptr(), FILE_ATTRIBUTE_HIDDEN) }, 0);
        save_document(file.to_str().unwrap().into(), "updated".into(), Some("original".into())).unwrap();
        assert_ne!(std::fs::metadata(&file).unwrap().file_attributes() & FILE_ATTRIBUTE_HIDDEN, 0);
        assert_eq!(std::fs::read_to_string(file).unwrap(), "updated");
    }

    #[test]
    fn saves_unicode_path_with_spaces() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("文档 中文.md");
        std::fs::write(&file, "original\r\n").unwrap();
        save_document(file.to_str().unwrap().into(), "修改\r\n".into(), Some("original\r\n".into())).unwrap();
        assert_eq!(std::fs::read_to_string(file).unwrap(), "修改\r\n");
    }

}
