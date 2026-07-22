// ライブE2E検証: 本番サイトから index/assets を取得し、PWで復号して原本一致を確認
const crypto = require("crypto");
const fs = require("fs");
const PW = "1964";
const BASE = "https://eurekastudio5.github.io/dropzone-site/";
const ORIG = [
  "C:\\Users\\USER\\OneDrive\\PwC\\ゲーム会社紹介スライド\\骨子_ゲーム会社向け2スライド_v3_20260722.docx",
];

async function get(url) {
  const r = await fetch(url + "?cb=" + Math.random(), { cache: "no-store" });
  if (!r.ok) throw new Error(r.status + " " + url);
  return Buffer.from(await r.arrayBuffer());
}

(async () => {
  const html = (await get(BASE)).toString("utf8");
  const m = html.match(/const DATA = \{ salt:"([^"]+)", pageIv:"([^"]+)", page:"([^"]+)", iter:(\d+) \}/);
  if (!m) throw new Error("DATA not found on live site");
  const key = crypto.pbkdf2Sync(Buffer.from(PW), Buffer.from(m[1], "base64"), parseInt(m[4]), 32, "sha256");
  const dec = (ivB64, buf) => {
    const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    d.setAuthTag(buf.slice(-16));
    return Buffer.concat([d.update(buf.slice(0, -16)), d.final()]);
  };
  const page = dec(m[2], Buffer.from(m[3], "base64")).toString("utf8");
  const dl = JSON.parse(page.match(/const DOWNLOADS = (\[[\s\S]*?\]);/)[1]);
  console.log("live DOWNLOADS:", dl.map(d => d.name + " (" + d.size + "B)").join(" / "));
  for (let i = 0; i < dl.length; i++) {
    const encBuf = await get(BASE + dl[i].asset);
    const plain = dec(dl[i].iv, encBuf);
    const orig = fs.readFileSync(ORIG[i]);
    if (Buffer.compare(plain, orig) !== 0) throw new Error("MISMATCH: " + dl[i].name);
    console.log("MATCH:", dl[i].name, "<->", ORIG[i]);
  }
  console.log("LIVE E2E ALL OK");
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
