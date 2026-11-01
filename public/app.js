'use strict';

const $ = (id) => document.getElementById(id);
let allRecords = [];
let editingId = null;
let searchTerm = '';

function todayStr() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function setSync(ok, text) {
  const box = $('syncBox');
  box.className = 'sync' + (ok ? '' : ' off');
  $('syncText').textContent = text;
}

// 拉取数据并渲染
async function refresh() {
  try {
    const res = await fetch('/api/records', { cache: 'no-store' });
    const data = await res.json();
    allRecords = data.records || [];
    render();
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    setSync(true, `已同步 ${hh}:${mm}:${ss}`);
  } catch (e) {
    setSync(false, '同步失败，重试中…');
  }
}

function render() {
  renderSummary();
  renderRanking();
  renderTable();
  renderSkirtList();
}

function renderSummary() {
  const total = allRecords.reduce((s, r) => s + (Number(r.count) || 0), 0);
  $('sumCount').textContent = total;
  $('sumRows').textContent = allRecords.length;
  $('sumSkirts').textContent = new Set(allRecords.map(r => r.skirt)).size;
  $('sumDays').textContent = new Set(allRecords.map(r => r.date)).size;
}

function renderRanking() {
  const map = {};
  allRecords.forEach(r => {
    map[r.skirt] = (map[r.skirt] || 0) + (Number(r.count) || 0);
  });
  const arr = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const box = $('ranking');
  if (!arr.length) { box.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const max = arr[0][1] || 1;
  box.innerHTML = arr.map(([name, v]) => `
    <div class="rank-item">
      <div class="rank-head"><span>${escapeHtml(name)}</span><span>${v} 人次</span></div>
      <div class="bar"><i style="width:${Math.max(6, (v / max) * 100)}%"></i></div>
    </div>`).join('');
}

function renderTable() {
  const term = searchTerm.trim().toLowerCase();
  const list = allRecords
    .filter(r => !term ||
      (r.date || '').toLowerCase().includes(term) ||
      (r.skirt || '').toLowerCase().includes(term) ||
      (r.recorder || '').toLowerCase().includes(term))
    .sort((a, b) => (b.date === a.date ? (b.createdAt || 0) - (a.createdAt || 0) : (b.date < a.date ? -1 : 1)));

  const tbody = $('tbody');
  $('emptyList').style.display = list.length ? 'none' : 'block';
  tbody.innerHTML = list.map(r => `
    <tr>
      <td>${escapeHtml(r.date)}</td>
      <td class="sk">${escapeHtml(r.skirt)}</td>
      <td><b>${r.count}</b></td>
      <td>${escapeHtml(r.recorder || '-')}</td>
      <td><div class="op">
        <button class="edit" data-edit="${r.id}">改</button>
        <button class="del" data-del="${r.id}">删</button>
      </div></td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', () => startEdit(b.dataset.edit)));
  tbody.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => delRecord(b.dataset.del)));
}

function renderSkirtList() {
  const set = new Set(allRecords.map(r => r.skirt).filter(Boolean));
  $('skirtList').innerHTML = [...set].map(s => `<option value="${escapeHtml(s)}">`).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 表单提交（新增 / 更新）
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    date: $('date').value,
    skirt: $('skirt').value.trim(),
    count: $('count').value,
    recorder: $('recorder').value.trim()
  };
  if (!payload.date || !payload.skirt || payload.count === '') {
    alert('请填写日期、裙子名称和询问人次');
    return;
  }
  const btn = $('submitBtn');
  btn.disabled = true;
  try {
    let res;
    if (editingId) {
      res = await fetch('/api/records/' + editingId, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch('/api/records', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '保存失败');
    }
    resetForm();
    await refresh();
  } catch (err) {
    alert(err.message || '保存失败');
  } finally {
    btn.disabled = false;
  }
});

function startEdit(id) {
  const r = allRecords.find(x => x.id === id);
  if (!r) return;
  editingId = id;
  $('editId').value = id;
  $('date').value = r.date;
  $('skirt').value = r.skirt;
  $('count').value = r.count;
  $('recorder').value = r.recorder || '';
  $('formTitle').textContent = '✏️ 编辑记录';
  $('submitBtn').textContent = '更新';
  $('cancelBtn').style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  editingId = null;
  $('editId').value = '';
  $('form').reset();
  $('date').value = todayStr();
  $('formTitle').textContent = '➕ 添加记录';
  $('submitBtn').textContent = '保存';
  $('cancelBtn').style.display = 'none';
}

$('cancelBtn').addEventListener('click', resetForm);

async function delRecord(id) {
  if (!confirm('确定删除这条记录吗？')) return;
  try {
    const res = await fetch('/api/records/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    await refresh();
  } catch (e) {
    alert('删除失败');
  }
}

$('search').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  renderTable();
});

// 初始化
$('date').value = todayStr();
refresh();
setInterval(refresh, 3000); // 自动刷新：每 3 秒拉取一次
