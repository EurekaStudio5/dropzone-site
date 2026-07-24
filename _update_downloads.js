// dropzone 全差し替え更新スクリプト（build.js消失後の代替手順・salt維持）
// usage: node _update_downloads.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PW = "1964";
const ROOT = __dirname;
const INDEX = path.join(ROOT, "index.html");

// ==== 今回の配布物（全差し替え）====
const NEW_FILES = [
  {
    src: "C:\\Users\\USER\\OneDrive\\PwC\\ゲーム会社紹介スライド\\260722_ゲーム業界トレンドと政策対談のご紹介_v5.pptx",
    name: "業界レポートサンプル_16x9.pptx",
    label: "業界レポートサンプル（16:9）",
    sub: "PowerPoint形式",
  },
];

const html = fs.readFileSync(INDEX, "utf8");
const m = html.match(/const DATA = \{ salt:"([^"]+)", pageIv:"([^"]+)", page:"([^"]+)", iter:(\d+) \}/);
if (!m) throw new Error("DATA not found / format mismatch");
const [, saltB64, pageIvB64, pageB64, iterStr] = m;
const iter = parseInt(iterStr, 10);
const salt = Buffer.from(saltB64, "base64");
const key = crypto.pbkdf2Sync(Buffer.from(PW, "utf8"), salt, iter, 32, "sha256");

function dec(ivB64OrBuf, dataBuf) {
  const iv = Buffer.isBuffer(ivB64OrBuf) ? ivB64OrBuf : Buffer.from(ivB64OrBuf, "base64");
  const tag = dataBuf.slice(dataBuf.length - 16);
  const ct = dataBuf.slice(0, dataBuf.length - 16);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}
function enc(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return { iv, data: Buffer.concat([ct, c.getAuthTag()]) };
}

// 1) ページ復号
let page = dec(pageIvB64, Buffer.from(pageB64, "base64")).toString("utf8");
console.log("page decrypted:", page.length, "chars");

// 2) DOWNLOADS 差し替え
const dm = page.match(/const DOWNLOADS = \[[\s\S]*?\];/);
if (!dm) throw new Error("DOWNLOADS not found in page");
console.log("old DOWNLOADS:", dm[0].slice(0, 400));

// 旧 assets を全削除
for (const f of fs.readdirSync(path.join(ROOT, "assets"))) {
  fs.unlinkSync(path.join(ROOT, "assets", f));
}

const entries = [];
NEW_FILES.forEach((nf, i) => {
  const buf = fs.readFileSync(nf.src);
  const e = enc(buf);
  const asset = `assets/f${i + 1}.enc`;
  fs.writeFileSync(path.join(ROOT, asset), e.data);
  entries.push({
    name: nf.name, label: nf.label, sub: nf.sub,
    asset, iv: e.iv.toString("base64"), size: buf.length,
  });
  // 往復検証
  const back = dec(e.iv, e.data);
  if (Buffer.compare(back, buf) !== 0) throw new Error("roundtrip mismatch: " + nf.src);
  console.log("encrypted:", asset, buf.length, "bytes ->", nf.name);
});

const newDl = "const DOWNLOADS = " + JSON.stringify(entries, null, 2) + ";";
page = page.replace(dm[0], newDl);

// 3) ページ再暗号化（salt維持・新pageIv）
const pe = enc(Buffer.from(page, "utf8"));
const newData = `const DATA = { salt:"${saltB64}", pageIv:"${pe.iv.toString("base64")}", page:"${pe.data.toString("base64")}", iter:${iter} }`;
const newHtml = html.replace(m[0], newData);
fs.writeFileSync(INDEX, newHtml, "utf8");

// 4) 検証：index再読込→復号→DOWNLOADS一致、誤PW拒否
const html2 = fs.readFileSync(INDEX, "utf8");
const m2 = html2.match(/const DATA = \{ salt:"([^"]+)", pageIv:"([^"]+)", page:"([^"]+)", iter:(\d+) \}/);
const page2 = dec(m2[2], Buffer.from(m2[3], "base64")).toString("utf8");
if (!entries.every(e => page2.includes(e.asset))) throw new Error("verify: DOWNLOADS not in re-decrypted page");
try {
  const badKey = crypto.pbkdf2Sync(Buffer.from("0000", "utf8"), salt, iter, 32, "sha256");
  const iv = Buffer.from(m2[2], "base64");
  const dataBuf = Buffer.from(m2[3], "base64");
  const tag = dataBuf.slice(dataBuf.length - 16);
  const ct = dataBuf.slice(0, dataBuf.length - 16);
  const d = crypto.createDecipheriv("aes-256-gcm", badKey, iv);
  d.setAuthTag(tag);
  Buffer.concat([d.update(ct), d.final()]);
  throw new Error("verify: wrong password was ACCEPTED");
} catch (e) {
  if (String(e.message).includes("ACCEPTED")) throw e;
  console.log("wrong-password correctly rejected");
}
console.log("ALL OK. entries:", entries.map(e => e.name).join(" / "));
