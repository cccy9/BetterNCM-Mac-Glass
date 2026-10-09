(() => {
  // Hot reload must not leave multiple observers or native-parameter writers.
  if (window.__macGlassTheme) window.__macGlassTheme.dispose();
  const STYLE_ID = "mac-glass-theme-style";
  const SETTINGS_KEY = "mac-glass-theme-settings";
  const DEFAULTS = {
    opacity: 0.46,
    strongOpacity: 0.62,
    blur: 24,
    playerOpacity: 0.54,
    playerBlur: 26,
    pageOpacity: 0.38,
    pageBlur: 28,
    overlay: 0.22,
    desktopGlass: false,
    whiteText: false,
    textColor: "#F5F7FF",
    gradientText: false,
    textColor2: "#83D8FF",
    lyricsColor: "#F5F7FF",
    lyricsColor2: "#B7D9FF",
    lyricsGradient: false,
    playbackBackground: "#30343c",
    chromaKey: false,
    nativeWindow: true,
    windowTransparency: 20,
    playbackTransparency: 20
  };

  let settings = readSettings();
  let lastImage = "";
  let scheduled = false;
  let nativeSignature = "";
  let nativeStatusText = "原生模块尚未确认加载";
  let syncTimer = null;
  let disposed = false;
  let lastDiagnostics = "";
  const configPages = new Set();
  const alphaFromTransparency = (value) => Math.round(255 * (1 - Math.max(0, Math.min(55, Number(value) || 0)) / 100));

  function findPlaybackSurface() {
    // Only known playback containers: a full-size home root is NOT a player.
    return [...document.querySelectorAll('.vinyl-page-container,[class*="VinylPageContainer"],[class*="PlayerPage"],[class*="player-page"]')]
      .find((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const visibleWidth = Math.min(rect.right, innerWidth) - Math.max(rect.left, 0);
        const visibleHeight = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0);
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.05 &&
          visibleWidth > innerWidth * .65 && visibleHeight > innerHeight * .55;
      }) || null;
  }

  function markPlaybackSurface() {
    const surface = findPlaybackSurface();
    document.documentElement.classList.toggle("mac-glass-playback-visible", Boolean(surface));
    document.querySelectorAll("[data-mac-glass-playback-surface]").forEach((element) => {
      if (element !== surface) element.removeAttribute("data-mac-glass-playback-surface");
    });
    if (surface && !surface.hasAttribute("data-mac-glass-playback-surface")) surface.setAttribute("data-mac-glass-playback-surface", "");
    // Hide only the home branch when the playback portal is outside it. Never
    // hide an ancestor of the player: that would also hide lyrics and controls.
    const hiddenBranches = new Set();
    if (surface && settings.nativeWindow) {
      for (const home of document.querySelectorAll("#root, #app, #main")) {
        if (!home.contains(surface) && !surface.contains(home)) hiddenBranches.add(home);
      }
    }
    document.querySelectorAll("[data-mac-glass-home-hidden]").forEach((element) => {
      if (!hiddenBranches.has(element)) element.removeAttribute("data-mac-glass-home-hidden");
    });
    hiddenBranches.forEach((element) => {
      if (!element.hasAttribute("data-mac-glass-home-hidden")) element.setAttribute("data-mac-glass-home-hidden", "");
    });
    return surface;
  }

  function markLyricText(surface) {
    if (!surface) return;
    const candidates = new Set();
    for (const lyrics of surface.querySelectorAll('[class*="lyric" i]')) {
      candidates.add(lyrics);
      lyrics.querySelectorAll("span,p,div,li,a").forEach((element) => candidates.add(element));
    }
    for (const element of candidates) {
      if (element.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
      const hasText = [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
      if (hasText && !element.hasAttribute("data-mac-glass-lyric-text")) element.setAttribute("data-mac-glass-lyric-text", "");
      if (!hasText) element.removeAttribute("data-mac-glass-lyric-text");
    }
  }

  function saveRuntimeDiagnostics(surface) {
    // Local, content-free status: no song names, lyrics, account data or URLs.
    if (typeof betterncm === "undefined" || !betterncm.fs || typeof plugin === "undefined") return;
    const report = { version: "1.8.88", playback: Boolean(surface),
      surfaceClass: surface ? String(surface.className) : null,
      background: surface ? getComputedStyle(surface).backgroundColor : null,
      position: surface ? getComputedStyle(surface).position : null,
      hiddenHomeRoots: document.querySelectorAll("[data-mac-glass-home-hidden]").length,
      lyricTextNodes: document.querySelectorAll("[data-mac-glass-lyric-text]").length,
      nativeStatus: nativeStatusText };
    const serialized = JSON.stringify(report, null, 2);
    if (serialized === lastDiagnostics) return;
    lastDiagnostics = serialized;
    Promise.resolve(betterncm.fs.writeFileText(`${plugin.pluginPath}/last-ui-status.json`, serialized))
      .catch(() => { lastDiagnostics = ""; });
  }

  function syncNative() {
    if (disposed) return;
    applyProjectBranding();
    const surface = markPlaybackSurface();
    markLyricText(surface);
    try {
      if (typeof betterncm_native === "undefined" || !betterncm_native.native_plugin) throw new Error("首次安装原生模块后需要重新启动网易云");
      const mainAlpha = alphaFromTransparency(settings.windowTransparency);
      const activeAlpha = surface ? alphaFromTransparency(settings.playbackTransparency) : mainAlpha;
      const args = [settings.nativeWindow ? 1 : 0, mainAlpha, activeAlpha];
      const signature = JSON.stringify(args);
      if (signature !== nativeSignature) {
        const result = JSON.parse(betterncm_native.native_plugin.call("mac_glass.configure", args));
        if (!result.saved) throw new Error("窗口参数保存失败：请检查插件目录写入权限");
        nativeSignature = signature;
      }
      const result = JSON.parse(betterncm_native.native_plugin.call("mac_glass.status", []));
      nativeStatusText = result.layered
        ? `已读回 Windows 窗体 Alpha=${result.alpha}/255，整窗透明 ${Math.round((1 - result.alpha / 255) * 100)}%。桌面磨砂半径不可调。`
        : settings.nativeWindow ? "正在等待主窗口应用透明；尚未验证成功。" : "整窗透明已关闭。";
      document.documentElement.classList.toggle("mac-glass-native-active", Boolean(result.layered && settings.nativeWindow));
    } catch (error) {
      nativeStatusText = `原生透明未确认：${error.message || String(error)}`;
    }
    for (const page of configPages) {
      if (!page.isConnected) { configPages.delete(page); continue; }
      const output = page.querySelector("[data-native-status]");
      if (output && output.textContent !== nativeStatusText) output.textContent = nativeStatusText;
    }
    saveRuntimeDiagnostics(surface);
  }

  function readSettings() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // Keep the BetterNCM welcome/about links aligned with this distribution.
  // The core PluginManager page is remote/compiled into BetterNCM, so the
  // theme updates its visible copy without replacing the core DLL.
  const PROJECT_URL = "https://github.com/cccy9/BetterNCM-Mac-Glass";
  const PROJECT_NAME = "BetterNCM Mac Glass";
  const PROJECT_VERSION = "1.8.88";
  let pendingSettingsNavigation = null;
  let settingsNavigationTimer = null;

  function completeSettingsNavigation() {
    if (!pendingSettingsNavigation) return;
    const { manager, deadline } = pendingSettingsNavigation;
    if (disposed || !manager.isConnected || Date.now() > deadline) {
      pendingSettingsNavigation = null;
      return;
    }
    // Let the original React button dismiss the welcome page and remember
    // consent first; then use the manager's own plugin-selection control.
    if (manager.querySelector(".startup-warning")) return;
    const entry = manager.querySelector('.loaded-plugins-list [data-plugin-slug="mac-glass-theme"]:not(.plugin-btn-disabled)');
    if (!entry) return;
    pendingSettingsNavigation = null;
    entry.click();
  }

  function onStartUsing(event) {
    const button = event.target instanceof Element && event.target.closest(".startup-warning button");
    const manager = button && button.closest(".bncm-mgr");
    if (!manager) return;
    pendingSettingsNavigation = { manager, deadline: Date.now() + 5000 };
    clearTimeout(settingsNavigationTimer);
    settingsNavigationTimer = setTimeout(completeSettingsNavigation, 0);
  }

  function applyProjectBranding() {
    const title = document.querySelector(".bncm-mgr-header h1");
    if (title) {
      // Preserve the React-owned span so later manager renders remain valid.
      for (const node of title.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().startsWith("BetterNCM") &&
            node.textContent !== PROJECT_NAME + " ") node.textContent = PROJECT_NAME + " ";
      }
      const version = title.querySelector("span");
      if (version && version.textContent !== PROJECT_VERSION) {
        version.title = "整合版版本；底层 BetterNCM 核心版本：" + version.textContent;
        version.textContent = PROJECT_VERSION;
      }
    }
    const warning = document.querySelector(".startup-warning");
    if (warning) {
      const heading = warning.querySelector("h1");
      if (heading && heading.textContent !== "欢迎使用 BetterNCM Mac Glass！") heading.textContent = "欢迎使用 BetterNCM Mac Glass！";
      const paragraphs = warning.querySelectorAll("p");
      const introduction = "BetterNCM Mac Glass 由 CCCY9 基于 BetterNCM 扩展，增加整窗透明、玻璃底栏、播放页背景和歌词颜色设置。感谢 BetterNCM 原作者及贡献者提供插件框架。";
      if (paragraphs[0] && paragraphs[0].textContent !== introduction) paragraphs[0].textContent = introduction;
      const notice = "BetterNCM Mac Glass 是完全开源、免费的软件。请通过本项目 GitHub 仓库获取源码与安装器，谨防付费售卖或冒充官方的版本。如已付费购买，请联系卖家退款。项目由爱好者维护，感谢你的支持与反馈。";
      if (paragraphs[1] && paragraphs[1].textContent !== notice) paragraphs[1].textContent = notice;
      const guide = "点击下方按钮即可进入 Mac Glass 设置页，调整整窗透明度、底栏磨砂、播放页背景和歌词颜色。之后也可以通过右上角的插件管理器图标重新打开设置。";
      if (paragraphs[3] && paragraphs[3].textContent !== guide) paragraphs[3].textContent = guide;
      const startButton = warning.querySelector("button");
      const startLabel = "开始使用 BetterNCM Mac Glass · 打开设置";
      if (startButton && startButton.textContent !== startLabel) startButton.textContent = startLabel;
      if (paragraphs[2]) {
        const link = paragraphs[2].querySelector("a");
        if (link) {
          if (link.textContent !== PROJECT_URL) link.textContent = PROJECT_URL;
          if (link.getAttribute("href") !== PROJECT_URL) link.href = PROJECT_URL;
        }
        paragraphs[2].childNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.includes("BetterNCM 的 Github")) {
            node.textContent = "项目源码和改进功能请访问 CCCY9 Mac Glass Github 仓库：";
          }
        });
      }
    }
    // The header GitHub icon is rendered without an href by the React app.
    // Catch that specific icon and route it to the fork as well.
    for (const anchor of document.querySelectorAll(".startup-warning a,.bncm-mgr-header .m-tool a")) {
      const isOldLink = (anchor.textContent || "").includes("std-microblock/BetterNCM") || anchor.getAttribute("href") === PROJECT_URL;
      const isGithubIcon = anchor.querySelector('svg path[d^="M12,2A10,10"]');
      if (!isOldLink && !isGithubIcon) continue;
      if (anchor.getAttribute("href") !== PROJECT_URL) anchor.href = PROJECT_URL;
      if (anchor.dataset.cccy9ProjectLink === "1") continue;
      anchor.dataset.cccy9ProjectLink = "1";
    }
    completeSettingsNavigation();
  }

  function openProjectLink(event) {
    const anchor = event.target instanceof Element && event.target.closest('a[data-cccy9-project-link="1"]');
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof betterncm !== "undefined" && betterncm.ncm && betterncm.ncm.openUrl) betterncm.ncm.openUrl(PROJECT_URL);
    else window.open(PROJECT_URL, "_blank");
  }

  function applySettings() {
    const root = document.documentElement;
    root.classList.toggle("mac-glass-desktop", Boolean(settings.nativeWindow));
    root.classList.toggle("mac-glass-white-text", Boolean(settings.whiteText));
    root.classList.toggle("mac-glass-gradient-text", Boolean(settings.whiteText && settings.gradientText));
    root.classList.toggle("mac-glass-lyrics-gradient", Boolean(settings.lyricsGradient));
    // Retire the chroma-key experiment: it can punch click-through holes.
    root.classList.remove("mac-glass-chroma");
    root.style.setProperty("--mac-glass-opacity", settings.opacity);
    root.style.setProperty("--mac-glass-opacity-strong", settings.strongOpacity);
    root.style.setProperty("--mac-glass-blur", `${settings.blur}px`);
    root.style.setProperty("--mac-glass-player-opacity", settings.playerOpacity);
    root.style.setProperty("--mac-glass-player-blur", `${settings.playerBlur}px`);
    root.style.setProperty("--mac-glass-page-opacity", settings.pageOpacity);
    root.style.setProperty("--mac-glass-page-blur", `${settings.pageBlur}px`);
    root.style.setProperty("--mac-glass-overlay", settings.overlay);
    root.style.setProperty("--mac-glass-text-color", settings.textColor || "#F5F7FF");
    root.style.setProperty("--mac-glass-text-color-2", settings.textColor2 || "#83D8FF");
    root.style.setProperty("--mac-glass-lyrics-color", settings.lyricsColor || "#F5F7FF");
    root.style.setProperty("--mac-glass-lyrics-color-2", settings.lyricsColor2 || "#B7D9FF");
    root.style.setProperty("--mac-glass-playback-background", settings.playbackBackground || "#30343c");
    applyProjectBranding();
    syncNative();
  }

  const css = `
:root {
  --mac-glass-opacity: .46;
  --mac-glass-opacity-strong: .62;
  --mac-glass-blur: 24px;
  --mac-glass-player-opacity: .54;
  --mac-glass-player-blur: 26px;
  --mac-glass-page-opacity: .38;
  --mac-glass-page-blur: 28px;
  --mac-glass-overlay: .22;
  --mac-glass-border: rgba(255, 255, 255, .42);
  --mac-glass-text: #202124;
  --mac-glass-text-color: #F5F7FF;
  --mac-glass-text-color-2: #83D8FF;
  --mac-glass-image: linear-gradient(135deg, #f3f5f8, #dfe4eb 48%, #f8f9fb);
  /* 网易云 3.x 主题变量，避免原皮肤的纯色背景盖住玻璃层 */
  --colorBackground: rgba(255, 255, 255, var(--mac-glass-opacity));
  --colorBackgroundWhite: rgba(255, 255, 255, var(--mac-glass-opacity-strong));
  --colorSidebar5: rgba(255, 255, 255, .12);
  --colorSidebar6: rgba(255, 255, 255, .08);
  --colorSidebar7: rgba(255, 255, 255, .04);
  --colorFunction5: rgba(255, 255, 255, .12);
  --colorFunction9: rgba(255, 255, 255, .12);
  --colorFunction10: rgba(255, 255, 255, .16);
}

html, body, #app, #root, #main { background: transparent !important; }
body { color: var(--mac-glass-text); position: relative; isolation: isolate; }

body::before {
  content: ""; position: fixed; inset: -32px; z-index: -2;
  pointer-events: none; background: var(--mac-glass-image) center / cover no-repeat;
  filter: blur(28px) saturate(125%); opacity: .9;
}

body::after {
  content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background: rgba(255, 255, 255, var(--mac-glass-overlay));
}

/* 配合 DWM Desktop Acrylic：不要让模拟专辑背景盖住桌面。 */
html.mac-glass-desktop {
  --colorBackground: transparent !important;
  --colorBackgroundWhite: rgba(255, 255, 255, var(--mac-glass-opacity-strong)) !important;
}
html.mac-glass-desktop body::before { display: none !important; }
html.mac-glass-desktop body::after {
  background: rgba(255, 255, 255, var(--mac-glass-overlay)) !important;
  backdrop-filter: blur(var(--mac-glass-blur)) saturate(135%) !important;
  -webkit-backdrop-filter: blur(var(--mac-glass-blur)) saturate(135%) !important;
}

/* Windowed CEF 91 stays opaque. Desktop transparency comes from the native
   uniform-alpha compatibility mode, not from this CSS. */
html.mac-glass-desktop #root {
  background: transparent !important;
  color: var(--mac-glass-text) !important;
}
html.mac-glass-desktop #root > [class*="AppEle"] {
  background: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
html.mac-glass-desktop #root :where([class*="app-background"], [class*="AppBackground"]) {
  background: transparent !important;
  background-image: none !important;
}
html.mac-glass-white-text #root :where(span, p, a, li, h1, h2, h3, label, button) {
  color: var(--mac-glass-text-color) !important;
}
html.mac-glass-white-text body :where([class*="VinylPageContainer"], [class*="PlayerPage"], [class*="LyricDisplayInnerContainer"]) :where(span, p, a, li, h1, h2, h3, label, button) {
  color: var(--mac-glass-text-color) !important;
}
html.mac-glass-gradient-text #root :where(span, p, a, li, h1, h2, h3, label),
html.mac-glass-gradient-text body :where([class*="VinylPageContainer"], [class*="PlayerPage"], [class*="LyricDisplayInnerContainer"]) :where(span, p, a, li, h1, h2, h3, label) {
  color: transparent !important;
  background-image: linear-gradient(105deg, var(--mac-glass-text-color), var(--mac-glass-text-color-2)) !important;
  background-clip: text !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
}

/* Chroma-key proof: only exact magenta pixels become transparent in Win32. */
html.mac-glass-chroma,
html.mac-glass-chroma body,
html.mac-glass-chroma #app,
html.mac-glass-chroma #root,
html.mac-glass-chroma #main {
  background: #ff00ff !important;
  background-image: none !important;
}
html.mac-glass-chroma body::after { display: none !important; }
html.mac-glass-chroma :where(.g-mn3, .g-mn4, .g-bd4, .m-top, .m-nav, .m-subnav,
  .m-player, .m-player-container, .m-player-content, .m-lycifo,
  [class*="sidebar"], [class*="Sidebar"], [class*="PlayerPage"], [class*="player-page"]) {
  background: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* 主页面和侧栏 */
:where(.g-mn3, .g-mn4, .g-bd4, .m-top, .m-nav, .m-subnav,
  .m-lycifo, .m-table, nav, aside, [class*="sidebar"], [class*="Sidebar"],
  [class*="navigation"], [class*="Navigation"]) {
  background: rgba(255, 255, 255, var(--mac-glass-opacity)) !important;
  border-color: var(--mac-glass-border) !important;
  box-shadow: 0 12px 36px rgba(31, 38, 51, .12);
  backdrop-filter: blur(var(--mac-glass-blur)) saturate(135%);
  -webkit-backdrop-filter: blur(var(--mac-glass-blur)) saturate(135%);
}

/* 只处理封面卡片，不再用 Card/Panel 通配符误伤歌曲列表。 */
.m-cvrlst li {
  background: rgba(255, 255, 255, var(--mac-glass-opacity-strong)) !important;
  border: 1px solid var(--mac-glass-border) !important;
  box-shadow: 0 8px 24px rgba(31, 38, 51, .10);
  backdrop-filter: blur(18px) saturate(130%);
  -webkit-backdrop-filter: blur(18px) saturate(130%);
}

/* 网易云 3.x 的 MetaCard 实际是歌曲行，不能被当作白色卡片。 */
:where(.cmd-metacard-table, [class*="MetaCardWrapper"]) {
  background: transparent !important;
  background-image: none !important;
  border: 0 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

:where(.cmd-metacard-table, [class*="MetaCardWrapper"]):hover {
  background: rgba(31, 38, 51, .12) !important;
}

:where(.cmd-metacard-table, [class*="MetaCardWrapper"]):where([class*="selected"], [class*="Selected"], [class*="active"], [class*="Active"], [aria-selected="true"]) {
  background: rgba(31, 38, 51, .08) !important;
}

/* 3.x 侧栏使用独立图标容器，原皮肤给图标容器本身加了浅色方底。 */
:where([class*="m-cmd-icon"], [class*="IconStyle"], [class*="icon-container"], [class*="IconContainer"]) {
  background: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
}

/* 底部播放栏：清掉网易云自己的动态颜色和背景图 */
:where(.m-playbar, .m-playbar-wrap, [class*="playbar"], [class*="Playbar"],
  [class*="bottom-player"], [class*="BottomPlayer"], [class*="player-bar"],
  [class*="PlayerBar"], .default-bar-wrapper, [class*="DefaultBarWrapper"]) {
  background: rgba(255, 255, 255, var(--mac-glass-player-opacity)) !important;
  background-image: none !important;
  border-top: 1px solid var(--mac-glass-border) !important;
  box-shadow: 0 -10px 30px rgba(31, 38, 51, .14) !important;
  backdrop-filter: blur(var(--mac-glass-player-blur)) saturate(140%) !important;
  -webkit-backdrop-filter: blur(var(--mac-glass-player-blur)) saturate(140%) !important;
}

:where(.m-playbar .bg, .m-playbar .updn, .m-playbar .updn-1, .m-playbar .updn-2,
  .m-playbar [class*="background"], .m-playbar [class*="Background"],
  [class*="playbar"] [class*="bg"], [class*="Playbar"] [class*="Bg"],
  .default-bar-wrapper [class*="background"], .default-bar-wrapper [class*="Background"],
  [class*="DefaultBarWrapper"] [class*="background"], [class*="DefaultBarWrapper"] [class*="Background"]) {
  background: transparent !important;
  background-image: none !important;
}

:where(.m-playbar *, .m-playbar-wrap *, [class*="playbar"] *, [class*="Playbar"] *,
  [class*="bottom-player"] *, [class*="BottomPlayer"] *, [class*="player-bar"] *,
  [class*="PlayerBar"] *, .default-bar-wrapper *, [class*="DefaultBarWrapper"] *) {
  border-color: rgba(255, 255, 255, .35) !important;
}

/* 独立播放页和歌词页 */
:where(.m-player, .m-player-container, .m-player-content, .m-lycifo,
  [class*="player-page"], [class*="PlayerPage"], [class*="player-window"],
  [class*="PlayerWindow"], [class*="lyric-page"], [class*="LyricPage"]) {
  background: rgba(255, 255, 255, var(--mac-glass-page-opacity)) !important;
  background-image: none !important;
  border-color: var(--mac-glass-border) !important;
  backdrop-filter: blur(var(--mac-glass-page-blur)) saturate(135%);
  -webkit-backdrop-filter: blur(var(--mac-glass-page-blur)) saturate(135%);
}

:where(.m-player .bg, .m-player .cover-bg, .m-player [class*="background"],
  .m-player [class*="Background"], [class*="player-page"] [class*="bg"],
  [class*="PlayerPage"] [class*="Bg"]) {
  background: transparent !important;
  background-image: none !important;
}

/* 网易云 3.x 播放页挂在 body 下的 portal，不在 #root 里。 */
:where(.vinyl-page-container, [class*="VinylPageContainer"]) {
  background: rgba(255, 255, 255, var(--mac-glass-page-opacity)) !important;
  background-image: none !important;
  backdrop-filter: blur(var(--mac-glass-page-blur)) saturate(135%) !important;
  -webkit-backdrop-filter: blur(var(--mac-glass-page-blur)) saturate(135%) !important;
}

:where([class*="CoverBackgroundContainer"], [class*="MinibarHoverMask"]) {
  background: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
}

/* 色键模式必须先用实心洋红遮住底下的主界面，再让播放页内部背景透出色键。 */
html.mac-glass-chroma :where(.vinyl-page-container, [class*="VinylPageContainer"]) {
  background: #ff00ff !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

html.mac-glass-chroma :where([class*="CoverBackgroundContainer"], [class*="MinibarHoverMask"]) {
  background: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

@supports not ((backdrop-filter: blur(1px))) {
  :where(.g-mn3, .g-mn4, .g-bd4, .m-top, .m-nav, .m-subnav, .m-playbar,
    .m-player, .m-player-container, .m-player-content, nav, aside,
    [class*="sidebar"], [class*="Sidebar"], [class*="playbar"], [class*="Playbar"],
    .default-bar-wrapper, [class*="DefaultBarWrapper"]) {
    background: rgba(238, 242, 247, .88) !important;
  }
}

/* In whole-window Alpha mode the playback portal must mask the home page.
   A translucent portal would reveal the home page, NOT the desktop. Native
   Alpha makes this opaque backplate transparent at the OS composition layer. */
html.mac-glass-desktop body :is(#root [data-mac-glass-playback-surface], [data-mac-glass-playback-surface]),
html.mac-glass-desktop body :is(#root [data-mac-glass-playback-surface], [data-mac-glass-playback-surface]):hover {
  background: var(--mac-glass-playback-background, #30343c) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
html body [data-mac-glass-home-hidden], html body [data-mac-glass-home-hidden] * {
  visibility: hidden !important;
  pointer-events: none !important;
}
/* Playback foreground is independent of the home-page text/gradient switch.
   Clip text-bearing nodes only, never the entire lyrics layout container. */
html body :is(#root [data-mac-glass-playback-surface], [data-mac-glass-playback-surface]) :is([class*="lyric" i], [data-mac-glass-lyric-text], [class*="lyric" i] :is(span,p,a,li,h1,h2,h3,label)) {
  color: var(--mac-glass-lyrics-color) !important;
  -webkit-text-fill-color: var(--mac-glass-lyrics-color) !important;
  background-image: none !important;
  background-clip: border-box !important;
  -webkit-background-clip: border-box !important;
}
html.mac-glass-lyrics-gradient body :is(#root [data-mac-glass-playback-surface], [data-mac-glass-playback-surface]) [data-mac-glass-lyric-text] {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  background-image: linear-gradient(105deg, var(--mac-glass-lyrics-color), var(--mac-glass-lyrics-color-2)) !important;
  background-clip: text !important;
  -webkit-background-clip: text !important;
}
/* Always keep the settings panel legible, even with white/gradient text enabled. */
html body #root [data-mac-glass-config],
html.mac-glass-white-text #root [data-mac-glass-config] :where(span,p,h2,label,button,output),
html.mac-glass-gradient-text #root [data-mac-glass-config] :where(span,p,h2,label,button,output),
body [data-mac-glass-config], body [data-mac-glass-config] :where(span,p,h2,label,button,output) {
  color: #202632 !important;
  -webkit-text-fill-color: #202632 !important;
  background-image: none !important;
  background-clip: border-box !important;
}
`;

  function installStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    if (style.textContent !== css) style.textContent = css;
    applySettings();
    clearOpaquePageSurfaces();
    markPlaybackSurface();
  }

  function clearOpaquePageSurfaces() {
    // Retire v1.1's geometry heuristic; it also cleared VinylPageContainer.
    document.querySelectorAll("[data-mac-glass-surface]").forEach((element) => element.removeAttribute("data-mac-glass-surface"));
  }

  function findAlbumImage() {
    const selectors = [
      ".m-playbar .head img",
      ".m-player .cover img",
      ".m-lycifo .u-cover img",
      "img[src*='music.126.net']"
    ];
    for (const selector of selectors) {
      const image = document.querySelector(selector);
      if (image && image.src) return image.src;
    }
    return "";
  }

  function syncAlbumBackground() {
    installStyle();
    const image = findAlbumImage();
    if (!image || image === lastImage) return;
    lastImage = image;
    document.documentElement.style.setProperty("--mac-glass-image", `url(${JSON.stringify(image)})`);
  }

  function scheduleSync() {
    if (scheduled || disposed) return;
    scheduled = true;
    syncTimer = setTimeout(() => { scheduled = false; if (!disposed) syncAlbumBackground(); }, 200);
  }

  function makeConfigPage() {
    const page = document.createElement("div");
    page.dataset.macGlassConfig = "";
    page.style.cssText = "padding:20px;max-width:640px;color:#202632;background:rgba(245,247,251,.95);border-radius:12px;font-size:14px;line-height:1.6";
    configPages.add(page);
    page.innerHTML = `
      <h2 style="margin:0 0 6px">BetterNCM Mac Glass 1.8.88</h2>
      <p style="margin:0 0 12px;opacity:.85">本插件基于 BetterNCM 插件框架扩展，项目地址：<a href="https://github.com/cccy9/BetterNCM-Mac-Glass" target="_blank">github.com/cccy9/BetterNCM-Mac-Glass</a></p>
      <p style="margin:0 0 12px;opacity:.85">Windows 兼容整窗透明：直接调整原生窗口 Alpha，主界面和播放页都能透到桌面。首次加载 DLL 后需重启一次，之后启动自动生效，无需手动运行命令。文字和封面也会轻微淡化；这不是 macOS 的独立背景透明合成。</p>
      <p data-native-status style="padding:8px;border:1px solid #aab4c4;border-radius:8px">${nativeStatusText}</p>
      <div data-setting="windowTransparency"></div><div data-setting="playbackTransparency"></div>
      <p>以下参数是网页层的蒙层和底栏磨砂，不是桌面磨砂半径。CEF 91 / Windows Acrylic 当前不能提供可调桌面模糊半径。</p>
      <p style="margin:0 0 12px;padding:8px;background:#e7edf6;border-radius:8px">调节顺序：先用整窗透明度决定能看到多少桌面，再调底栏磨砂。整窗透明度越高越透（0% 不透，55% 最透）；蒙层不透明度越高越实（0.30 = 30% 不透明）；磨砂越大越模糊（0px 无模糊）。可先尝试整窗 20%、底栏蒙层 0.40、底栏磨砂 20px。文字变淡时，先降低整窗透明度。</p>
      <div data-setting="opacity"></div><div data-setting="strongOpacity"></div>
      <div data-setting="blur"></div><div data-setting="playerOpacity"></div>
      <div data-setting="playerBlur"></div><div data-setting="pageOpacity"></div>
      <div data-setting="pageBlur"></div><div data-setting="overlay"></div>
      <label style="display:flex;align-items:center;gap:10px;margin:16px 0">
        <input data-desktop-glass type="checkbox">启用原生整窗透明（自动应用，兼容模式）
      </label>
      <label style="display:flex;align-items:center;gap:10px;margin:12px 0">
        <input data-white-text type="checkbox">启用自定义文字颜色（提高玻璃背景可读性）
      </label>
      <label style="display:flex;align-items:center;gap:10px;margin:12px 0">
        <span style="width:170px">文字颜色</span><input data-text-color type="color" aria-label="文字颜色">
        <input data-gradient-text type="checkbox" aria-label="渐变文字">渐变
        <input data-text-color-2 type="color" aria-label="渐变结束颜色">
      </label>
      <label style="display:flex;align-items:center;gap:10px;margin:12px 0">
        <span style="width:170px">播放页歌词颜色</span><input data-lyrics-color type="color" aria-label="播放页歌词颜色">
        <input data-lyrics-gradient type="checkbox" aria-label="歌词渐变">渐变
        <input data-lyrics-color-2 type="color" aria-label="歌词渐变结束颜色">
      </label>
      <label style="display:flex;align-items:center;gap:10px;margin:12px 0">
        <span style="width:170px">播放页背景颜色</span><input data-playback-background type="color" aria-label="播放页背景颜色">
      </label>
      <p>歌词颜色独立保存，不需要开启上面的主页文字开关。原生透窗模式使用实色播放页底板挡住主页，再由整窗透明透到桌面；建议浅色歌词搭配深色背景。歌词位置和滚动沿用网易云。</p>
      <button data-reset type="button" style="margin-top:12px;padding:6px 14px">恢复默认</button>
    `;

    const fields = [
      ["windowTransparency", "主窗体透明度（原生）", 0, 55, 1, "%"],
      ["playbackTransparency", "播放页整窗透明度（原生）", 0, 55, 1, "%"],
      ["opacity", "主界面蒙层不透明度", 0.15, 0.85, 0.01, ""],
      ["strongOpacity", "卡片蒙层不透明度", 0.2, 0.95, 0.01, ""],
      ["blur", "页面内容磨砂（非桌面）", 0, 48, 1, "px"],
      ["playerOpacity", "底栏蒙层不透明度", 0.15, 0.9, 0.01, ""],
      ["playerBlur", "底栏内容磨砂", 0, 60, 1, "px"],
      ["pageOpacity", "播放页蒙层（网页模式）", 0.15, 0.9, 0.01, ""],
      ["pageBlur", "播放页磨砂（网页模式）", 0, 60, 1, "px"],
      ["overlay", "背景白色叠加", 0, 0.6, 0.01, ""]
    ];
    const hints = {
      windowTransparency: "向右越透桌面，文字和封面也会变淡。0% 为完全不透明。",
      playbackTransparency: "只在播放页展开时使用；收起后恢复主窗体透明度。",
      opacity: "侧栏等页面蒙层：向右更厚、更遮挡背景，不改变 Windows 整窗透明度。",
      strongOpacity: "封面卡片的底色厚度；不修改歌曲列表行。",
      blur: "页面玻璃层模糊后方网页内容；背景无内容时变化可能不明显，不模糊桌面。",
      playerOpacity: "底部播放栏白色蒙层：向右更白、更实。",
      playerBlur: "底部播放栏后方网页内容的模糊半径：0px 无磨砂，向右更柔和。",
      pageOpacity: "关闭原生透窗时可用；开启时采用实色底板，避免透出主页。",
      pageBlur: "关闭原生透窗时可用；模糊的是后方主页内容，不是桌面。",
      overlay: "整页白色叠加：向右更亮、更偏白。"
    };

    for (const [key, label, min, max, step, suffix] of fields) {
      const row = page.querySelector(`[data-setting="${key}"]`);
      const title = document.createElement("label");
      title.style.cssText = "display:flex;align-items:center;gap:10px;margin:13px 0";
      title.innerHTML = `<span style="width:170px">${label}</span>`;
      const input = document.createElement("input");
      input.type = "range"; input.min = min; input.max = max; input.step = step;
      input.value = settings[key]; input.style.flex = "1";
      input.setAttribute("aria-label", label);
      const value = document.createElement("output");
      value.style.cssText = "width:58px;text-align:right";
      const render = () => { value.value = `${input.value}${suffix}`; value.textContent = value.value; };
      input.addEventListener("input", () => {
        settings[key] = Number(input.value); render(); applySettings(); saveSettings();
      });
      render(); title.append(input, value); row.appendChild(title);
      const hint = document.createElement("p");
      hint.id = `mac-glass-hint-${key}`;
      hint.textContent = hints[key];
      hint.style.cssText = "font-size:12px;margin:-7px 0 14px;opacity:.8";
      input.setAttribute("aria-describedby", hint.id);
      row.appendChild(hint);
    }
    const updateAvailableControls = () => {
      for (const key of ["pageOpacity", "pageBlur"]) {
        const row = page.querySelector(`[data-setting="${key}"]`);
        row.querySelector("input").disabled = Boolean(settings.nativeWindow);
        row.style.opacity = settings.nativeWindow ? ".5" : "1";
      }
    };
    updateAvailableControls();

    const desktopGlassInput = page.querySelector("[data-desktop-glass]");
    desktopGlassInput.checked = Boolean(settings.nativeWindow);
    desktopGlassInput.addEventListener("change", () => {
      settings.nativeWindow = desktopGlassInput.checked;
      applySettings(); clearOpaquePageSurfaces(); saveSettings(); updateAvailableControls();
    });
    const whiteTextInput = page.querySelector("[data-white-text]");
    whiteTextInput.checked = Boolean(settings.whiteText);
    whiteTextInput.addEventListener("change", () => {
      settings.whiteText = whiteTextInput.checked;
      applySettings(); saveSettings();
    });
    const textColorInput = page.querySelector("[data-text-color]");
    const textColor2Input = page.querySelector("[data-text-color-2]");
    const gradientTextInput = page.querySelector("[data-gradient-text]");
    textColorInput.value = settings.textColor;
    textColor2Input.value = settings.textColor2;
    gradientTextInput.checked = Boolean(settings.gradientText);
    const saveTextSettings = () => { applySettings(); saveSettings(); };
    textColorInput.addEventListener("input", () => { settings.textColor = textColorInput.value; saveTextSettings(); });
    textColor2Input.addEventListener("input", () => { settings.textColor2 = textColor2Input.value; saveTextSettings(); });
    gradientTextInput.addEventListener("change", () => { settings.gradientText = gradientTextInput.checked; saveTextSettings(); });
    const lyricsColorInput = page.querySelector("[data-lyrics-color]");
    const lyricsColor2Input = page.querySelector("[data-lyrics-color-2]");
    const lyricsGradientInput = page.querySelector("[data-lyrics-gradient]");
    lyricsColorInput.value = settings.lyricsColor;
    lyricsColor2Input.value = settings.lyricsColor2;
    lyricsGradientInput.checked = Boolean(settings.lyricsGradient);
    const saveLyricsSettings = () => {
      settings.lyricsColor = lyricsColorInput.value;
      settings.lyricsColor2 = lyricsColor2Input.value;
      settings.lyricsGradient = lyricsGradientInput.checked;
      document.documentElement.classList.toggle("mac-glass-lyrics-gradient", settings.lyricsGradient);
      applySettings(); saveSettings();
    };
    lyricsColorInput.addEventListener("input", saveLyricsSettings);
    lyricsColor2Input.addEventListener("input", saveLyricsSettings);
    lyricsGradientInput.addEventListener("change", saveLyricsSettings);
    const playbackBackgroundInput = page.querySelector("[data-playback-background]");
    playbackBackgroundInput.value = settings.playbackBackground;
    playbackBackgroundInput.addEventListener("input", () => {
      settings.playbackBackground = playbackBackgroundInput.value; applySettings(); saveSettings();
    });

    page.querySelector("[data-reset]").addEventListener("click", () => {
      settings = { ...DEFAULTS }; saveSettings(); installStyle();
      desktopGlassInput.checked = settings.nativeWindow;
      whiteTextInput.checked = false;
      textColorInput.value = settings.textColor;
      textColor2Input.value = settings.textColor2;
      gradientTextInput.checked = false;
      lyricsColorInput.value = settings.lyricsColor;
      lyricsColor2Input.value = settings.lyricsColor2;
      lyricsGradientInput.checked = false;
      playbackBackgroundInput.value = settings.playbackBackground;
      updateAvailableControls();
      page.querySelectorAll("input[type=range]").forEach((input) => {
        const key = input.parentElement.parentElement.dataset.setting;
        input.value = settings[key]; input.dispatchEvent(new Event("input"));
      });
    });
    return page;
  }

  installStyle();
  syncAlbumBackground();
  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const playbackObserver = new MutationObserver((records) => {
    if (records.some((record) => record.target !== document.documentElement)) scheduleSync();
  });
  playbackObserver.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class", "style", "hidden"] });
  // Hover can alter a backplate with no DOM mutation. Recheck the portal before
  // the next paint; the native Alpha itself does not change on hover.
  document.addEventListener("pointerover", markPlaybackSurface, { passive: true });
  document.addEventListener("transitionend", scheduleSync, { passive: true });
  document.addEventListener("click", openProjectLink, true);
  document.addEventListener("click", onStartUsing, true);
  window.addEventListener("resize", scheduleSync, { passive: true });
  const nativeTimer = setInterval(syncNative, 1000);
  window.__macGlassTheme = { dispose() {
    disposed = true; observer.disconnect(); playbackObserver.disconnect(); clearTimeout(syncTimer); clearInterval(nativeTimer);
    window.removeEventListener("resize", scheduleSync); configPages.clear();
    document.removeEventListener("pointerover", markPlaybackSurface);
    document.removeEventListener("transitionend", scheduleSync);
    document.removeEventListener("click", openProjectLink, true);
    document.removeEventListener("click", onStartUsing, true);
    clearTimeout(settingsNavigationTimer); pendingSettingsNavigation = null;
    document.querySelectorAll("[data-cccy9-project-link]").forEach((element) => element.removeAttribute("data-cccy9-project-link"));
    document.querySelectorAll("[data-mac-glass-home-hidden],[data-mac-glass-playback-surface],[data-mac-glass-lyric-text]").forEach((element) => {
      element.removeAttribute("data-mac-glass-home-hidden"); element.removeAttribute("data-mac-glass-playback-surface"); element.removeAttribute("data-mac-glass-lyric-text");
    });
  }};

  if (typeof plugin !== "undefined" && plugin.onConfig) {
    plugin.onConfig(() => makeConfigPage());
  }
})();
