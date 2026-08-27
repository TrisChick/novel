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
 *   --pattern <正则>     强制使用自定义章节标题正则（覆盖自动检测）
 *   --single             强制整本当作一个章节导入（有无章节标题都如此）
 *   --min-chapters <n>   章节数低于 n 时降级为单篇（默认 1）
 *   --verbose            输出更详细的检测报告
 *   --dry-run            只分析不写文件
 *
 * 自动完成的事情：
 *   1. 编码自动识别（UTF-8 / GB18030）
 *   2. 多模式章节标题识别（第X章/回/话、第X节/篇/幕、第1章、Chapter 1、一、1、（一）、序章/番外 等，均行首锚定防误判）
 *   3. 卷识别（第X卷/上卷/卷X 显式卷标，或章节序号回绕的隐式卷），卷内章节按其序号分层
 *   4. 三档结构兜底：卷+章 / 普通分章 / 整本单篇（无章节也不报错）
 *   5. 段落自动切分（4 空格/空行/每行一段）+ 过滤下载站页脚
 *   6. 生成 ZW_META 头、novel/<书名>/NNN.txt、toc.json（含 mode/volumes 分组信息）、更新 sort.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

// ==================== 参数解析 ====================
function parseArgs(argv) {
  const args = { out: null, dryRun: false, book: null, author: null, input: null, pattern: null, single: false, minChapters: 1, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--book') args.book = argv[++i];
    else if (a === '--author') args.author = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--pattern') args.pattern = argv[++i];
    else if (a === '--single') args.single = true;
    else if (a === '--min-chapters') args.minChapters = parseInt(argv[++i], 10) || 1;
    else if (a === '--verbose') args.verbose = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--help' || a === '-h') { console.log(usageText()); process.exit(0); }
    else args.input = a;
  }
  if (!args.input) { console.error('缺少输入文件路径'); console.error(usageText()); process.exit(1); }
  return args;
}
function usageText() {
  return '用法: node tools/import_novel.mjs "<小说TXT路径>" [--book 书名] [--author 作者] [--out 目录] [--pattern 正则] [--single] [--min-chapters n] [--verbose] [--dry-run]';
}

// ==================== 编码自动识别 ====================
function decodeAuto(buf) {
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'utf-8' }; }
  catch { return { text: new TextDecoder('gb18030').decode(buf), enc: 'gb18030' }; }
}

// ==================== 中文/阿拉伯数字 <-> 整数 ====================
function cnToInt(s) {
  const d = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const u = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0, section = 0, cur = 0, has = false;
  for (const c of s) {
    if (d[c] !== undefined) { cur = d[c]; has = true; }
    else if (u[c] !== undefined) {
      if (u[c] === 10000) { section = (section + cur) * u[c]; cur = 0; total += section; section = 0; }
      else { if (cur === 0) cur = 1; section += cur * u[c]; cur = 0; }
      has = true;
    }
  }
  return total + section + cur;
}
function toNum(s) {
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return cnToInt(s);
}

// ==================== 标题候选模式（按优先级） ====================
const CN = '一二三四五六七八九十百千万零两〇0-9';
const WS = '\\s*';
const EOL = '[^\\r\\n]*';
const PATTERNS = [
  { key: 'volume', rank: 0, maxLen: 14,
    re: new RegExp(`^${WS}(?:第${WS}([${CN}]{1,10})${WS}[卷部集册]|([上下])${WS}卷|卷${WS}([${CN}]{1,6}))${WS}${EOL}`),
    ord: m => m[1] ? toNum(m[1]) : (m[2] ? (m[2] === '上' ? 1 : 2) : toNum(m[3])) },
  { key: 'chapter', rank: 1,
    re: new RegExp(`^${WS}第${WS}([${CN}]{1,10})${WS}[章回话]${WS}${EOL}`), ord: m => toNum(m[1]) },
  { key: 'chapterAr', rank: 2,
    re: /^\s*(?:Chapter|chapter|CHAPTER)\s+(\d{1,4})\s*[^\r\n]*/, ord: m => parseInt(m[1], 10) },
  { key: 'section', rank: 3,
    re: new RegExp(`^${WS}第${WS}([${CN}]{1,10})${WS}[节篇幕]${WS}${EOL}`), ord: m => toNum(m[1]) },
  { key: 'special', rank: 4,
    re: /^\s*(序章|序言|楔子|引子|尾声|终章|后记|番外|附章|正文|全文)[^\r\n]*/, ord: () => null },
  { key: 'numCn', rank: 5, bool: true,
    re: /^\s*[（(]?\s*([一二三四五六七八九十百千万零两〇]{1,10})\s*[、.． 　）)]\s*[^\r\n]*/, ord: m => toNum(m[1]) },
  { key: 'numAr', rank: 6, bool: true,
    re: /^\s*[（(]?\s*(\d{1,4})\s*[.．、）)]\s*[^\r\n]*/, ord: m => parseInt(m[1], 10) },
];

function matchLine(t) {
  for (const p of PATTERNS) {
    const m = t.match(p.re);
    if (!m) continue;
    if (p.maxLen && t.length > p.maxLen) continue;  // 卷标题通常很短
    if (p.bool && t.length > 30) continue;          // 裸数字靠长度约束防止正文/列表误判
    return { category: p.key, ordinal: p.ord(m), title: t, raw: t };
  }
  return null;
}

// ==================== 候选扫描 ====================
function scanCandidates(lines) {
  const cands = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    const r = matchLine(t);
    if (r) cands.push(Object.assign({ lineIdx: i }, r));
  }
  return cands;
}

// ==================== 章节类别选择 ====================
// 章节单元优先级（粗优先）：第X章/回/话 > Chapter N > 第X节/篇/幕
const STRONG_ORDER = ['chapter', 'chapterAr', 'section'];
function pickChapterSet(cands, totalLines) {
  const counts = {};
  for (const c of cands) counts[c.category] = (counts[c.category] || 0) + 1;
  let cat = null;
  for (const k of STRONG_ORDER) { if (counts[k] > 0) { cat = k; break; } }
  if (cat) {
    const special = cands.filter(c => c.category === 'special');
    const chs = cands.filter(c => c.category === cat).concat(special).sort((a, b) => a.lineIdx - b.lineIdx);
    return { kind: 'strong', cat, chapters: chs, counts };
  }
  // 裸数字：要求单调递增且分散分布（防前置目录/列表误判）
  const bare = cands.filter(c => c.category === 'numCn' || c.category === 'numAr');
  if (bare.length >= 2 && isSequentialBare(bare, totalLines)) {
    return { kind: 'bare', cat: 'bare', chapters: bare.sort((a, b) => a.lineIdx - b.lineIdx), counts };
  }
  const special = cands.filter(c => c.category === 'special');
  if (special.length >= 2) {
    return { kind: 'special', cat: 'special', chapters: special.sort((a, b) => a.lineIdx - b.lineIdx), counts };
  }
  return { kind: 'single', cat: null, chapters: [], counts };
}
function isSequentialBare(bare, totalLines) {
  const ords = bare.map(c => c.ordinal).filter(x => x !== null);
  if (ords.length < 2) return false;
  for (let i = 1; i < ords.length; i++) if (ords[i] <= ords[i - 1]) return false;
  const minLine = Math.min(...bare.map(c => c.lineIdx));
  const maxLine = Math.max(...bare.map(c => c.lineIdx));
  const spread = maxLine - minLine;
  return spread >= 0.2 * totalLines || ords.length >= 5;
}

// ==================== 卷分组 ====================
function assignVolumes(chapters, cands) {
  const volCands = cands.filter(c => c.category === 'volume')
    .sort((a, b) => a.lineIdx - b.lineIdx);
  if (volCands.length >= 2) {
    const groups = [];
    let vi = -1;
    for (const ch of chapters) {
      while (vi + 1 < volCands.length && volCands[vi + 1].lineIdx < ch.lineIdx) vi++;
      if (vi < 0) continue;
      if (!groups[vi]) groups[vi] = [];
      groups[vi].push(ch);
    }
    const segs = [];
    for (let j = 0; j < volCands.length; j++) {
      if (groups[j] && groups[j].length) segs.push({ title: volCands[j].title, startIdx: chapters.indexOf(groups[j][0]) });
    }
    if (segs.length >= 2) return { kind: 'volumes', segs };
  }
  // 隐式卷：内部章节序号回绕（如 86 -> 1）
  const cuts = [0];
  for (let i = 1; i < chapters.length; i++) {
    const a = chapters[i - 1].ordinal, b = chapters[i].ordinal;
    if (a != null && b != null && b < a) cuts.push(i);
  }
  if (cuts.length >= 2) {
    return { kind: 'volumes', segs: cuts.map((s, k) => ({ title: '第' + (k + 1) + '卷', startIdx: s })) };
  }
  return { kind: 'flat' };
}

// ==================== 段落切分 ====================
const BOILERPLATE = [
  /^[-－—=]{10,}$/, /^[-－—=]{8,}[^\r\n]*[-－—=]{8,}$/, /用户上传之内容(开始|结束)/, /^声明[：:]/, /^本书(为|来自|由)/,
];
function isBoilerplate(p) { return BOILERPLATE.some(re => re.test(p)); }
function splitParagraphs(seg) {
  seg = seg.replace(/\r\n?/g, '\n');
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
    if (!book) { const m = l.match(/《([^》\n]{1,40})》/); if (m) book = m[1].trim(); }
    if (!author) { const m = l.match(/^\s*作\s*者[：:]\s*([^\r\n]{1,30})/); if (m) author = m[1].trim(); }
  }
  return { book, author };
}

// ==================== 主流程 ====================
function main() {
  const args = parseArgs(process.argv.slice(2));
  const buf = readFileSync(args.input);
  const { text, enc } = decodeAuto(buf);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  const meta = extractMeta(lines);
  const book = args.book || meta.book || basename(args.input).replace(/\.(txt|TXT)$/, '');
  const author = args.author || meta.author || '佚名';
  const outDir = args.out || join(process.cwd(), 'novel', book);

  let files = [];        // {num,title,paras,volume?}
  let mode = 'single';

  if (args.single) {
    mode = 'single';
    const paras = splitParagraphs(lines.join('\n'));
    files.push({ num: '001', title: book, paras: paras.length ? paras : [text.replace(/\s+/g, ' ').trim()], volume: undefined });
  } else {
    const cands = scanCandidates(lines);
    const sel = pickChapterSet(cands, lines.length);
    // 自定义 --pattern 覆盖
    if (args.pattern) {
      const re2 = new RegExp('^\\s*' + args.pattern + '[^\\r\\n]*', 'i');
      const custom = [];
      for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t && re2.test(t)) custom.push({ lineIdx: i, category: 'chapter', ordinal: null, title: t, raw: t });
      }
      sel.chapters = custom.sort((a, b) => a.lineIdx - b.lineIdx);
      sel.kind = custom.length ? 'strong' : 'single';
    }

    const counts = sel.counts || {};
    const chapterCount = sel.chapters.length;

    if (args.verbose) {
      console.log(`[检测] 候选命中: 卷=${counts.volume || 0} 章=${counts.chapter || 0} 节=${counts.section || 0} Chapter=${counts.chapterAr || 0} 序/番外=${counts.special || 0} 裸数字=${(counts.numCn || 0) + (counts.numAr || 0)}`);
      console.log(`[检测] 选择类别=${sel.cat || '无'} 命中章节=${chapterCount}`);
    }

    if (chapterCount >= args.minChapters) {
      mode = 'chapters';
      const vols = assignVolumes(sel.chapters, cands);
      const chapterList = sel.chapters;

      // 前置简介（第一个章节之前的“内容简介/简介/文案”之后内容）
      let introStart = -1, introTitle = '内容简介';
      const firstHl = chapterList[0] ? chapterList[0].lineIdx : lines.length;
      for (let i = 0; i < firstHl; i++) {
        const mm = lines[i].match(/^\s*(内容简介|简介|文案)[：:]?\s*$/);
        if (mm) { introStart = i + 1; if (mm[1]) introTitle = mm[1]; break; }
      }
      if (introStart >= 0 && introStart < firstHl) {
        const paras = splitParagraphs(lines.slice(introStart, firstHl).join('\n'));
        if (paras.length) files.push({ num: '000', title: introTitle, paras, volume: undefined });
      }

      // 每章切分（顺序编号，全局唯一）
      chapterList.forEach((h, i) => {
        const start = h.lineIdx + 1;
        const end = i + 1 < chapterList.length ? chapterList[i + 1].lineIdx : lines.length - 1;
        let paras = splitParagraphs(lines.slice(start, end).join('\n'));
        if (paras.length === 0) paras = [h.title];
        files.push({ num: String(i + 1).padStart(3, '0'), title: h.title, paras, volume: undefined });
      });

      // 卷分组：给在卷内的章节标注 volume
      if (vols.kind === 'volumes') {
        mode = 'volumes';
        const segs = vols.segs;
        // volume[idx] 覆盖 [startIdx, nextStartIdx) 的章节（chapterList 下标）
        const volOf = new Array(chapterList.length).fill(undefined);
        for (let k = 0; k < segs.length; k++) {
          const from = segs[k].startIdx;
          const to = k + 1 < segs.length ? segs[k + 1].startIdx : chapterList.length;
          for (let i = from; i < to; i++) volOf[i] = segs[k].title;
        }
        const introPresent = files.length > 0 && files[0].num === '000';
        const offset = introPresent ? 1 : 0;
        for (let i = 0; i < chapterList.length; i++) {
          const f = files[offset + i];
          if (f) f.volume = volOf[i];
        }
      }
    } else {
      mode = 'single';
      const paras = splitParagraphs(lines.join('\n'));
      files.push({ num: '001', title: book, paras: paras.length ? paras : [text.replace(/\s+/g, ' ').trim()], volume: undefined });
    }
  }

  console.log(`[1] 编码: ${enc} | 书名: ${book} | 作者: ${author}`);
  console.log(`[2] 结构: ${mode} | 章节数: ${files.length}`);
  if (mode === 'volumes') {
    const vm = [];
    for (const f of files) if (f.volume && !vm.includes(f.volume)) vm.push(f.volume);
    console.log(`[3] 检测到卷: ${vm.join(' / ')}`);
  }

  if (args.dryRun) {
    console.log('[dry-run] 跳过写入。前 8 个文件:');
    files.slice(0, 8).forEach(f => console.log(`   ${f.num}.txt [${f.volume || '—'}] ${f.title}`));
    return;
  }

  // 写文件
  mkdirSync(outDir, { recursive: true });
  for (const f of files) {
    const metaJson = JSON.stringify({ title: f.title, author, book });
    writeFileSync(join(outDir, `${f.num}.txt`), `<!-- ZW_META: ${metaJson} -->\n${f.paras.join('\n\n')}`, 'utf8');
  }
  console.log(`[4] 已写出 ${files.length} 个文件到 ${outDir}`);

  // toc.json
  const chapters = files.map(f => {
    const o = { file: `${f.num}.txt`, title: f.title };
    if (f.volume) o.volume = f.volume;
    return o;
  });
  let toc = { book, author, mode, chapters };
  if (mode === 'volumes') {
    // 按卷分组
    const volsMap = {};
    const order = [];
    for (const f of files) {
      if (!f.volume) continue;
      if (!volsMap[f.volume]) { volsMap[f.volume] = { title: f.volume, chapters: [] }; order.push(f.volume); }
      volsMap[f.volume].chapters.push(`${f.num}.txt`);
    }
    toc.volumes = order.map(v => volsMap[v]);
  }
  writeFileSync(join(outDir, 'toc.json'), JSON.stringify(toc, null, 2) + '\n', 'utf8');
  console.log(`[5] 已生成 ${join(outDir, 'toc.json')}`);

  const sortPath = join(process.cwd(), 'novel', 'sort.json');
  let order2 = [];
  if (existsSync(sortPath)) { try { order2 = JSON.parse(readFileSync(sortPath, 'utf8')).order || []; } catch {} }
  if (!order2.includes(book)) order2.push(book);
  writeFileSync(sortPath, JSON.stringify({ order: order2 }, null, 2) + '\n', 'utf8');
  console.log(`[6] 已更新 novel/sort.json 顺序: ${order2.join(', ')}`);
}

main();
