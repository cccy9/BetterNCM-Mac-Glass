use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::windows::fs::OpenOptionsExt;
use std::path::Path;

use anyhow::{Context, Result};

// Acquire all destination files before changing any bytes. A DLL still loaded
// by NetEase aborts the update before the JavaScript or manifest is replaced.
// Only bundled files are touched; settings.json and native-window.ini stay put.
pub fn write_payload(directory: &Path, payload: &[(&str, &[u8])]) -> Result<()> {
    fs::create_dir_all(directory)?;
    let mut opened = Vec::new();
    for (name, _) in payload {
        let path = directory.join(name);
        match OpenOptions::new().read(true).write(true).create(true)
            .truncate(false).share_mode(0).open(&path) {
            Ok(mut file) => {
                let mut previous = Vec::new();
                file.read_to_end(&mut previous)?;
                opened.push((file, previous));
            }
            Err(error) => return Err(error).with_context(||
                format!("无法更新 {name}，请完全退出网易云后重试")),
        }
    }
    let result = (|| -> Result<()> {
        for ((file, _), (name, contents)) in opened.iter_mut().zip(payload) {
            file.seek(SeekFrom::Start(0))?;
            file.write_all(contents).with_context(|| format!("写入 {name} 失败"))?;
            file.set_len(contents.len() as u64)?;
            file.sync_all()?;
        }
        Ok(())
    })();
    if result.is_err() {
        for ((file, previous), (name, _)) in opened.iter_mut().zip(payload) {
            let restore = (|| -> std::io::Result<()> {
                file.seek(SeekFrom::Start(0))?;
                file.write_all(previous)?;
                file.set_len(previous.len() as u64)?;
                file.sync_all()
            })();
            restore.with_context(|| format!("更新失败，恢复 {name} 也失败，请重新安装插件"))?;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temporary_directory() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mac-glass-update-test-{}-{}",
            std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir(&dir).unwrap();
        dir
    }

    #[test]
    fn update_preserves_settings_and_core() {
        let root = temporary_directory();
        let theme = root.join("plugins_dev/mac-glass-theme");
        fs::create_dir_all(&theme).unwrap();
        fs::write(root.join("msimg32.dll"), b"existing core").unwrap();
        for name in ["settings.json", "native-window.ini", "custom.txt"] {
            fs::write(theme.join(name), b"user settings").unwrap();
        }
        fs::write(theme.join("main.js"), b"previous longer script").unwrap();
        write_payload(&theme, &[("main.js", b"new"), ("manifest.json", b"{}")]).unwrap();
        assert_eq!(fs::read(theme.join("main.js")).unwrap(), b"new");
        assert_eq!(fs::read(root.join("msimg32.dll")).unwrap(), b"existing core");
        for name in ["settings.json", "native-window.ini", "custom.txt"] {
            assert_eq!(fs::read(theme.join(name)).unwrap(), b"user settings");
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn locked_dll_leaves_existing_payload_untouched() {
        let root = temporary_directory();
        fs::write(root.join("main.js"), b"old script").unwrap();
        fs::write(root.join("native.dll"), b"old dll").unwrap();
        let lock = OpenOptions::new().read(true).share_mode(0).open(root.join("native.dll")).unwrap();
        assert!(write_payload(&root, &[("main.js", b"new"), ("native.dll", b"new dll")]).is_err());
        assert_eq!(fs::read(root.join("main.js")).unwrap(), b"old script");
        drop(lock);
        assert_eq!(fs::read(root.join("native.dll")).unwrap(), b"old dll");
        fs::remove_dir_all(root).unwrap();
    }
}
