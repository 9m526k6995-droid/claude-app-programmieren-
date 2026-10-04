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
  for (const f of [".env", ".env.local"]) {
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

const outdir = single ? "dist-single" : "dist";
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
  write: !single,
  logLevel: "info",
  define: {
    __ZWIP_CONFIG__: JSON.stringify(config),
    __ZWIP_SINGLE__: String(single),
  },
};

function writeHtml() {
  let html = fs.readFileSync("index.html", "utf8");
  html = html
    .replace("<!--CSS-->", '<link rel="stylesheet" href="app.css" />')
    .replace("<!--JS-->", '<script src="app.js"></script>');
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
  console.log(`✔ ${outdir}/index.html (${(html.length / 1024).toFixed(1)} KB)`);
} else if (serve) {
  writeHtml();
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const port = Number(env.PORT || 5173);
  const { hosts } = await ctx.serve({ servedir: outdir, port, host: "0.0.0.0" });
  console.log(`\n  ZWIP läuft auf http://localhost:${port}  (Handy im selben WLAN: http://<deine-IP>:${port})\n`, hosts ?? "");
} else {
  await esbuild.build(options);
  writeHtml();
  const size = fs.statSync(path.join(outdir, "app.js")).size + fs.statSync(path.join(outdir, "app.css")).size;
  console.log(`✔ ${outdir}/ gebaut – JS+CSS ${(size / 1024).toFixed(1)} KB`);
}
