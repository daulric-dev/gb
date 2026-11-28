pub mod models;
pub mod commands;
pub mod system;

use commands::instance::{
    check_instance_health, check_instance_online, check_system_environment,
    install_instance_packages, load_registered_instances, remove_registered_instance,
    save_instance_config, scan_instance_directory,
};
use commands::env::{read_file_content, read_service_envs, save_service_envs};
use commands::releases::{download_release_archive, fetch_github_releases, verify_release_checksum};
use commands::upgrade::extract_and_upgrade_instance;
use commands::ssh::{execute_remote_command, test_ssh_connection};
use commands::service::{
    build_service, clear_service_logs, get_service_logs, get_service_status,
    install_service_packages, start_service, stop_service, delete_service, ProcessState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    crate::system::ensure_system_path();

    tauri::Builder::default()
        .manage(ProcessState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            scan_instance_directory,
            check_system_environment,
            check_instance_health,
            install_instance_packages,
            install_service_packages,
            build_service,
            start_service,
            stop_service,
            get_service_status,
            get_service_logs,
            clear_service_logs,
            delete_service,
            save_instance_config,
            remove_registered_instance,
            load_registered_instances,
            check_instance_online,
            read_service_envs,
            save_service_envs,
            read_file_content,
            fetch_github_releases,
            download_release_archive,
            verify_release_checksum,
            extract_and_upgrade_instance,
            test_ssh_connection,
            execute_remote_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
