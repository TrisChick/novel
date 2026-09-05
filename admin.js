// ===================== 管理后台配置 =====================
// 仅管理后台使用。阅读入口 Access gate 在 app.js 的 CONFIG.ACCESS_PWD。
const ADMIN = {
    user: "TrisChick",
    repo: "novel",
    branch: "main",
    api: "https://api.github.com/repos",
    cdn: "https://cdn.jsdelivr.net/gh/TrisChick/novel@main/",
    purgeApi: "https://purge.jsdelivr.net",
    // 管理口令（SHA-256 十六进制）——与阅读口令独立。生成：node tools/gen_pwd.mjs 你的口令
    pwdHash: "e84ad422339ca383fa2283706765711e8b15797dd831387950e036e290a6d492",
    pwdKey: "novel_admin_pwd_ok",      // 会话内口令通过标记
    tokenKey: "novel_admin_token",     // 本地保存的 GitHub 访问 Token（不入仓库）
    themeKey: "novel_admin_theme"
};

const $ = id => document.getElementById(id);
const enc = s => encodeURIComponent(s);
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// ---------- 工具 ----------
const basename = p => p.split("/").pop();
function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}
function textToBase64(s) { return arrayBufferToBase64(new TextEncoder().encode(s)); }
function b64ToUtf8(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}
function encPath(p) { return p.split("/").map(encodeURIComponent).join("/"); }
function showStatus(t) { const el = $("statusTip"); if (el) el.textContent = t; }
function showError(t) { const el = $("statusTip"); if (el) el.innerHTML = `<div class="error-tip">${t}</div>`; }
function toggleLoader(show) { const el = $("loader"); if (el) el.style.display = show ? "block" : "none"; }

// ---------- 口令门 ----------
async function sha256hex(s) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const isUnlocked = () => sessionStorage.getItem(ADMIN.pwdKey) === "1";
const markUnlocked = () => sessionStorage.setItem(ADMIN.pwdKey, "1");

// ---------- Token ----------
const getToken = () => localStorage.getItem(ADMIN.tokenKey) || "";
const setToken = t => localStorage.setItem(ADMIN.tokenKey, t);
const clearToken = () => localStorage.removeItem(ADMIN.tokenKey);

// ---------- 主题 ----------
function applyTheme() {
    let theme = localStorage.getItem(ADMIN.themeKey) || "light";
    document.body.dataset.theme = theme;
    const b = $("themeBtn");
    if (b) b.textContent = theme === "dark" ? "日间" : "夜间";
}
function toggleTheme() {
    const cur = document.body.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(ADMIN.themeKey, cur);
    applyTheme();
}

// ---------- API 读取（公开，不带 token） ----------
async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// 读取仓库文件内容（Contents API）。useToken=true 时带 token（编辑用，确保最新），否则匿名（列表用）。
async function readFile(path, useToken) {
    const h = useToken && getToken() ? { Authorization: "Bearer " + getToken() } : {};
    const r = await fetch(`${ADMIN.api}/${ADMIN.user}/${ADMIN.repo}/contents/${encPath(path)}`, { headers: h });
    if (!r.ok) throw new Error(`读取 ${path} 失败 (HTTP ${r.status})`);
    const j = await r.json();
    return b64ToUtf8((j.content || "").replace(/\n/g, ""));
}

const tocUrl = fold => `${ADMIN.api}/${ADMIN.user}/${ADMIN.repo}/contents/${encPath(`novel/${fold}/toc.json`)}`;

async function listBooks() {
    const url = `${ADMIN.api}/${ADMIN.user}/${ADMIN.repo}/git/trees/${ADMIN.branch}?recursive=1`;
    const data = await fetchJson(url);
    const dirs = {};
    for (const it of (data.tree || [])) {
        if (it.type !== "blob") continue;
        const m = it.path.match(/^novel\/([^/]+)\/[^/]+\.(txt|md)$/i);
        if (m) { if (!dirs[m[1]]) dirs[m[1]] = { fold: m[1], count: 0 }; dirs[m[1]].count++; }
    }
    const books = await Promise.all(Object.values(dirs).map(async b => {
        try {
            const t = JSON.parse(await readFile(`novel/${b.fold}/toc.json`, false));
            b.name = b.fold;
            b.book = t.book || b.fold;
            b.author = t.author || "佚名";
        } catch (e) {
            b.name = b.fold; b.book = b.fold; b.author = "佚名";
        }
        return b;
    }));
    return books.sort((a, b) => (a.book || a.name).localeCompare(b.book || b.name, "zh-CN"));
}

// ---------- 写入：用 Git Data API 一次性提交（支持大文件） ----------
async function gitWrite(changes, message) {
    const token = getToken();
    if (!token) throw new Error("请先在「设置 Token」粘贴 GitHub 访问 Token");
    const h = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    for (const c of changes) {
        const r = await fetch(`${ADMIN.api}/${ADMIN.user}/${ADMIN.repo}/git/blobs`, {
            method: "POST", headers: h,
            body: JSON.stringify({ content: c.base64, encoding: "base64" })
        });
        if (!r.ok) throw new Error(`创建 blob 失败 (${r.status})`);
        c.sha = (await r.json()).sha;
    }
    const ref = await fetch(`${ADMIN.api}/${ADMIN.user}/${ADMIN.repo}/git/refs/heads/${ADMIN.branch}`, { headers: h });
    if (!ref.ok) throw new Error(`读取 ref 失败 (${ref.status})`);
    const commitSha = (await ref.json()).object.sha;
    const commit = await fetch(`${ADMIN.api}/${ADMIN.user}/${ADMIN.repo}/git/commits/${commitSha}`, { headers: h });
    const baseTree = (await commit.json()).tree.sha;
    const treePayload = changes.map(c => ({ path: c.path, mode: "100644", type: "blob", sha: c.sha }));
    const treeRes = await fetch(`${ADMIN.api}/${ADMIN.user}/${ADMIN.repo}/git/trees`, {
        method: "POST", headers: h,
        body: JSON.stringify({ base_tree: baseTree, tree: treePayload })
    });
    if (!treeRes.ok) throw new Error(`创建 tree 失败 (${treeRes.status})`);
    const newTree = (await treeRes.json()).sha;
    const commitRes = await fetch(`${ADMIN.api}/${ADMIN.user}/${ADMIN.repo}/git/commits`, {
        method: "POST", headers: h,
        body: JSON.stringify({ message, tree: newTree, parents: [commitSha] })
    });
    if (!commitRes.ok) throw new Error(`创建 commit 失败 (${commitRes.status})`);
    const newCommit = (await commitRes.json()).sha;
    const upd = await fetch(`${ADMIN.api}/${ADMIN.user}/${ADMIN.repo}/git/refs/heads/${ADMIN.branch}`, {
        method: "PATCH", headers: h,
        body: JSON.stringify({ sha: newCommit, force: false })
    });
    if (!upd.ok) throw new Error(`更新分支引用失败 (${upd.status})`);
    return newCommit;
}

// ---------- CDN 缓存刷新（尽力而为） ----------
async function purge(paths) {
    try {
        await fetch(ADMIN.purgeApi, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: paths }) });
        return true;
    } catch (e) { return false; }
}

// ---------- 上传（推送到 _inbox，由 auto-import 工作流处理） ----------
function sanitizeName(s) {
    return s.replace(/\/|\\|[:*?"<>|\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim();
}
async function uploadBook(file) {
    let name = sanitizeName(basename(file.name).replace(/\.txt$/i, ""));
    if (!name) name = "新书-" + Date.now();
    const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(arrayBufferToBase64(r.result));
        r.onerror = rej;
        r.readAsArrayBuffer(file);
    });
    const path = `_inbox/${name}.txt`;
    showStatus("正在提交上传请求…");
    toggleLoader(true);
    try {
        await gitWrite([{ path, base64 }], `admin: 上传 ${name}`);
        showStatus(`已提交《${name}》到 _inbox，自动导入工作流将在几分钟内完成上架。`);
        await loadAdmin();
    } catch (e) {
        showError(`上传失败：${e.message}`);
    } finally { toggleLoader(false); }
}

// ---------- 删除（写入 _ops/delete-*.json，由 ops 工作流执行） ----------
async function queueDelete(book) {
    const op = JSON.stringify({ action: "delete", book: book });
    const path = `_ops/delete-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`;
    showStatus(`正在提交删除请求：${book} …`);
    toggleLoader(true);
    try {
        await gitWrite([{ path, base64: textToBase64(op) }], `admin: 删除《${book}》`);
        showStatus(`已提交删除《${book}》，管理工作流将稍后执行并刷新缓存。`);
        await purge([`/gh/${ADMIN.user}/${ADMIN.repo}@${ADMIN.branch}/novel/${book}/`]);
        await loadAdmin();
    } catch (e) {
        showError(`删除请求失败：${e.message}`);
    } finally { toggleLoader(false); }
}

// ===================== 编辑目录（书名/作者、章节改名、重排卷序） =====================
let editState = null;      // 当前编辑的书籍目录结构

function tocToState(toc, fold) {
    const st = { fold, book: toc.book || fold, author: toc.author || "", mode: toc.mode || "chapters", chapters: [], ungrouped: [], volumes: [] };
    const chs = toc.chapters || [];
    if (st.mode === "volumes" && Array.isArray(toc.volumes) && toc.volumes.length) {
        const inVol = new Set();
        toc.volumes.forEach(v => (v.chapters || []).forEach(f => inVol.add(f)));
        st.ungrouped = chs.filter(c => !inVol.has(c.file)).map(c => ({ file: c.file, title: c.title }));
        st.volumes = toc.volumes.map(v => ({
            title: v.title,
            chapters: (v.chapters || []).map(f => { const c = chs.find(x => x.file === f); return { file: f, title: c ? c.title : f }; })
        }));
    } else {
        st.chapters = chs.map(c => ({ file: c.file, title: c.title }));
    }
    return st;
}
function stateToToc(st) {
    if (st.mode === "volumes") {
        const chapters = [
            ...st.ungrouped.map(c => ({ file: c.file, title: c.title })),
            ...st.volumes.flatMap(v => v.chapters.map(c => ({ file: c.file, title: c.title, volume: v.title })))
        ];
        const volumes = st.volumes.map(v => ({ title: v.title, chapters: v.chapters.map(c => c.file) }));
        return { book: st.book, author: st.author, mode: st.mode, chapters, volumes };
    }
    return { book: st.book, author: st.author, mode: st.mode, chapters: st.chapters.map(c => ({ file: c.file, title: c.title })) };
}

async function openEdit(fold) {
    if (!getToken()) { showError("请先设置 Token 才能编辑。"); return; }
    showStatus("加载目录…");
    toggleLoader(true);
    try {
        const txt = await readFile(`novel/${fold}/toc.json`, true);
        editState = tocToState(JSON.parse(txt), fold);
        $("editTitle").textContent = `编辑：${editState.book}`;
        renderEdit();
        $("editModal").style.display = "flex";
    } catch (e) {
        showError("加载目录失败：" + e.message);
    } finally { toggleLoader(false); }
}
function closeEditModal() { $("editModal").style.display = "none"; editState = null; }

function collectEdit() {
    if (!editState) return;
    editState.book = $("edBook").value;
    editState.author = $("edAuthor").value;
    document.querySelectorAll("#editBody [data-kind]").forEach(inp => {
        const kind = inp.dataset.kind, i = +inp.dataset.i, j = +inp.dataset.j;
        if (kind === "ch") editState.chapters[i].title = inp.value;
        else if (kind === "ug") editState.ungrouped[i].title = inp.value;
        else if (kind === "vt") editState.volumes[i].title = inp.value;
        else if (kind === "vc") editState.volumes[i].chapters[j].title = inp.value;
    });
}
function moveItem(dir, info) {
    const st = editState;
    const swap = (arr, a, b) => { if (b >= 0 && b < arr.length) { const t = arr[a]; arr[a] = arr[b]; arr[b] = t; } };
    if (info.kind === "ch") swap(st.chapters, info.i, info.i + dir);
    else if (info.kind === "ug") swap(st.ungrouped, info.i, info.i + dir);
    else if (info.kind === "vc") swap(st.volumes[info.i].chapters, info.j, info.j + dir);
    else if (info.kind === "vt") swap(st.volumes, info.i, info.i + dir);
}
function moveBtn(dir, info) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tool-btn edit-move";
    b.textContent = dir < 0 ? "↑" : "↓";
    b.title = dir < 0 ? "上移" : "下移";
    b.onclick = () => { collectEdit(); moveItem(dir, info); renderEdit(); };
    return b;
}
function titleRow(info, c) {
    const row = document.createElement("div");
    row.className = "edit-row";
    const input = document.createElement("input");
    input.className = "token-input edit-title";
    input.value = c.title || "";
    input.placeholder = "章节标题";
    input.dataset.kind = info.kind;
    if (info.i !== undefined) input.dataset.i = info.i;
    if (info.j !== undefined) input.dataset.j = info.j;
    row.appendChild(input);
    row.appendChild(moveBtn(-1, info));
    row.appendChild(moveBtn(1, info));
    return row;
}
function renderEdit() {
    const st = editState;
    if (!st) return;
    const body = $("editBody");
    body.innerHTML = "";

    const meta = document.createElement("div");
    meta.className = "edit-meta";
    const lb = document.createElement("label"); lb.textContent = "书名（显示名）";
    const edBook = document.createElement("input");
    edBook.id = "edBook"; edBook.className = "token-input"; edBook.value = st.book || "";
    lb.appendChild(edBook);
    const la = document.createElement("label"); la.textContent = "作者";
    const edAuthor = document.createElement("input");
    edAuthor.id = "edAuthor"; edAuthor.className = "token-input"; edAuthor.value = st.author || "";
    la.appendChild(edAuthor);
    meta.appendChild(lb); meta.appendChild(la);
    body.appendChild(meta);

    const list = document.createElement("div");
    list.className = "edit-list";
    body.appendChild(list);

    if (st.mode === "volumes") {
        if (st.ungrouped.length) {
            const h = document.createElement("div"); h.className = "edit-section"; h.textContent = "未分章";
            list.appendChild(h);
            st.ungrouped.forEach((c, i) => list.appendChild(titleRow({ kind: "ug", i }, c)));
        }
        st.volumes.forEach((v, vi) => {
            const vol = document.createElement("div");
            vol.className = "edit-volume";
            const vh = document.createElement("div");
            vh.className = "edit-volume-head";
            const badge = document.createElement("span"); badge.className = "edit-badge"; badge.textContent = "卷";
            const vt = document.createElement("input");
            vt.className = "token-input edit-title"; vt.placeholder = "卷标题";
            vt.value = v.title || ""; vt.dataset.kind = "vt"; vt.dataset.i = vi;
            vh.appendChild(badge); vh.appendChild(vt);
            vh.appendChild(moveBtn(-1, { kind: "vt", i: vi }));
            vh.appendChild(moveBtn(1, { kind: "vt", i: vi }));
            vol.appendChild(vh);
            const vch = document.createElement("div");
            vch.className = "edit-vol-chapters";
            v.chapters.forEach((c, ci) => vch.appendChild(titleRow({ kind: "vc", i: vi, j: ci }, c)));
            vol.appendChild(vch);
            list.appendChild(vol);
        });
    } else {
        st.chapters.forEach((c, i) => list.appendChild(titleRow({ kind: "ch", i }, c)));
    }
}
async function saveEdit() {
    const st = editState;
    if (!st) return;
    collectEdit();
    const toc = stateToToc(st);
    const path = `novel/${st.fold}/toc.json`;
    const base64 = textToBase64(JSON.stringify(toc, null, 2) + "\n");
    showStatus("正在保存目录…");
    toggleLoader(true);
    try {
        await gitWrite([{ path, base64 }], `admin: 编辑《${st.fold}》`);
        showStatus(`已保存《${st.fold}》的目录与元信息。`);
        closeEditModal();
        await purge([`/gh/${ADMIN.user}/${ADMIN.repo}@${ADMIN.branch}/novel/${st.fold}/`]);
        await loadAdmin();
    } catch (e) {
        showError("保存失败：" + e.message);
    } finally { toggleLoader(false); }
}

// ---------- 渲染书单 ----------
function renderList(books) {
    const list = $("bookList");
    list.innerHTML = "";
    if (books.length === 0) {
        list.innerHTML = `<div class="book-item"><div class="book-item-title">暂无书籍</div><div class="book-item-meta">上传 .txt 后由自动导入工作流上架。</div></div>`;
        return;
    }
    books.forEach(b => {
        const item = document.createElement("div");
        item.className = "book-item";
        const t = document.createElement("div");
        t.className = "book-item-title";
        t.textContent = b.book || b.name;
        const m = document.createElement("div");
        m.className = "book-item-meta";
        m.textContent = `作者：${b.author} · 共 ${b.count} 个章节文件`;
        const act = document.createElement("div");
        act.className = "book-item-actions";
        const view = document.createElement("a"); view.className = "tool-btn"; view.textContent = "查看目录";
        view.href = `detail.html?book=${enc(b.name)}`;
        const edit = document.createElement("button"); edit.className = "tool-btn"; edit.textContent = "编辑";
        edit.onclick = () => openEdit(b.name);
        const del = document.createElement("button"); del.className = "tool-btn danger"; del.textContent = "删除";
        del.onclick = async () => {
            if (!getToken()) { showError("请先设置 Token 才能执行删除。"); return; }
            if (!confirm(`确定删除《${b.book || b.name}》及全部 ${b.count} 个章节文件吗？此操作不可撤销。`)) return;
            await queueDelete(b.name);
        };
        act.appendChild(view); act.appendChild(edit); act.appendChild(del);
        item.appendChild(t); item.appendChild(m); item.appendChild(act);
        list.appendChild(item);
    });
}

async function loadAdmin() {
    toggleLoader(true);
    showStatus("加载书单中…");
    try {
        const books = await listBooks();
        $("adminMeta").textContent = `仓库：${ADMIN.user}/${ADMIN.repo}　共 ${books.length} 本书`;
        renderList(books);
        showStatus(`共 ${books.length} 本书。上传经 _inbox 自动导入；删除经 _ops 工作流执行；编辑保存 toc.json 后全站生效。`);
    } catch (e) {
        showError(`加载失败：${e.message}，请检查网络或仓库配置`);
    } finally { toggleLoader(false); }
}

// ---------- Token 弹窗 ----------
function openTokenModal() {
    $("tokenInput").value = getToken();
    $("tokenModal").style.display = "flex";
}
function closeTokenModal() { $("tokenModal").style.display = "none"; }
function saveToken() {
    const v = $("tokenInput").value.trim();
    if (!v) { showError("Token 不能为空。"); return; }
    setToken(v);
    closeTokenModal();
    loadAdmin();
}

// ---------- 启动 ----------
function setupApp() {
    $("adminGate").style.display = "none";
    document.querySelector(".container").style.visibility = "";
    if (!getToken()) {
        $("tokenInput").value = "";
        openTokenModal();
    }
    loadAdmin();
}

window.onload = () => {
    applyTheme();
    if (ADMIN.pwdHash && !isUnlocked()) {
        document.querySelector(".container").style.visibility = "hidden";
        $("adminGate").style.display = "flex";
        $("gateInput").focus();
    } else {
        setupApp();
    }

    const tryPwd = async () => {
        const inp = $("gateInput");
        if (!inp.value) { $("gateErr").textContent = "请输入口令"; return; }
        const h = await sha256hex(inp.value);
        if (h === ADMIN.pwdHash) { markUnlocked(); setupApp(); }
        else { $("gateErr").textContent = "口令不正确"; inp.value = ""; inp.focus(); }
    };
    $("gateBtn").onclick = tryPwd;
    $("gateInput").addEventListener("keydown", e => { if (e.key === "Enter") tryPwd(); });

    $("refreshBtn").onclick = () => loadAdmin();
    $("tokenBtn").onclick = () => openTokenModal();
    $("logoutBtn").onclick = () => { sessionStorage.removeItem(ADMIN.pwdKey); clearToken(); location.reload(); };
    $("purgeBtn").onclick = async () => {
        showStatus("正在刷新 CDN 缓存…");
        const ok = await purge([`/gh/${ADMIN.user}/${ADMIN.repo}@${ADMIN.branch}/`]);
        showStatus(ok ? "已触发 CDN 缓存刷新。" : "刷新请求失败（跨域或网络），可稍后重试。");
    };
    $("uploadInput").onchange = e => { const f = e.target.files[0]; if (f) uploadBook(f); e.target.value = ""; };
    $("tokenModal").addEventListener("click", e => { if (e.target.id === "tokenModal") closeTokenModal(); });
    $("editModal").addEventListener("click", e => { if (e.target.id === "editModal") closeEditModal(); });
    $("editCancelBtn").onclick = () => closeEditModal();
    $("saveEditBtn").onclick = () => saveEdit();
};
