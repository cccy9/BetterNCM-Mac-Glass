# BetterNCM Mac Glass

点击欢迎页“开始使用”后自动进入 Mac Glass 设置，参数调整后自动保存。

项目地址：[github.com/cccy9/BetterNCM-Mac-Glass](https://github.com/cccy9/BetterNCM-Mac-Glass)

本插件基于 BetterNCM 插件框架扩展，在原有主题基础上增加 Windows 整窗透明、播放页透明、歌词颜色和渐变、
播放页背景颜色以及 x86/x64 原生窗口插件自动加载。
同时会把 BetterNCM 首次启动说明页和右上角 GitHub 入口指向本项目地址；不替换 BetterNCM 核心 DLL。

1.2.1 修复播放页背景被“大面积容器清空”规则覆盖的问题；播放页展开时隐藏其外部主页根节点，收起后恢复，不隐藏播放页的祖先。增加独立歌词纯色/渐变与播放页背景色，设置页附每项用途、调节方向和推荐起点。原生透窗时禁用无效的网页播放页蒙层/磨砂参数。

整窗透明度越高越透桌面；蒙层不透明度越高越实；磨砂 px 越大越模糊（仅网页内）。建议先用整窗 20%、底栏蒙层 0.40、底栏磨砂 20px，再按背景明暗调整。歌词位置和滚动仍由网易云控制。

Windows 网易云 / BetterNCM 1.3.4 的玻璃样式与整窗透明兼容插件。

本版附带自行编译的 `MacGlassNative.dll`，通过 BetterNCM 的公开原生插件接口加载。
只处理本进程的 OrpheusBrowserHost 窗口。无 CEF 函数挂钩，不替换网易云安装目录 DLL。
首次部署需要重启网易云；之后随网易云自动启动，不再依赖 PowerShell Watch 或登录任务。

## 设置

- 主窗体透明度、播放页整窗透明度：Windows 原生 Alpha，0% 不透、55% 最透。默认 20%。
- 关闭原生整窗透明：恢复模块接管前的窗口属性。关闭网易云亦会销毁这些窗口属性。
- 页面蒙层和底栏磨砂：CSS 页面效果，不能调节桌面模糊半径。
- 自定义文字纯色/渐变：独立选项，设置面板始终保持深色文字。

状态栏读取实际窗口 Layered/Alpha 属性，不把 DWM Backdrop=3 当成视觉验收。
全部参数由原生接口同步保存到插件目录 settings.json，启动时优先读取；网页缓存仅用于旧版迁移。保存结果显示在设置页。
模块每 500 ms 发现本进程新窗口。页面每秒检查播放页状态并发送对应 Alpha。

## 限制

整窗 Alpha 会让文字和封面一起淡化。此兼容模式不等同于 macOS 保持前景不透明、背景独立磨砂的合成。
当前 CEF 91 的 windowed 模式把透明背景回退到不透明背景；仅改 CSS、background_color=0 或 DWM 属性不解决这一限制。
播放 portal 使用实色底板挡住主页面，再由 Windows 透到桌面，防止歌词叠到首页。
桌面磨砂半径调节及 macOS 式前景独立合成仍未实现，不能标作已完成。

## 编译和回退

版本号统一取自安装器 Cargo.toml，编译时自动写入插件清单和页面；不要直接安装含版本占位符的源文件。使用 scripts/package.ps1 同时编译双架构 DLL 并打包。
`../mac-glass-window/Deploy-NativeTheme.ps1` 备份旧插件、停止并禁用旧 Watch 任务、部署和重启应用。
回退时关闭网易云，将工作区 work/native-deploy-backup-* 中的插件文件夹恢复到 plugins_dev。
该目录中的 watch-task.xml 是旧任务备份；仅在需要旧实验脚本时恢复，避免多个实现竞争窗口属性。
