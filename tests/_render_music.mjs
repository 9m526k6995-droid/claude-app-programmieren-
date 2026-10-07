import * as esbuild from "esbuild";
import { chromium } from "playwright";
import fs from "node:fs";
const [out, secs, segs] = [process.argv[2], Number(process.argv[3]), process.argv[4]];
const code = (await esbuild.build({ entryPoints: ["src/music.ts"], bundle: true, write: false, format: "iife", globalName: "MUS" })).outputFiles[0].text;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<html><body></body></html>");
await page.addScriptTag({ content: code });
const res = await page.evaluate(async ({ secs, segs }) => {
  const sr = 44100;
  const off = new OfflineAudioContext(2, Math.floor(sr * secs), sr);
  const t0 = performance.now();
  window.MUS.renderInto(off, secs, JSON.parse(segs));
  const buf = await off.startRendering();
  const ms = performance.now() - t0;
  const n = buf.length, ch = 2;
  let peak = 0;
  for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i])); }
  const gain = 0.8 / peak;
  const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + n * ch * 2, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, n * ch * 2, true);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < n; i++) { dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i] * gain)) * 32767, true); dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i] * gain)) * 32767, true); }
  const rms = [];
  for (let k = 0; k + sr < n; k += sr) { let s = 0; for (let i = k; i < k + sr; i++) s += L[i] * L[i]; rms.push(Math.round(Math.sqrt(s / sr) * 1000)); }
  let s = ""; const u = new Uint8Array(dv.buffer);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return { b64: btoa(s), peak, ms, rms };
}, { secs, segs });
fs.writeFileSync(out, Buffer.from(res.b64, "base64"));
console.log("peak", res.peak.toFixed(3), "render ms", Math.round(res.ms), "rms/s", res.rms.join(" "));
await browser.close();
