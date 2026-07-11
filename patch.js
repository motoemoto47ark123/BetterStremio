/* BetterStremio:start */
0;

global.requireModule = (moduleName) => {
    if (typeof __webpack_require__ === 'undefined')
        return require(moduleName);
    else
        return {
            "node-fetch": __webpack_require__(Object.entries(__webpack_require__.m).find(([k, v]) => v.toString().includes("module.exports \= exports \= fetch"))[0]),
            "fs": __webpack_require__(Object.entries(__webpack_require__.m).find(([k, v]) => v.toString().includes("module.exports \= require(\"fs\");"))[0]),
            "path": path,
            "os": __webpack_require__(Object.entries(__webpack_require__.m).find(([k, v]) => v.toString().includes("module.exports \= require(\"os\");"))[0]),
            "child_process": __webpack_require__(Object.entries(__webpack_require__.m).find(([k, v]) => v.toString().includes("module.exports \= require(\"child_process\");"))[0])
        } [moduleName];
}

global.getOS = () => {
    const os = requireModule("os");
    return os.platform().toLowerCase().replace(/[0-9]/g, ``).replace(`darwin`, `macos`);
}

global.getBetterStremioPath = () => {
    const path = requireModule("path");
    switch (getOS()) {
        case `win`:
            // Resolve from the runtime executable location (the Stremio program
            // folder) instead of process.cwd(), which depends on how Stremio
            // was launched (Start Menu, protocol link, terminal...).
            return path.join(path.dirname(process.execPath), "BetterStremio");
        case `linux`:
        case `macos`:
            return path.join(process.env.HOME, ".config", "BetterStremio");
    }
}

global.proxyWebUIAsset = async (req, res, next) => {
    // Serves the Stremio 5 web UI static assets from the local origin.
    // Required because the UI boots its core inside a Web Worker, and
    // workers can only be constructed from same-origin scripts.
    try {
        const fetch = requireModule("node-fetch");
        const upstream = "https://web.stremio.com" + req.originalUrl;
        const response = await fetch(upstream, {
            "headers": {
                "accept": req.headers["accept"] || "*/*",
                "accept-language": req.headers["accept-language"] || "en-US,en;q=0.9"
            }
        });
        if (!response.ok) return next();
        const body = await (response.buffer ? response.buffer() : response.arrayBuffer().then((b) => Buffer.from(b)));
        const headers = {};
        const contentType = response.headers.get("content-type");
        const cacheControl = response.headers.get("cache-control");
        if (contentType) headers["content-type"] = contentType;
        if (cacheControl) headers["cache-control"] = cacheControl;
        res.writeHead(response.status, headers);
        res.end(body);
    } catch (err) {
        console.error("[BetterStremio] Failed to proxy web UI asset:", err);
        return next();
    }
}

global.serveBetterStremioShell = async (req, res, next, webui) => {
    if (!req.headers.host) return next("No host header");
    var socketConstructor = req.socket.constructor.name,
        protocol = "";

    if ("Socket" == socketConstructor) protocol = "http://";
    else {
        if ("TLSSocket" != socketConstructor) return next("Unknown protocol");
        protocol = "https://";
    }

    const host = protocol + req.headers.host;
    const source = webui === "v5" ? "https://web.stremio.com/" : webUILocation;
    // v5 assets resolve against the local origin (see proxyWebUIAsset); the
    // classic v4 UI keeps loading its assets straight from app.strem.io.
    const base = webui === "v5" ? "/" : source;
    const inject = `<base href="${base}"/>` +
        `<style type="text/css">@font-face {font-family: 'icon-full-height';src: url('${host}/better-stremio/src/fonts/icon-full-height.ttf?3lc42w') format('truetype'), url('${host}/better-stremio/src/fonts/icon-full-height.woff?3lc42w') format('woff');font-weight: normal;font-style: normal;} @font-face {font-family: 'PlusJakartaSans';src: url("${host}/better-stremio/src/fonts/PlusJakartaSans.ttf") format('truetype')}</style>` +
        `<script type="text/javascript">BetterStremio = {host: "${host}/better-stremio", webui: "${webui}"}</script>` +
        `<script type="text/javascript" src="${host}/better-stremio/src/BetterStremio.loader.js?v=${Date.now()}"></script>`;

    try {
        const fetch = requireModule("node-fetch");
        const shell = await fetch(source, {
            "headers": {
                "sec-ch-ua": "\"BetterStremio\";v=\"1\"",
                "sec-ch-ua-mobile": "?0",
                "upgrade-insecure-requests": "1"
            },
            "referrerPolicy": "strict-origin-when-cross-origin",
            "body": null,
            "method": "GET"
        });
        if (!shell.ok) throw new Error("HTTP " + shell.status);
        let html = await shell.text();
        // Inject right after <head> so the loader runs before the app
        // bootstraps and the document stays in standards mode.
        if (/<head>/i.test(html)) html = html.replace(/<head>/i, (m) => m + inject);
        else html = inject + html;
        res.writeHead(200, {
            "content-type": "text/html; charset=utf-8"
        });
        res.end(html);
    } catch (err) {
        const message = "<html><body style=\"background:#0c0b11;color:#fff;font-family:sans-serif;text-align:center;padding-top:20vh\">" +
            "<h1>BetterStremio</h1><p>Failed to load the Stremio Web UI from <code>" + source + "</code>.</p>" +
            "<p>Check your internet connection, then close Stremio from the system tray and reopen it.</p>" +
            "<p style=\"color:#888\">" + (err && err.toString()) + "</p></body></html>";
        res.writeHead(502, {
            "content-type": "text/html; charset=utf-8"
        });
        res.end(message);
    }
}

enginefs.router.use("/better-stremio/src", (function(req, res, next) {
    const fs = requireModule("fs");
    const path = requireModule("path");
    const requestedPath = req.path.replace(/^\/better-stremio\/src/, "");
    const staticFolder = getBetterStremioPath();
    const filePath = path.join(staticFolder, requestedPath.replace(/[#?].*$/, ''));

    res.setHeader("Access-Control-Allow-Origin", "*");
    // Plugins/themes/loader must always be read fresh from disk; otherwise
    // the WebView may keep serving old versions after an update.
    res.setHeader("Cache-Control", "no-store");

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            return next();
        }
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".gif": "image/gif",
            ".svg": "image/svg+xml",
            ".wav": "audio/wav",
            ".mp4": "video/mp4",
            ".woff": "application/font-woff",
            ".ttf": "application/font-ttf",
            ".eot": "application/vnd.ms-fontobject",
            ".otf": "application/font-otf",
            ".wasm": "application/wasm",
        };

        const contentType = mimeTypes[ext] || "application/octet-stream";
        res.setHeader("Content-Type", contentType);

        // Stream the file to the response
        const readStream = fs.createReadStream(filePath);
        readStream.on("error", (streamErr) => {
            console.error("Error reading file:", streamErr);
            res.statusCode = 500;
            res.end("Internal Server Error");
        });
        readStream.pipe(res);
    });

})), enginefs.router.post("/better-stremio/update/:filename(*)", (async function(req, res, _next) {
    const fetch = requireModule("node-fetch");
    const fs = requireModule("fs");
    let status = 500;
    let message = {};
    try {
        const from = req.query.from;
        const to = req.params.filename;
        if (!from || !to) {
            status = 400;
            throw new Error("Filename and query param 'from' is required.");
        }
        const response = await fetch(from);
        if (!response.ok) throw new Error('Failed to fetch the file.');
        const fileContents = await response.text();
        const filePath = path.resolve(getBetterStremioPath(), to);
        fs.writeFileSync(filePath, fileContents);
        status = 200;
        message = {
            message: 'File updated successfully.'
        };
    } catch (error) {
        message = {
            error: error.toString()
        };
    }
    message = JSON.stringify({
        filename: req.params,
        ...message
    });

    res.writeHead(status, {
        "content-type": "application/json",
        "content-length": message.length
    }), res.end(message);
})), enginefs.router.use("/better-stremio/folder", (function(_req, res, _next) {
    const child_process = requireModule("child_process");

    try {
        const platform = getOS()
        const BSPath = getBetterStremioPath() || (platform === "win" ? '' : '/');
        const cmd = {
            "win": "explorer",
            "linux": "xdg-open",
            "macos": "open"
        } [platform];
        child_process.spawn(cmd, [BSPath]);
        res.writeHead(204);
        return res.end();
    } catch (err) {
        const message = JSON.stringify({
            error: err.toString()
        });
        res.writeHead(500, {
            "content-type": "application/json",
            "content-length": message.length
        }), res.end(message);
    }
})), enginefs.router.use("/better-stremio/changelog", (function(_req, res, _next) {
    const child_process = requireModule("child_process");

    try {
        const platform = getOS()
        const cmd = {
            "win": "explorer",
            "linux": "xdg-open",
            "macos": "open"
        } [platform];
        child_process.spawn(cmd, ["https://github.com/motoemoto47ark123/BetterStremio/blob/main/CHANGELOG.md"]);
        res.writeHead(204);
        return res.end();
    } catch (err) {
        const message = JSON.stringify({
            error: err.toString()
        });
        res.writeHead(500, {
            "content-type": "application/json",
            "content-length": message.length
        }), res.end(message);
    }
})), enginefs.router.get("/better-stremio", (async function(_req, res, _next) {
    const fs = requireModule("fs");
    let message;
    let status = 200;
    try {
        const BSPath = getBetterStremioPath();
        message = JSON.stringify({
            v: 2,
            path: BSPath,
            plugins: fs.readdirSync(path.resolve(BSPath, 'plugins')),
            themes: fs.readdirSync(path.resolve(BSPath, 'themes'))
        })
    } catch (error) {
        status = 501;
        message = JSON.stringify({
            error: error.toString()
        })
    };
    res.writeHead(status, {
        "content-type": "application/json",
        "content-length": message.length
    }), res.end(message);
})), enginefs.router.get(/^\/(?:[0-9a-f]{16,}\/|favicons\/|manifest\.json$)/, (function(req, res, next) {
    // Static assets of the Stremio 5 web UI (hashed bundle dir, favicons,
    // PWA manifest), proxied so they are same-origin (see proxyWebUIAsset).
    return proxyWebUIAsset(req, res, next);
})), enginefs.router.get("/betterstremio-v5", (function(req, res, next) {
    // New Stremio 5 desktop UI (same one the app normally shows) with
    // BetterStremio injected. The BetterStremio launcher points the shell
    // here via --webui-url.
    return serveBetterStremioShell(req, res, next, "v5");
})), enginefs.router.get("/", (function(req, res, next) {
    // Classic v4 web UI, used by the old Stremio 4.x shells launched with
    // --development --streaming-server.
    return serveBetterStremioShell(req, res, next, "v4");
}));
/* BetterStremio:end */
