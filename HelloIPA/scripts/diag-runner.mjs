// 诊断：先确认账号级 Actions 是否可用（ubuntu），再看 macOS 是否被限制
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO_NAME || "helloipa-app";
const H = { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "user-agent": "quqi" };
const API = "https://api.github.com";
const owner = (await (await fetch(`${API}/user`, { headers: H })).json()).login;
const j = async (m, p, body) => {
  const r = await fetch(API + p, { method: m, headers: body ? { ...H, "content-type": "application/json" } : H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let d = null; try { d = JSON.parse(t); } catch {}
  return { status: r.status, d, t: t.slice(0, 300) };
};

const mode = process.argv[2] || "ubuntu";
const runner = mode === "macos" ? "macos-14" : "ubuntu-latest";
const wf = `name: diag-${mode}
on: workflow_dispatch
jobs:
  d:
    runs-on: ${runner}
    steps:
      - run: |
          echo "runner ok"
          uname -a
`;
const put = await j("PUT", `/repos/${owner}/${REPO}/contents/.github/workflows/diag-${mode}.yml`, {
  message: `diag: ${mode} runner`, content: Buffer.from(wf).toString("base64"), branch: "main",
});
console.log("put", put.status, put.status < 300 ? "ok" : put.t);
await new Promise((r) => setTimeout(r, 3000));
const disp = await j("POST", `/repos/${owner}/${REPO}/actions/workflows/diag-${mode}.yml/dispatches`, { ref: "main" });
console.log("dispatch", disp.status, disp.status < 300 ? "ok" : disp.t);

for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const runs = await j("GET", `/repos/${owner}/${REPO}/actions/runs?per_page=5`);
  const r = (runs.d?.workflow_runs ?? []).find((x) => x.path.includes(`diag-${mode}`));
  if (r) {
    process.stdout.write(`\r  ${r.status}/${r.conclusion ?? "-"} ${i * 10}s   `);
    if (r.status === "completed") {
      console.log(`\nresult: ${r.conclusion} for ${mode} (${runner})`);
      const jobs = await j("GET", `/repos/${owner}/${REPO}/actions/runs/${r.id}/jobs`);
      for (const jb of jobs.d?.jobs ?? []) {
        console.log(` job ${jb.name} ${jb.status}/${jb.conclusion} runner=${jb.runner_name ?? "-"}`);
        for (const s of jb.steps ?? []) console.log(`   [${s.conclusion ?? s.status}] ${s.name}`);
      }
      break;
    }
  }
}