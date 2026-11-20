import zlib from "node:zlib";
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO_NAME || "helloipa-app";
const H = { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "user-agent": "quqi" };
const API = "https://api.github.com";
const owner = (await (await fetch(`${API}/user`, { headers: H })).json()).login;

const runs = await (await fetch(`${API}/repos/${owner}/${REPO}/actions/runs?per_page=3`, { headers: H })).json();
const run = runs.workflow_runs?.[0];
if (!run) { console.log("no runs"); process.exit(0); }
console.log("run", run.id, run.status, run.conclusion);

// 尝试拿日志 zip
const r = await fetch(`${API}/repos/${owner}/${REPO}/actions/runs/${run.id}/logs`, { headers: H, redirect: "manual" });
console.log("logs status", r.status);
const loc = r.headers.get("location");
if (loc) {
  const bin = Buffer.from(await (await fetch(loc)).arrayBuffer());
  console.log("zip bytes", bin.length);
  // 简易 unzip
  let eocd = -1;
  for (let i = bin.length - 22; i >= 0 && i > bin.length - 65558; i--) if (bin.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd >= 0) {
    const n = bin.readUInt16LE(eocd + 10);
    let p = bin.readUInt32LE(eocd + 16);
    for (let k = 0; k < n; k++) {
      const method = bin.readUInt16LE(p + 10);
      const csize = bin.readUInt32LE(p + 20);
      const nl = bin.readUInt16LE(p + 28), el = bin.readUInt16LE(p + 30), cl = bin.readUInt16LE(p + 32);
      const lho = bin.readUInt32LE(p + 42);
      const name = bin.slice(p + 46, p + 46 + nl).toString("utf8");
      const lnl = bin.readUInt16LE(lho + 26), lel = bin.readUInt16LE(lho + 28);
      const s = lho + 30 + lnl + lel;
      const raw = bin.slice(s, s + csize);
      const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
      console.log(`--- ${name} (${data.length}) ---`);
      console.log(data.toString("utf8").slice(0, 3000));
      p += 46 + nl + el + cl;
    }
  }
} else {
  console.log("no location; body:", (await r.text()).slice(0, 300));
}

// 也看 check-runs 的 output
const cr = await fetch(`${API}/repos/${owner}/${REPO}/commits/${run.head_sha}/check-runs`, { headers: H });
const crj = await cr.json();
for (const c of crj.check_runs ?? []) {
  console.log(`check: ${c.name} ${c.status}/${c.conclusion}  ${c.output?.title ?? ""} ${c.output?.summary ?? ""}`);
}