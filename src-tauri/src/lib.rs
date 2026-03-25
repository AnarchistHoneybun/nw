use std::path::PathBuf;

#[tauri::command]
async fn save_file(path: String, content: String) -> Result<String, String> {
    let file_path = PathBuf::from(&path);
    tokio::fs::write(&file_path, &content)
        .await
        .map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn open_file(path: String) -> Result<String, String> {
    let content = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())?;

    Ok(content)
}

#[tauri::command]
async fn show_save_dialog(
    app_handle: tauri::AppHandle,
    suggested_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let result = app_handle
        .dialog()
        .file()
        .add_filter("Text Files", &["txt"])
        .set_file_name(&suggested_name)
        .blocking_save_file();

    Ok(result.map(|p| p.to_string()))
}

#[tauri::command]
async fn show_open_dialog(app_handle: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let result = app_handle
        .dialog()
        .file()
        .add_filter("Text Files", &["txt"])
        .blocking_pick_file();

    Ok(result.map(|p| p.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            save_file,
            open_file,
            show_save_dialog,
            show_open_dialog
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
