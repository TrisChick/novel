#!/usr/bin/env node
/**
 * 生成访问口令的 SHA-256 哈希（用于 app.js 的 CONFIG.ACCESS_PWD）。
 * 用法：
 *   node tools/gen_pwd.mjs 你的口令
 * 输出一行十六进制哈希，把它粘贴到 app.js 的 CONFIG.ACCESS_PWD 即可启用口令门。
 */
import { createHash } from 'node:crypto';

const pwd = process.argv[2];
if (!pwd) {
  console.error('用法: node tools/gen_pwd.mjs 你的口令');
  process.exit(1);
}
console.log(createHash('sha256').update(pwd, 'utf8').digest('hex'));
