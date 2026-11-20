#!/usr/bin/env node
/**
 * make-ipa.mjs — 把一个已编译的 .app 打成 .ipa（零依赖，纯 node:zlib）。
 *
 * 用法：
 *   node scripts/make-ipa.mjs <输入 .app 目录> <输出 .ipa 文件>
 * 例：
 *   node scripts/make-ipa.mjs build/HelloIPA.xcarchive/Products/Applications/HelloIPA.app build/HelloIPA.ipa
 *
 * IPA 结构 = zip{ Payload/<Name>.app/... }，本脚本按 ZIP 规范直写，
 * 不依赖 zip 命令行，因此在任何装了 node>=18 的机器上都能跑（macOS / Linux / Windows）。
 * 权限位：目录 0755、可执行文件（无扩展名或以 .dylib/.so 结尾）0755、其余 0644、符号链接保留。
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const [, , inApp, outIpa] = process.argv;

if (!inApp || !outIpa) {
  console.error("用法: node make-ipa.mjs <Xxx.app 目录> <输出.ipa>");
  process.exit(2);
}
const appPath = path.resolve(inApp);
if (!fs.existsSync(appPath) || !fs.statSync(appPath).isDirectory()) {
  console.error(`输入不是目录: ${appPath}`);
  process.exit(2);
}
if (!appPath.endsWith(".app")) {
  console.error(`输入必须以 .app 结尾: ${appPath}`);
  process.exit(2);
}

const appName = path.basename(appPath);

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- DOS 时间 ---------- */
function dosTime(d) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/* ---------- 收集条目 ---------- */
function collect(abs, rel, out) {
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink()) {
    out.push({ kind: "symlink", rel, abs, target: fs.readlinkSync(abs), mtime: st.mtime });
    return out;
  }
  if (st.isDirectory()) {
    out.push({ kind: "dir", rel: rel.endsWith("/") ? rel : rel + "/", abs, mtime: st.mtime });
    for (const name of fs.readdirSync(abs).sort()) collect(path.join(abs, name), rel + "/" + name, out);
    return out;
  }
  const ext = path.extname(abs).toLowerCase();
  const execLike = ext === "" || ext === ".dylib" || ext === ".so";
  out.push({ kind: "file", rel, abs, mtime: st.mtime, exec: execLike && st.mode & 0o111 ? true : execLike });
  return out;
}

const PAYLOAD_ROOT = "Payload/" + appName;
const entries = [];
collect(appPath, PAYLOAD_ROOT, entries);
// 确保顶层目录条目存在（Payload/Xxx.app）
if (!entries.some((e) => e.rel === PAYLOAD_ROOT + "/")) {
  entries.unshift({ kind: "dir", rel: PAYLOAD_ROOT + "/", abs: appPath, mtime: fs.statSync(appPath).mtime });
}

/* ---------- 写 ZIP ---------- */
const chunks = [];
const central = [];
let offset = 0;

const FLAG_UTF8 = 0x0800;
const METHOD_DEFLATE = 8;
const METHOD_STORE = 0;

for (const e of entries) {
  const nameBuf = Buffer.from(e.rel, "utf8");
  let data;
  let method;
  let mode;

  if (e.kind === "dir") {
    data = Buffer.alloc(0);
    method = METHOD_STORE;
    mode = 0o040755;
  } else if (e.kind === "symlink") {
    data = Buffer.from(e.target, "utf8");
    method = METHOD_STORE;
    mode = 0o120777;
  } else {
    const raw = fs.readFileSync(e.abs);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    if (deflated.length < raw.length) {
      data = deflated;
      method = METHOD_DEFLATE;
    } else {
      data = raw;
      method = METHOD_STORE;
    }
    e._usize = raw.length;
    mode = e.exec ? 0o100755 : 0o100644;
  }

  const crc = crc32(e.kind === "file" ? fs.readFileSync(e.abs) : data);
  const usize = e.kind === "file" ? e._usize : data.length;
  const { time, date } = dosTime(e.mtime || new Date());

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(FLAG_UTF8, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(usize, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  chunks.push(local, nameBuf, data);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(0x031e, 4); // made by: unix / 3.0
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(FLAG_UTF8, 8);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt16LE(time, 12);
  cd.writeUInt16LE(date, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt32LE(usize, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt16LE(0, 30); // extra
  cd.writeUInt16LE(0, 32); // comment
  cd.writeUInt16LE(0, 34); // disk
  cd.writeUInt16LE(0, 36); // internal attrs
  cd.writeUInt32LE((mode << 16) >>> 0, 38); // external attrs
  cd.writeUInt32LE(offset, 42); // local header offset
  central.push(Buffer.concat([cd, nameBuf]));

  offset += local.length + nameBuf.length + data.length;
}

const cdBuf = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(cdBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

fs.mkdirSync(path.dirname(path.resolve(outIpa)), { recursive: true });
fs.writeFileSync(outIpa, Buffer.concat([...chunks, cdBuf, eocd]));

const size = fs.statSync(outIpa).size;
console.log(`OK  ${path.resolve(outIpa)}`);
console.log(`    entries=${entries.length}  size=${size} bytes  (${(size / 1024 / 1024).toFixed(2)} MiB)`);
console.log(`    payload=Payload/${appName}`);
