mod commands;
mod config;
mod import;
mod pack;
mod scanner;
mod translations;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // PLAN-04：数据目录外部化（AppData）+ 旧 _data 一次性迁移
            config::init_data_dir(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_skills,
            commands::read_skill_file,
            commands::read_translation,
            commands::write_translation,
            commands::load_config,
            commands::get_llm_api_key,
            commands::save_config,
            commands::sync_deleted,
            commands::detect_paths,
            commands::preview_zip_import,
            commands::commit_zip_import,
            commands::preview_url_import,
            commands::commit_url_import,
            commands::packs_list,
            commands::pack_create,
            commands::pack_export,
            commands::pack_import,
            commands::pack_install,
            commands::pack_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
