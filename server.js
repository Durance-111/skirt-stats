const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'records.json');
const COST_FILE = path.join(DATA_DIR, 'costs.json');
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- 数据存储（本地 JSON 文件，零依赖、易部署）----
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
  if (!fs.existsSync(COST_FILE)) fs.writeFileSync(COST_FILE, '{}');
}
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8') || JSON.stringify(fallback)); }
  catch (e) { return fallback; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
ensureStore();

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
function readRecords() { return readJSON(DATA_FILE, []).map(normalize); }
function readCosts() { return readJSON(COST_FILE, {}); }

// ---- API ----
// 查询全部记录 + 成本
app.get('/api/records', (req, res) => {
  res.json({ records: readRecords(), costs: readCosts(), serverTime: Date.now() });
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
    const records = readRecords();
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
    records.push(record);
    writeJSON(DATA_FILE, records);
    res.json({ ok: true, record: normalize(record) });
  }).catch(() => res.status(500).json({ error: '保存失败，请重试' }));
});

// 编辑记录（合并更新，兼容旧记录；更新 inq 时一并迁移掉 count）
app.put('/api/records/:id', (req, res) => {
  withLock(() => {
    const records = readRecords();
    const r = records.find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: '记录不存在' });
    const b = req.body || {};
    if (b.date !== undefined) r.date = String(b.date);
    if (b.skirt !== undefined) r.skirt = String(b.skirt).trim();
    if (b.inq !== undefined) {
      const n = Number(b.inq);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: '询问人次必须是非负数字' });
      r.inq = n; delete r.count; // 迁移：inq 成为权威字段
    }
    if (b.ren !== undefined) r.ren = Number(b.ren) || 0;
    if (b.pdate !== undefined) r.pdate = b.pdate ? String(b.pdate) : '';
    if (b.col !== undefined) r.col = Number(b.col) || 0;
    if (b.rec !== undefined) r.rec = String(b.rec).trim();
    r.updatedAt = Date.now();
    writeJSON(DATA_FILE, records);
    res.json({ ok: true, record: normalize(r) });
  }).catch(() => res.status(500).json({ error: '保存失败，请重试' }));
});

// 删除记录
app.delete('/api/records/:id', (req, res) => {
  withLock(() => {
    const records = readRecords();
    const idx = records.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '记录不存在' });
    records.splice(idx, 1);
    writeJSON(DATA_FILE, records);
    res.json({ ok: true });
  }).catch(() => res.status(500).json({ error: '删除失败，请重试' }));
});

// 成本档案（每个裙子进价）
app.get('/api/costs', (req, res) => res.json(readCosts()));
app.put('/api/costs', (req, res) => {
  const { skirt, cost } = req.body || {};
  if (!skirt) return res.status(400).json({ error: '请填写裙子名称' });
  const c = Number(cost);
  if (!Number.isFinite(c) || c < 0) return res.status(400).json({ error: '进价必须是非负数字' });
  withLock(() => {
    const costs = readCosts();
    costs[String(skirt).trim()] = c;
    writeJSON(COST_FILE, costs);
    res.json({ ok: true, costs });
  }).catch(() => res.status(500).json({ error: '保存失败，请重试' }));
});

app.listen(PORT, '0.0.0.0', () =>
  console.log(`裙子经营统计服务已启动: http://0.0.0.0:${PORT}`));
