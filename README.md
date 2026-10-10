# BetterNCM Mac Glass

## 中文说明

这是基于 [BetterNCM](https://github.com/MicroCBer/BetterNCM) 和
[BetterNCM Installer II](https://github.com/std-microblock/BetterNCM-Installer)
开发的 Windows 网易云音乐整合版。项目在原有 BetterNCM 安装和插件框架的基础上，增加了
Mac Glass Theme、Windows 整窗透明、主界面与播放页玻璃效果、歌词颜色与渐变、播放页背景颜色、
透明度和网页磨砂参数，以及 x86/x64 原生窗口插件自动加载。

项目地址：[github.com/cccy9/BetterNCM-Mac-Glass](https://github.com/cccy9/BetterNCM-Mac-Glass)

### 安装与测试

运行 BetterNCM-Mac-Glass-Installer.exe 并接受 Windows 管理员权限提示。
首次使用点击“安装”；已有 BetterNCM 只更新插件时点击“仅更新 Mac Glass（离线）”，不需要等待版本检查。要同时重装核心时使用“重装/更新”。操作会关闭并重新启动网易云音乐。
欢迎页点击“开始使用 BetterNCM Mac Glass · 打开设置”直接进入 Mac Glass 设置。
设置自动保存，重新启动后恢复。

正式附件发布位置为本仓库的 [Releases](https://github.com/cccy9/BetterNCM-Mac-Glass/releases)。
只有发布完成后该页面才会出现下载附件；本地构建不会自动上传。

### 安装器包含的功能

- 一键安装或更新 BetterNCM，并在完成后自动安装 Mac Glass Theme。
- 根据网易云音乐进程架构提供 32 位和 64 位原生 DLL。
- 安装完成后自动启动网易云音乐，不需要手动运行 PowerShell 或 Watch 脚本。
- 在 BetterNCM 设置页调整主界面透明度、播放页透明度、网页蒙层、网页磨砂、歌词颜色和渐变。

这是联网安装器。主题文件和原生 DLL 已嵌入 EXE；BetterNCM 核心 DLL 会在安装时从版本索引下载，
以匹配当前网易云版本。安装器不包含网易云音乐客户端。

### 效果与限制

Windows 版本使用整窗 Alpha 兼容模式，透明度会同时影响文字和封面；网页磨砂参数只作用于网页层，
不能控制 Windows 桌面级模糊半径。它用于接近 macOS 玻璃效果，和 macOS 原生的独立背景合成仍有差异。

### 构建

```powershell
rustup toolchain install nightly --profile minimal --component rust-src
rustup target add --toolchain nightly i686-pc-windows-msvc
./scripts/package.ps1
```

推送到本仓库的 `main` 分支后，GitHub Actions 会生成
`BetterNCM-Mac-Glass-Installer` 构建产物；创建 Release 后会自动附加安装器 EXE。

### 开源与署名

本项目保留上游 BetterNCM Installer II 的 GPL-3.0 许可，并公开本项目的主题源码和构建脚本。
发布修改版时请保留许可证、上游链接和本项目地址，不要将本项目标记为上游官方版本。

---

## English

BetterNCM Mac Glass is a Windows NetEase Cloud Music distribution based on
[BetterNCM](https://github.com/MicroCBer/BetterNCM) and
[BetterNCM Installer II](https://github.com/std-microblock/BetterNCM-Installer).
It keeps the original BetterNCM installer and plugin framework, and adds Mac Glass Theme,
whole-window transparency, glass styling for the main and playback pages, lyric color and gradient
controls, playback background color, opacity and web blur controls, plus automatic native plugin
loading for both x86 and x64 clients.

Project repository: [github.com/cccy9/BetterNCM-Mac-Glass](https://github.com/cccy9/BetterNCM-Mac-Glass)

Settings are saved automatically and restored on restart.
With BetterNCM already installed, use “仅更新 Mac Glass（离线）” (Update Mac Glass only, offline) to update the plugin without waiting for the online version check. The existing core and saved settings are preserved.
The welcome-page Start button opens the Mac Glass settings directly.

### Included installer features

- Installs or updates BetterNCM and installs Mac Glass Theme automatically.
- Includes native DLLs for both 32-bit and 64-bit NetEase Cloud Music processes.
- Launches NetEase Cloud Music after installation without requiring PowerShell or a Watch script.
- Provides BetterNCM settings for window opacity, playback opacity, web overlays, web blur, lyric colors,
  gradients, and playback background color.

This is an online installer. The theme files and native DLLs are embedded in the EXE; the BetterNCM core
DLL is downloaded during installation from the version index so it matches the installed NetEase client.
The installer does not include the NetEase Cloud Music client itself.

### Visual behavior and limitations

The Windows build uses whole-window alpha compatibility mode, so opacity also affects text and cover art.
Web blur settings affect the web layer only and cannot control the Windows desktop blur radius. The result
approximates the macOS glass look but is not the same as macOS native background composition.

### Build

```powershell
rustup toolchain install nightly --profile minimal --component rust-src
rustup target add --toolchain nightly i686-pc-windows-msvc
./scripts/package.ps1
```

Pushing to `main` starts the GitHub Actions build. A published Release receives the installer EXE
automatically.

### License and attribution

This project retains the GPL-3.0 license of BetterNCM Installer II and publishes the theme source and
native build scripts. Keep the license, upstream links, and this project URL when redistributing modified
versions. Do not present this project as an official upstream release.
