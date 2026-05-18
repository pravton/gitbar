mod cache;
mod github;

use std::collections::BTreeSet;
use std::sync::Mutex;

use cache::Cache;
use github::client;
use github::models::{AuthCheck, Issue, PullRequest, Stats};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State};

const CACHE_TTL_SECS: u64 = 60;

pub struct AppState {
    cache: Mutex<Cache>,
}

#[tauri::command]
async fn get_prs(token: String, state: State<'_, AppState>) -> Result<Vec<PullRequest>, String> {
    refresh_if_needed(&token, &state, false).await?;
    let cache = state.cache.lock().map_err(|error| error.to_string())?;
    Ok(cache.prs.clone())
}

#[tauri::command]
async fn get_issues(token: String, state: State<'_, AppState>) -> Result<Vec<Issue>, String> {
    refresh_if_needed(&token, &state, false).await?;
    let cache = state.cache.lock().map_err(|error| error.to_string())?;
    Ok(cache.issues.clone())
}

#[tauri::command]
async fn get_stats(token: String, state: State<'_, AppState>) -> Result<Stats, String> {
    refresh_if_needed(&token, &state, false).await?;
    stats_from_cache(&state)
}

#[tauri::command]
async fn refresh_cache(token: String, state: State<'_, AppState>) -> Result<Stats, String> {
    refresh_if_needed(&token, &state, true).await?;
    stats_from_cache(&state)
}

#[tauri::command]
async fn check_auth(token: String) -> Result<AuthCheck, String> {
    client::check_auth(&token).await
}

async fn refresh_if_needed(
    token: &str,
    state: &State<'_, AppState>,
    force: bool,
) -> Result<(), String> {
    let stale = {
        let cache = state.cache.lock().map_err(|error| error.to_string())?;
        force || cache.is_stale(CACHE_TTL_SECS)
    };

    if !stale {
        return Ok(());
    }

    let prs = client::fetch_prs(token).await?;
    let issues = client::fetch_issues(token).await?;
    let mut cache = state.cache.lock().map_err(|error| error.to_string())?;
    cache.update(prs, issues);
    Ok(())
}

fn stats_from_cache(state: &State<'_, AppState>) -> Result<Stats, String> {
    let cache = state.cache.lock().map_err(|error| error.to_string())?;
    let total_prs = cache.prs.len() as u32;
    let total_issues = cache.issues.len() as u32;
    let total = total_prs + total_issues;
    let rain_level = match total {
        0..=3 => "clear",
        4..=7 => "light",
        8..=15 => "raining",
        _ => "storm",
    }
    .to_string();

    let repos_with_prs = cache
        .prs
        .iter()
        .map(|pr| pr.repository.name_with_owner.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    Ok(Stats {
        total_prs,
        total_issues,
        rain_level,
        repos_with_prs,
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState {
            cache: Mutex::new(Cache::default()),
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                let _ = window.show();
            }

            let show = MenuItem::with_id(app, "show", "Show GitBar", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide GitBar", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .show_menu_on_left_click(true);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            tray.on_menu_event(|app, event| match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { .. } = event {
                    if let Some(app) = tray.app_handle().get_webview_window("main") {
                        let is_visible = app.is_visible().unwrap_or(false);
                        let is_minimized = app.is_minimized().unwrap_or(false);
                        if is_visible && !is_minimized {
                            let _ = app.minimize();
                        } else {
                            let _ = app.unminimize();
                            let _ = app.show();
                            let _ = app.set_focus();
                        }
                    }
                }
            })
            .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_prs,
            get_issues,
            get_stats,
            refresh_cache,
            check_auth
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitBar");
}
