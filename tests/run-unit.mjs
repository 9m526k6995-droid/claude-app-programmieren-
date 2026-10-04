// Bündelt die Unit-Tests mit esbuild und startet sie mit dem eingebauten Node-Test-Runner.
import * as esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

fs.mkdirSync(".tmp", { recursive: true });
await esbuild.build({
  entryPoints: ["tests/unit.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".tmp/unit.test.mjs",
  logLevel: "warning",
  define: { __ZWIP_CONFIG__: "undefined", __ZWIP_SINGLE__: "false" },
});
const r = spawnSync(process.execPath, ["--test", ".tmp/unit.test.mjs"], { stdio: "inherit" });
process.exit(r.status ?? 1);
