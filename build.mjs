// Build ohne Framework: esbuild bündelt TypeScript + CSS.
//   node build.mjs            → dist/ (für Hosting: GitHub Pages, Vercel, Netlify, Cloudflare)
//   node build.mjs --single   → dist-single/index.html (alles in einer Datei)
//   node build.mjs --serve    → lokaler Dev-Server mit Live-Rebuild
import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const single = args.has("--single");
const serve = args.has("--serve");

// .env lesen (ohne Extra-Paket)
function loadEnv() {
  const env = { ...process.env };
  // Reihenfolge = Vorrang: Umgebungsvariablen > .env > .env.local > .env.production
  for (const f of [".env", ".env.local", ".env.production"]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith("#")) env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}
const env = loadEnv();

const config = {
  supabaseUrl: (env.ZWIP_SUPABASE_URL || "").replace(/\/$/, ""),
  supabaseAnonKey: env.ZWIP_SUPABASE_ANON_KEY || "",
  publicUrl: env.ZWIP_PUBLIC_URL || "",
};

// Schutz: Geheime Supabase-Keys dürfen nie in die öffentliche App gelangen
(function guardSecretKey(key) {
  if (!key) return;
  let role = "";
  if (key.startsWith("eyJ")) {
    try {
      role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role || "";
    } catch {
      /* kein lesbares JWT */
    }
  }
  if (key.startsWith("sb_secret_") || role === "service_role") {
    console.error(
      "\n✘ ZWIP_SUPABASE_ANON_KEY enthält einen GEHEIMEN Key (secret/service_role).\n" +
        "  Der würde öffentlich im Browser landen. Nimm den 'publishable' bzw. 'anon public' Key.\n",
    );
    process.exit(1);
  }
})(config.supabaseAnonKey);

const outdir = env.ZWIP_OUTDIR || (single ? "dist-single" : "dist");
fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

const options = {
  entryPoints: { app: "src/main.ts" },
  bundle: true,
  minify: !serve,
  sourcemap: serve,
  target: ["es2020", "safari15", "chrome90"],
  format: "iife",
  outdir,
  // Normaler Build: app-<hash>.js, damit Browser/CDN nie eine alte Version zeigen
  entryNames: single || serve ? "[name]" : "[name]-[hash]",
  metafile: true,
  write: !single,
  logLevel: "info",
  define: {
    __ZWIP_CONFIG__: JSON.stringify(config),
    __ZWIP_SINGLE__: String(single),
  },
};

function writeHtml(js = "app.js", css = "app.css") {
  let html = fs.readFileSync("index.html", "utf8");
  html = html
    .replace("<!--CSS-->", `<link rel="stylesheet" href="${css}" />`)
    .replace("<!--JS-->", `<script src="${js}"></script>`);
  fs.writeFileSync(path.join(outdir, "index.html"), html);
  fs.cpSync("public", outdir, { recursive: true });
}

if (single) {
  const res = await esbuild.build(options);
  const js = res.outputFiles.find((f) => f.path.endsWith(".js")).text;
  const css = res.outputFiles.find((f) => f.path.endsWith(".css")).text;
  const icon = "data:image/svg+xml," + encodeURIComponent(fs.readFileSync("public/icon.svg", "utf8"));
  let html = fs.readFileSync("index.html", "utf8");
  html = html
    .replace(/<!--PWA-->[\s\S]*<!--\/PWA-->/, `<link rel="icon" href="${icon}" />`)
    .replace("<!--CSS-->", () => `<style>${css}</style>`)
    .replace("<!--JS-->", () => `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`);
  fs.writeFileSync(path.join(outdir, "index.html"), html);
  // Variante ohne <html>/<head>/<body>-Gerüst, z. B. für Einbettungen, die das Gerüst selbst liefern
  const fonts = html.match(/<link rel="preconnect"[\s\S]*?display=swap" \/>/)?.[0] ?? "";
  const frag = `<title>ZWIP</title>\n${fonts}\n<style>${css}</style>\n<div id="app"></div>\n<script>${js.replace(/<\/script/gi, "<\\/script")}</script>\n`;
  fs.writeFileSync(path.join(outdir, "embed.html"), frag);
  console.log(`✔ ${outdir}/index.html (${(html.length / 1024).toFixed(1)} KB)`);
} else if (serve) {
  writeHtml();
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const port = Number(env.PORT || 5173);
  const { hosts } = await ctx.serve({ servedir: outdir, port, host: "0.0.0.0" });
  console.log(`\n  ZWIP läuft auf http://localhost:${port}  (Handy im selben WLAN: http://<deine-IP>:${port})\n`, hosts ?? "");
} else {
  const res = await esbuild.build(options);
  const outs = Object.keys(res.metafile.outputs).map((f) => path.basename(f));
  const js = outs.find((f) => f.endsWith(".js"));
  const css = outs.find((f) => f.endsWith(".css"));
  writeHtml(js, css);
  const size = fs.statSync(path.join(outdir, js)).size + fs.statSync(path.join(outdir, css)).size;
  console.log(`✔ ${outdir}/ gebaut – JS+CSS ${(size / 1024).toFixed(1)} KB`);
}
