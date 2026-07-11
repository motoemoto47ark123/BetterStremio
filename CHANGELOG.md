# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-07-10

### Fixed

- Stremio 5 UI stuck on the splash screen: the web UI boots its core in a Web Worker, which must be same-origin — its static assets are now proxied through the local server instead of loaded via `<base href>`.
- Loader self-update no longer downgrades to older/cached versions (strict semver comparison + cache busting) and the loader script is always served fresh (`Cache-Control: no-store`).

## [1.1.0] - 2026-07-10

### Added

- **Stremio 5 support**: works with the new Stremio desktop app (`stremio-shell-ng`), including the new default install path (`%localAppData%\Programs\Stremio\`).
- **No more special shortcuts (Stremio 5)**: the installer replaces `stremio-shell-ng.exe` with a tiny launcher (original kept as `stremio-shell-ng-vanilla.exe`) that starts Stremio with the BetterStremio web UI. Opening Stremio from the Start Menu, taskbar or `stremio://` links just works.
- **New desktop UI support**: BetterStremio now injects into the regular Stremio 5 interface (web.stremio.com) with a floating button + management panel (`Ctrl+Shift+B`) for plugins & themes. The classic v4 UI keeps the original BetterStremio tab.
- GitHub Actions workflow that builds the Windows installer on every push and attaches it to releases on tags.

### Fixed

- Installer no longer hangs while "Scanning for existing Stremio shortcuts": the recursive scan of `%APPDATA%`/`%PROGRAMDATA%` (one PowerShell process per shortcut) was replaced by a single fast scan of the actual shortcut folders with a hard timeout.
- `--development --streaming-server` args are removed from Stremio 5 shortcuts (they crash the new shell).
- Stremio processes are now correctly stopped before patching (`stremio-shell-ng.exe`, `stremio-runtime.exe`).
- Extra downloads (WatchParty/Amoled) were not awaited, so failures were silently ignored.
- BetterStremio folder resolution no longer depends on the working directory Stremio was launched from.
- Patched page is served in standards mode (injection happens inside `<head>` instead of before `<!doctype>`).
- Theme update check logged `undefined` instead of the theme name.

## [1.0.5] - 2024-01-05

### Added

- Fixed cached responses.
- Fixed notification icon.

## [1.0.4] - 2024-01-05

### Added

- New notification icon couting plugins/themes available to update.

## [1.0.3] - 2024-01-03

### Added

- Autoupdate: automatically check for updates on plugins & themes.
- Improved plugins error handling.
- Reduced final binary size (moved assets to the web).
- Fixed BetterStremio UI / reloading for plugins and themes (`BetterStremio.Internal.reloadUI`).
- Fixed installer compatibility with Windows systems of users suffering from [USERPROFILE abbreviation](https://superuser.com/questions/892228/user1-in-user-folder).
- Added new status messages to installer (to monitor the patching/unpatching process).


## [1.0.2] - 2024-12-29

### Added

- Windows / Linux compatibility (requires repatching).
- New open changelog route.

### Removed

-  Windows batch installer: replaced by a universal WebUI installer.


## [1.0.1] - 2024-06-05

### Added

- BetterStremio.Modules.
- BetterStremio.Scopes.


## [1.0.0] - 2024-06-02

### Added

- Patching script (Windows).
- BetterStremio Loader (plugins & themes).
- Documentation: CHANGELOG and README.
- Autoupdate for BetterStremio Loader.

[1.0.0]: https://github.com/MateusAquino/BetterStremio/releases/tag/v1.0.0
[1.0.1]: https://github.com/MateusAquino/BetterStremio/releases/tag/v1.0.1
[1.0.2]: https://github.com/MateusAquino/BetterStremio/releases/tag/v1.0.2
