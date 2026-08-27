// ===================== 全局配置 =====================
const CONFIG = {
    GH_USER: "TrisChick",
    GH_REPO: "novel",
    GH_BRANCH: "main",
    GH_API: "https://api.github.com/repos",
    CDN_BASE: "https://cdn.jsdelivr.net/gh/TrisChick/novel@main/",
    STORAGE_KEY: "simple_reader_setting",
    // 访问口令门（方案一，挡随手点开的路人；纯前端，懂行的人可绕过）
    // 填口令的 SHA-256 十六进制值即启用；留空字符串 = 不启用（公开）。
    // 生成：node tools/gen_pwd.mjs 你的口令
    ACCESS_PWD: ""
};

// ===================== 阅读设置（跨页持久化） =====================
let setting = { theme: "light", fontSize: 18, lineHeight: 1.8, pageMargin: 24 };

const $ = id => document.getElementById(id);

function loadSetting() {
    try {
        const s = JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY));
        if (s && typeof s === "object") setting = Object.assign(setting, s);
    } catch (e) {}
}
function saveSetting() {
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(setting));
}

// 主题：单按钮切换 日间/夜间，字体/行距/页边距 由 CSS 应用
function applyTheme() {
    document.body.dataset.theme = setting.theme;
    const btn = $("themeBtn");
    if (btn) btn.textContent = setting.theme === "dark" ? "日间" : "夜间";
}
function toggleTheme() {
    setting.theme = setting.theme === "dark" ? "light" : "dark";
    saveSetting();
    applyTheme();
}

// 应用到阅读区（字号/行距/页边距）
function applyReaderCss() {
    const c = $("reader-content");
    if (!c) return;
    c.style.fontSize = setting.fontSize + "px";
    c.style.lineHeight = setting.lineHeight;
    c.style.paddingLeft = setting.pageMargin + "px";
    c.style.paddingRight = setting.pageMargin + "px";
}
function changeFontSize(delta) {
    setting.fontSize = Math.max(14, Math.min(28, setting.fontSize + delta));
    saveSetting();
    applyReaderCss();
}

// ===================== 工具函数 =====================
function getQuery() {
    const p = new URLSearchParams(location.search);
    const o = {};
    for (const [k, v] of p) o[k] = decodeURIComponent(v);
    return o;
}
const enc = s => encodeURIComponent(s);

function showStatus(text) { const el = $("statusTip"); if (el) el.textContent = text; }
function showError(text) { const el = $("statusTip"); if (el) el.innerHTML = `<div class="error-tip">${text}</div>`; }
function toggleLoader(show) { const el = $("loader"); if (el) el.style.display = show ? "block" : "none"; }

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}
async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

// ===================== 设置弹窗 =====================
function openSettingModal() {
    $("setFontSize").value = setting.fontSize;
    $("setLineHeight").value = setting.lineHeight;
    $("setPageMargin").value = setting.pageMargin;
    $("settingModal").style.display = "flex";
}
function closeSettingModal() { $("settingModal").style.display = "none"; }
function saveGlobalSettings() {
    setting.fontSize = parseInt($("setFontSize").value) || 18;
    setting.lineHeight = parseFloat($("setLineHeight").value) || 1.8;
    setting.pageMargin = parseInt($("setPageMargin").value) || 24;
    saveSetting();
    applyReaderCss();
    closeSettingModal();
    showStatus("设置已保存");
}

// ===================== 数据读取 =====================
// 目录清单：novel/<书>/toc.json
const tocUrl = book => CONFIG.CDN_BASE + "novel/" + enc(book) + "/toc.json";
const chapterUrl = (book, file) => CONFIG.CDN_BASE + "novel/" + enc(book) + "/" + enc(file);

// 首页：枚举仓库里 novel/下一级目录的书籍名
async function listBooks() {
    const url = `${CONFIG.GH_API}/${CONFIG.GH_USER}/${CONFIG.GH_REPO}/git/trees/${CONFIG.GH_BRANCH}?recursive=1`;
    const data = await fetchJson(url);
    const books = {};
    for (const it of (data.tree || [])) {
        if (it.type !== "blob") continue;
        const m = it.path.match(/^novel\/([^/]+)\/[^/]+\.(txt|md)$/i);
        if (m) books[m[1]] = { name: m[1] };
    }
    return Object.values(books);
}

// ===================== 页面分发 =====================
async function initHome() {
    toggleLoader(true);
    showStatus("加载中");
    try {
        const raw = await listBooks();
        if (raw.length === 0) {
            showStatus("当前暂无书籍，敬请期待");
            renderBookList([]);
            return;
        }
        // 拉取每本书的 toc.json 获取作者与章节数
        const books = await Promise.all(raw.map(async b => {
            try {
                const t = await fetchJson(tocUrl(b.name));
                b.author = t.author || "佚名";
                b.count = (t.chapters || []).length;
                b.book = t.book || b.name;
            } catch (e) {
                b.author = "佚名";
                b.count = 0;
            }
            return b;
        }));
        // 统一按书名排序
        books.sort((a, b) => (a.book || a.name).localeCompare(b.book || b.name, "zh-CN"));
        renderBookList(books);
    } catch (e) {
        showError(`加载失败：${e.message}，请检查网络或仓库配置`);
    } finally {
        toggleLoader(false);
    }
}

function renderBookList(books) {
    const list = $("bookList");
    list.innerHTML = "";
    if (books.length === 0) return;
    books.forEach(b => {
        const name = b.book || b.name;
        const item = document.createElement("div");
        item.className = "book-item";
        const t = document.createElement("div");
        t.className = "book-item-title";
        t.textContent = name;
        const m = document.createElement("div");
        m.className = "book-item-meta";
        m.textContent = `作者：${b.author}　共 ${b.count} 章`;
        item.appendChild(t);
        item.appendChild(m);
        item.onclick = () => { location.href = `detail.html?book=${enc(name)}`; };
        list.appendChild(item);
    });
}

function doSearch() {
    const kw = ($("searchInput").value || "").trim().toLowerCase();
    const items = document.querySelectorAll(".book-item");
    items.forEach(it => {
        const txt = it.textContent.toLowerCase();
        it.style.display = (!kw || txt.includes(kw)) ? "" : "none";
    });
}

// ---- 详情页 ----
async function initDetail() {
    const { book } = getQuery();
    if (!book) { showError("缺少书籍参数"); return; }
    toggleLoader(true);
    showStatus("加载中");
    try {
        const t = await fetchJson(tocUrl(book));
        $("detailTitle").textContent = t.book || book;
        $("detailMeta").textContent = `作者：${t.author || "佚名"}　共 ${t.chapters.length} 章`;
        const toc = $("tocList");
        toc.innerHTML = "";
        const chapters = t.chapters || [];
        const open = file => { location.href = `reader.html?book=${enc(t.book || book)}&ch=${enc(file)}`; };
        const hasVolumes = t.mode === "volumes" && Array.isArray(t.volumes) && t.volumes.length > 0;
        if (hasVolumes) {
            // 不归属任何卷的章节（如前置简介、卷前序章）先平铺
            const inVol = new Set();
            t.volumes.forEach(v => (v.chapters || []).forEach(f => inVol.add(f)));
            chapters.filter(c => !inVol.has(c.file)).forEach(ch => {
                const item = document.createElement("div");
                item.className = "toc-item";
                item.textContent = ch.title;
                item.onclick = () => open(ch.file);
                toc.appendChild(item);
            });
            // 按卷分组
            t.volumes.forEach(v => {
                const hd = document.createElement("div");
                hd.className = "toc-volume";
                hd.textContent = v.title;
                toc.appendChild(hd);
                (v.chapters || []).forEach(file => {
                    const ch = chapters.find(c => c.file === file);
                    const item = document.createElement("div");
                    item.className = "toc-item";
                    item.textContent = ch ? ch.title : file;
                    item.onclick = () => open(file);
                    toc.appendChild(item);
                });
            });
        } else {
            chapters.forEach(ch => {
                const item = document.createElement("div");
                item.className = "toc-item";
                item.textContent = ch.title;
                item.onclick = () => open(ch.file);
                toc.appendChild(item);
            });
        }
        showStatus(`共 ${chapters.length} 章`);
    } catch (e) {
        showError(`加载失败：${e.message}`);
    } finally {
        toggleLoader(false);
    }
}

function backToHome() { location.href = "index.html"; }

// ---- 阅读页 ----
async function initReader() {
    const { book, ch } = getQuery();
    if (!book) { showError("缺少书籍参数"); return; }
    toggleLoader(true);
    showStatus("加载中");
    try {
        const t = await fetchJson(tocUrl(book));
        const chapters = t.chapters || [];
        const idx = Math.max(0, chapters.findIndex(c => c.file === ch));
        const cur = chapters[idx] || { file: ch, title: "" };
        const raw = await fetchText(chapterUrl(book, cur.file));
        const metaMatch = raw.match(/<!--\s*ZW_META:\s*(\{[\s\S]*?\})\s*-->/);
        let meta = { title: cur.title, author: t.author || "佚名", book: t.book || book };
        if (metaMatch) { try { meta = Object.assign(meta, JSON.parse(metaMatch[1])); } catch (e) {} }
        const content = raw.replace(/<!--\s*ZW_META:[\s\S]*?-->\s*/, "").trim();

        $("readerTitle").textContent = meta.title || cur.title;
        const curVol = (chapters[idx] && chapters[idx].volume) ? chapters[idx].volume : null;
        $("readerMeta").textContent = `书籍：${meta.book || book}　作者：${meta.author || "佚名"}` + (curVol ? `　卷：${curVol}` : "");
        $("reader-content").innerHTML = marked.parse(content);
        applyReaderCss();

        // 上一章 / 下一章 / 目录
        const prev = idx > 0 ? chapters[idx - 1] : null;
        const next = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null;
        const prevBtn = $("prevChBtn");
        const nextBtn = $("nextChBtn");
        prevBtn.disabled = !prev;
        nextBtn.disabled = !next;
        prevBtn.onclick = () => { if (prev) location.href = `reader.html?book=${enc(meta.book || book)}&ch=${enc(prev.file)}`; };
        nextBtn.onclick = () => { if (next) location.href = `reader.html?book=${enc(meta.book || book)}&ch=${enc(next.file)}`; };
        $("tocBtn").onclick = () => { location.href = `detail.html?book=${enc(meta.book || book)}`; };
        $("pageInfo").textContent = `第 ${idx + 1} 章 / 共 ${chapters.length} 章`;

        showStatus("");
        window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
        showError(`加载失败：${e.message}`);
    } finally {
        toggleLoader(false);
    }
}

// ===================== 访问口令门（方案一） =====================
async function sha256hex(s) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function isUnlocked() { return sessionStorage.getItem("simple_reader_key") === "1"; }
function markUnlocked() { sessionStorage.setItem("simple_reader_key", "1"); }

function buildGate() {
    // 遮住内容，阻止加载，直到输入正确口令
    document.querySelector(".container").style.visibility = "hidden";
    const wrap = document.createElement("div");
    wrap.className = "gate-modal";
    wrap.innerHTML = `
        <div class="gate-box">
            <h2>简单阅读</h2>
            <p class="gate-tip">请输入访问口令</p>
            <input id="gateInput" type="password" placeholder="访问口令" autocomplete="off">
            <button id="gateBtn" class="save-setting-btn">进入</button>
            <div id="gateErr" class="gate-err"></div>
        </div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector("#gateInput");
    const btn = wrap.querySelector("#gateBtn");
    const err = wrap.querySelector("#gateErr");
    const tryIn = async () => {
        if (!input.value) { err.textContent = "请输入口令"; return; }
        const h = await sha256hex(input.value);
        if (h === CONFIG.ACCESS_PWD) {
            markUnlocked();
            wrap.remove();
            document.querySelector(".container").style.visibility = "";
            runPageInit();
        } else {
            err.textContent = "口令不正确";
            input.value = "";
            input.focus();
        }
    };
    btn.onclick = tryIn;
    input.addEventListener("keydown", e => { if (e.key === "Enter") tryIn(); });
    setTimeout(() => input.focus(), 100);
}

// ===================== 初始化 =====================
function runPageInit() {
    const page = document.body.dataset.page;
    if (page === "home") initHome();
    else if (page === "detail") initDetail();
    else if (page === "reader") initReader();

    const sm = $("settingModal");
    if (sm) sm.addEventListener("click", e => { if (e.target.id === "settingModal") closeSettingModal(); });
    const si = $("searchInput");
    if (si) si.addEventListener("keydown", e => { if (e.key === "Enter") doSearch(); });
}

window.onload = () => {
    loadSetting();
    applyTheme();
    applyReaderCss();

    if (CONFIG.ACCESS_PWD && !isUnlocked()) {
        buildGate();
    } else {
        runPageInit();
    }
};
