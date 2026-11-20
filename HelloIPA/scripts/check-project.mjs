#!/usr/bin/env node
/**
 * check-project.mjs —— 在没有 Xcode 的环境里静态校验 .xcodeproj 是否自洽。
 * 覆盖：括号平衡 / 所有 24 位对象 ID 都有定义 / 每个 PBXBuildFile 的 fileRef 存在 /
 *       Sources 阶段列出的编译文件真的在磁盘上 / Info.plist 与 Assets 存在。
 *
 *   node scripts/check-project.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PBX = path.join(ROOT, "HelloIPA.xcodeproj", "project.pbxproj");
const fails = [];
const oks = [];
const ok = (m) => oks.push(m);
const bad = (m) => fails.push(m);

if (!fs.existsSync(PBX)) {
  console.error("找不到 project.pbxproj");
  process.exit(1);
}
const src = fs.readFileSync(PBX, "utf8");

/* 1. 括号 / 花括号平衡 */
const count = (s, ch) => (s.match(new RegExp("\\" + ch, "g")) || []).length;
if (count(src, "{") === count(src, "}")) ok(`花括号平衡 {}=${count(src, "{")}`);
else bad(`花括号不平衡 {}=${count(src, "{")} }=${count(src, "}")}`);
if (count(src, "(") === count(src, ")")) ok(`圆括号平衡 ()=${count(src, "(")}`);
else bad(`圆括号不平衡 ()=${count(src, "(")} )=${count(src, ")")}`);

/* 2. 收集定义与引用 */
const defined = new Set([...src.matchAll(/^\s*([0-9A-F]{24})(?:\s*\/\*.*?\*\/)?\s*=\s*\{/gm)].map((m) => m[1]));
const used = new Set([...src.matchAll(/\b([0-9A-F]{24})\b/g)].map((m) => m[1]));
const undef = [...used].filter((id) => !defined.has(id));
if (undef.length === 0) ok(`对象 ID 引用全部有定义（defined=${defined.size}, used=${used.size}）`);
else bad(`有 ${undef.length} 个 ID 未定义: ${undef.join(", ")}`);

/* 3. rootObject 指向 project */
const root = src.match(/rootObject = ([0-9A-F]{24})/)?.[1];
if (root && defined.has(root)) ok(`rootObject = ${root}`);
else bad("rootObject 缺失或未定义");

/* 4. PBXBuildFile 的 fileRef 定义存在 */
for (const m of src.matchAll(/isa = PBXBuildFile; fileRef = ([0-9A-F]{24})/g)) {
  if (!defined.has(m[1])) bad(`PBXBuildFile.fileRef 未定义: ${m[1]}`);
}

/* 5. 每个 PBXFileReference 的文件在磁盘上能找到同名文件（产物 .app 除外） */
const fileRefs = [...src.matchAll(/isa = PBXFileReference;[^}]*?path = ([^;]+);/g)].map((m) =>
  m[1].trim().replace(/^"|"$/g, "")
);
const walk = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "build" || e.name.startsWith(".")) continue;
    acc.push(e.name);
    if (e.isDirectory()) walk(path.join(dir, e.name), acc);
  }
  return acc;
};
const disk = new Set(walk(ROOT));
const missing = fileRefs.filter((p) => !p.endsWith(".app") && !disk.has(p));
if (missing.length === 0) ok(`文件引用全部落地（${fileRefs.length} 项，磁盘索引 ${disk.size} 项）`);
else bad(`磁盘缺文件: ${missing.join(", ")}`);

/* 6. Sources 阶段必须包含 4 个 swift */
const sourcesBlock = src.match(/isa = PBXSourcesBuildPhase;[\s\S]*?\);/)?.[0] ?? "";
const swiftCount = (sourcesBlock.match(/\.swift in Sources/g) || []).length;
if (swiftCount >= 4) ok(`Sources 阶段包含 ${swiftCount} 个 swift 编译项`);
else bad(`Sources 阶段只有 ${swiftCount} 个 swift 编译项`);

/* 7. 关键构建设置 */
const checks = {
  "INFOPLIST_FILE = HelloIPA/Info.plist": "INFOPLIST_FILE",
  "GENERATE_INFOPLIST_FILE = NO": "GENERATE_INFOPLIST_FILE",
  "PRODUCT_BUNDLE_IDENTIFIER": "PRODUCT_BUNDLE_IDENTIFIER",
  "IPHONEOS_DEPLOYMENT_TARGET": "IPHONEOS_DEPLOYMENT_TARGET",
  "productType = \"com.apple.product-type.application\"": "productType",
};
for (const [needle, label] of Object.entries(checks)) {
  if (src.includes(needle)) ok(`设置存在: ${label}`);
  else bad(`设置缺失: ${label}`);
}

/* 8. scheme 存在 */
const scheme = path.join(ROOT, "HelloIPA.xcodeproj", "xcshareddata", "xcschemes", "HelloIPA.xcscheme");
if (fs.existsSync(scheme)) ok("共享 scheme 存在（xcodebuild -scheme 可用）");
else bad("缺共享 scheme");

console.log(oks.map((m) => "  PASS  " + m).join("\n"));
if (fails.length) {
  console.log(fails.map((m) => "  FAIL  " + m).join("\n"));
  console.log(`\n结果: ${oks.length} 通过 / ${fails.length} 失败`);
  process.exit(1);
}
console.log(`\n结果: ${oks.length} 项全部通过`);
