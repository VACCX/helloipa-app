#!/usr/bin/env node
/**
 * publish-github.mjs —— 把本仓库发到 GitHub，触发 macOS 构建，等它跑完，
 * 把产出的 ipa 下载并解开到本地。
 *
 * 用法：
 *   GITHUB_TOKEN=ghp_xxx node scripts/publish-github.mjs
 *   GITHUB_TOKEN=ghp_xxx REPO_NAME=myapp PRIVATE=1 node scripts/publish-github.mjs
 *
 * 需要的 token 权限：classic PAT 勾 repo + workflow；或 fine-grained 勾
 *   Administration:write, Contents:write, Actions:read, Workflows:write（对本仓库）。
 *
 * 产物：
 *   build/artifact-<id>.zip         GitHub 原始 artifact
 *   build/HelloIPA-unsigned.ipa     解出来的 ipa
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const REPO_NAME = process.env.REPO_NAME || "helloipa-app";
const PRIVATE = (process.env.PRIVATE ?? "1") !== "0";
const BRANCH = process.env.BRANCH || "main";
const WORKFLOW_FILE = process.env.WORKFLOW_FILE || "build-ipa.yml";
const API = "https://api.github.com";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", ".."); // DSH-Go：仓库根
const BUILD = path.join(ROOT, "HelloIPA", "build");

/* ---------- 预检：无 token 或 DRY_RUN=1 时跑本地全量自检，不碰网络写操作 ---------- */
const DRY = process.env.DRY_RUN === "1" || !TOKEN;

if (DRY) {
  console.log("=== PREFLIGHT (dry run, no network writes) ===");
  const report = [];
  const add = (ok, msg) => { report.push({ ok, msg }); };

  // 1) 必备文件
  const need = [
    ".github/workflows/build-ipa.yml",
    "HelloIPA/HelloIPA.xcodeproj/project.pbxproj",
    "HelloIPA/HelloIPA.xcodeproj/xcshareddata/xcschemes/HelloIPA.xcscheme",
    "HelloIPA/HelloIPA/HelloIPAApp.swift",
    "HelloIPA/HelloIPA/ContentView.swift",
    "HelloIPA/HelloIPA/DeviceInfo.swift",
    "HelloIPA/HelloIPA/ToolView.swift",
    "HelloIPA/HelloIPA/Info.plist",
    "HelloIPA/scripts/make-ipa.mjs",
  ];
  for (const rel of need) {
    add(fs.existsSync(path.join(ROOT, rel)), `file: ${rel}`);
  }

  // 2) 工作流引用的路径与脚本真实存在
  const wfPath = path.join(ROOT, ".github/workflows/build-ipa.yml");
  if (fs.existsSync(wfPath)) {
    const wf = fs.readFileSync(wfPath, "utf8");
    add(/working-directory:\s*HelloIPA/.test(wf), "workflow: working-directory=HelloIPA");
    add(/runs-on:\s*macos-/.test(wf), "workflow: macOS runner");
    add(/check-project\.mjs/.test(wf), "workflow: 调用 check-project.mjs");
    add(/make-ipa\.mjs/.test(wf), "workflow: 调用 make-ipa.mjs");
    add(/upload-artifact/.test(wf), "workflow: 上传 artifact");
    add(/CODE_SIGNING_ALLOWED=NO/.test(wf), "workflow: 关闭签名（免开发者账号）");
    const m = wf.match(/-project\s+(\S+)/);
    if (m) add(fs.existsSync(path.join(ROOT, "HelloIPA", m[1])), `workflow: -project ${m[1]} 存在`);
    const s = wf.match(/-scheme\s+(\S+)/);
    if (s) add(/BlueprintName = "/.test("BlueprintName = \"") && fs.existsSync(path.join(ROOT, "HelloIPA/HelloIPA.xcodeproj/xcshareddata/xcschemes", s[1] + ".xcscheme")), `workflow: -scheme ${s[1]} 有共享 scheme`);
  }

  // 3) 文件清单（推送范围）
  const SKIP = new Set(["build", "node_modules", ".git", "DerivedData"]);
  const ROOTS_D = [".github", "HelloIPA"];
  const walk = (dir, rel, acc) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r, acc);
      else if (e.isFile()) acc.push({ rel: r, size: fs.statSync(abs).size });
    }
    return acc;
  };
  const files = [];
  for (const root of ROOTS_D) {
    const abs = path.join(ROOT, root);
    if (fs.existsSync(abs)) walk(abs, root, files);
  }
  const total = files.reduce((a, f) => a + f.size, 0);
  add(files.length > 0, `push set: ${files.length} files, ${(total / 1024).toFixed(1)} KiB (roots: ${ROOTS_D.join(", ")})`);

  // 4) GitHub API 可达
  let apiOK = false;
  try {
    const r = await fetch("https://api.github.com/zen", { headers: { "user-agent": "quqi" } });
    apiOK = r.status === 200;
  } catch { apiOK = false; }
  add(apiOK, "github api reachable (api.github.com/zen)");

  // 5) token 状态
  add(!!TOKEN, TOKEN ? "GITHUB_TOKEN present" : "GITHUB_TOKEN MISSING (设置后即可真跑)");

  for (const r of report) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.msg}`);
  const fails = report.filter((r) => !r.ok);
  console.log(`\nfiles:`);
  for (const f of files) console.log(`  ${String(f.size).padStart(7)}  ${f.rel}`);
  console.log(`\nresult: ${report.length - fails.length} pass / ${fails.length} fail`);
  if (!TOKEN) {
    console.log("\n把 token 填进去就能真跑（一条命令）：");
    console.log("  GITHUB_TOKEN=ghp_xxx node HelloIPA/scripts/publish-github.mjs");
  }
  process.exit(fails.length ? 1 : 0);
}

const H = {
  authorization: `Bearer ${TOKEN}`,
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "quqi-publish",
};

async function api(method, p, body) {
  const r = await fetch(p.startsWith("http") ? p : API + p, {
    method,
    headers: body ? { ...H, "content-type": "application/json" } : H,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON */ }
  return { status: r.status, json, text, headers: r.headers };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1. 身份 ---------- */
const me = await api("GET", "/user");
if (me.status !== 200) {
  console.error(`token 不可用（${me.status}）：${me.json?.message ?? me.text.slice(0, 200)}`);
  process.exit(2);
}
const owner = me.json.login;
console.log(`token OK: @${owner}`);

/* ---------- 2. 建仓（已存在则复用） ---------- */
let repo = await api("GET", `/repos/${owner}/${REPO_NAME}`);
if (repo.status === 404) {
  if ((process.env.CHECK_ONLY ?? "0") === "1") {
    console.log(`repo ${owner}/${REPO_NAME} 不存在 —— 真跑时会自动新建（${PRIVATE ? "私有" : "公开"}）`);
    process.exit(0);
  }
  const created = await api("POST", "/user/repos", {
    name: REPO_NAME,
    private: PRIVATE,
    auto_init: true,
    description: "HelloIPA — SwiftUI app + unsigned ipa pipeline",
  });
  if (created.status >= 300) {
    console.error(`建仓失败 ${created.status}: ${created.json?.message ?? created.text.slice(0, 300)}`);
    if (String(created.json?.message ?? "").includes("scope"))
      console.error("→ token 少了 repo 权限");
    process.exit(3);
  }
  repo = created;
  console.log(`repo created: ${owner}/${REPO_NAME} (${PRIVATE ? "private" : "public"})`);
} else if (repo.status === 200) {
  console.log(`repo exists: ${owner}/${REPO_NAME}`);
} else {
  console.error(`查仓失败 ${repo.status}: ${repo.json?.message ?? repo.text.slice(0, 200)}`);
  process.exit(3);
}

/* ---------- 2.5 CHECK_ONLY：只看仓库现状，不推送 ---------- */
if ((process.env.CHECK_ONLY ?? "0") === "1") {
  const r = repo.json;
  console.log("=== repo status ===");
  console.log(`  full_name    : ${r.full_name}`);
  console.log(`  private      : ${r.private}`);
  console.log(`  default_branch: ${r.default_branch}`);
  console.log(`  size         : ${r.size} KiB`);
  console.log(`  pushed_at    : ${r.pushed_at}`);
  console.log(`  html_url     : ${r.html_url}`);
  const wf = await api("GET", `/repos/${owner}/${REPO_NAME}/contents/.github/workflows`);
  console.log(`  has .github/workflows: ${wf.status === 200 ? (wf.json ?? []).map((x) => x.name).join(", ") : "否"}`);
  const hl = await api("GET", `/repos/${owner}/${REPO_NAME}/contents/HelloIPA`);
  console.log(`  has HelloIPA/        : ${hl.status === 200 ? "是（同名文件会被覆盖）" : "否"}`);
  process.exit(0);
}

/* ---------- 3. 收集文件 ---------- */
// 默认只推 .github/ 与 HelloIPA/，避免把工作区其它无关目录带进仓库。
// INCLUDE_ALL=1 时推整个工作区。
const INCLUDE_ALL = (process.env.INCLUDE_ALL ?? "0") === "1";
const ROOTS = INCLUDE_ALL ? [""] : [".github", "HelloIPA"];
const SKIP_DIRS = new Set(["build", "node_modules", ".git", "DerivedData"]);
function walk(dir, rel, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(abs, r, acc);
    else if (e.isFile()) acc.push({ rel: r, abs });
  }
  return acc;
}
const files = [];
for (const root of ROOTS) {
  const abs = path.join(ROOT, root);
  if (!fs.existsSync(abs)) continue;
  if (root === "") walk(abs, "", files);
  else walk(abs, root, files);
}
console.log(`files to push: ${files.length} (roots: ${ROOTS.map((r) => r || ".").join(", ")})`);

/* ---------- 4. blob → tree → commit → ref ---------- */
// 空仓库（0 commit）上 POST /git/blobs 会返回 409 "Git Repository is empty."。
// 先通过 contents API 建一个初始化 commit，再继续。
let bootstrapped = false;
async function bootstrapEmptyRepo() {
  const r = await api("PUT", `/repos/${owner}/${REPO_NAME}/contents/README.md`, {
    message: "chore: bootstrap repository",
    content: Buffer.from(`# ${REPO_NAME}\n`).toString("base64"),
  });
  if (r.status >= 300) {
    console.error(`初始化空仓库失败 ${r.status}: ${r.json?.message ?? r.text.slice(0, 200)}`);
    return false;
  }
  console.log("empty repo bootstrapped (README.md)");
  return true;
}

const tree = [];
for (const f of files) {
  const b64 = fs.readFileSync(f.abs).toString("base64");
  let blob = await api("POST", `/repos/${owner}/${REPO_NAME}/git/blobs`, { content: b64, encoding: "base64" });
  if (blob.status === 409 && !bootstrapped) {
    bootstrapped = true;
    if (!(await bootstrapEmptyRepo())) process.exit(4);
    blob = await api("POST", `/repos/${owner}/${REPO_NAME}/git/blobs`, { content: b64, encoding: "base64" });
  }
  if (blob.status >= 300) {
    console.error(`blob 失败 ${f.rel} ${blob.status}: ${blob.json?.message ?? ""}`);
    process.exit(4);
  }
  // 可执行文件保留 100755
  const mode = fs.statSync(f.abs).mode & 0o111 ? "100755" : "100644";
  tree.push({ path: f.rel, mode, type: "blob", sha: blob.json.sha });
}

// 拿基线的 commit 与 tree。注意：ref 的 object.sha 是 commit，不是 tree，
// base_tree 必须传 tree sha，否则整棵树会被覆盖（复用已有仓库时会把原有文件清掉）。
let baseCommitSha = null;
let baseTreeSha = null;
let refRes = await api("GET", `/repos/${owner}/${REPO_NAME}/git/ref/heads/${BRANCH}`);
if (refRes.status === 404 && repo.json?.default_branch && repo.json.default_branch !== BRANCH) {
  console.log(`分支 ${BRANCH} 不存在，改用仓库默认分支 ${repo.json.default_branch}`);
  refRes = await api("GET", `/repos/${owner}/${REPO_NAME}/git/ref/heads/${repo.json.default_branch}`);
}
if (refRes.status === 200) {
  baseCommitSha = refRes.json.object.sha;
  const baseCommit = await api("GET", `/repos/${owner}/${REPO_NAME}/git/commits/${baseCommitSha}`);
  baseTreeSha = baseCommit.status === 200 ? (baseCommit.json.tree?.sha ?? null) : null;
  if (!baseTreeSha) {
    console.error("取基线 tree 失败，停手（继续会整树覆盖已有仓库内容）");
    process.exit(4);
  }
  console.log(`base: commit=${baseCommitSha.slice(0, 10)} tree=${baseTreeSha.slice(0, 10)}`);
} else if (refRes.status === 404) {
  console.log(`分支 ${BRANCH} 还不存在（空仓库），将创建首个 commit`);
} else {
  console.error(`取 ref 失败 ${refRes.status}: ${refRes.json?.message ?? ""}`);
  process.exit(4);
}

const treeRes = await api("POST", `/repos/${owner}/${REPO_NAME}/git/trees`, {
  tree,
  ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
});
if (treeRes.status >= 300) {
  console.error(`tree 失败 ${treeRes.status}: ${treeRes.json?.message ?? ""}`);
  process.exit(4);
}

const commitRes = await api("POST", `/repos/${owner}/${REPO_NAME}/git/commits`, {
  message: `HelloIPA: push ${files.length} files from ${new Date().toISOString()}`,
  tree: treeRes.json.sha,
  parents: baseCommitSha ? [baseCommitSha] : [],
});
if (commitRes.status >= 300) {
  console.error(`commit 失败 ${commitRes.status}: ${commitRes.json?.message ?? ""}`);
  process.exit(4);
}
const sha = commitRes.json.sha;

const refUp = baseCommitSha
  ? await api("PATCH", `/repos/${owner}/${REPO_NAME}/git/refs/heads/${BRANCH}`, { sha, force: true })
  : await api("POST", `/repos/${owner}/${REPO_NAME}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha });
if (refUp.status >= 300) {
  console.error(`ref 失败 ${refUp.status}: ${refUp.json?.message ?? ""}`);
  process.exit(4);
}
console.log(`pushed: ${sha.slice(0, 10)} → ${BRANCH}`);

/* ---------- 5. 触发 workflow ---------- */
const disp = await api("POST", `/repos/${owner}/${REPO_NAME}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
  ref: BRANCH,
});
if (disp.status >= 300) {
  console.log(`dispatch 返回 ${disp.status}（${disp.json?.message ?? ""}），改等 push 触发的那次`);
} else {
  console.log("workflow dispatched");
}
await sleep(4000);

/* ---------- 6. 等构建 ---------- */
let run = null;
for (let i = 0; i < 60; i++) {
  const runs = await api("GET", `/repos/${owner}/${REPO_NAME}/actions/runs?per_page=20`);
  const list = runs.json?.workflow_runs ?? [];
  run = list.find((r) => r.head_sha === sha) ?? list[0] ?? null;
  if (run && run.status === "completed") break;
  if (run) process.stdout.write(`\r  ${run.status}/${run.conclusion ?? "-"}  ${i * 15}s   `);
  await sleep(15000);
}

if (!run) {
  console.error("\n没拿到 run，去网页看：https://github.com/" + owner + "/" + REPO_NAME + "/actions");
  process.exit(5);
}
console.log(`\nrun: ${run.status}/${run.conclusion}`);
console.log(`url: ${run.html_url}`);
if (run.conclusion !== "success") {
  const jobs = await api("GET", `/repos/${owner}/${REPO_NAME}/actions/runs/${run.id}/jobs`);
  for (const j of jobs.json?.jobs ?? []) {
    for (const s of j.steps ?? []) {
      console.log(`  [${s.conclusion ?? s.status}] ${j.name} / ${s.name}`);
    }
  }
  process.exit(5);
}

/* ---------- 7. 下载 artifact ---------- */
const arts = await api("GET", `/repos/${owner}/${REPO_NAME}/actions/runs/${run.id}/artifacts`);
const art = (arts.json?.artifacts ?? [])[0];
if (!art) {
  console.error("run 成功但没有 artifact");
  process.exit(6);
}
fs.mkdirSync(BUILD, { recursive: true });
const zipPath = path.join(BUILD, `artifact-${art.id}.zip`);
const dl = await fetch(art.archive_download_url, { headers: H, redirect: "manual" });
const loc = dl.headers.get("location");
if (!loc) {
  console.error(`artifact 下载失败 ${dl.status}`);
  process.exit(6);
}
const bin = await fetch(loc);
fs.writeFileSync(zipPath, Buffer.from(await bin.arrayBuffer()));
console.log(`artifact: ${zipPath} (${fs.statSync(zipPath).size} bytes)`);

/* ---------- 8. 解 zip 取出 ipa（自带实现，不依赖 unzip） ---------- */
function unzipAll(buf) {
  const out = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 65558; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("不是 zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("中央目录损坏");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(dataStart, dataStart + csize);
    out.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : raw });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const entries = unzipAll(fs.readFileSync(zipPath));
let ipaPath = null;
for (const e of entries) {
  console.log(`  in artifact: ${e.name} (${e.data.length} bytes)`);
  if (e.name.endsWith(".ipa")) {
    ipaPath = path.join(BUILD, path.basename(e.name));
    fs.writeFileSync(ipaPath, e.data);
  }
}
if (ipaPath) {
  console.log(`\nIPA: ${ipaPath} (${fs.statSync(ipaPath).size} bytes)`);
  console.log(`装法: Sideloadly / AltStore 拖进去，登自己的 Apple ID 签名`);
} else {
  console.log("artifact 里没有 .ipa，看上面的条目");
}
