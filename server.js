const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'records.json');
const COST_FILE = path.join(DATA_DIR, 'costs.json');
const PORT = process.env.PORT || 3000;

// ===== GitHub 作为免费持久层（跨部署不丢数据）=====
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GH_OWNER = process.env.GH_OWNER || 'Durance-111';
const GH_REPO = process.env.GH_REPO || 'skirt-stats';
const GH_BRANCH = process.env.GH_BRANCH || 'main';
const USE_GH = !!GITHUB_TOKEN;

// 内存里始终是最新数据（运行时唯一真相）；本地文件与 GitHub 都是备份/同步源
let recordsCache = [];
let costsCache = {};
let recordsSha = null;   // GitHub 文件当前 sha，用于增量更新
let costsSha = null;
let recordsDirty = false;
let costsDirty = false;

function ghHeaders(extra) {
  return Object.assign({
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'skirt-stats'
  }, extra || {});
}

async function ghGet(path) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { sha: data.sha, json: JSON.parse(content) };
}

async function ghPut(path, obj, sha) {
  const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
  const body = {
    message: `skirt-stats: update ${path}`,
    content: Buffer.from(JSON.stringify(obj, null, 2), 'utf8').toString('base64'),
    branch: GH_BRANCH
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: ghHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PUT ${path} -> ${res.status} ${t}`);
  }
  const data = await res.json();
  return data.content.sha;
}

async function pushRecords() {
  if (!USE_GH || recordsBusy) return;
  recordsBusy = true;
  try {
    if (!recordsSha) {
      const r = await ghGet('data/records.json');
      recordsSha = r ? r.sha : null;
    }
    recordsSha = await ghPut('data/records.json', recordsCache, recordsSha);
    recordsDirty = false;
  } catch (e) {
    recordsDirty = true;
    recordsSha = null; // sha 可能过期，下次重试前重新获取
    console.error('[persist] records 推送失败:', e.message);
  } finally {
    recordsBusy = false;
  }
}
async function pushCosts() {
  if (!USE_GH || costsBusy) return;
  costsBusy = true;
  try {
    if (!costsSha) {
      const c = await ghGet('data/costs.json');
      costsSha = c ? c.sha : null;
    }
    costsSha = await ghPut('data/costs.json', costsCache, costsSha);
    costsDirty = false;
  } catch (e) {
    costsDirty = true;
    costsSha = null;
    console.error('[persist] costs 推送失败:', e.message);
  } finally {
    costsBusy = false;
  }
}
let recordsBusy = false, costsBusy = false;

async function loadFromGitHub() {
  if (!USE_GH) return false;
  try {
    const r = await ghGet('data/records.json');
    if (r) { recordsCache = r.json.map(normalize); recordsSha = r.sha; }
    const c = await ghGet('data/costs.json');
    if (c) { costsCache = c.json; costsSha = c.sha; }
    console.log(`[persist] 已从 GitHub 加载 ${recordsCache.length} 条记录`);
    return true;
  } catch (e) {
    console.error('[persist] GitHub 加载失败，改用本地文件:', e.message);
    return false;
  }
}

// ===== 本地文件兜底（无 GitHub 令牌时，或网络异常时）=====
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
  if (!fs.existsSync(COST_FILE)) fs.writeFileSync(COST_FILE, '{}');
}
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8') || JSON.stringify(fallback)); }
  catch (e) { return fallback; }
}
function writeLocalRecords() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(recordsCache, null, 2)); } catch (e) {} }
function writeLocalCosts() { try { fs.writeFileSync(COST_FILE, JSON.stringify(costsCache, null, 2)); } catch (e) {} }
function loadLocalFallback() {
  recordsCache = readJSON(DATA_FILE, []).map(normalize);
  costsCache = readJSON(COST_FILE, {});
  console.log(`[persist] 使用本地文件 ${recordsCache.length} 条记录`);
}

// 写入串行化：多人同时提交时，避免读-改-写互相覆盖
let writeChain = Promise.resolve();
function withLock(fn) {
  const result = writeChain.then(fn);
  writeChain = result.catch(() => {});
  return result;
}

// ---- 兼容旧数据：把老字段 count→inq、recorder→rec 归一化（仅内存，不破坏磁盘）----
function normalize(r) {
  const inq = r.inq !== undefined ? Number(r.inq)
            : r.count !== undefined ? Number(r.count) : 0;
  return {
    ...r,
    inq,
    ren: r.ren !== undefined ? Number(r.ren) : 0,
    pdate: r.pdate || '',
    col: r.col !== undefined ? Number(r.col) : 0,
    rec: r.rec || r.recorder || ''
  };
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- API ----
// 查询全部记录 + 成本
app.get('/api/records', (req, res) => {
  res.json({
    records: recordsCache.map(normalize),
    costs: costsCache,
    persistence: USE_GH ? 'github' : 'local',
    serverTime: Date.now()
  });
});

// 新增记录（支持 询问/预定/预定日期/回款/记录人）
app.post('/api/records', (req, res) => {
  const { date, skirt, inq, ren, pdate, col, rec } = req.body || {};
  if (!date || !skirt || inq === undefined || inq === '') {
    return res.status(400).json({ error: '请填写日期、裙子名称和询问人次' });
  }
  const inqN = Number(inq);
  if (!Number.isFinite(inqN) || inqN < 0) return res.status(400).json({ error: '询问人次必须是非负数字' });
  withLock(() => {
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      date: String(date),
      skirt: String(skirt).trim(),
      inq: inqN,
      ren: Number(ren) || 0,
      pdate: pdate ? String(pdate) : '',
      col: Number(col) || 0,
      rec: rec ? String(rec).trim() : '',
      createdAt: Date.now(),
      updatedAt: null
    };
    recordsCache.push(record);
    writeLocalRecords();
    recordsDirty = true; pushRecords();
    res.json({ ok: true, record: normalize(record) });
  }).catch(() => res.status(500).json({ error: '保存失败，请重试' }));
});

// 编辑记录（合并更新，兼容旧记录；更新 inq 时一并迁移掉 count）
app.put('/api/records/:id', (req, res) => {
  withLock(() => {
    const r = recordsCache.find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: '记录不存在' });
    const b = req.body || {};
    if (b.date !== undefined) r.date = String(b.date);
    if (b.skirt !== undefined) r.skirt = String(b.skirt).trim();
    if (b.inq !== undefined) {
      const n = Number(b.inq);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: '询问人次必须是非负数字' });
      r.inq = n; delete r.count;
    }
    if (b.ren !== undefined) r.ren = Number(b.ren) || 0;
    if (b.pdate !== undefined) r.pdate = b.pdate ? String(b.pdate) : '';
    if (b.col !== undefined) r.col = Number(b.col) || 0;
    if (b.rec !== undefined) r.rec = String(b.rec).trim();
    r.updatedAt = Date.now();
    writeLocalRecords();
    recordsDirty = true; pushRecords();
    res.json({ ok: true, record: normalize(r) });
  }).catch(() => res.status(500).json({ error: '保存失败，请重试' }));
});

// 删除记录
app.delete('/api/records/:id', (req, res) => {
  withLock(() => {
    const idx = recordsCache.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '记录不存在' });
    recordsCache.splice(idx, 1);
    writeLocalRecords();
    recordsDirty = true; pushRecords();
    res.json({ ok: true });
  }).catch(() => res.status(500).json({ error: '删除失败，请重试' }));
});

// 成本档案（每个裙子进价）
app.get('/api/costs', (req, res) => res.json(costsCache));
app.put('/api/costs', (req, res) => {
  const { skirt, cost } = req.body || {};
  if (!skirt) return res.status(400).json({ error: '请填写裙子名称' });
  const c = Number(cost);
  if (!Number.isFinite(c) || c < 0) return res.status(400).json({ error: '进价必须是非负数字' });
  withLock(() => {
    costsCache[String(skirt).trim()] = c;
    writeLocalCosts();
    costsDirty = true; pushCosts();
    res.json({ ok: true, costs: costsCache });
  }).catch(() => res.status(500).json({ error: '保存失败，请重试' }));
});

// 启动：先尝试从 GitHub 拉取（持久真相源），失败则退回本地文件
(async () => {
  ensureStore();
  const ok = USE_GH ? await loadFromGitHub() : false;
  if (!ok) loadLocalFallback();
  if (USE_GH) {
    // 定时把未成功同步的改动重试推送到 GitHub
    setInterval(() => { if (recordsDirty) pushRecords(); if (costsDirty) pushCosts(); }, 15000);
  }
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`裙子经营统计服务已启动 (持久层: ${USE_GH ? 'GitHub' : '本地文件'}): http://0.0.0.0:${PORT}`));
})();
