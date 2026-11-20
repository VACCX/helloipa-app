// 检查最近几次 run 的状态与失败步骤
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO_NAME || "helloipa-app";
const H = { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "user-agent": "quqi" };
const API = "https://api.github.com";
const me = await (await fetch(`${API}/user`, { headers: H })).json();
const owner = me.login;
const j = async (p) => {
  const r = await fetch(API + p, { headers: H });
  const t = await r.text();
  let d = null; try { d = JSON.parse(t); } catch {}
  return { status: r.status, d, t };
};

const runs = await j(`/repos/${owner}/${REPO}/actions/runs?per_page=5`);
console.log("=== runs ===");
for (const r of runs.d?.workflow_runs ?? []) {
  console.log(`${r.id}  ${r.event}  ${r.status}/${r.conclusion}  sha=${r.head_sha.slice(0,8)}  ${r.created_at}`);
  console.log(`   name=${r.name}  path=${r.path}`);
}
const first = runs.d?.workflow_runs?.[0];
if (first) {
  const jobs = await j(`/repos/${owner}/${REPO}/actions/runs/${first.id}/jobs`);
  console.log(`\n=== jobs of ${first.id} ===`);
  for (const jb of jobs.d?.jobs ?? []) {
    console.log(`job: ${jb.name}  ${jb.status}/${jb.conclusion}`);
    for (const s of jb.steps ?? []) console.log(`   [${s.conclusion ?? s.status}] ${s.number}. ${s.name}`);
  }
  // 取日志地址
  console.log(`\nlogs: https://github.com/${owner}/${REPO}/actions/runs/${first.id}`);
}