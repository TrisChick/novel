#!/usr/bin/env node
/**
 * 小说自动导入工具 —— 把一本 TXT 小说自动拆分成阅读站可用的章节文件。
 *
 * 用法：
 *   node tools/import_novel.mjs "<小说TXT路径>" [选项]
 *
 * 选项：
 *   --book <书名>        指定书名（默认自动从《书名》或文件名提取）
 *   --author <作者>      指定作者（默认自动从“作者：xxx”提取）
 *   --out <目录>         输出目录（默认为 novel/<书名>/）
 *   --dry-run            只分析不写文件
 *
 * 自动完成的事情：
 *   1. 编码自动识别（UTF-8 / GB18030）
 *   2. 章节标题自动识别（第X章 / 第X节 / 第X回 / 第X卷 等，行首锚定防误判）
 *   3. 段落自动切分（识别 4 空格/空行/每行一段 等常见 TXT 排版）
 *   4. 生成 ZW_META 元信息头，输出 novel/<书名>/NNN.txt（NNN 为 001 起零填充序号）
 *   5. 前置“内容简介/文案”自动成为 000.txt
 *   6. 更新 novel/sort.json 的 order 列表（保留已有书籍）
 *
 * 示例：
 *   node tools/import_novel.mjs "E:\Typography work\小说TXT\绍宋.txt"
 *   node tools/import_novel.mjs "新书.txt" --book "新书" --author "某作者" --dry-run
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';

// ==================== 参数解析 ====================
function parseArgs(argv) {
  const args = { out: null, dryRun: false, book: null, author: null, input: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book') args.book = argv[++i];
    else if (a === '--author') args.author = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') { console.log(usageText()); process.exit(0); }
    else args.input = a;
  }
  if (!args.input) { console.error('缺少输入文件路径'); console.error(usageText()); process.exit(1); }
  return args;
}
function usageText() {
  return `用法: node tools/import_novel.mjs "<小说TXT路径>" [--book 书名] [--author 作者] [--out 目录] [--dry-run]`;
}

// ==================== 编码自动识别 ====================
function decodeAuto(buf) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'utf-8' };
  } catch {
    return { text: new TextDecoder('gb18030').decode(buf), enc: 'gb18030' };
  }
}

// ==================== 章节标题自动识别 ====================
const CN_NUM = '一二三四五六七八九十百千万零两〇0-9';
const HEAD_PATTERNS = [
  { key: '章节回', re: new RegExp(`^[ \\t\\u3000]*第[${CN_NUM}]{1,10}[章节回][^\\r\\n]*`, 'gm') },
  { key: '卷部集', re: new RegExp(`^[ \\t\\u3000]*第[${CN_NUM}]{1,10}[卷部集][^\\r\\n]*`, 'gm') },
  { key: '特殊', re: /^[ \t\u3000]*(序章|序言|楔子|引子|尾声|终章|后记|番外[^\r\n]*)/gm },
];
function detectHeadings(text) {
  let best = null;
  for (const p of HEAD_PATTERNS) {
    const n = (text.match(p.re) || []).length;
    if (n > (best ? best.count : 0)) best = { pattern: p, count: n };
  }
  return best; // best.pattern.re has /g flag state — always reset with lastIndex=0 before use
}

// ==================== 段落切分 ====================
// 下载站常见页脚/分隔线，识别后直接丢弃
const BOILERPLATE = [
  /^[-－—=]{10,}$/,                        // 纯横线分隔
  /^[-－—=]{8,}[^\r\n]*[-－—=]{8,}$/,      // 横线夹文字的站点标记（如 ----用户上传之内容结束----）
  /用户上传之内容(开始|结束)/,
  /^声明[：:]/,
  /^本书(为|来自|由)/,
];
function isBoilerplate(p) {
  return BOILERPLATE.some(re => re.test(p));
}
function splitParagraphs(seg) {
  seg = seg.replace(/\r\n?/g, '\n');
  // 把所有段落分隔符统一成换行：
  //   空行（可能夹带空格） -> 换行；4+ 空格/TAB、2+ 全角空格 -> 换行
  seg = seg.replace(/[\r\n]+[ \t]*[\r\n]+/g, '\n');
  seg = seg.replace(/(?:[ \t]{4,}|[\u3000]{2,})/g, '\n');
  return seg.split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !isBoilerplate(s))
    .map(s => s.replace(/^[\u3000 ]+/, ''));
}

// ==================== 元信息提取 ====================
function extractMeta(lines) {
  const head = lines.slice(0, 100);
  let book = '', author = '';
  for (const l of head) {
    if (!book) {
      const m = l.match(/《([^》\n]{1,40})》/);
      if (m) book = m[1].trim();
    }
    if (!author) {
      const m = l.match(/^\s*作\s*者[：:]\s*([^\r\n]{1,30})/);
      if (m) author = m[1].trim();
    }
  }
  return { book, author };
}

// ==================== 主流程 ====================
function main() {
  const args = parseArgs(process.argv.slice(2));
  const buf = readFileSync(args.input);
  const { text, enc } = decodeAuto(buf);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  // 识别章节标题（行首锚定，避免把标题内的“第X章”字样误判）
  const det = detectHeadings(text);
  const re = new RegExp(det.pattern.re.source, 'gm');
  re.lastIndex = 0;
  const headings = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    headings.push({ index: text.slice(0, m.index).split('\n').length - 1, title: m[0].trim() });
  }
  console.log(`[1] 编码: ${enc} | 标题模式: ${det.pattern.key} | 识别到 ${headings.length} 个章节标题`);
  if (headings.length < 5) {
    console.error('识别的章节数过少，请检查小说格式（可能不是“第X章”式标题）。');
    process.exit(1);
  }

  const meta = extractMeta(lines);
  const book = args.book || meta.book || basename(args.input).replace(/\.(txt|TXT)$/, '');
  const author = args.author || meta.author || '佚名';
  const outDir = args.out || join(process.cwd(), 'novel', book);
  console.log(`[2] 书名: ${book} | 作者: ${author} | 输出目录: ${outDir}`);

  // 前置简介（第一个章节标题之前的“内容简介/简介/文案”之后的内容）
  const firstHeadingLine = headings[0].index;
  let introStart = -1, introTitle = '内容简介';
  for (let i = 0; i < firstHeadingLine; i++) {
    const mm = lines[i].match(/^\s*(内容简介|简介|文案)[：:]?\s*$/);
    if (mm) { introStart = i + 1; if (mm[1]) introTitle = mm[1]; break; }
  }
  const files = [];
  if (introStart >= 0 && introStart < firstHeadingLine) {
    const paras = splitParagraphs(lines.slice(introStart, firstHeadingLine).join('\n'));
    if (paras.length > 0) {
      files.push({ num: '000', title: introTitle, paras });
    }
  }

  // 逐章切分
  headings.forEach((h, i) => {
    const start = h.index + 1;
    const end = i + 1 < headings.length ? headings[i + 1].index : lines.length - 1;
    const seg = lines.slice(start, end).join('\n');
    let paras = splitParagraphs(seg);
    if (paras.length === 0) paras = [h.title];
    files.push({ num: String(i + 1).padStart(3, '0'), title: h.title, paras });
  });
  console.log(`[3] 共切出 ${files.length} 个文件（含前置简介）`);

  if (args.dryRun) {
    console.log('[dry-run] 跳过写入。前 5 个文件:');
    files.slice(0, 5).forEach(f => console.log(`   ${f.num}.txt -> ${f.title}`));
    return;
  }

  // 写文件（UTF-8 无 BOM）
  mkdirSync(outDir, { recursive: true });
  for (const f of files) {
    const metaJson = JSON.stringify({ title: f.title, author, book });
    const content = `<!-- ZW_META: ${metaJson} -->\n${f.paras.join('\n\n')}`;
    writeFileSync(join(outDir, `${f.num}.txt`), content, 'utf8');
  }
  console.log(`[4] 已写出 ${files.length} 个文件到 ${outDir}`);

  // 更新 novel/sort.json
  const sortPath = join(process.cwd(), 'novel', 'sort.json');
  let order = [];
  if (existsSync(sortPath)) {
    try { order = JSON.parse(readFileSync(sortPath, 'utf8')).order || []; } catch {}
  }
  if (!order.includes(book)) order.push(book);
  writeFileSync(sortPath, JSON.stringify({ order }, null, 2) + '\n', 'utf8');
  console.log(`[5] 已更新 novel/sort.json 顺序: ${order.join(', ')}`);
}

main();
