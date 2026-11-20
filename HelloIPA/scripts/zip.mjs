#!/usr/bin/env node
/**
 * zip.mjs —— 最小 ZIP 读取器（node:zlib，零依赖）。用于从 GitHub artifact 里取 ipa。
 * 也可独立当自检：node scripts/zip.mjs <some.zip>
 */
import fs from "node:fs";
import zlib from "node:zlib";

export function unzipAll(buf) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 65558);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("找不到 EOCD：不是 zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`中央目录第 ${n} 项损坏`);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + csize);
    out.push({ name, method, data: method === 8 ? zlib.inflateRawSync(raw) : raw });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("zip.mjs")) {
  const target = process.argv[2];
  if (!target) {
    console.error("用法: node scripts/zip.mjs <file.zip>");
    process.exit(2);
  }
  const entries = unzipAll(fs.readFileSync(target));
  for (const e of entries) console.log(`${e.data.length}\t${e.method === 8 ? "deflate" : "store"}\t${e.name}`);
  console.log(`entries=${entries.length}`);
}
