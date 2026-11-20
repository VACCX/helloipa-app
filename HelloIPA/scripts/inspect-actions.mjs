const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO_NAME || "helloipa-app";
const H = { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "user-agent": "quqi" };
const API = "https://api.github.com";
const owner = (await (await fetch(`${API}/user`, { headers: H })).json()).login;
const j = async (p) => {
  const r = await fetch(API + p, { headers: H });
  const t = await r.text();
  let d = null; try { d = JSON.parse(t); } catch {}
  return { status: r.status, d, t: t.slice(0, 400) };
};
const perms = await j(`/repos/${owner}/${REPO}/actions/permissions`);
console.log("actions/permissions:", perms.status, JSON.stringify(perms.d));
const wfs = await j(`/repos/${owner}/${REPO}/actions/workflows`);
console.log("workflows:", wfs.status, JSON.stringify(wfs.d?.workflows?.map(w => ({ id: w.id, name: w.name, path: w.path, state: w.state })) ?? wfs.t));
const repo = await j(`/repos/${owner}/${REPO}`);
console.log("repo:", JSON.stringify({ private: repo.d?.private, default_branch: repo.d?.default_branch, size: repo.d?.size }));
// 尝试重新 dispatch
if ((process.env.DISPATCH ?? "0") === "1") {
  const r = await fetch(`${API}/repos/${owner}/${REPO}/actions/workflows/build-ipa.yml/dispatches`, {
    method: "POST", headers: { ...H, "content-type": "application/json" },
    body: JSON.stringify({ ref: "main" }),
  });
  console.log("dispatch:", r.status, (await r.text()).slice(0, 200));
}