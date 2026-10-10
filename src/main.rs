#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]
mod ncm_utils;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::process;
use std::process::Command;
use std::time::Duration;
use std::{env, os::windows::process::CommandExt};

use anyhow::Context;
use anyhow::Result;
use druid::commands::CLOSE_ALL_WINDOWS;
use druid::widget::Checkbox;
use druid::widget::{Flex, Label, ProgressBar};
use druid::Color;
use druid::ExtEventSink;
use druid::{
    AppLauncher, Data, FontDescriptor, FontWeight, Lens, Widget, WidgetExt as _, WindowDesc,
};
use ncm_utils::Ncm;
use ncm_utils::{is_vc_redist_14_x64_installed, is_vc_redist_14_x86_installed};
use semver::Version;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

use scl_gui_widgets::{
    widget_ext::WidgetExt,
    widgets::{Button, WindowWidget, QUERY_CLOSE_WINDOW},
};

use crate::ncm_utils::get_ncm_install_path;

#[derive(Debug, Clone, PartialEq)]
pub enum AdaptedVersionResult {
    Version(Version),
    NoAdaptedVersion,
}

#[derive(Debug, Clone, Data, Lens)]
struct AppData {
    progress: f64,
    prerelease: bool,
    #[data(eq)]
    latest_version: Option<AdaptedVersionResult>,
    old_version: bool,
    new_version: bool,
    #[data(eq)]
    installer_version: Version,

    #[data(eq)]
    tips_string: String,
    #[data(eq)]
    latest_download_url: Option<String>,
    #[data(eq)]
    ncm: Option<Ncm>,
}

fn config_path() -> String {
    String::from(
        dirs::home_dir()
            .unwrap()
            .as_os_str()
            .to_str()
            .expect("Covert error"),
    ) + "\\betterncm\\"
}

// Embed the theme so the release installer is a single self-contained file.
const MAC_GLASS_MAIN_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/main.js"));
const MAC_GLASS_MANIFEST: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/manifest.json"));
const MAC_GLASS_NATIVE_DLL: &[u8] = include_bytes!("../assets/mac-glass-theme/MacGlassNative.dll");
const MAC_GLASS_NATIVE_X64_DLL: &[u8] = include_bytes!("../assets/mac-glass-theme/MacGlassNative.dll.x64.dll");
const MAC_GLASS_README: &[u8] = include_bytes!("../assets/mac-glass-theme/README.md");

fn betterncm_profile() -> PathBuf {
    // The installer is elevated, so process environment alone may be stale.
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let key = if root == HKEY_CURRENT_USER {
            r"Environment"
        } else {
            r"System\CurrentControlSet\Control\Session Manager\Environment"
        };
        if let Ok(key) = RegKey::predef(root).open_subkey(key) {
            if let Ok(value) = key.get_value::<String, _>("BETTERNCM_PROFILE") {
                if !value.trim().is_empty() {
                    return PathBuf::from(value);
                }
            }
        }
    }
    if let Ok(value) = env::var("BETTERNCM_PROFILE") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }
    PathBuf::from(r"C:\betterncm")
}

fn install_mac_glass_theme() -> anyhow::Result<()> {
    let theme_dir = betterncm_profile().join(r"plugins_dev\mac-glass-theme");
    fs::create_dir_all(&theme_dir)?;
    for (name, contents) in [
        ("main.js", MAC_GLASS_MAIN_JS),
        ("manifest.json", MAC_GLASS_MANIFEST),
        ("MacGlassNative.dll", MAC_GLASS_NATIVE_DLL),
        ("MacGlassNative.dll.x64.dll", MAC_GLASS_NATIVE_X64_DLL),
        ("README.md", MAC_GLASS_README),
    ] {
        fs::write(theme_dir.join(name), contents)?;
    }
    Ok(())
}

fn uninstall_mac_glass_theme() -> anyhow::Result<()> {
    let profile = betterncm_profile();
    let theme_dir = profile.join(r"plugins_dev\mac-glass-theme");
    if !theme_dir.exists() { return Ok(()); }
    // Preserve user-created settings/files for an easy rollback.
    let backup_root = profile.join("uninstalled-plugins");
    fs::create_dir_all(&backup_root)?;
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_millis();
    fs::rename(theme_dir, backup_root.join(format!("mac-glass-theme-{suffix}")))?;
    Ok(())
}

fn get_adapted_betterncm_version(
    ncm: Option<Ncm>,
    event_sink: ExtEventSink,
    channel: String,
) -> anyhow::Result<()> {
    if let Some(ncm) = ncm {
        use serde_json::Value;
        let releases = tinyget::get(
            "https://ganbei-hot-update-1258625969.file.myqcloud.com/betterncm-data/binary/data.json",
        )
        .with_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36")
        .send()?;

        anyhow::ensure!(releases.status_code == 200, "Version index HTTP {}", releases.status_code);
        let releases = releases.as_str()?;

        let releases: Value = serde_json::from_str(releases)?;

        let adapted_versions = releases[channel]
            .as_object()
            .context("Invalid JSON")?
            .clone();
        for (version_req, val) in adapted_versions.iter() {
            if semver::VersionReq::parse(version_req)
                .context("Failed to parse version req")?
                .matches(&ncm.version)
            {
                let latest_version = Some(AdaptedVersionResult::Version(
                    Version::parse(val["version"].to_owned().as_str().unwrap()).unwrap(),
                ));
                let latest_url = Some(if ncm.ncm_type == ncm_utils::NcmType::X86 {
                    val["url_x86"].to_owned().as_str().unwrap().to_string()
                } else {
                    val["url_x64"].to_owned().as_str().unwrap().to_string()
                });

                event_sink.add_idle_callback(move |data: &mut AppData| {
                    data.latest_version = latest_version;
                    data.latest_download_url = latest_url;
                });
                return Ok(());
            }
        }
    }

    event_sink.add_idle_callback(move |data: &mut AppData| {
        data.latest_version = Some(AdaptedVersionResult::NoAdaptedVersion);
    });

    Ok(())
}

fn start_job(sink: ExtEventSink, job: impl FnOnce() -> anyhow::Result<()> + Send + 'static) {
    std::thread::spawn(move || {
        if let Err(error) = job() {
            let message = format!("操作失败：{error:#}");
            sink.add_idle_callback(move |data: &mut AppData| {
                data.tips_string = message;
            });
        }
    });
}

fn main() -> Result<()> {
    let main_window = WindowDesc::new(ui_builder())
        .window_size((520., 350.))
        .resizable(false)
        .show_titlebar(false)
        .title("BetterNCM + Mac Glass Installer");

    let mut data = AppData {
        prerelease: false,
        progress: 0.,
        latest_version: None,
        old_version: if let Ok(path) = get_ncm_install_path() {
            path.join("cloudmusicn.exe").exists()
        } else {
            false
        },
        new_version: if let Ok(path) = get_ncm_install_path() {
            path.join("msimg32.dll").exists()
        } else {
            false
        },
        latest_download_url: None,
        installer_version: Version::parse(env!("CARGO_PKG_VERSION"))?,
        ncm: get_ncm_install_path()
            .and_then(|path| Ncm::get_ncm_by_path(path))
            .ok(),
        // ncm_install_path: if let Ok(path) = get_ncm_install_path() {
        //     Some(path)
        // } else {
        //     None
        // },
        // ncm_version: get_ncm_version().ok(),
        tips_string: String::new(),
    };
    if let Some(ncm) = &data.ncm {
        if &ncm.version < &Version::new(2, 10, 2) {
            data.tips_string = "您的网易云版本太低，请更新".to_string();
        }
    }
    let launcher = AppLauncher::with_window(main_window);

    let event_sink = launcher.get_external_handle();

    let ncm_version_ = data.ncm.clone();

    start_job(event_sink.clone(), move || {
        get_adapted_betterncm_version(ncm_version_, event_sink, "versions".to_string())
    });

    launcher
        .configure_env(|env, _| {
            scl_gui_widgets::theme::color::set_color_to_env(
                env,
                scl_gui_widgets::theme::color::Theme::Dark,
            );
        })
        .launch(data)?;
    Ok(())
}

fn get_ncm_localdata_path() -> String {
    let appdata = env::var("APPDATA").unwrap();
    let ncmdata = Path::new(&appdata);
    ncmdata
        .parent()
        .unwrap()
        .join("Local")
        .join("Netease")
        .join("CloudMusic")
        .to_str()
        .unwrap()
        .to_string()
}

fn set_noproxy_localdata() -> anyhow::Result<()> {
    fs::write(
        get_ncm_localdata_path() + "/localdata",
        include_bytes!("localdata/localdata_noproxy"),
    )?;
    Ok(())
}

fn ui_builder() -> impl Widget<AppData> {
    let title = Label::new("BetterNCM + Mac Glass".to_string()).with_font(
        FontDescriptor::default()
            .with_size(20.)
            .with_weight(FontWeight::BOLD),
    );

    let installer_version_label = Flex::row()
        .with_child(Label::new("Mac Glass 安装器版本: ").with_text_color(Color::grey(0.7)))
        .with_child(
            Label::new(|data: &AppData, _env: &_| -> String { data.installer_version.to_string() })
                .with_font(
                    FontDescriptor::default()
                        .with_size(17.)
                        .with_weight(FontWeight::SEMI_BOLD),
                ),
        );

    let latest_version_label = Flex::row()
        .with_child(Label::new("适配 BetterNCM 版本: ").with_text_color(Color::grey(0.7)))
        .with_child(
            Label::new(|data: &AppData, _env: &_| -> String {
                match &data.latest_version {
                    Some(AdaptedVersionResult::Version(version)) => version.to_string(),
                    Some(AdaptedVersionResult::NoAdaptedVersion) => "未适配".to_string(),
                    None => String::from("获取中..."),
                }
            })
            .with_font(
                FontDescriptor::default()
                    .with_size(17.)
                    .with_weight(FontWeight::SEMI_BOLD),
            ),
        );

    let local_version_label = Flex::row().with_child(
        Label::new(|data: &AppData, _env: &_| -> String {
            match data.old_version {
                true => String::from("检测到老版本BetterNCM 请先卸载"),
                false => String::from(""),
            }
        })
        .with_font(
            FontDescriptor::default()
                .with_size(17.)
                .with_weight(FontWeight::SEMI_BOLD),
        ),
    );

    let install_path_label = Flex::row()
        .with_child(Label::new("网易云版本: ").with_text_color(Color::grey(0.7)))
        .with_child(
            Label::new(|data: &AppData, _env: &_| -> String {
                match &data.ncm {
                    Some(ncm) => format!("{} ({:#?})", ncm.version, ncm.ncm_type).to_lowercase(),
                    None => "未安装".to_string(),
                }
            })
            .with_font(
                FontDescriptor::default()
                    .with_size(17.)
                    .with_weight(FontWeight::SEMI_BOLD),
            ),
        );

    let checker_prerelease = Checkbox::new("测试通道")
        .on_change(|ctx, _old, new, _env| {
            let sink = ctx.get_external_handle();
            let channel = if *new { "test" } else { "versions" };
            ctx.get_external_handle()
                .add_idle_callback(move |data: &mut AppData| {
                    data.latest_version = None;
                    data.tips_string = "".into();
                    let ncm = data.ncm.clone();
                    start_job(sink.clone(), move || {
                        get_adapted_betterncm_version(ncm, sink, channel.to_string())
                    });
                });
        })
        .lens(AppData::prerelease);

    let button_install = Button::new("安装")
        .disabled_if(|data: &AppData, _env: &_| {
            data.latest_version.is_none()
                || data.latest_version == Some(AdaptedVersionResult::NoAdaptedVersion)
                || data.old_version
                || data.new_version
        })
        .on_click(|ctx, data, _env| {
            let event_sink = ctx.get_external_handle();
            let url: String = data.latest_download_url.as_ref().unwrap().clone();
            start_job(event_sink.clone(), move || {
                fn add_exclude_from_wd() -> anyhow::Result<()> {
                    // Command::new("powershell.exe")
                    //     .arg("-Command")
                    //     .arg(format!(
                    //         "Add-MpPreference -ExclusionPath \"{}\"",
                    //         get_ncm_install_path()?
                    //             .to_str()
                    //             .context("Failed to get ncm install path")?
                    //     ))
                    //     .spawn()?
                    //     .wait()?;

                    Ok(())
                }

                let _ = add_exclude_from_wd();

                let _ = std::fs::remove_file("betterncm.dll");

                download_file(&url, "betterncm.dll", event_sink.to_owned())?;

                install_vc_redist_14(event_sink.to_owned())?;

                event_sink.add_idle_callback(move |data: &mut AppData| {
                    data.tips_string = "正在安装 BetterNCM…".into();
                });

                Command::new("taskkill.exe")
                    .args(["/f", "/im", "cloudmusic.exe"])
                    .creation_flags(0x08000000)
                    .spawn()?
                    .wait()?;

                std::thread::sleep(Duration::from_millis(300));

                std::fs::copy("betterncm.dll", get_ncm_install_path()?.join("msimg32.dll"))
                    .context("写入 BetterNCM DLL 失败")?;

                install_mac_glass_theme()?;

                event_sink.add_idle_callback(move |data: &mut AppData| {
                    data.tips_string = "安装成功！".into();
                    data.new_version = if let Ok(path) = get_ncm_install_path() {
                        path.join("msimg32.dll").exists()
                    } else {
                        false
                    };
                });

                Command::new(get_ncm_install_path()?.join("cloudmusic.exe"))
                    .current_dir(get_ncm_install_path()?)
                    .spawn()?;
                anyhow::Ok(())
            });
        });

    let button_reinstall = Button::new("重装/更新")
        .disabled_if(|data: &AppData, _env: &_| {
            data.latest_version.is_none()
                || data.latest_version == Some(AdaptedVersionResult::NoAdaptedVersion)
                || data.old_version
                || !data.new_version
        })
        .on_click(|ctx, data, _env| {
            let event_sink = ctx.get_external_handle();
            let url: String = data.latest_download_url.as_ref().unwrap().clone();
            start_job(event_sink.clone(), move || {
                let _ = std::fs::remove_file("betterncm.dll");

                download_file(&url, "betterncm.dll", event_sink.to_owned())?;
                install_vc_redist_14(event_sink.to_owned())?;

                event_sink.add_idle_callback(move |data: &mut AppData| {
                    data.tips_string = "正在升级/重新安装 BetterNCM…".into();
                });

                Command::new("taskkill.exe")
                    .args(["/f", "/im", "cloudmusic.exe"])
                    .creation_flags(0x08000000)
                    .spawn()?
                    .wait()?;

                std::thread::sleep(Duration::from_millis(300));

                std::fs::copy("betterncm.dll", get_ncm_install_path()?.join("msimg32.dll"))
                    .context("写入 BetterNCM DLL 失败")?;

                install_mac_glass_theme()?;

                event_sink.add_idle_callback(move |data: &mut AppData| {
                    data.tips_string = "升级/重新安装成功！".into();
                    data.new_version = if let Ok(path) = get_ncm_install_path() {
                        path.join("msimg32.dll").exists()
                    } else {
                        false
                    };
                });

                Command::new(get_ncm_install_path()?.join("cloudmusic.exe"))
                    .current_dir(get_ncm_install_path()?)
                    .spawn()?;
                anyhow::Ok(())
            });
        });

    let button_uninstall = Button::new("卸载")
        .disabled_if(|data: &AppData, _env: &_| data.old_version || !data.new_version)
        .on_click(|ctx, _data, _env| {
            let event_sink = ctx.get_external_handle();
            start_job(event_sink.clone(), move || {
                event_sink.add_idle_callback(move |data: &mut AppData| {
                    data.tips_string = "正在卸载 BetterNCM…".into();
                });
                Command::new("taskkill.exe")
                    .args(["/f", "/im", "cloudmusic.exe"])
                    .creation_flags(0x08000000)
                    .spawn()?
                    .wait()?;
                Command::new("taskkill.exe")
                    .args(["/f", "/im", "cloudmusicn.exe"])
                    .creation_flags(0x08000000)
                    .spawn()?
                    .wait()?;
                fs::remove_file(get_ncm_install_path()?.join("msimg32.dll"))?;
                uninstall_mac_glass_theme()?;

                event_sink.add_idle_callback(move |data: &mut AppData| {
                    data.new_version = if let Ok(path) = get_ncm_install_path() {
                        path.join("msimg32.dll").exists()
                    } else {
                        false
                    };
                    data.tips_string = "卸载完成！".into();
                });

                process::Command::new(get_ncm_install_path()?.join("cloudmusic.exe"))
                    .current_dir(get_ncm_install_path()?)
                    .spawn()?;
                anyhow::Ok(())
            });
        });

    let button_uninstall_old = Button::new("卸载老版本")
        .disabled_if(|data: &AppData, _env: &_| !data.old_version)
        .on_click(|_ctx, data, _env| {
            let mut ins = || {
                fs::remove_dir_all(config_path())?;
                Command::new("taskkill.exe")
                    .args(["/f", "/im", "cloudmusic.exe"])
                    .creation_flags(0x08000000)
                    .spawn()?
                    .wait()?;
                Command::new("taskkill.exe")
                    .args(["/f", "/im", "cloudmusicn.exe"])
                    .creation_flags(0x08000000)
                    .spawn()?
                    .wait()?;
                fs::remove_file(get_ncm_install_path()?.join("cloudmusic.exe"))?;

                fs::rename(
                    get_ncm_install_path()?.join("cloudmusicn.exe"),
                    get_ncm_install_path()?.join("cloudmusic.exe"),
                )?;

                set_noproxy_localdata()?;

                data.old_version = if let Ok(path) = get_ncm_install_path() {
                    path.join("cloudmusicn.exe").exists()
                } else {
                    false
                };

                process::Command::new(get_ncm_install_path()?.join("cloudmusic.exe"))
                    .current_dir(get_ncm_install_path()?)
                    .spawn()?;
                anyhow::Ok(())
            };
            ins().unwrap();
        });

    let button_set_path = Button::new("修改数据地址").on_click(|_ctx, _data, _env| {
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let (env, _) = hklm
            .create_subkey("System\\CurrentControlSet\\Control\\Session Manager\\Environment")
            .unwrap();

        let origin_dir: std::result::Result<String, std::io::Error> =
            env.get_value("BETTERNCM_PROFILE");
        let origin_dir = origin_dir.unwrap_or("C:\\betterncm".to_string());

        let folder = rfd::FileDialog::new()
            .set_directory(origin_dir)
            .pick_folder();
        if let Some(path) = folder {
            env.set_value(
                "BETTERNCM_PROFILE",
                &path.to_str().unwrap_or("C:\\betterncm"),
            )
            .unwrap();

            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let (env, _) = hkcu.create_subkey("Environment").unwrap(); // create_subkey opens with write permissions
            env.set_value(
                "BETTERNCM_PROFILE",
                &path.to_str().unwrap_or("C:\\betterncm"),
            )
            .unwrap();
        }
    });

    let button_reset_path = Button::new("重置数据地址")
        .on_click(|_ctx, _data, _env| {
            let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
            let (env, _) = hklm
                .create_subkey("System\\CurrentControlSet\\Control\\Session Manager\\Environment")
                .unwrap();

            let _ = env.delete_value("BETTERNCM_PROFILE");

            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let (env, _) = hkcu.create_subkey("Environment").unwrap(); // create_subkey opens with write permissions
            let _ = env.delete_value("BETTERNCM_PROFILE");
        });

    let button_set_ncm_path =
        Button::new("手动指定网易云").on_click(|ctx, data: &mut AppData, _env| {
            let files = rfd::FileDialog::new()
                .add_filter("NCM Executable", &["exe"])
                .pick_files();

            if let Some(files) = files {
                data.ncm = Ncm::get_ncm_by_path(files[0].parent().unwrap().to_path_buf()).ok();
                let _ = get_adapted_betterncm_version(
                    data.ncm.clone(),
                    ctx.get_external_handle(),
                    if data.prerelease { "test" } else { "versions" }.to_string(),
                );
            }
        });

    let progress_bar = ProgressBar::new().lens(AppData::progress).expand_width();

    WindowWidget::new(
        "BetterNCM + Mac Glass Installer",
        Flex::column()
            .with_child(title)
            .with_child(installer_version_label)
            .with_child(latest_version_label)
            .with_child(install_path_label)
            .with_child(local_version_label)
            .with_spacer(5.)
            .with_child(Label::new(|data: &AppData, _env: &_| -> String {
                data.tips_string.clone()
            }))
            .with_flex_spacer(1.)
            .with_child(checker_prerelease)
            .with_spacer(5.)
            .with_child(
                Flex::row()
                    .with_flex_child(button_install.expand_width(), 1.)
                    .with_spacer(5.)
                    .with_flex_child(button_reinstall.expand_width(), 1.)
                    .with_spacer(5.)
                    .with_flex_child(button_uninstall.expand_width(), 1.)
                    .with_spacer(5.)
                    .with_flex_child(button_uninstall_old.expand_width(), 1.),
            )
            .with_spacer(5.)
            .with_child(
                Flex::row()
                    .with_flex_child(button_set_path.expand_width(), 1.)
                    .with_spacer(5.)
                    .with_flex_child(button_reset_path.expand_width(), 1.)
                    .with_spacer(5.)
                    .with_flex_child(button_set_ncm_path.expand_width(), 1.),
            )
            .with_spacer(5.)
            .with_child(progress_bar)
            .cross_axis_alignment(druid::widget::CrossAxisAlignment::Start)
            .padding(10.),
    )
    .on_notify(QUERY_CLOSE_WINDOW, |ctx, _, _| {
        ctx.submit_command(CLOSE_ALL_WINDOWS);
    })
}

fn download_file(url: &str, path: &str, event_sink: druid::ExtEventSink) -> anyhow::Result<()> {
    let tip_str = format!("正在下载: {path}");
    event_sink.add_idle_callback(move |data: &mut AppData| {
        data.tips_string = tip_str;
    });
    use std::fs::File;
    use std::io::Write;

    let res = tinyget::get(url)
        .with_header(
            "User-Agent",
            &format!("BetterNCM Installer/{};", env!("CARGO_PKG_VERSION")),
        )
        .send_lazy()?;
    anyhow::ensure!(res.status_code == 200, "下载 {path} 失败：HTTP {}", res.status_code);

    let file_size = res
        .headers
        .get("content-length")
        .map(|x| x.as_str().parse::<usize>())
        .unwrap_or(Ok(0))
        .unwrap_or(0);

    event_sink.add_idle_callback(move |data: &mut AppData| {
        data.tips_string = "正在下载…".into();
    });

    let mut buf = Vec::with_capacity(file_size);
    let mut tip_str = "正在下载…".to_string();
    for data in res {
        let (byte, length) = data?;
        buf.reserve(length);
        buf.push(byte);

        let progress = if file_size == 0 { 0.0 } else { buf.len() as f64 / file_size as f64 };
        let percent_progress = ((progress * 100.).floor() as u32).min(100).max(0);
        let new_tip_str = format!("正在下载：{path}（{percent_progress}%）");
        if tip_str != new_tip_str {
            tip_str = new_tip_str.to_owned();
            event_sink.add_idle_callback(move |data: &mut AppData| {
                data.tips_string = new_tip_str;
                data.progress = progress;
            });
        }
    }

    anyhow::ensure!(buf.starts_with(b"MZ"), "下载内容不是有效的 Windows 程序：{path}");
    let mut file = File::create(path)?;
    file.write_all(&buf)?;

    event_sink.add_idle_callback(move |data: &mut AppData| {
        data.tips_string = "".to_string();
    });
    Ok(())
}

pub fn install_vc_redist_14(event_sink: druid::ExtEventSink) -> anyhow::Result<()> {
    if is_vc_redist_14_x86_installed() && is_vc_redist_14_x64_installed() {
        return Ok(());
    }
    // https://aka.ms/vs/17/release/VC_redist.x86.exe
    // Install: /install /passive /norestart
    // SilentInstall: /install /quiet /norestart

    let install_url = |url: &str| -> anyhow::Result<()> {
        download_file(url, "VC_redist.exe", event_sink.to_owned())?;

        event_sink.add_idle_callback(move |data: &mut AppData| {
            data.tips_string = "正在安装 VC 运行时…".into();
            data.progress = 1.;
        });

        let status = Command::new("VC_redist.exe")
            .args(["/install", "/quiet", "/norestart"])
            .creation_flags(0x08000000)
            .status()?;
        anyhow::ensure!(matches!(status.code(), Some(0 | 1638 | 3010)), "VC 运行时安装失败：{status}");
        Ok(())
    };

    install_url("https://aka.ms/vs/17/release/VC_redist.x86.exe")?;
    install_url("https://aka.ms/vs/17/release/VC_redist.x64.exe")?;
    Ok(())
}
