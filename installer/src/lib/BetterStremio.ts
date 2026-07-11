/// <reference lib="deno.ns" />

// @ts-ignore: Importing @types/webui breaks the language server
import { WebUIEvent } from "@types/webui";
import path from "node:path";

const start = "/* BetterStremio:start */";
const end = "/* BetterStremio:end */";

// Base URL for raw BetterStremio files. Can be overridden (e.g. with a
// file:// URL) through the BETTERSTREMIO_RAW_BASE env var for local testing.
const rawBase = Deno.env.get("BETTERSTREMIO_RAW_BASE") ??
  "https://raw.githubusercontent.com/motoemoto47ark123/BetterStremio/refs/heads/main";

const urlPatch = `${rawBase}/patch.js`;
const urlLoader = `${rawBase}/BetterStremio.loader.js`;
const urlFont1 = `${rawBase}/fonts/icon-full-height.ttf`;
const urlFont2 = `${rawBase}/fonts/icon-full-height.woff`;
const urlFont3 = `${rawBase}/fonts/PlusJakartaSans.ttf`;
const urlWp =
  "https://raw.githubusercontent.com/MateusAquino/WatchParty/refs/heads/main/WatchParty.plugin.js";
const urlAmoled =
  "https://raw.githubusercontent.com/REVENGE977/StremioAmoledTheme/refs/heads/main/amoled.theme.css";

// Argument that makes the new Stremio shell (v5, stremio-shell-ng) load the
// patched local streaming server UI (which serves the regular desktop UI
// with BetterStremio injected) instead of plain https://web.stremio.com/.
export const WEBUI_ARG = "--webui-url=http://127.0.0.1:11470/betterstremio-v5";
// Arguments used by the old Stremio 4.x (Qt) shell.
const LEGACY_ARGS = "--development --streaming-server";
// Pattern that strips any BetterStremio-related argument from a shortcut.
const CLEANUP_ARGS_PATTERN =
  "\\s*--development\\b|\\s*--streaming-server\\b|\\s*--webui-url=\\S*";

const VANILLA_EXE = "stremio-shell-ng-vanilla.exe";

const unixAlert = (src: string) =>
  Deno.build.os === "windows"
    ? ""
    : `\n\nFor Unix systems, run before patching:\n\nsudo chown username ${
      src.endsWith("/") ? src : src + "/"
    }*`;

async function download(url: string, filename: string) {
  console.log("Downloading", url, "to", filename);
  // Cache-bust http(s) downloads so a stale CDN edge can't serve an old
  // version right after a release. (file:// URLs are used in local tests.)
  const noCacheUrl = url.startsWith("http")
    ? url + (url.includes("?") ? "&" : "?") + "t=" + Date.now()
    : url;
  const response = await fetch(noCacheUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  const data = await response.arrayBuffer();
  return Deno.writeFile(filename, new Uint8Array(data));
}

function exists(filePath: string) {
  try {
    Deno.statSync(filePath);
    return true;
  } catch (_e) {
    return false;
  }
}

export function getDefaultPath() {
  if (Deno.build.os === "windows") {
    const localAppData = Deno.env.get("LOCALAPPDATA");
    const candidates = [
      `${localAppData}\\Programs\\Stremio\\`, // Stremio 5.x (stremio-shell-ng)
      `${localAppData}\\Programs\\LNV\\Stremio-4\\`, // Stremio 4.x (Qt shell)
    ];
    for (const candidate of candidates) {
      if (exists(path.join(candidate, "server.js"))) return candidate;
    }
    return candidates[0];
  }
  return "/opt/stremio/";
}

export function getBetterStremioPath(stremioPath: string) {
  if (Deno.build.os === "windows") {
    return path.join(stremioPath, "BetterStremio");
  }
  return path.join(Deno.env.get("HOME")!, ".config", "BetterStremio");
}

// Which Stremio shell lives in the given folder:
// "ng" = new Stremio 5 shell (stremio-shell-ng), "legacy" = old 4.x Qt shell.
export function getShellKind(stremioPath: string): "ng" | "legacy" | null {
  if (
    exists(path.join(stremioPath, "stremio-shell-ng.exe")) ||
    exists(path.join(stremioPath, VANILLA_EXE))
  ) return "ng";
  if (exists(path.join(stremioPath, "stremio.exe"))) return "legacy";
  return null;
}

async function runPowerShell(
  script: string,
  args: string[] = [],
  timeoutMs = 120_000,
) {
  const scriptPath = await Deno.makeTempFile({
    prefix: "betterstremio-",
    suffix: ".ps1",
  });
  await Deno.writeTextFile(scriptPath, script);
  try {
    const cmd = new Deno.Command("powershell", {
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        ...args,
      ],
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const output = await cmd.output();
    const decoder = new TextDecoder();
    return {
      success: output.success,
      stdout: decoder.decode(output.stdout).trim(),
      stderr: decoder.decode(output.stderr).trim(),
    };
  } finally {
    try {
      Deno.removeSync(scriptPath);
    } catch (_e) {
      // temp script already removed
    }
  }
}

// C# source for the launcher that replaces stremio-shell-ng.exe. It starts
// the original executable (renamed to stremio-shell-ng-vanilla.exe) with the
// BetterStremio web UI argument, so Stremio can be opened normally (Start
// Menu, taskbar, stremio:// links) without any special shortcuts.
const WRAPPER_CSHARP = `using System;
using System.Diagnostics;
using System.IO;
using System.Text;

// BetterStremioWrapper v1
static class BetterStremioWrapper
{
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string real = Path.Combine(dir, "${VANILLA_EXE}");
        if (!File.Exists(real)) return 1;

        var sb = new StringBuilder();
        bool hasWebui = false;
        foreach (string a in args)
        {
            if (a.StartsWith("--webui-url", StringComparison.OrdinalIgnoreCase)) hasWebui = true;
            if (sb.Length > 0) sb.Append(' ');
            sb.Append(Quote(a));
        }
        if (!hasWebui)
        {
            if (sb.Length > 0) sb.Append(' ');
            sb.Append("${WEBUI_ARG}");
        }

        var psi = new ProcessStartInfo();
        psi.FileName = real;
        psi.Arguments = sb.ToString();
        psi.WorkingDirectory = dir;
        psi.UseShellExecute = false;
        using (Process.Start(psi)) { }
        return 0;
    }

    static string Quote(string s)
    {
        if (s.Length > 0 && s.IndexOfAny(new[] { ' ', '\\t', '\\n', '\\v', '"' }) < 0) return s;
        var r = new StringBuilder("\\"");
        int bs = 0;
        foreach (char c in s)
        {
            if (c == '\\\\') { bs++; continue; }
            if (c == '"') { r.Append('\\\\', bs * 2 + 1); r.Append('"'); bs = 0; continue; }
            r.Append('\\\\', bs); r.Append(c); bs = 0;
        }
        r.Append('\\\\', bs * 2);
        r.Append('"');
        return r.ToString();
    }
}
`;

// Renames the real shell to stremio-shell-ng-vanilla.exe and compiles the
// launcher in its place using csc.exe (ships with .NET Framework on every
// Windows 10/11). Idempotent: safe to run on repair and after Stremio
// updates itself (which restores the real exe over our launcher).
async function wrapShell(stremioPath: string): Promise<boolean> {
  const script = `param([Parameter(Mandatory=$true)][string]$StremioPath, [Parameter(Mandatory=$true)][string]$WrapperSource)
$ErrorActionPreference = "Stop"
$exe = Join-Path $StremioPath "stremio-shell-ng.exe"
$vanilla = Join-Path $StremioPath "${VANILLA_EXE}"

if (-not (Test-Path $exe)) {
  if (Test-Path $vanilla) { Move-Item $vanilla $exe -Force }
  else { throw "stremio-shell-ng.exe not found in $StremioPath" }
}

# The real shell is a few MB; the BetterStremio launcher is tiny.
$exeIsReal = ((Get-Item $exe).Length -gt 2MB)
if ($exeIsReal) {
  if (Test-Path $vanilla) { Remove-Item $vanilla -Force }
  Move-Item $exe $vanilla -Force
} elseif (-not (Test-Path $vanilla)) {
  throw "stremio-shell-ng.exe looks like a BetterStremio launcher but the original executable is missing. Please reinstall Stremio."
} else {
  Remove-Item $exe -Force
}

$csc = @(
  (Join-Path $env:WINDIR "Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"),
  (Join-Path $env:WINDIR "Microsoft.NET\\Framework\\v4.0.30319\\csc.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) {
  Move-Item $vanilla $exe -Force
  throw "csc.exe (.NET Framework) not found"
}

$ico = Join-Path $env:TEMP ("betterstremio-icon-" + [guid]::NewGuid().ToString("N") + ".ico")
$iconArgs = @()
try {
  Add-Type -AssemblyName System.Drawing
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($vanilla)
  $fs = [System.IO.File]::Create($ico)
  $icon.Save($fs)
  $fs.Close()
  $iconArgs = @("/win32icon:" + $ico)
} catch { $iconArgs = @() }

& $csc /nologo /target:winexe /optimize+ ("/out:" + $exe) @iconArgs $WrapperSource | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exe)) {
  Move-Item $vanilla $exe -Force
  throw "Failed to compile the BetterStremio launcher"
}
Remove-Item $ico -Force -ErrorAction SilentlyContinue
Write-Output "wrapped"
`;

  const wrapperSource = await Deno.makeTempFile({
    prefix: "betterstremio-wrapper-",
    suffix: ".cs",
  });
  await Deno.writeTextFile(wrapperSource, WRAPPER_CSHARP);
  try {
    const result = await runPowerShell(script, [
      "-StremioPath",
      stremioPath,
      "-WrapperSource",
      wrapperSource,
    ]);
    if (!result.success || !result.stdout.includes("wrapped")) {
      console.error("wrapShell failed:", result.stderr || result.stdout);
      return false;
    }
    return true;
  } catch (e) {
    console.error("wrapShell failed:", e);
    return false;
  } finally {
    try {
      Deno.removeSync(wrapperSource);
    } catch (_e) {
      // already removed
    }
  }
}

// Restores the original stremio-shell-ng.exe (removes the launcher).
async function unwrapShell(stremioPath: string): Promise<boolean> {
  const script = `param([Parameter(Mandatory=$true)][string]$StremioPath)
$ErrorActionPreference = "Stop"
$exe = Join-Path $StremioPath "stremio-shell-ng.exe"
$vanilla = Join-Path $StremioPath "${VANILLA_EXE}"
if (Test-Path $vanilla) {
  if ((Test-Path $exe) -and ((Get-Item $exe).Length -le 2MB)) { Remove-Item $exe -Force }
  if (Test-Path $exe) { Remove-Item $vanilla -Force }
  else { Move-Item $vanilla $exe -Force }
}
Write-Output "unwrapped"
`;
  try {
    const result = await runPowerShell(script, ["-StremioPath", stremioPath]);
    if (!result.success) {
      console.error("unwrapShell failed:", result.stderr || result.stdout);
      return false;
    }
    return true;
  } catch (e) {
    console.error("unwrapShell failed:", e);
    return false;
  }
}

// Adds/removes Stremio shortcut arguments. Unlike the previous
// implementation (which recursively scanned all of %APPDATA%/%PROGRAMDATA%
// with one PowerShell process per shortcut and could hang for a very long
// time), this runs a single PowerShell process over the handful of folders
// where launcher shortcuts actually live, and is capped by a hard timeout.
async function updateWindowsShortcuts(
  event: WebUIEvent,
  addArgs: string,
  removeArgsPattern: string,
) {
  event.window.run("setStatus('Updating Stremio shortcuts...')");
  const script = `param([string]$AddArgs = "", [string]$RemoveArgsPattern = "")
$ErrorActionPreference = "SilentlyContinue"
$shell = New-Object -ComObject WScript.Shell
$dirs = @(
  [Environment]::GetFolderPath("Desktop"),
  [Environment]::GetFolderPath("CommonDesktopDirectory"),
  [Environment]::GetFolderPath("StartMenu"),
  [Environment]::GetFolderPath("CommonStartMenu"),
  (Join-Path $env:APPDATA "Microsoft\\Internet Explorer\\Quick Launch")
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique
$count = 0
foreach ($dir in $dirs) {
  foreach ($lnk in (Get-ChildItem -Path $dir -Filter *.lnk -Recurse -ErrorAction SilentlyContinue)) {
    try {
      $sc = $shell.CreateShortcut($lnk.FullName)
      $target = [string]$sc.TargetPath
      if ($target -notmatch "(?i)\\\\stremio(-shell-ng)?(-vanilla)?\\.exe$") { continue }
      $oldArgs = [string]$sc.Arguments
      $newArgs = $oldArgs
      if ($RemoveArgsPattern) { $newArgs = ($newArgs -replace $RemoveArgsPattern, "").Trim() }
      if ($AddArgs -and ($newArgs -notlike ("*" + $AddArgs + "*"))) {
        $newArgs = ($newArgs + " " + $AddArgs).Trim()
      }
      if ($newArgs -ne $oldArgs) { $sc.Arguments = $newArgs; $sc.Save(); $count++ }
    } catch {}
  }
}
Write-Output ("updated:" + $count)
`;
  try {
    const result = await runPowerShell(
      script,
      ["-AddArgs", addArgs, "-RemoveArgsPattern", removeArgsPattern],
      90_000,
    );
    console.log("Shortcut update:", result.stdout, result.stderr);
    return result.success;
  } catch (e) {
    // Never fail the whole (un)installation because of shortcuts.
    console.error("updateWindowsShortcuts failed:", e);
    return false;
  }
}

function updateLinuxDesktopFile(
  event: WebUIEvent,
  stremioPath: string,
  addArgs: string,
  removeArgs: string,
) {
  event.window.run(
    "setStatus('Updating smartcode-stremio.desktop shortcut...')",
  );
  const desktopApp = path.join(stremioPath, "smartcode-stremio.desktop");
  const desktopAppContents = Deno.readTextFileSync(desktopApp);
  const rgx = /Exec=(?!.*--development --streaming-server.*).*/;
  const updatedDesktopAppContents = desktopAppContents
    .replace(removeArgs, "")
    .replace(rgx, `$&${addArgs}`);
  Deno.writeTextFileSync(desktopApp, updatedDesktopAppContents);
}

export async function installExtra(
  event: WebUIEvent,
  stremioPath: string,
  url: string,
  type: "plugins" | "themes",
  filename: string,
) {
  event.window.run(`setStatus('Downloading ${filename}...')`);
  const BetterStremioPath = getBetterStremioPath(stremioPath);
  try {
    await download(url, path.join(BetterStremioPath, type, filename));
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function patch(event: WebUIEvent, stremioPath: string) {
  console.log("Patching Stremio");
  event.window.run("setStatus('Patching Stremio...')");

  let patchContent;
  try {
    const noCacheUrl = urlPatch.startsWith("http")
      ? urlPatch + (urlPatch.includes("?") ? "&" : "?") + "t=" + Date.now()
      : urlPatch;
    const response = await fetch(noCacheUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    patchContent = new TextDecoder().decode(
      new Uint8Array(await response.arrayBuffer()),
    );
  } catch (e) {
    console.error(e);
    return "Failed to download patch, make sure you have an established internet connection.";
  }

  const serverJs = path.join(stremioPath, "server.js");
  const contents = Deno.readTextFileSync(serverJs);

  if (!/enginefs\.router\.get/.test(contents)) {
    return "This server.js does not look like a supported Stremio streaming server (enginefs router not found). Your Stremio version may be too new or too old for this BetterStremio release.";
  }

  try {
    const updatedContents = contents.replace(
      /enginefs\.router\.get/,
      `${patchContent.trim()}enginefs.router.get`,
    );
    Deno.writeTextFileSync(serverJs, updatedContents);
  } catch (e) {
    console.error(e);
    return (
      "Failed to update server.js, make sure BetterStremio is allowed to write to Stremio files." +
      unixAlert(stremioPath)
    );
  }
  return true;
}

export async function install(
  event: WebUIEvent,
  stremioPath: string,
  installWp: boolean,
  installAmoled: boolean,
) {
  event.window.run("setStatus('Creating BetterStremio folder...')");
  const BetterStremioPath = getBetterStremioPath(stremioPath);

  try {
    Deno.mkdirSync(BetterStremioPath, { recursive: true });
  } catch (e) {
    console.error(e);
    return "Failed to create BetterStremio folder, make sure BetterStremio is allowed to write to Stremio files.";
  }

  Deno.mkdirSync(path.join(BetterStremioPath, "themes"), { recursive: true });
  Deno.mkdirSync(path.join(BetterStremioPath, "fonts"), { recursive: true });
  Deno.mkdirSync(path.join(BetterStremioPath, "plugins"), { recursive: true });

  try {
    event.window.run("setStatus('Downloading BetterStremio loader...')");
    await download(
      urlLoader,
      path.join(BetterStremioPath, "BetterStremio.loader.js"),
    );
    event.window.run(
      "setStatus('Downloading missing Stremio fonts (icon-full-height.ttf)...')",
    );
    await download(
      urlFont1,
      path.join(BetterStremioPath, "fonts", "icon-full-height.ttf"),
    );
    event.window.run(
      "setStatus('Downloading missing Stremio fonts (icon-full-height.woff)...')",
    );
    await download(
      urlFont2,
      path.join(BetterStremioPath, "fonts", "icon-full-height.woff"),
    );
    event.window.run(
      "setStatus('Downloading missing Stremio fonts (PlusJakartaSans.ttf)...')",
    );
    await download(
      urlFont3,
      path.join(BetterStremioPath, "fonts", "PlusJakartaSans.ttf"),
    );
  } catch (e) {
    console.error(e);
    return "Failed to download BetterStremio files, make sure you have an established internet connection.";
  }

  event.window.run("setStatus('Removing previous BetterStremio patches...')");
  const uninstallResult = await uninstall(event, stremioPath, false);
  if (uninstallResult !== true) return uninstallResult;
  const patchResult = await patch(event, stremioPath);
  if (patchResult !== true) return patchResult;

  if (Deno.build.os === "windows") {
    const shellKind = getShellKind(stremioPath);
    if (shellKind === "ng") {
      // New Stremio 5 shell: replace the executable with a launcher so that
      // opening Stremio normally (Start Menu, taskbar, stremio:// links)
      // loads BetterStremio — no shortcut changes needed.
      event.window.run(
        "setStatus('Setting up the BetterStremio launcher...')",
      );
      const wrapped = await wrapShell(stremioPath);
      // Clean legacy args off any Stremio shortcut; they break the new
      // shell. If the launcher could not be compiled, fall back to putting
      // the web UI argument on the shortcuts instead.
      await updateWindowsShortcuts(
        event,
        wrapped ? "" : WEBUI_ARG,
        CLEANUP_ARGS_PATTERN,
      );
    } else if (shellKind === "legacy") {
      // Old Stremio 4.x Qt shell: keep the original approach of adding
      // launch arguments to existing shortcuts.
      await updateWindowsShortcuts(event, LEGACY_ARGS, CLEANUP_ARGS_PATTERN);
    } else {
      return "Could not find a Stremio executable (stremio-shell-ng.exe or stremio.exe) in the selected path.";
    }
  } else {
    try {
      updateLinuxDesktopFile(event, stremioPath, ` ${LEGACY_ARGS}`, "");
    } catch (e) {
      console.error(e);
      return (
        "Failed to update existing Stremio shortcuts args: " +
        (e as Error).toString() +
        unixAlert(stremioPath)
      );
    }
  }

  const resultWp = installWp
    ? await installExtra(
      event,
      stremioPath,
      urlWp,
      "plugins",
      "WatchParty.plugin.js",
    )
    : true;
  const resultAmoled = installAmoled
    ? await installExtra(
      event,
      stremioPath,
      urlAmoled,
      "themes",
      "amoled.theme.css",
    )
    : true;

  return resultWp && resultAmoled
    ? true
    : "BetterStremio was successfully installed, but these extras failed: " +
      (resultWp ? "" : "WatchParty") +
      (!resultWp && !resultAmoled ? ", " : "") +
      (resultAmoled ? "" : "Amoled theme");
}

export async function uninstall(
  event: WebUIEvent,
  stremioPath: string,
  restoreLaunchers = true,
) {
  const serverJs = path.join(stremioPath, "server.js");
  let contents;
  try {
    contents = Deno.readTextFileSync(serverJs);
  } catch (e) {
    console.error(e);
    return (
      "Failed to read server.js, make sure BetterStremio is allowed to access Stremio files." +
      unixAlert(stremioPath)
    );
  }

  if (contents.includes(start)) {
    event.window.run("setStatus('Unpatching Stremio...')");
    const startIdx = contents.indexOf(start);
    const endIdx = contents.indexOf(end, startIdx);
    if (endIdx === -1) {
      return "Failed to uninstall BetterStremio, is your Stremio installation corrupted?";
    }
    const newContents = contents.slice(0, startIdx) +
      contents.slice(endIdx + end.length);
    try {
      Deno.writeTextFileSync(serverJs, newContents);
    } catch (e) {
      console.error(e);
      return (
        "Failed to update server.js, make sure BetterStremio is allowed to write to Stremio files." +
        unixAlert(stremioPath)
      );
    }
  }

  if (restoreLaunchers) {
    if (Deno.build.os === "windows") {
      if (getShellKind(stremioPath) === "ng") {
        event.window.run(
          "setStatus('Restoring the original Stremio executable...')",
        );
        await unwrapShell(stremioPath);
      }
      await updateWindowsShortcuts(event, "", CLEANUP_ARGS_PATTERN);
    } else {
      try {
        updateLinuxDesktopFile(event, stremioPath, "", ` ${LEGACY_ARGS}`);
      } catch (e) {
        console.error(e);
        return (
          "Failed to update existing Stremio shortcuts args: " +
          (e as Error).toString() +
          unixAlert(stremioPath)
        );
      }
    }
  }

  return true;
}

export function killStremio() {
  if (Deno.build.os === "windows") {
    for (
      const image of [
        "stremio.exe",
        "stremio-shell-ng.exe",
        VANILLA_EXE,
        "stremio-runtime.exe",
      ]
    ) {
      try {
        new Deno.Command("taskkill", { args: ["/F", "/IM", image] })
          .outputSync();
      } catch (e) {
        console.error(`Failed to kill ${image}:`, e);
      }
    }
  } else {
    const cmd = new Deno.Command("pkill", { args: ["-f", "stremio"] });
    return cmd.outputSync();
  }
}
