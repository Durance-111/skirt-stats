const API = '/api';
let RECORDS = [];      // 归一化后的记录
let COSTS = {};        // {skirt: cost}
let curPerson = null;
let curSkirt = null;
let editId = null;
let lastSig = '';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const getCSS = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ---- 归一化：兼容旧数据 count→inq、recorder→rec ----
function normalize(r){
  return {
    id: r.id,
    date: r.date,
    skirt: r.skirt,
    inq: (r.inq!==undefined? +r.inq : (r.count!==undefined? +r.count : 0)),
    ren: (r.ren!==undefined? +r.ren : 0),
    pdate: r.pdate || '',
    col: (r.col!==undefined? +r.col : 0),
    rec: (r.rec || r.recorder || '')
  };
}
const recsOf = () => (curPerson ? RECORDS.filter(r => r.rec === curPerson) : RECORDS);

// ===== API =====
async function load(){
  try{
    const r = await fetch(API + '/records');
    const d = await r.json();
    RECORDS = (d.records || []).map(normalize);
    COSTS = d.costs || {};
    setSync(true);
    const sig = JSON.stringify([RECORDS.length, COSTS, RECORDS.map(x=>x.id+x.inq).join(',')]);
    if (sig !== lastSig){ lastSig = sig; render(); }
  }catch(e){ setSync(false); }
}
function setSync(on){
  $('syncBox').className = 'sync' + (on ? ' on' : '');
  $('syncText').textContent = on ? '已同步' : '连接失败';
}
function postRecord(o){ return fetch(API+'/records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}); }
function putRecord(id,o){ return fetch(API+'/records/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}); }
function delRecord(id){ return fetch(API+'/records/'+id,{method:'DELETE'}); }
function putCost(o){ return fetch(API+'/costs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}); }

// ===== 图表 =====
function groupedBar(el,labels,series){
  const W=600,H=260,pad=34,colGap=18;
  const max=Math.max(1,...series.flatMap(s=>s.data));
  const n=labels.length, gw=W-pad*2, gwid=gw/n, bw=(gwid-colGap)/series.length;
  let s=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  for(let i=0;i<=4;i++){const y=pad+(H-pad*2)*i/4;s+=`<line x1="${pad}" y1="${y}" x2="${W-pad}" y2="${y}" stroke="#eee"/><text x="2" y="${y+4}" font-size="11" fill="#999">${Math.round(max*(4-i)/4)}</text>`;}
  labels.forEach((lab,i)=>{
    const gx=pad+gwid*i+colGap/2;
    series.forEach((ser,j)=>{
      const v=ser.data[i]||0, h=(H-pad*2)*v/max, x=gx+bw*j, y=H-pad-h;
      s+=`<rect x="${x}" y="${y}" width="${bw-2}" height="${h}" rx="3" fill="${ser.color}"/>`;
    });
    s+=`<text x="${pad+gwid*i+gwid/2}" y="${H-pad+16}" font-size="11" fill="#666" text-anchor="middle">${lab.length>5?lab.slice(0,5)+'…':lab}</text>`;
  });
  s+=`</svg>`; el.innerHTML=s;
}
function lineChart(el,labels,series){
  const W=600,H=260,pad=34;
  const max=Math.max(1,...series.flatMap(s=>s.data));
  const n=labels.length, x=i=>pad+(W-pad*2)*i/(n-1||1);
  let s=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`;
  for(let i=0;i<=4;i++){const y=pad+(H-pad*2)*i/4;s+=`<line x1="${pad}" y1="${y}" x2="${W-pad}" y2="${y}" stroke="#eee"/><text x="2" y="${y+4}" font-size="11" fill="#999">${Math.round(max*(4-i)/4)}</text>`;}
  labels.forEach((lab,i)=>{ if(n>1) s+=`<text x="${x(i)}" y="${H-pad+16}" font-size="10" fill="#999" text-anchor="middle">${lab.slice(5)}</text>`;});
  series.forEach(ser=>{
    let d=''; ser.data.forEach((v,i)=>{const y=H-pad-(H-pad*2)*v/max; d+=(i?'L':'M')+x(i)+' '+y+' ';});
    s+=`<path d="${d}" fill="none" stroke="${ser.color}" stroke-width="2.5"/>`;
    ser.data.forEach((v,i)=>{const y=H-pad-(H-pad*2)*v/max; s+=`<circle cx="${x(i)}" cy="${y}" r="3" fill="${ser.color}"/>`;});
  });
  s+=`</svg>`; el.innerHTML=s;
}
function hBars(el,items){
  const W=600,H=Math.max(120,items.length*42+20),pad=10;
  const max=Math.max(1,...items.map(i=>i.value));
  let s=`<svg viewBox="0 0 ${W} ${H}">`;
  items.forEach((it,i)=>{
    const y=pad+i*42+18, w=(W-pad*2-90)*it.value/max;
    s+=`<text x="${pad}" y="${y-4}" font-size="12" fill="#444">${esc(it.label.length>6?it.label.slice(0,6)+'…':it.label)}</text>`;
    s+=`<rect x="${pad}" y="${y}" width="${w}" height="16" rx="8" fill="${it.color}"/>`;
    s+=`<text x="${pad+w+6}" y="${y+13}" font-size="12" fill="#666">${it.value}%</text>`;
  });
  s+=`</svg>`; el.innerHTML=s;
}

// ===== 聚合 =====
function agg(){
  const recs = recsOf();
  const bySkirt={};
  recs.forEach(r=>{
    const s=bySkirt[r.skirt]||(bySkirt[r.skirt]={skirt:r.skirt,inq:0,ren:0,col:0});
    s.inq+=r.inq; s.ren+=r.ren; s.col+=r.col;
  });
  Object.values(bySkirt).forEach(s=>{ s.cost=COSTS[s.skirt]||0; s.pro=s.col-s.cost; });
  const ds=[...new Set(recs.map(r=>r.date))];
  recs.forEach(r=>{ if(r.pdate) ds.push(r.pdate); });
  const dates=[...new Set(ds)].sort();
  const byDate={};
  dates.forEach(d=>byDate[d]={inq:0,ren:0,col:0});
  recs.forEach(r=>{
    byDate[r.date].inq+=r.inq;
    byDate[r.pdate||r.date].ren+=r.ren;
    byDate[r.date].col+=r.col;
  });
  const tot={inq:0,ren:0,col:0,cost:0,pro:0};
  Object.values(bySkirt).forEach(s=>{tot.inq+=s.inq;tot.ren+=s.ren;tot.col+=s.col;tot.cost+=s.cost;tot.pro+=s.pro;});
  return {bySkirt:Object.values(bySkirt),dates,byDate,tot};
}

// ===== 渲染 =====
function render(){
  const a=agg();
  const rate=a.tot.inq?Math.round(a.tot.ren/a.tot.inq*100):0;
  const roi=a.tot.cost?Math.round(a.tot.col/a.tot.cost*100):0;
  $('kpis').innerHTML=`
   <div class="kpi"><div class="n">${a.tot.inq}</div><div class="l">总询问人次</div></div>
   <div class="kpi"><div class="n">${a.tot.ren}</div><div class="l">总预定(下单)</div></div>
   <div class="kpi money"><div class="n">¥${a.tot.col}</div><div class="l">总回款</div></div>
   <div class="kpi"><div class="n">¥${a.tot.cost}</div><div class="l">总采购成本</div></div>
   <div class="kpi good"><div class="n">¥${a.tot.pro}</div><div class="l">总毛利</div></div>
   <div class="kpi"><div class="n">${rate}%</div><div class="l">预定转化率</div></div>
   <div class="kpi"><div class="n">${roi}%</div><div class="l">投入产出比</div></div>
   <div class="kpi"><div class="n">${a.bySkirt.length}</div><div class="l">裙子款数</div></div>`;
  groupedBar($('c1'),a.bySkirt.map(s=>s.skirt),[
    {name:'询问',color:getCSS('--inq'),data:a.bySkirt.map(s=>s.inq)},
    {name:'预定',color:getCSS('--ren'),data:a.bySkirt.map(s=>s.ren)}]);
  lineChart($('c2'),a.dates,[
    {color:getCSS('--inq'),data:a.dates.map(d=>a.byDate[d].inq)},
    {color:getCSS('--ren'),data:a.dates.map(d=>a.byDate[d].ren)},
    {color:getCSS('--col'),data:a.dates.map(d=>a.byDate[d].col)}]);
  groupedBar($('c3'),a.bySkirt.map(s=>s.skirt),[
    {color:getCSS('--cost'),data:a.bySkirt.map(s=>s.cost)},
    {color:getCSS('--col'),data:a.bySkirt.map(s=>s.col)},
    {color:getCSS('--pro'),data:a.bySkirt.map(s=>s.pro)}]);
  hBars($('c4'),a.bySkirt.map(s=>({label:s.skirt,value:s.inq?Math.round(s.ren/s.inq*100):0})).sort((x,y)=>y.value-x.value));
  renderSkirtGrid(a);
  if(curSkirt && $('skirtDetail').style.display==='block') openDetail(curSkirt);
  renderPersons();
  renderTeam();
  renderTable();
  $('sk').innerHTML=[...new Set([...RECORDS.map(r=>r.skirt),...Object.keys(COSTS)])].map(s=>`<option value="${esc(s)}">`).join('');
}

function renderSkirtGrid(a){
  const el=$('skirtGrid');
  if($('skirtDetail').style.display==='block') return;
  const skirts=a.bySkirt.slice().sort((x,y)=>y.inq-x.inq);
  if(!skirts.length){el.innerHTML='<div class="empty">暂无数据，先在「录入」加一条记录</div>';return;}
  el.innerHTML='<div class="sk-grid">'+skirts.map(s=>`
    <div class="sk-card" data-sk="${esc(s.skirt)}">
      <div class="nm">${esc(s.skirt)}</div>
      <div class="mini">询问 <b>${s.inq}</b> · 预定 <b>${s.ren}</b></div>
      <div class="mini" style="margin-top:2px">回款 <b>¥${s.col}</b></div>
    </div>`).join('')+'</div>';
  el.querySelectorAll('[data-sk]').forEach(c=>c.onclick=()=>openDetail(c.dataset.sk));
}
function openDetail(sk){
  curSkirt=sk;
  const a=agg();
  const s=a.bySkirt.find(x=>x.skirt===sk)||{inq:0,ren:0,col:0,cost:0,pro:0};
  $('dTitle').textContent='👗 '+sk;
  const rate=s.inq?Math.round(s.ren/s.inq*100):0;
  $('dKpis').innerHTML=`
    <div class="kpi"><div class="n">${s.inq}</div><div class="l">累计询问</div></div>
    <div class="kpi"><div class="n">${s.ren}</div><div class="l">累计预定</div></div>
    <div class="kpi money"><div class="n">¥${s.col}</div><div class="l">累计回款</div></div>
    <div class="kpi good"><div class="n">¥${s.pro}</div><div class="l">毛利(扣成本)</div></div>
    <div class="kpi"><div class="n">${rate}%</div><div class="l">预定转化率</div></div>`;
  const dates=a.dates;
  const ok = curPerson ? (r=>r.skirt===sk&&r.rec===curPerson) : (r=>r.skirt===sk);
  groupedBar($('dChart'),dates.map(d=>d.slice(5)),[
    {name:'询问',color:getCSS('--inq'),data:dates.map(d=>RECORDS.filter(r=>ok(r)&&r.date===d).reduce((t,r)=>t+r.inq,0))},
    {name:'预定',color:getCSS('--ren'),data:dates.map(d=>RECORDS.filter(r=>ok(r)&&(r.pdate||r.date)===d).reduce((t,r)=>t+r.ren,0))}]);
  $('skirtGrid').style.display='none';
  $('skirtDetail').style.display='block';
}

function renderPersons(){
  ['persons-over','persons-hot','persons-team'].forEach(cid=>{
    const el=$(cid); if(!el) return;
    const persons=[...new Set(RECORDS.map(r=>r.rec).filter(Boolean))].sort();
    let h='<button class="pchip'+(curPerson===null?' active':'')+'" data-p="">全部</button>';
    persons.forEach(p=>{ h+='<button class="pchip'+(curPerson===p?' active':'')+'" data-p="'+esc(p)+'">'+esc(p)+'</button>'; });
    el.innerHTML=h;
    el.querySelectorAll('.pchip').forEach(b=>b.onclick=()=>{ curPerson=b.dataset.p||null; render(); });
  });
}
function renderTeam(){
  const title=$('teamTitle'), body=$('teamBody'); if(!title||!body) return;
  if(curPerson){
    const recs=RECORDS.filter(r=>r.rec===curPerson);
    const bySk={};
    recs.forEach(r=>{ const s=bySk[r.skirt]||(bySk[r.skirt]={inq:0,ren:0,col:0}); s.inq+=r.inq; s.ren+=r.ren; s.col+=r.col; });
    const rows=Object.entries(bySk).sort((a,b)=>b[1].inq-a[1].inq);
    title.textContent='👤 '+curPerson+' · 各裙子明细';
    let h='<table><thead><tr><th>裙子</th><th>咨询</th><th>下单</th><th>转化</th><th>回款</th></tr></thead><tbody>';
    if(!rows.length) h+='<tr><td colspan="5" style="text-align:center;color:#999">暂无记录</td></tr>';
    rows.forEach(([sk,s])=>{ const rate=s.inq?Math.round(s.ren/s.inq*100):0;
      h+='<tr><td>'+esc(sk)+'</td><td>'+s.inq+'</td><td>'+s.ren+'</td><td>'+rate+'%</td><td>¥'+s.col+'</td></tr>'; });
    h+='</tbody></table>';
    body.innerHTML=h;
  }else{
    const byP={};
    RECORDS.forEach(r=>{ if(!r.rec) return; const p=byP[r.rec]||(byP[r.rec]={inq:0,ren:0,col:0}); p.inq+=r.inq; p.ren+=r.ren; p.col+=r.col; });
    const rows=Object.entries(byP).sort((a,b)=>b[1].inq-a[1].inq);
    title.textContent='👥 全部人员 · 点某行只看TA';
    let h='<table><thead><tr><th>人员</th><th>咨询</th><th>下单</th><th>转化</th><th>回款</th></tr></thead><tbody>';
    rows.forEach(([p,s])=>{ const rate=s.inq?Math.round(s.ren/s.inq*100):0;
      h+='<tr data-p="'+esc(p)+'" style="cursor:pointer"><td>'+esc(p)+'</td><td>'+s.inq+'</td><td>'+s.ren+'</td><td>'+rate+'%</td><td>¥'+s.col+'</td></tr>'; });
    h+='</tbody></table>';
    body.innerHTML=h;
    body.querySelectorAll('tr[data-p]').forEach(tr=>tr.onclick=()=>{ curPerson=tr.dataset.p; render(); switchTab('team'); });
  }
}
function renderTable(){
  const q=($('search').value||'').trim().toLowerCase();
  const rows=RECORDS.filter(r=>!q || (r.date+r.skirt+r.rec).toLowerCase().includes(q))
    .slice().sort((a,b)=>b.date.localeCompare(a.date));
  $('emptyList').style.display = rows.length? 'none':'block';
  $('tbody').innerHTML=rows.map(r=>`
    <tr>
      <td>${r.date}</td><td>${esc(r.skirt)}</td><td>${r.inq}</td><td>${r.ren||''}</td>
      <td>¥${r.col||0}</td><td>${esc(r.rec||'')}</td>
      <td><div class="op">
        <button class="edit" data-edit="${r.id}">改</button>
        <button class="pay" data-pay="${r.id}">补款</button>
        <button class="del" data-del="${r.id}">删</button>
      </div></td>
    </tr>`).join('');
  $('tbody').querySelectorAll('[data-pay]').forEach(b=>b.onclick=async()=>{
    const r=RECORDS.find(x=>x.id==b.dataset.pay);
    const v=prompt('输入回款金额（元）：',r.col||'');
    if(v!==null){ await putRecord(r.id,{col:+v||0}); await load(); }
  });
  $('tbody').querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{
    if(!confirm('确定删除这条记录？')) return;
    await delRecord(b.dataset.del); await load();
  });
  $('tbody').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>startEdit(b.dataset.edit));
}

// ===== 交互 =====
function switchTab(p){
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelector('.tab[data-p="'+p+'"]').classList.add('active');
  document.querySelectorAll('.panel').forEach(el=>el.classList.remove('show'));
  $('p-'+p).classList.add('show');
}
function startEdit(id){
  const r=RECORDS.find(x=>x.id==id); if(!r) return;
  editId=id;
  $('editId').value=id;
  $('date').value=r.date; $('skirt').value=r.skirt;
  $('inq').value=r.inq; $('ren').value=r.ren||''; $('pdate').value=r.pdate||'';
  $('col').value=r.col||''; $('rec').value=r.rec||'';
  $('formTitle').textContent='✏️ 编辑记录';
  $('submitBtn').textContent='保存修改';
  $('cancelBtn').style.display='';
  switchTab('rec');
  $('date').scrollIntoView({behavior:'smooth'});
}
function resetForm(){
  editId=null; $('editId').value=''; $('form').reset();
  $('date').value=new Date().toISOString().slice(0,10);
  $('formTitle').textContent='➕ 添加记录';
  $('submitBtn').textContent='保存记录'; $('cancelBtn').style.display='none';
}
$('form').onsubmit=async e=>{
  e.preventDefault();
  const o={date:$('date').value,skirt:$('skirt').value.trim(),inq:+$('inq').value||0,
    ren:+$('ren').value||0,pdate:$('pdate').value||'',col:+$('col').value||0,rec:$('rec').value.trim()};
  if(!o.date||!o.skirt||($('inq').value===''&&o.inq===0)){alert('请填写日期、裙子名称和询问人次');return;}
  if(editId){ await putRecord(editId,o); } else { await postRecord(o); }
  resetForm(); await load(); switchTab('over');
};
$('cancelBtn').onclick=resetForm;
$('addCost').onclick=async()=>{
  const k=$('costSk').value.trim(), v=+$('costVal').value;
  if(k&&v>=0){ await putCost({skirt:k,cost:v}); $('costSk').value='';$('costVal').value=''; await load(); alert('已保存进价：'+k+' ¥'+v); }
};
$('backBtn').onclick=()=>{ $('skirtDetail').style.display='none'; $('skirtGrid').style.display='block'; curSkirt=null; renderSkirtGrid(agg()); };
$('search').oninput=renderTable;
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>switchTab(t.dataset.p));

// ===== 启动 =====
resetForm();
load();
setInterval(load, 3000);
