const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'records.json');
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- 数据存储（本地 JSON 文件，零依赖、易部署）----
function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
}
function readRecords() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8') || '[]');
  } catch (e) {
    return [];
  }
}
function writeRecords(records) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2));
}
ensureStore();

// 写入串行化：多人同时提交时，避免读-改-写互相覆盖
let writeChain = Promise.resolve();
function withLock(fn) {
  const result = writeChain.then(fn);
  writeChain = result.catch(() => {});
  return result;
}

// ---- API ----
// 查询全部记录
app.get('/api/records', (req, res) => {
  res.json({ records: readRecords(), serverTime: Date.now() });
});

// 新增记录
app.post('/api/records', (req, res) => {
  const { date, skirt, count, recorder } = req.body || {};
  if (!date || !skirt || count === undefined || count === '') {
    return res.status(400).json({ error: '请填写日期、裙子名称和询问人次' });
  }
  const num = Number(count);
  if (!Number.isFinite(num) || num < 0) {
    return res.status(400).json({ error: '询问人次必须是非负数字' });
  }
  withLock(() => {
    const records = readRecords();
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      date: String(date),
      skirt: String(skirt).trim(),
      count: num,
      recorder: recorder ? String(recorder).trim() : '',
      createdAt: Date.now(),
      updatedAt: null
    };
    records.push(record);
    writeRecords(records);
    res.json({ ok: true, record });
  }).catch(() => res.status(500).json({ error: '保存失败，请重试' }));
});

// 编辑记录
app.put('/api/records/:id', (req, res) => {
  withLock(() => {
    const records = readRecords();
    const r = records.find(x => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: '记录不存在' });
    const { date, skirt, count, recorder } = req.body || {};
    if (date !== undefined) r.date = String(date);
    if (skirt !== undefined) r.skirt = String(skirt).trim();
    if (count !== undefined) {
      const n = Number(count);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: '询问人次必须是非负数字' });
      r.count = n;
    }
    if (recorder !== undefined) r.recorder = String(recorder).trim();
    r.updatedAt = Date.now();
    writeRecords(records);
    res.json({ ok: true, record: r });
  }).catch(() => res.status(500).json({ error: '保存失败，请重试' }));
});

// 删除记录
app.delete('/api/records/:id', (req, res) => {
  withLock(() => {
    const records = readRecords();
    const idx = records.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '记录不存在' });
    records.splice(idx, 1);
    writeRecords(records);
    res.json({ ok: true });
  }).catch(() => res.status(500).json({ error: '删除失败，请重试' }));
});

app.listen(PORT, '0.0.0.0', () =>
  console.log(`裙子统计服务已启动: http://0.0.0.0:${PORT}`));
