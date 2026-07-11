/**
 * This is the BetterStremio Loader, responsible for activating plugins and themes.
 *
 * It supports both Stremio UIs:
 *  - "v5": the current desktop UI (https://web.stremio.com/) used by the new
 *    Stremio 5 shell — BetterStremio adds a floating button + management panel.
 *  - "v4": the classic v4.4 web UI used by the old Stremio 4.x shells —
 *    BetterStremio adds a "BetterStremio" tab (original behavior).
 *
 * @see {@link https://github.com/motoemoto47ark123/BetterStremio} for further instructions.
 */

(function boot() {
  BetterStremio.version = "1.1.1";
  BetterStremio.errors = [];

  const IS_V5 = BetterStremio.webui === "v5";

  BetterStremio.Data = {
    store: (plugin, key, value) =>
      localStorage.setItem(`BetterStremio!${plugin}!${key}`, value),
    read: (plugin, key) =>
      localStorage.getItem(`BetterStremio!${plugin}!${key}`),
    delete: (plugin, key) =>
      localStorage.removeItem(`BetterStremio!${plugin}!${key}`),
  };

  BetterStremio.Plugins = {
    enable: (plugin) => {
      if (BetterStremio.Internal.enabledPlugins.includes(plugin)) return;
      BetterStremio.Internal.enabledPlugins.push(plugin);
      BetterStremio.Data.delete("disabled-plugins", plugin);
      try {
        BetterStremio.Internal.plugins[plugin]?.onEnable?.();
      } catch (e) {
        console.error(
          `[BetterStremio] Plugin '${plugin}' threw an exception at onEnable:`,
          e,
        );
        BetterStremio.errors.push(["onEnable", e]);
      }
    },
    disable: (plugin) => {
      if (!BetterStremio.Internal.enabledPlugins.includes(plugin)) return;
      BetterStremio.Internal.enabledPlugins = BetterStremio.Internal
        .enabledPlugins.filter((e) => e !== plugin);
      BetterStremio.Data.store("disabled-plugins", plugin, "1");
      try {
        BetterStremio.Internal.plugins[plugin]?.onDisable?.();
      } catch (e) {
        console.error(
          `[BetterStremio] Plugin '${plugin}' threw an exception at onDisable:`,
          e,
        );
        BetterStremio.errors.push(["onDisable", e]);
      }
    },
    reload: async () => {
      BetterStremio.Internal.enabledPlugins.forEach((plugin) => {
        try {
          BetterStremio.Internal.plugins[plugin]?.onDisable?.();
        } catch (e) {
          console.error(
            `[BetterStremio] Plugin '${plugin}' threw an exception at onDisable:`,
            e,
          );
          BetterStremio.errors.push(["onDisable", e]);
        }
      });
      BetterStremio.Internal.reloadInfo();
      BetterStremio.Internal.enabledPlugins.forEach((plugin) => {
        try {
          BetterStremio.Internal.plugins[plugin]?.onEnable?.();
        } catch (e) {
          console.error(
            `[BetterStremio] Plugin '${plugin}' threw an exception at onEnable:`,
            e,
          );
          BetterStremio.errors.push(["onEnable", e]);
        }
      });
      await checkPluginUpdates();
      BetterStremio.Internal.reloadUI();
    },
  };

  BetterStremio.Themes = {
    enable: (theme, preserve = true) => {
      const textArea = document.createElement("textarea");
      textArea.innerText = theme;
      const themeEscaped = textArea.innerHTML;

      if (!document.getElementById(`theme-${themeEscaped}`)) {
        const content = BetterStremio.Internal.themes[theme]?.content || "";
        const style = document.createElement("style");
        document.head.appendChild(style);
        style.id = `theme-${themeEscaped}`;
        style.type = "text/css";
        style.appendChild(document.createTextNode(content));
      }

      if (preserve && !BetterStremio.Internal.enabledThemes.includes(theme)) {
        BetterStremio.Internal.enabledThemes.push(theme);
        BetterStremio.Data.delete("disabled-themes", theme);
      }
    },
    disable: (theme, preserve = true) => {
      const textArea = document.createElement("textarea");
      textArea.innerText = theme;
      const themeEscaped = textArea.innerHTML;

      const sheet = document.getElementById(`theme-${themeEscaped}`);
      if (sheet) sheet.remove();

      if (preserve && BetterStremio.Internal.enabledThemes.includes(theme)) {
        BetterStremio.Internal.enabledThemes = BetterStremio.Internal
          .enabledThemes.filter((e) => e !== theme);
        BetterStremio.Data.store("disabled-themes", theme, "1");
      }
    },
    reload: async () => {
      BetterStremio.Internal.enabledThemes.forEach((theme) =>
        BetterStremio.Themes.disable(theme, false)
      );
      BetterStremio.Internal.reloadInfo();
      BetterStremio.Internal.enabledThemes.forEach((theme) =>
        BetterStremio.Themes.enable(theme, false)
      );
      await checkThemeUpdates();
      BetterStremio.Internal.reloadUI();
    },
  };

  function parseTheme(content) {
    return {
      getName: () => (/@name (.*?)$/m.exec(content) || [])[1],
      getDescription: () => (/@description (.*?)$/m.exec(content) || [])[1],
      getImage: () => (/@image (.*?)$/m.exec(content) || [])[1],
      getUpdateURL: () => (/@updateUrl (.*?)$/m.exec(content) || [])[1],
      getShareURL: () =>
        (/@shareUrl (.*?)$/m.exec(content) || [])[1] ||
        (/@updateUrl (.*?)$/m.exec(content) || [])[1],
      getVersion: () => (/@version (.*?)$/m.exec(content) || [])[1],
      getAuthor: () => (/@author (.*?)$/m.exec(content) || [])[1],
      content,
    };
  }

  BetterStremio.Internal = {
    fetch: (route = "/", async = true) => {
      if (async) {
        const noCache = "v=" + Date.now();
        const updateURL = BetterStremio.host + route;
        const updateURLNoCache = updateURL.includes("?")
          ? updateURL + "&" + noCache
          : updateURL + "?" + noCache;
        return fetch(updateURLNoCache, {
          body: null,
          method: "GET",
        });
      }

      const request = new XMLHttpRequest();
      request.open("GET", BetterStremio.host + route, false);
      request.send(null);
      return request?.responseText;
    },
    update: (filename, sourceUrl) => {
      return fetch(
        `${BetterStremio.host}/update/${filename}?from=${
          encodeURIComponent(sourceUrl)
        }`,
        { body: null, method: "POST" },
      );
    },
    reloadInfo: () => {
      const info = JSON.parse(BetterStremio.Internal.fetch("/", false));
      const plugins = info.plugins.map((plugin) => [
        plugin,
        BetterStremio.Internal.fetch(`/src/plugins/${plugin}`, false),
      ]);
      const themes = info.themes.map((theme) => [
        theme,
        parseTheme(BetterStremio.Internal.fetch(`/src/themes/${theme}`, false)),
      ]);
      const enabledPlugins = info.plugins.filter(
        (plugin) => BetterStremio.Data.read("disabled-plugins", plugin) !== "1",
      );
      const enabledThemes = info.themes.filter(
        (theme) => BetterStremio.Data.read("disabled-themes", theme) !== "1",
      );
      const compiledPlugins = [];
      BetterStremio.errors = [];

      for (const [pluginName, pluginSource] of plugins) {
        try {
          const PluginModule = new Function(
            `let module = { exports: {} };let exports = module.exports; return ${pluginSource}\n//# sourceURL=${BetterStremio.host}/src/plugins/${pluginName}`,
          )();
          compiledPlugins.push([pluginName, new PluginModule()]);
        } catch (e) {
          var err = e.constructor(
            `[BetterStremio] Plugin '${pluginName}' failed to compile: ${e.message}`,
          );
          console.error(err);
          BetterStremio.errors.push(["onImport", e]);
          const PluginModule = new Function(
            `let module = { exports: class InvalidPlugin { getName = () => "${pluginName}"; getDescription = () => "This plugin failed to compile. Please check the console and/or BetterStremio plugin template for more information." } };let exports = module.exports; return module.exports;\n//# sourceURL=${BetterStremio.host}/src/plugins/${pluginName}`,
          )();
          compiledPlugins.push([pluginName, new PluginModule()]);
        }
      }

      BetterStremio.Internal.enabledPlugins = enabledPlugins;
      BetterStremio.Internal.enabledThemes = enabledThemes;
      BetterStremio.Internal.plugins = Object.fromEntries(compiledPlugins);
      BetterStremio.Internal.themes = Object.fromEntries(themes);
      return BetterStremio.Internal;
    },
    reloadUI: () => {
      if (IS_V5) return reloadV5UI();
      return reloadV4UI();
    },
  };

  const info = BetterStremio.Internal.reloadInfo();

  info.enabledPlugins.forEach((plugin) => {
    try {
      info.plugins[plugin].onBoot?.();
    } catch (e) {
      console.error(
        `[BetterStremio] Plugin '${plugin}' threw an exception at onBoot:`,
        e,
      );
      BetterStremio.errors.push(["onBoot", e]);
    }
  });

  function countUpdates() {
    return Object.values(BetterStremio.Internal.plugins).filter((p) =>
      p.bsUpdateAvailable
    ).length +
      Object.values(BetterStremio.Internal.themes).filter((t) =>
        t.bsUpdateAvailable
      ).length;
  }

  async function updateEntry(type, name) {
    const context = type === "plugins"
      ? BetterStremio.Plugins
      : BetterStremio.Themes;
    const enabledValues = type === "plugins"
      ? BetterStremio.Internal.enabledPlugins
      : BetterStremio.Internal.enabledThemes;
    const entries = type === "plugins"
      ? BetterStremio.Internal.plugins
      : BetterStremio.Internal.themes;
    const isEnabled = enabledValues.includes(name);
    if (isEnabled) context.disable(name);
    const updateURL = entries[name]?.getUpdateURL?.();
    if (!updateURL) return;
    await BetterStremio.Internal.update(`${type}/${name}`, updateURL);
    BetterStremio.Internal.reloadInfo();
    if (isEnabled) context.enable(name);
    await checkPluginUpdates();
    await checkThemeUpdates();
    BetterStremio.Internal.reloadUI();
    const entry = type === "plugins"
      ? BetterStremio.Internal.plugins[name]
      : BetterStremio.Internal.themes[name];
    BetterStremio.Toasts?.info?.(
      `Updated ${type === "plugins" ? "Plugin" : "Theme"} "${
        entry?.getName?.() || name
      }" to v${entry?.getVersion?.() || "?"}`,
    );
  }

  function copyToClipboard(text) {
    const fallback = () => {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
      } finally {
        textArea.remove();
      }
    };
    try {
      navigator.clipboard.writeText(text).catch(fallback);
    } catch (_e) {
      fallback();
    }
  }

  function isNewerVersion(remote, local) {
    const remoteParts = String(remote).split(".").map((n) =>
      parseInt(n, 10) || 0
    );
    const localParts = String(local).split(".").map((n) => parseInt(n, 10) || 0);
    const length = Math.max(remoteParts.length, localParts.length);
    for (let i = 0; i < length; i++) {
      if ((remoteParts[i] || 0) > (localParts[i] || 0)) return true;
      if ((remoteParts[i] || 0) < (localParts[i] || 0)) return false;
    }
    return false;
  }

  async function checkForUpdates() {
    const updateURL =
      "https://raw.githubusercontent.com/motoemoto47ark123/BetterStremio/main/BetterStremio.loader.js";

    const noCache = "v=" + Date.now();
    const updateURLNoCache = updateURL.includes("?")
      ? updateURL + "&" + noCache
      : updateURL + "?" + noCache;

    fetch(updateURLNoCache, {
      body: null,
      method: "GET",
    })
      .then(async (res) => {
        const loader = await res.text();
        const match = /BetterStremio\.version\s*=\s*"(.*?)"/gm.exec(loader);
        // Only upgrade on a strictly newer version: CDN caches may still
        // serve older loaders, which previously caused downgrade loops.
        if (
          match && match[1] && isNewerVersion(match[1], BetterStremio.version)
        ) {
          await BetterStremio.Internal.update(
            "BetterStremio.loader.js",
            updateURLNoCache,
          );
          BetterStremio.Toasts?.info?.(
            "BetterStremio update available!",
            `Close Stremio from system tray and reopen to upgrade to v${
              match[1]
            }.`,
          );
        } else if (match && match[1]) {
          console.log(`[BetterStremio] Running latest version. (v${match[1]})`);
        } else {
          console.error(
            `[BetterStremio] Couldn't fetch version from loader content:`,
            loader,
          );
        }
      })
      .catch((e) => {
        console.error("[BetterStremio] Failed to check for updates", e);
      });

    await checkPluginUpdates();
    await checkThemeUpdates();
    BetterStremio.Internal.reloadUI();
  }

  async function checkPluginUpdates() {
    for (
      const [pluginName, plugin] of Object.entries(
        BetterStremio.Internal.plugins,
      )
    ) {
      try {
        const updateURL = plugin.getUpdateURL();
        if (!updateURL) continue;
        const noCache = "v=" + Date.now();
        const updateURLNoCache = updateURL.includes("?")
          ? updateURL + "&" + noCache
          : updateURL + "?" + noCache;

        const res = await fetch(updateURLNoCache, {
          body: null,
          method: "GET",
        });
        const pluginSource = await res.text();
        if (!pluginSource) continue;

        const PluginModule = new Function(
          `return (function() {
            "use strict";
            return function() {
                  const window = undefined;
                  const document = undefined;
                  let module = { exports: {} };
                  let exports = module.exports;
                  return (function() {
                    return ${pluginSource}\n//# sourceURL=${updateURL}
                  }).call(this);
              };
            })`,
        )();
        const newPlugin = new (PluginModule()())();
        if (newPlugin.getVersion() !== plugin.getVersion()) {
          console.log(
            'Update for plugin "' + pluginName + '" available:',
            plugin.getVersion(),
            "~>",
            newPlugin.getVersion(),
          );
          plugin.bsUpdateAvailable = true;
        }
      } catch (e) {
        console.error(
          `[BetterStremio] Plugin '${pluginName}' threw an exception at update check:`,
          e,
        );
        BetterStremio.errors.push(["updateCheck", e]);
      }
    }
  }

  async function checkThemeUpdates() {
    for (
      const [themeName, theme] of Object.entries(
        BetterStremio.Internal.themes,
      )
    ) {
      try {
        const updateURL = theme.getUpdateURL();
        if (!updateURL) continue;
        const noCache = "v=" + Date.now();
        const updateURLNoCache = updateURL.includes("?")
          ? updateURL + "&" + noCache
          : updateURL + "?" + noCache;
        const res = await fetch(updateURLNoCache, {
          body: null,
          method: "GET",
        });
        const loader = await res.text();
        if (!loader) continue;
        const newTheme = parseTheme(loader);
        if (newTheme.getVersion() !== theme.getVersion()) {
          console.log(
            'Update for theme "' + themeName + '" available:',
            theme.getVersion(),
            "~>",
            newTheme.getVersion(),
          );
          theme.bsUpdateAvailable = true;
        }
      } catch (e) {
        console.error(
          `[BetterStremio] Theme '${themeName}' threw an exception at update check:`,
          e,
        );
        BetterStremio.errors.push(["updateCheck", e]);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Stremio 5 UI (https://web.stremio.com/) — floating button + panel   */
  /* ------------------------------------------------------------------ */

  const BS_ICON =
    `<g fill="currentColor"><g transform="scale(5.12,5.12)"><path d="M14,4c-1.105,0 -2,0.895 -2,2v15h-0.5c-4.67666,0 -8.5,3.82334 -8.5,8.5c-0.00765,0.54095 0.27656,1.04412 0.74381,1.31683c0.46725,0.27271 1.04514,0.27271 1.51238,0c0.46725,-0.27271 0.75146,-0.77588 0.74381,-1.31683c0,-3.05534 2.44466,-5.5 5.5,-5.5h0.5v13c0,1.105 0.895,2 2,2h4v6.5c-0.00765,0.54095 0.27656,1.04412 0.74381,1.31683c0.46725,0.27271 1.04514,0.27271 1.51238,0c0.46725,-0.27271 0.75146,-0.77588 0.74381,-1.31683v-6.5h8v6.5c-0.00765,0.54095 0.27656,1.04412 0.74381,1.31683c0.46725,0.27271 1.04514,0.27271 1.51238,0c0.46725,-0.27271 0.75146,-0.77588 0.74381,-1.31683v-6.5h4c1.105,0 2,-0.895 2,-2v-13h0.5c0.21371,0.00241 0.42547,-0.04088 0.62109,-0.12695c4.37381,-0.33661 7.87891,-3.91645 7.87891,-8.37305c0.00582,-0.40562 -0.15288,-0.7963 -0.43991,-1.08296c-0.28703,-0.28666 -0.67792,-0.44486 -1.08353,-0.43852c-0.82766,0.01293 -1.48843,0.69381 -1.47656,1.52148c0,3.05534 -2.44466,5.5 -5.5,5.5h-0.5v-15c0,-1.105 -0.895,-2 -2,-2zM17,8h16c0.552,0 1,0.448 1,1v9c0,0.552 -0.448,1 -1,1h-16c-0.552,0 -1,-0.448 -1,-1v-9c0,-0.552 0.448,-1 1,-1zM20,11c-0.55228,0 -1,0.44772 -1,1c0,0.55228 0.44772,1 1,1c0.55228,0 1,-0.44772 1,-1c0,-0.55228 -0.44772,-1 -1,-1zM30,11c-0.55228,0 -1,0.44772 -1,1c0,0.55228 0.44772,1 1,1c0.55228,0 1,-0.44772 1,-1c0,-0.55228 -0.44772,-1 -1,-1zM23,14c0,1.105 0.895,2 2,2c1.105,0 2,-0.895 2,-2zM16,22h11v2h-11zM32,22c0.552,0 1,0.448 1,1c0,0.552 -0.448,1 -1,1c-0.552,0 -1,-0.448 -1,-1c0,-0.552 0.448,-1 1,-1zM18,26h2v2h2v2h-2v2h-2v-2h-2v-2h2zM29,26l2,3h-4zM34,27c0.552,0 1,0.448 1,1c0,0.552 -0.448,1 -1,1c-0.552,0 -1,-0.448 -1,-1c0,-0.552 0.448,-1 1,-1zM31.5,31c1.381,0 2.5,1.119 2.5,2.5c0,1.381 -1.119,2.5 -2.5,2.5c-1.381,0 -2.5,-1.119 -2.5,-2.5c0,-1.381 1.119,-2.5 2.5,-2.5zM17,34h2c0.553,0 1,0.448 1,1c0,0.552 -0.447,1 -1,1h-2c-0.553,0 -1,-0.448 -1,-1c0,-0.552 0.447,-1 1,-1zM23,34h2c0.553,0 1,0.448 1,1c0,0.552 -0.447,1 -1,1h-2c-0.553,0 -1,-0.448 -1,-1c0,-0.552 0.447,-1 1,-1z"></path></g></g>`;

  const V5_EMPTY_IMAGE =
    "data:image/svg+xml;base64," + btoa(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="#221f36"/><g transform="translate(48,48)" fill="#7b5bf5">${BS_ICON.replace(/currentColor/g, "#7b5bf5")}</g></svg>`,
    );

  const escapeHtml = (value) =>
    String(value == null ? "" : value).replace(
      /[&<>"']/g,
      (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c]),
    );

  let v5Tab = "plugins";

  function setupV5Toasts() {
    const container = document.createElement("div");
    container.id = "betterstremio-toasts";
    document.body.appendChild(container);

    const show = (accent) => (title, desc) => {
      const toast = document.createElement("div");
      toast.className = "bs-toast";
      toast.style.borderLeftColor = accent;
      toast.innerHTML = `<b>${escapeHtml(title)}</b>${
        desc ? `<span>${escapeHtml(desc)}</span>` : ""
      }`;
      container.appendChild(toast);
      setTimeout(() => toast.classList.add("bs-toast-visible"), 20);
      setTimeout(() => {
        toast.classList.remove("bs-toast-visible");
        setTimeout(() => toast.remove(), 400);
      }, 6000);
    };

    BetterStremio.Toasts = {
      error: show("#dd2232"),
      info: show("#7b5bf5"),
      success: show("#1fb87c"),
      warning: show("#e8a316"),
    };
  }

  const V5_CSS = `
#betterstremio-fab { position: fixed; left: 14px; bottom: 14px; width: 46px; height: 46px; border-radius: 50%; background: linear-gradient(135deg, #4a3d9e, #7b5bf5); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 999990; box-shadow: 0 4px 14px rgba(0,0,0,.55); transition: transform .15s ease, box-shadow .15s ease; }
#betterstremio-fab:hover { transform: scale(1.08); box-shadow: 0 6px 18px rgba(123,91,245,.55); }
#betterstremio-fab svg { width: 26px; height: 26px; pointer-events: none; }
#betterstremio-fab .bs-badge { position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: #dd2232; color: #fff; font-size: 11px; font-weight: 700; line-height: 18px; text-align: center; font-family: sans-serif; }
#betterstremio-overlay { position: fixed; inset: 0; background: rgba(8,7,14,.75); backdrop-filter: blur(4px); z-index: 999991; display: none; }
#betterstremio-overlay.bs-open { display: block; }
#betterstremio-panel { position: absolute; top: 5vh; left: 50%; transform: translateX(-50%); width: min(960px, 92vw); height: 90vh; background: #14121f; border: 1px solid #2c2844; border-radius: 14px; display: flex; flex-direction: column; overflow: hidden; color: #e6e4f2; font-family: 'PlusJakartaSans', 'Plus Jakarta Sans', system-ui, sans-serif; }
.bs-panel-header { display: flex; align-items: center; gap: 14px; padding: 16px 20px; border-bottom: 1px solid #2c2844; }
.bs-panel-header svg { width: 30px; height: 30px; color: #a78bfa; flex-shrink: 0; }
.bs-panel-title { font-size: 20px; font-weight: 400; background: linear-gradient(90deg, #c4b5fd, #8b5cf6); -webkit-background-clip: text; background-clip: text; color: transparent; white-space: nowrap; }
.bs-panel-title b { font-weight: 800; }
.bs-panel-version { font-size: 11px; color: #7f7a99; margin-top: 3px; }
.bs-panel-version a { color: palegoldenrod; cursor: pointer; text-decoration: none; }
.bs-tabs { display: flex; gap: 4px; margin-left: 18px; }
.bs-tab { padding: 7px 18px; border-radius: 20px; cursor: pointer; font-size: 14px; color: #b5b1cc; background: transparent; border: 1px solid transparent; }
.bs-tab:hover { background: #1e1b30; }
.bs-tab.bs-active { background: #2c2844; color: #fff; border-color: #423d63; }
.bs-header-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; }
.bs-action { padding: 7px 14px; border-radius: 8px; background: #1e1b30; border: 1px solid #2c2844; color: #cfcbe4; font-size: 13px; cursor: pointer; white-space: nowrap; }
.bs-action:hover { background: #262239; color: #fff; }
.bs-close { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 8px; cursor: pointer; color: #b5b1cc; font-size: 20px; line-height: 1; }
.bs-close:hover { background: #262239; color: #fff; }
.bs-panel-list { flex: 1; overflow-y: auto; padding: 18px 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 14px; align-content: start; }
.bs-empty { grid-column: 1 / -1; text-align: center; color: #7f7a99; padding: 60px 0 0; font-size: 14px; }
.bs-empty b { color: #a78bfa; }
.bs-card { display: flex; gap: 14px; background: #1a172a; border: 1px solid #2c2844; border-radius: 12px; padding: 14px; }
.bs-card img { width: 58px; height: 58px; border-radius: 10px; object-fit: cover; background: #221f36; flex-shrink: 0; }
.bs-card-body { flex: 1; min-width: 0; }
.bs-card-title { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.bs-card-title h3 { margin: 0; font-size: 15px; font-weight: 700; color: #fff; overflow: hidden; text-overflow: ellipsis; }
.bs-card-title span { font-size: 11px; color: #7f7a99; }
.bs-card-author { font-size: 12px; color: #8f8aab; margin: 1px 0 4px; }
.bs-card-desc { font-size: 12.5px; color: #b5b1cc; line-height: 1.45; max-height: 55px; overflow: hidden; }
.bs-card-buttons { display: flex; flex-direction: column; gap: 6px; justify-content: center; flex-shrink: 0; }
.bs-btn { min-width: 92px; text-align: center; padding: 7px 12px; border-radius: 20px; font-size: 12.5px; font-weight: 600; cursor: pointer; border: none; }
.bs-btn-on { background: #7b5bf5; color: #fff; }
.bs-btn-on:hover { background: #6a4ce0; }
.bs-btn-off { background: #2c2844; color: #b5b1cc; }
.bs-btn-off:hover { background: #38335a; color: #fff; }
.bs-btn-small { background: transparent; color: #8f8aab; padding: 4px 12px; font-weight: 400; }
.bs-btn-small:hover { color: #fff; }
.bs-btn-update { position: relative; overflow: hidden; background: cornflowerblue; color: #fff; }
.bs-btn-update::after { content: ''; position: absolute; top: 0; left: -100%; width: 100%; height: 100%; background: linear-gradient(120deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.4) 50%, rgba(255,255,255,0) 100%); transform: skewX(-45deg); pointer-events: none; animation: bs-shine 2s linear infinite; }
@keyframes bs-shine { 0% { left: -100%; } 50% { left: 50%; } 100% { left: 200%; } }
#betterstremio-toasts { position: fixed; top: 18px; right: 18px; z-index: 999999; display: flex; flex-direction: column; gap: 10px; width: 320px; }
.bs-toast { background: #1a172a; border: 1px solid #2c2844; border-left: 4px solid #7b5bf5; border-radius: 10px; padding: 12px 14px; color: #e6e4f2; font-family: 'PlusJakartaSans', system-ui, sans-serif; font-size: 13px; box-shadow: 0 6px 18px rgba(0,0,0,.5); opacity: 0; transform: translateX(24px); transition: all .35s ease; display: flex; flex-direction: column; gap: 3px; }
.bs-toast b { font-size: 13.5px; }
.bs-toast span { color: #b5b1cc; font-size: 12.5px; }
.bs-toast-visible { opacity: 1; transform: translateX(0); }
`;

  function renderV5List() {
    const list = document.getElementById("betterstremio-list");
    if (!list) return;
    const entries = v5Tab === "plugins"
      ? BetterStremio.Internal.plugins
      : BetterStremio.Internal.themes;
    const enabledValues = v5Tab === "plugins"
      ? BetterStremio.Internal.enabledPlugins
      : BetterStremio.Internal.enabledThemes;

    const names = Object.keys(entries);
    if (names.length === 0) {
      list.innerHTML = `<div class="bs-empty">No ${v5Tab} installed yet.<br/>` +
        `Drop <b>${
          v5Tab === "plugins" ? ".plugin.js" : ".theme.css"
        }</b> files into the <b>${v5Tab}</b> folder (button above), then hit Reload.</div>`;
      return;
    }

    list.innerHTML = names.map((name) => {
      const entry = entries[name];
      const enabled = enabledValues.includes(name);
      const image = entry?.getImage?.() || V5_EMPTY_IMAGE;
      const title = entry?.getName?.() || name;
      const version = entry?.getVersion?.() || "0.0.0";
      const author = entry?.getAuthor?.() || "unknown";
      const description = entry?.getDescription?.() || "";
      const hasSettings = typeof entry?.onSettings === "function";
      const hasShare = Boolean(
        entry?.getShareURL?.() || entry?.getUpdateURL?.(),
      );
      const hasUpdate = Boolean(entry?.bsUpdateAvailable);
      const encodedName = encodeURIComponent(name);
      return `<div class="bs-card">
        <img alt="Logo" src="${escapeHtml(image)}" onerror="this.src='${V5_EMPTY_IMAGE}'"/>
        <div class="bs-card-body">
          <div class="bs-card-title"><h3>${escapeHtml(title)}</h3><span>v${
        escapeHtml(version)
      }</span></div>
          <div class="bs-card-author">By: @${escapeHtml(author)}</div>
          <div class="bs-card-desc">${escapeHtml(description)}</div>
        </div>
        <div class="bs-card-buttons">
          ${
        hasUpdate
          ? `<button class="bs-btn bs-btn-update" data-action="update" data-name="${encodedName}">Update</button>`
          : ""
      }
          <button class="bs-btn ${
        enabled ? "bs-btn-on" : "bs-btn-off"
      }" data-action="toggle" data-name="${encodedName}">${
        enabled ? "Enabled" : "Disabled"
      }</button>
          ${
        hasSettings
          ? `<button class="bs-btn bs-btn-small" data-action="settings" data-name="${encodedName}">Settings</button>`
          : ""
      }
          ${
        hasShare
          ? `<button class="bs-btn bs-btn-small" data-action="share" data-name="${encodedName}">Share</button>`
          : ""
      }
        </div>
      </div>`;
    }).join("");
  }

  function reloadV5UI() {
    const badge = document.getElementById("betterstremio-fab-badge");
    if (badge) {
      const updateCount = countUpdates();
      badge.style.display = updateCount > 0 ? "block" : "none";
      badge.innerText = updateCount > 9 ? "9+" : String(updateCount);
    }
    const pluginsTab = document.getElementById("betterstremio-tab-plugins");
    const themesTab = document.getElementById("betterstremio-tab-themes");
    if (pluginsTab && themesTab) {
      pluginsTab.classList.toggle("bs-active", v5Tab === "plugins");
      themesTab.classList.toggle("bs-active", v5Tab === "themes");
    }
    renderV5List();
  }

  function setupV5UI() {
    if (document.getElementById("betterstremio-fab")) return;

    const style = document.createElement("style");
    style.id = "betterstremio-v5-style";
    style.appendChild(document.createTextNode(V5_CSS));
    document.head.appendChild(style);

    setupV5Toasts();

    const fab = document.createElement("div");
    fab.id = "betterstremio-fab";
    fab.title = "BetterStremio (Ctrl+Shift+B)";
    fab.innerHTML =
      `<svg viewBox="0 0 256 256">${BS_ICON}</svg><span class="bs-badge" id="betterstremio-fab-badge" style="display:none"></span>`;
    document.body.appendChild(fab);

    const overlay = document.createElement("div");
    overlay.id = "betterstremio-overlay";
    overlay.innerHTML = `<div id="betterstremio-panel">
      <div class="bs-panel-header">
        <svg viewBox="0 0 256 256">${BS_ICON}</svg>
        <div>
          <div class="bs-panel-title">Better<b>Stremio</b></div>
          <div class="bs-panel-version">v${BetterStremio.version} · <a data-action="changelog">changelog</a></div>
        </div>
        <div class="bs-tabs">
          <div class="bs-tab bs-active" id="betterstremio-tab-plugins" data-action="tab" data-tab="plugins">Plugins</div>
          <div class="bs-tab" id="betterstremio-tab-themes" data-action="tab" data-tab="themes">Themes</div>
        </div>
        <div class="bs-header-actions">
          <div class="bs-action" data-action="reload">Reload</div>
          <div class="bs-action" data-action="folder">Open folder</div>
          <div class="bs-close" data-action="close">✕</div>
        </div>
      </div>
      <div class="bs-panel-list" id="betterstremio-list"></div>
    </div>`;
    document.body.appendChild(overlay);

    const openPanel = () => {
      overlay.classList.add("bs-open");
      reloadV5UI();
    };
    const closePanel = () => overlay.classList.remove("bs-open");

    fab.addEventListener("click", openPanel);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) return closePanel();
      const actionEl = event.target.closest("[data-action]");
      if (!actionEl) return;
      const action = actionEl.getAttribute("data-action");
      const name = actionEl.getAttribute("data-name")
        ? decodeURIComponent(actionEl.getAttribute("data-name"))
        : null;
      const context = v5Tab === "plugins"
        ? BetterStremio.Plugins
        : BetterStremio.Themes;
      const entries = v5Tab === "plugins"
        ? BetterStremio.Internal.plugins
        : BetterStremio.Internal.themes;
      const enabledValues = v5Tab === "plugins"
        ? BetterStremio.Internal.enabledPlugins
        : BetterStremio.Internal.enabledThemes;

      switch (action) {
        case "close":
          return closePanel();
        case "tab":
          v5Tab = actionEl.getAttribute("data-tab");
          return reloadV5UI();
        case "reload":
          return Promise.resolve(BetterStremio.Themes.reload())
            .then(() => BetterStremio.Plugins.reload())
            .then(() =>
              BetterStremio.Toasts?.success?.("Plugins & themes reloaded")
            );
        case "folder":
          return BetterStremio.Internal.fetch("/folder");
        case "changelog":
          return BetterStremio.Internal.fetch("/changelog");
        case "toggle": {
          if (!name) return;
          if (enabledValues.includes(name)) context.disable(name);
          else context.enable(name);
          return reloadV5UI();
        }
        case "settings": {
          if (!name) return;
          try {
            entries[name]?.onSettings?.();
          } catch (e) {
            console.error(
              `[BetterStremio] Plugin '${name}' threw an exception at onSettings:`,
              e,
            );
            BetterStremio.errors.push(["onSettings", e]);
          }
          return;
        }
        case "share": {
          if (!name) return;
          const url = entries[name]?.getShareURL?.() ||
            entries[name]?.getUpdateURL?.();
          if (!url) return;
          copyToClipboard(url);
          return BetterStremio.Toasts?.success?.(
            "Link copied to clipboard",
            url,
          );
        }
        case "update": {
          if (!name) return;
          return updateEntry(v5Tab, name);
        }
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && overlay.classList.contains("bs-open")) {
        closePanel();
      }
      if (
        (event.ctrlKey || event.metaKey) && event.shiftKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault();
        if (overlay.classList.contains("bs-open")) closePanel();
        else openPanel();
      }
    });

    reloadV5UI();
  }

  /* ------------------------------------------------------------------ */
  /* Classic v4.4 UI — original BetterStremio tab (Angular)              */
  /* ------------------------------------------------------------------ */

  function reloadV4UI() {
    BetterStremio.Scopes?.betterStremioCtrl?.$state?.reload?.();
    document.querySelector("#bs-notification-count")?.remove?.();
    const updateCount = countUpdates();

    if (updateCount > 0) {
      document.querySelector('[ui-sref="betterstremio"]')?.insertAdjacentHTML?.(
        "beforeend",
        `<div id="bs-notification-count" style="position: absolute; top: -5px; right: -3px; background-color: #dd2232; color: white; height: 20px; border-radius: 50%; width: 20px; align-items: center; justify-content: center; font-weight: bold; line-height: 1; display: flex; font-size: 11px;">${
          updateCount > 9 ? "9+" : updateCount
        }</div>`,
      );
    }
  }

  function itemButton() {
    const emptyImage = V5_EMPTY_IMAGE;

    return `<div ng-repeat="(name, plugin) in type === 'plugins' ? plugins : themes" class="pure-u-1-4 addon ng-scope"><div class="addon-content"><div class="left-pane"><div class="addon-logo"><img alt="Logo" ng-src="{{plugin.getImage() || '${emptyImage}'}}"></div>
		  <div class="desc-row"><div class="heading"><h2 class="title">{{plugin.getName() || ""}}</h2>
		  <span class="version">v{{plugin.getVersion() || "0.0.0"}}</span></div>
		  <div class="addon-type">By: @{{plugin.getAuthor() || "unknown" }}</div>
		  <div class="description"><span class="ng-binding">{{plugin.getDescription() || ""}}</span></div></div></div><div class="right-pane">
		  <div class="buttons">
			  <a ng-hide="!plugin.onSettings" ng-class="!enabled(name) && 'remove'" ng-click="settings(name)" ng-title="translate('ADDON_CONFIGURE')" class="configure small"><svg icon="settings" class="icon" viewBox="0 0 512 512"><path d="M464 250a9.996 9.996 0 0 0-2.9-6.7 10.795 10.795 0 0 0-6.5-3.3l-25.6-4.2a5.867 5.867 0 0 1-3-1.6 5.693 5.693 0 0 1-1.5-3.1c-0.5-3.2-1-6.4-1.7-9.5a5.36 5.36 0 0 1 0.4-3.3 6.633 6.633 0 0 1 2.2-2.5l22.8-12.7c2.26-1.16 4.01-3.12 4.9-5.5 0.93-2.37 0.97-5 0.1-7.4l-3.9-10.9a10.6 10.6 0 0 0-4.8-5.6 10.285 10.285 0 0 0-7.3-0.9l-25.5 5c-1.16 0.18-2.34 0.01-3.4-0.5a5.34 5.34 0 0 1-2.4-2.3c-1.5-2.8-3.1-5.6-4.8-8.4-0.6-0.99-0.88-2.14-0.8-3.3 0.07-1.18 0.53-2.3 1.3-3.2l17-19.6c1.69-1.87 2.68-4.28 2.8-6.8 0.08-2.52-0.78-4.97-2.4-6.9l-7.4-8.9a10.298 10.298 0 0 0-13.6-2l-22.4 13.4c-1 0.58-2.15 0.83-3.3 0.7a5.24 5.24 0 0 1-3.1-1.4c-2.5-2.2-5-4.3-7.4-6.2a5.428 5.428 0 0 1-1.9-2.8c-0.28-1.13-0.21-2.31 0.2-3.4l9.3-24.4c0.99-2.33 1.1-4.95 0.31-7.36s-2.43-4.45-4.61-5.74l-10.1-5.9a10.34 10.34 0 0 0-7.3-1.2 9.96 9.96 0 0 0-6.2 4l-16.4 20.5a5.24 5.24 0 0 1-2.5 1.9c-1.02 0.33-2.13 0.26-3.1-0.2-0.6-0.2-5.8-2.4-9.8-3.7a5.508 5.508 0 0 1-2.7-2 5.31 5.31 0 0 1-1-3.2l0.4-26.1c0.15-2.55-0.63-5.08-2.2-7.1-1.55-2.01-3.8-3.36-6.3-3.8l-11.4-2c-2.49-0.4-5.04 0.09-7.2 1.4a10.49 10.49 0 0 0-4.5 5.8l-8.5 24.8a5.12 5.12 0 0 1-2.1 2.7c-0.98 0.64-2.13 0.96-3.3 0.9h-9.8c-1.15 0.04-2.28-0.31-3.2-1-0.97-0.66-1.7-1.6-2.1-2.7l-8.5-24.7c-0.71-2.43-2.32-4.51-4.5-5.8-2.16-1.3-4.71-1.79-7.2-1.4l-11.5 2c-2.48 0.48-4.72 1.83-6.3 3.8a9.968 9.968 0 0 0-2.2 7l0.4 26.2c-0.01 1.19-0.4 2.34-1.1 3.3-0.73 0.91-1.7 1.61-2.8 2-2.3 0.9-7.3 2.8-9.5 3.6-2 0.7-4.2-0.1-5.9-2.1l-16.3-20a9.96 9.96 0 0 0-6.2-4c-2.49-0.5-5.07-0.11-7.3 1.1l-10.1 5.8c-2.23 1.29-3.9 3.35-4.7 5.8-0.82 2.43-0.68 5.08 0.4 7.4l9.2 24.3c0.43 1.09 0.47 2.29 0.1 3.4-0.28 1.1-0.91 2.09-1.8 2.8-2.4 2-4.9 4-7.4 6.2-0.86 0.78-1.94 1.27-3.09 1.4-1.15 0.13-2.31-0.12-3.31-0.7l-22.1-13.7a10.68 10.68 0 0 0-7.2-1.6c-2.51 0.36-4.79 1.64-6.4 3.6l-7.4 8.9a10.224 10.224 0 0 0-2.4 6.9c0.1 2.53 1.09 4.94 2.8 6.8l17.1 19.6c0.77 0.9 1.23 2.02 1.3 3.2a5.47 5.47 0 0 1-0.8 3.3c-1.7 2.7-3.3 5.6-4.8 8.4a5.793 5.793 0 0 1-2.5 2.4c-1.05 0.51-2.24 0.69-3.4 0.5l-25.5-4.9a10.21 10.21 0 0 0-7.31 0.91c-2.24 1.2-3.94 3.19-4.79 5.59l-4 10.9c-0.92 2.39-0.88 5.04 0.1 7.4 0.92 2.36 2.66 4.31 4.9 5.5l22.8 12.7c1.01 0.57 1.81 1.45 2.3 2.5 0.49 1.06 0.6 2.27 0.3 3.4l-0.2 1.3c-0.5 2.8-1 5.4-1.5 8.2a5.716 5.716 0 0 1-1.5 3c-0.81 0.84-1.86 1.4-3 1.6l-25.7 4.2c-2.51 0.3-4.82 1.51-6.5 3.4a10.22 10.22 0 0 0-2.6 6.9v11.6c-0.01 2.54 0.91 4.99 2.59 6.89 1.67 1.9 3.99 3.11 6.51 3.41l25.7 4.1c1.15 0.18 2.21 0.75 3 1.6 0.81 0.85 1.33 1.94 1.5 3.1 0.5 3.2 1 6.4 1.7 9.5 0.21 1.15 0.08 2.33-0.4 3.4a6.633 6.633 0 0 1-2.2 2.5l-22.8 12.7a10.203 10.203 0 0 0-4.9 5.5c-0.88 2.38-0.92 5-0.1 7.4l4 10.9a10.6 10.6 0 0 0 4.8 5.6c2.24 1.19 4.84 1.52 7.3 0.9l25.6-4.9c1.16-0.23 2.36-0.05 3.4 0.5 1.02 0.5 1.86 1.3 2.4 2.3 1.5 2.8 3.1 5.6 4.8 8.4 0.6 0.99 0.88 2.14 0.8 3.3a5.39 5.39 0 0 1-1.3 3.2l-17 19.6a10.312 10.312 0 0 0-0.5 13.8l7.4 8.9a10.298 10.298 0 0 0 13.6 2l22.4-13.4c1-0.58 2.15-0.83 3.3-0.7 1.16 0.11 2.25 0.6 3.1 1.4 2.5 2.2 5 4.3 7.4 6.2 0.92 0.71 1.58 1.69 1.9 2.8 0.32 1.12 0.28 2.3-0.1 3.4l-9.3 24.4c-0.99 2.33-1.1 4.95-0.31 7.36s2.43 4.45 4.61 5.74l10.1 5.8c2.2 1.29 4.8 1.71 7.3 1.2a9.96 9.96 0 0 0 6.2-4l16.6-20.3c1.4-1.7 3.6-2.5 5.2-1.8 3.5 1.4 5.8 2.2 9.9 3.6 1.09 0.37 2.03 1.07 2.7 2a5.31 5.31 0 0 1 1 3.2l-0.4 26.1a11.3 11.3 0 0 0 2.2 7.1c1.55 2.01 3.8 3.36 6.3 3.8l11.4 2c2.49 0.41 5.04-0.09 7.2-1.4 2.18-1.29 3.79-3.37 4.5-5.8l8.5-24.8a5.12 5.12 0 0 1 2.1-2.7c0.95-0.69 2.13-1.01 3.3-0.9h9.8c1.15-0.04 2.28 0.32 3.2 1 0.97 0.66 1.7 1.6 2.1 2.7l8.5 24.7a10.662 10.662 0 0 0 10 7.4c0.6-0.02 1.21-0.08 1.8-0.2l11.5-2c2.49-0.47 4.72-1.82 6.3-3.8a9.968 9.968 0 0 0 2.2-7l-0.4-26.2c-0.04-1.15 0.31-2.28 1-3.2 0.69-0.91 1.63-1.6 2.7-2 3.8-1.3 6.5-2.3 8.9-3.2l0.6-0.2c3.1-1.1 4.6 0.2 5.5 1.3l16.8 20.6a10.278 10.278 0 0 0 13.5 2.8l10.1-5.8a9.948 9.948 0 0 0 4.6-5.7c0.8-2.42 0.7-5.05-0.3-7.4l-9.2-24.3a5.724 5.724 0 0 1-0.2-3.4 4.88 4.88 0 0 1 1.9-2.8c2.4-2 4.9-4 7.4-6.2 0.87-0.76 1.95-1.25 3.1-1.4 1.15-0.12 2.3 0.13 3.3 0.7l22.4 13.4a10.68 10.68 0 0 0 7.2 1.6c2.51-0.36 4.79-1.64 6.4-3.6l7.4-8.9c1.64-1.95 2.5-4.45 2.4-7-0.1-2.53-1.09-4.94-2.8-6.8l-17.1-19.7c-0.76-0.89-1.21-2-1.3-3.17-0.09-1.17 0.19-2.33 0.8-3.33 1.7-2.7 3.3-5.6 4.8-8.4a6.48 6.48 0 0 1 2.5-2.4c1.05-0.51 2.24-0.69 3.4-0.5l25.5 5c2.46 0.62 5.07 0.3 7.31-0.9 2.24-1.2 3.95-3.2 4.79-5.6l3.9-10.9c0.92-2.39 0.88-5.04-0.1-7.4-0.92-2.36-2.66-4.31-4.9-5.5l-22.8-12.7a5.568 5.568 0 0 1-2.3-2.5c-0.5-1.06-0.6-2.27-0.3-3.4l0.2-1.3c0.5-2.8 1-5.4 1.5-8.2 0.19-1.13 0.71-2.17 1.5-3 0.81-0.84 1.86-1.4 3-1.6l25.7-4.1c2.51-0.3 4.82-1.51 6.5-3.4 1.69-1.9 2.62-4.36 2.6-6.9v-11.8h-0.1Zm-282.4 94a15.52 15.52 0 0 1-5.1 5.4c-2.1 1.37-4.5 2.23-7 2.5-2.48 0.27-4.99-0.07-7.3-1-2.34-0.9-4.43-2.34-6.1-4.2a135.028 135.028 0 0 1-34.9-90.88 135.02 135.02 0 0 1 35.3-90.72c1.67-1.86 3.76-3.3 6.1-4.2 2.32-0.89 4.83-1.2 7.3-0.9 2.5 0.27 4.9 1.13 7 2.5a16.56 16.56 0 0 1 5.1 5.4l45.6 80.4c1.38 2.41 2.1 5.13 2.1 7.9 0 2.77-0.72 5.49-2.1 7.9l-46 79.9Zm74.4 47.2c-9.51 0-19-1-28.3-3a15.522 15.522 0 0 1-11-9.1c-0.97-2.27-1.41-4.73-1.3-7.2 0.13-2.47 0.85-4.87 2.1-7l46-80c1.4-2.4 3.4-4.4 5.8-5.8 2.4-1.39 5.13-2.12 7.9-2.1h92.1c2.47 0.01 4.9 0.59 7.1 1.7a15.9 15.9 0 0 1 5.6 4.7c1.47 2.02 2.46 4.34 2.9 6.8 0.39 2.44 0.22 4.94-0.5 7.3-17.5 54.2-68.4 93.7-128.4 93.7Zm7.5-163.9L218 147.0999999999999a17.248 17.248 0 0 1-2.1-7c-0.22-3.72 0.91-7.4 3.16-10.37 2.25-2.97 5.5-5.04 9.14-5.83 9.11-1.91 18.39-2.89 27.7-2.9 60 0 110.9 39.4 128.4 93.8 0.71 2.37 0.88 4.86 0.5 7.3-0.41 2.45-1.4 4.77-2.88 6.77-1.47 1.99-3.4 3.62-5.62 4.73-2.21 1.1-4.63 1.68-7.1 1.7h-92c-2.8 0-5.56-0.72-8-2.1-2.33-1.5-4.28-3.52-5.7-5.9Z" style="fill:currentcolor"></path></svg></a>
			  <a ng-hide="!enabled(name)" ng-click="disable(name)" class="install">Enabled</a>
			  <a ng-hide="enabled(name)" ng-click="enable(name)" class="remove">Disabled</a>
		  </div>
		  <div ng-hide="!plugin.getShareURL()" ng-click="share(name)" class="share"><svg icon="share" class="icon" viewBox="0 0 512 512"><path d="M396 459.9000000000001a68.732 68.732 0 0 1-69.2-67.7v-1.5l-138.3-45.6a78.017 78.017 0 0 1-27.51 21.83 78.18 78.18 0 0 1-34.29 7.57c-20.25 0.8-39.99-6.47-54.89-20.22a76.497 76.497 0 0 1-4.45-108.01 76.464 76.464 0 0 1 53.04-24.67c2.1-0.1 4.2-0.1 6.3 0 17.47 0.17 34.44 5.84 48.5 16.2l101.7-66.2c-6.3-12.85-9.81-26.89-10.3-41.2-0.9-19.1 3.94-38.03 13.9-54.36a95.752 95.752 0 0 1 41.98-37.23 95.712 95.712 0 0 1 55.62-7.3 95.675 95.675 0 0 1 50.17 25.13 95.68 95.68 0 0 1 27.46 48.92 95.708 95.708 0 0 1-4.68 55.91 95.622 95.622 0 0 1-35.21 43.69 95.744 95.744 0 0 1-53.64 16.44c-12.24 0.2-24.4-2.04-35.77-6.59a92.241 92.241 0 0 1-30.43-19.91l-100 64.7a77.105 77.105 0 0 1 8.8 35.2 94.128 94.128 0 0 1-2.9 19.1l132.3 42.6a70.112 70.112 0 0 1 33.27-29.66 70.06 70.06 0 0 1 44.42-3.6 70.09 70.09 0 0 1 37.62 23.91 70.124 70.124 0 0 1 15.59 41.75 71.267 71.267 0 0 1-20.28 49.33 71.293 71.293 0 0 1-48.82 21.47Zm0-104.4c-6.91 0.3-13.57 2.62-19.17 6.68-5.6 4.05-9.88 9.67-12.32 16.14a35.341 35.341 0 0 0-1.38 20.25 35.271 35.271 0 0 0 63.85 11.58 35.212 35.212 0 0 0 5.82-19.45 36.1 36.1 0 0 0-11.14-25.19 36.103 36.103 0 0 0-25.66-10.01Zm-270.6-102.9a45.61 45.61 0 0 0-17.53 3.05 45.73 45.73 0 0 0-15.04 9.53 45.821 45.821 0 0 0-10.24 14.55 45.61 45.61 0 0 0-0.84 34.9 45.73 45.73 0 0 0 9.53 15.04c4.13 4.33 9.08 7.81 14.55 10.24a45.644 45.644 0 0 0 17.37 3.89h2.2c5.99 0.14 11.95-0.89 17.53-3.05a45.73 45.73 0 0 0 15.04-9.53c4.33-4.13 7.81-9.08 10.24-14.55a45.644 45.644 0 0 0 3.89-17.37c0.15-5.99-0.89-11.95-3.05-17.53a45.73 45.73 0 0 0-9.53-15.04 45.821 45.821 0 0 0-14.55-10.24 45.644 45.644 0 0 0-17.37-3.89h-2.2Zm236.8-180.9a61.296 61.296 0 0 0-23.57 3.89 61.023 61.023 0 0 0-20.29 12.62 61.108 61.108 0 0 0-13.92 19.42 61.166 61.166 0 0 0-5.42 23.27v1.1a61.285 61.285 0 0 0 18.62 43.02 61.309 61.309 0 0 0 43.58 17.28h1.1c8.16 0.39 16.32-0.89 23.98-3.75a60.44 60.44 0 0 0 20.56-12.88 60.422 60.422 0 0 0 13.83-19.95c3.21-7.51 4.86-15.6 4.86-23.77a60.49 60.49 0 0 0-4.9-23.77 60.334 60.334 0 0 0-34.45-32.77 60.305 60.305 0 0 0-23.98-3.71Z" style="fill:currentcolor"></path></svg>Share {{type === "plugins" ? "Plugin" : "Theme"}}</div>
		  <div ng-hide="!plugin.bsUpdateAvailable" ng-click="update(name)" class="share bs-update"><svg viewBox="0 0 256 256" class="icon"><g fill="#ffffff"><g transform="scale(8,8)"><path d="M16,4c-6.61719,0 -12,5.38281 -12,12h2c0,-5.51562 4.48438,-10 10,-10c3.69531,0 6.92578,2.01172 8.65625,5h-3.65625v2h7v-7h-2v3.40625c-2.14453,-3.25391 -5.82031,-5.40625 -10,-5.40625zM26,16c0,5.51563 -4.48437,10 -10,10c-3.69531,0 -6.92578,-2.01172 -8.65625,-5h3.65625v-2h-7v7h2v-3.40625c2.14453,3.25391 5.82031,5.40625 10,5.40625c6.61719,0 12,-5.38281 12,-12z"></path></g></g></svg>Update Available</div>
		  </div></div></div>`;
  }

  function setupV4UI() {
    info.enabledThemes.forEach((theme) =>
      BetterStremio.Themes.enable(theme, false)
    );

    const betterStremioTpl = document.createElement("script");
    betterStremioTpl.id = "betterStremioTpl";
    betterStremioTpl.type = "text/ng-template";
    betterStremioTpl.innerHTML =
      `<div ng-controller="betterStremioCtrl" ng-cloak><div id="addonsCatalog"><div id="addons"><div id="betterstremio-filters" spatial-nav-section="{ id: 'betterstremio-filters', enterTo: 'last-focused'}" spatial-nav-section-active="$state.includes('betterstremio') &amp;&amp; ! prompt" class="options"><div class="filters"><ul class="segments"><li ng-repeat="type in ['plugins', 'themes']" ui-sref="betterstremio({ type: type })" ui-sref-opts="{location: 'replace'}" ng-class="{ selected: type == getSelectedType() }" tabindex="-1"><span ng-if="type == 'plugins'" translate="Plugins" class="label"> </span><span ng-if="type == 'themes'" translate="Themes" class="label"></span></li></ul></div><div class="filters"><span id="betterstremio-version" style="margin-top: 0.5rem;margin-right: 10px;align-items: center;display: flex;color: gray;font-size: 10px;flex-wrap: nowrap;flex-direction: column;">BetterStremio v${BetterStremio.version}<span ng-click="openChangelog()" tabindex="-1" style="cursor: pointer; color: palegoldenrod;">(changelog)</span></span><ul class="segments"><li ng-click="reloadAll()" tabindex="-1"><span class="label">Reload</span></li><li ng-click="openFolder()" tabindex="-1"><span class="label">Open folder</span></li></ul></div></div><div ng-repeat="type in ['plugins', 'themes']" ng-hide="type != getSelectedType()" class="content">${itemButton()}</div></div></div></div>
    <style type="text/css">@keyframes shine { 0% { left: -100%; } 50% { left: 50%; } 100% { left: 200%; } } .bs-update { position: relative; overflow: hidden; background: cornflowerblue; border-radius: 3rem; } .bs-update::after { content: ''; position: absolute; top: 0; left: -100%; width: 100%; height: 100%; background: linear-gradient( 120deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.4) 50%, rgba(255, 255, 255, 0) 100% ); transform: skewX(-45deg); transition: none; pointer-events: none; } .bs-update::after { animation: shine 2s linear infinite; }</style>`;

    const addonsTpl = document.getElementById("addonsTpl");
    if (!addonsTpl) {
      console.error(
        "[BetterStremio] Could not find the addons template; is this really the classic v4 UI?",
      );
      return;
    }
    addonsTpl.parentElement.insertBefore(betterStremioTpl, addonsTpl);

    stremioApp.run([
      "$rootScope",
      "toasts",
      "player",
      "sharing",
      function (root, toasts, player, sharing) {
        BetterStremio.StremioRoot = root;
        BetterStremio.StremioRoot.tabs.splice(5, 0, {
          id: 6,
          name: "BetterStremio",
          icon: "betterstremio",
          route: "betterstremio",
        });
        BetterStremio.Toasts = toasts;
        BetterStremio.Player = player;
        BetterStremio.Sharing = sharing;
      },
    ]);

    stremioApp.config([
      "$stateProvider",
      function (t) {
        t.state({
          name: "betterstremio",
          url: "/betterstremio/:type",
          params: {
            type: "plugins",
          },
          views: {
            view: {
              templateUrl: "betterStremioTpl",
            },
          },
        });
      },
    ]);

    stremioApp.controller("betterStremioCtrl", [
      "$scope",
      "$state",
      "sharing",
      function (s, m, d) {
        const context = () =>
          m.params.type === "plugins"
            ? BetterStremio.Plugins
            : BetterStremio.Themes;
        const enabledValues = () =>
          m.params.type === "plugins"
            ? BetterStremio.Internal.enabledPlugins
            : BetterStremio.Internal.enabledThemes;
        const entries = () =>
          m.params.type === "plugins"
            ? BetterStremio.Internal.plugins
            : BetterStremio.Internal.themes;

        s.getSelectedType = () => m.params.type;
        s.getCatalogs = () => ["plugins", "themes"];

        s.themes = BetterStremio.Internal.themes;
        s.plugins = BetterStremio.Internal.plugins;
        s.reloadAll = () => context().reload();
        s.enable = (name) => context().enable(name);
        s.disable = (name) => context().disable(name);
        s.settings = (name) => entries()[name].onSettings();
        s.enabled = (name) => enabledValues().includes(name);
        s.openFolder = () => BetterStremio.Internal.fetch("/folder", false);
        s.openChangelog = () =>
          BetterStremio.Internal.fetch("/changelog", false);
        s.update = (name) => updateEntry(m.params.type, name);
        s.share = (name) => {
          d.sendShare({
            url: entries()[name].getShareURL() ||
              entries()[name].getUpdateURL(),
            name: entries()[name].getName(),
            type: "copylink",
          });
        };
      },
    ]);

    BetterStremio.Modules = {};
    BetterStremio.Scopes = {};

    stremioApp._invokeQueue
      .map((v) => v[2])
      .forEach(([k, v]) => {
        if (typeof v !== "object") return;
        const scopeIdx = v.indexOf("$scope");
        const queueIdx = stremioApp._invokeQueue.findIndex(
          (el) => el[2][0] === k,
        );
        const queue = stremioApp._invokeQueue[queueIdx];
        const originalCallers = queue[queue.length - 1][1];
        const originalFn =
          queue[queue.length - 1][1][originalCallers.length - 1];
        queue[queue.length - 1][1][originalCallers.length - 1] = function () {
          v.forEach((mod) => {
            if (
              typeof mod === "string" &&
              !["$scope", "$rootScope"].includes(mod)
            ) {
              BetterStremio.Modules[mod] = arguments[v.indexOf(mod)];
            }
          });
          if (k.endsWith("Ctrl") && scopeIdx > -1) {
            BetterStremio.Scopes[k] = arguments[scopeIdx];
          }
          return originalFn.apply(originalFn, arguments);
        };
      });
  }

  function setupV4Icons() {
    const outlineIcon = document.querySelector(
      '[icon="betterstremio-outline"]',
    );
    const filledIcon = document.querySelector('[icon="betterstremio"]');
    if (outlineIcon) {
      outlineIcon.innerHTML =
        `<g fill="currentColor"><g transform="scale(5.12,5.12)"><path d="M14,3c-1.64497,0 -3,1.35503 -3,3v15.02539c-4.44462,0.26245 -8,3.96685 -8,8.47461c-0.00765,0.54095 0.27656,1.04412 0.74381,1.31683c0.46725,0.27271 1.04514,0.27271 1.51238,0c0.46725,-0.27271 0.75146,-0.77588 0.74381,-1.31683c0,-2.8862 2.18298,-5.22619 5,-5.47656v12.97656c0,1.64497 1.35503,3 3,3h4v5.5c-0.00765,0.54095 0.27656,1.04412 0.74381,1.31683c0.46725,0.27271 1.04514,0.27271 1.51238,0c0.46725,-0.27271 0.75146,-0.77588 0.74381,-1.31683v-5.5h8v5.5c-0.00765,0.54095 0.27656,1.04412 0.74381,1.31683c0.46725,0.27271 1.04514,0.27271 1.51238,0c0.46725,-0.27271 0.75146,-0.77588 0.74381,-1.31683v-5.5h4c1.64497,0 3,-1.35503 3,-3v-13.02539c4.44461,-0.26245 8,-3.96685 8,-8.47461c0.00582,-0.40562 -0.15288,-0.7963 -0.43991,-1.08296c-0.28703,-0.28666 -0.67792,-0.44486 -1.08353,-0.43852c-0.82766,0.01293 -1.48843,0.69381 -1.47656,1.52148c0,2.8862 -2.18298,5.22619 -5,5.47656v-14.97656c0,-1.64497 -1.35503,-3 -3,-3zM14,5h22c0.56503,0 1,0.43497 1,1v16.25391c-0.02645,0.16103 -0.02645,0.3253 0,0.48633v14.25977c0,0.56503 -0.43497,1 -1,1h-22c-0.56503,0 -1,-0.43497 -1,-1v-14.25391c0.02645,-0.16103 0.02645,-0.3253 0,-0.48633v-16.25977c0,-0.56503 0.43497,-1 1,-1zM17,7c-1.09306,0 -2,0.90694 -2,2v9c0,1.09306 0.90694,2 2,2h16c1.09306,0 2,-0.90694 2,-2v-9c0,-1.09306 -0.90694,-2 -2,-2zM17,9h16v9h-16zM20,11c-0.55228,0 -1,0.44772 -1,1c0,0.55228 0.44772,1 1,1c0.55228,0 1,-0.44772 1,-1c0,-0.55228 -0.44772,-1 -1,-1zM30,11c-0.55228,0 -1,0.44772 -1,1c0,0.55228 0.44772,1 1,1c0.55228,0 1,-0.44772 1,-1c0,-0.55228 -0.44772,-1 -1,-1zM23,14c0,1.105 0.895,2 2,2c1.105,0 2,-0.895 2,-2zM15,22v2h12v-2zM32,22c-0.55228,0 -1,0.44772 -1,1c0,0.55228 0.44772,1 1,1c0.55228,0 1,-0.44772 1,-1c0,-0.55228 -0.44772,-1 -1,-1zM17,26v2h-2v2h2v2h2v-2h2v-2h-2v-2zM29,26l-2,3h4zM34,27c-0.552,0 -1,0.448 -1,1c0,0.552 0.448,1 1,1c0.552,0 1,-0.448 1,-1c0,-0.552 -0.448,-1 -1,-1zM31.5,31c-1.381,0 -2.5,1.119 -2.5,2.5c0,1.381 1.119,2.5 2.5,2.5c1.381,0 2.5,-1.119 2.5,-2.5c0,-1.381 -1.119,-2.5 -2.5,-2.5zM16,34c-0.36064,-0.0051 -0.69608,0.18438 -0.87789,0.49587c-0.18181,0.3115 -0.18181,0.69676 0,1.00825c0.18181,0.3115 0.51725,0.50097 0.87789,0.49587h2c0.36064,0.0051 0.69608,-0.18438 0.87789,-0.49587c0.18181,-0.3115 0.18181,-0.69676 0,-1.00825c-0.18181,-0.3115 -0.51725,-0.50097 -0.87789,-0.49587zM22,34c-0.36064,-0.0051 -0.69608,0.18438 -0.87789,0.49587c-0.18181,0.3115 -0.18181,0.69676 0,1.00825c0.18181,0.3115 0.51725,0.50097 0.87789,0.49587h2c0.36064,0.0051 0.69608,-0.18438 0.87789,-0.49587c0.18181,-0.3115 0.18181,-0.69676 0,-1.00825c-0.18181,-0.3115 -0.51725,-0.50097 -0.87789,-0.49587z"></path></g></g>`;
      outlineIcon.setAttribute("viewBox", "0 0 256 256");
    }
    if (filledIcon) {
      filledIcon.innerHTML = `<g fill="currentColor">${BS_ICON}</g>`;
      filledIcon.setAttribute("viewBox", "0 0 256 256");
    }
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  document.addEventListener("DOMContentLoaded", () => {
    if (IS_V5) {
      info.enabledThemes.forEach((theme) =>
        BetterStremio.Themes.enable(theme, false)
      );
      setupV5UI();
    } else {
      setupV4UI();
    }

    info.enabledPlugins.forEach((plugin) => {
      try {
        info.plugins[plugin].onReady?.();
      } catch (e) {
        console.error(
          `[BetterStremio] Plugin '${plugin}' threw an exception at onReady:`,
          e,
        );
        BetterStremio.errors.push(["onReady", e]);
      }
    });
  });

  window.addEventListener("load", () => {
    setTimeout(() => checkForUpdates(), 2000);
    setInterval(() => checkForUpdates(), 86400000);

    if (!IS_V5) setupV4Icons();

    info.enabledPlugins.forEach((plugin) => {
      try {
        info.plugins[plugin].onLoad?.();
      } catch (e) {
        console.error(
          `[BetterStremio] Plugin '${plugin}' threw an exception at onLoad:`,
          e,
        );
        BetterStremio.errors.push(["onLoad", e]);
      }
    });
  });
})();
