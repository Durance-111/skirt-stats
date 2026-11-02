# 👗 裙子询问人次统计（微信可分享 · 多人实时协作）

一个零依赖、可直接部署的小网站。谁点开链接都能**在线录入 / 编辑**，数据**每 3 秒自动刷新**，所有人看到的都是同一份实时数据。

核心统计维度：**哪一天 · 哪个裙子 · 询问多少人次**。

> 你**发到微信的链接** = 网站部署到公网后的网址（例如 `https://skirt.xxx.com`）。
> 本机 `localhost:3000` 只有你自己电脑能开，不能发微信。详见下方「三、部署上线」。

---

## 一、功能一览

| 功能 | 说明 |
|------|------|
| 在线录入 | 填 日期 / 裙子名称 / 询问人次 / 记录人（选填），一键保存 |
| 自动刷新 | 前端每 3 秒拉取一次，别人刚录入你立刻能看到 |
| 实时汇总 | 总询问人次、记录条数、裙子款数、覆盖天数 |
| 按裙子排名 | 每款裙子的累计询问人次，带进度条 |
| 明细列表 | 支持按 日期 / 裙子 / 记录人 搜索 |
| 编辑 / 删除 | 录错可改可删 |
| 移动端适配 | 专为微信内置浏览器优化，手机操作无障碍 |

---

## 二、本地运行（先在自己电脑上看效果）

```bash
# 需要 Node.js 18+
cd 本项目目录
npm install
npm start
# 浏览器打开 http://localhost:3000
```

数据保存在 `data/records.json`，重启不丢。

---

## 三、部署上线（拿到能发微信的链接）

任选一种。**推荐方案 1（Railway）**：不用买服务器、自动 HTTPS、几分钟上线。

### 方案 1：Railway（最简单，免费额度可用，自动 HTTPS）

1. 注册 [Railway](https://railway.app)（可用 GitHub 登录）。
2. 把本项目推到你的 GitHub 仓库（仓库里需包含 `package.json`、`server.js`、`public/`）。
3. 在 Railway 里 **New Project → Deploy from GitHub repo**，选这个仓库。
4. 等部署完成，Railway 会给你一个形如 `https://skirt-stats-xxxx.up.railway.app` 的地址 —— **这个就是你要发微信的链接**。
5. （重要）**让数据不丢**：Railway 默认磁盘是临时的，重新部署会清空 `data/records.json`。请在 Railway 项目里 **Settings → Volumes → Create Volume**，把卷挂载到路径 `/app/data`（容量 1GB 足够），重启/重新部署后记录都会保留。
6. （可选）在 Railway 的 Settings → Domains 里绑定你自己的域名（如 `skirt.你的域名.com`），然后用你自己的域名发微信。

> 直接把 `xxx.railway.app` 这个 https 链接发到微信群即可长期使用。

### 方案 2：自己的云服务器（阿里云 / 腾讯云等，用 Docker）

```bash
# 1. 把项目传到服务器，进入目录后构建镜像
docker build -t skirt-stats .

# 2. 启动容器（数据挂载到宿主机 ./data，重启不丢）
docker run -d --name skirt-stats -p 3000:3000 \
  -v $(pwd)/data:/app/data --restart=always skirt-stats
```

再用 Nginx 反代 + HTTPS（`certbot` 申请免费证书），把你的域名（如 `skirt.你的域名.com`）指过来：

```nginx
server {
    listen 443 ssl;
    server_name skirt.你的域名.com;
    ssl_certificate     /etc/letsencrypt/live/skirt.你的域名.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/skirt.你的域名.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
```

部署完成后，把 `https://skirt.你的域名.com` 发到微信群即可长期使用。

> 💡 微信建议用 **HTTPS** 链接，部分安卓机型对 http 链接会拦截或提示风险。
> 若只想要临时地址试一试，可在本机运行本项目后用 cpolar / ngrok 把 `localhost:3000` 映射成公网 https 链接（关电脑即失效）。

---

## 四、常见问题

- **多人同时录会不会冲突？** 不会，所有写入都落到同一个数据文件，后端用写入锁串行处理，前端每 3 秒同步一次。
- **数据量大了怎么办？** 当前用 JSON 文件存储，适合小团队日常统计。若需海量数据，可把存储换成 SQLite / 数据库（改动集中在 `server.js` 的读写函数）。
- **想加字段（如颜色、尺码）？** 在 `public/index.html` 表单和 `server.js` 的读写里加对应字段即可。
- **端口冲突？** 用环境变量改端口：`PORT=8080 npm start`（Docker 部署时改 `-p` 映射）。

---

## 五、项目结构

```
.
├── server.js          # 后端：API + 静态服务（含写入锁）
├── package.json
├── Dockerfile         # 容器化部署
├── railway.json       # Railway 部署配置
├── data/records.json  # 数据文件（自动生成，建议挂载持久化）
└── public/
    ├── index.html     # 页面
    ├── style.css      # 样式
    └── app.js         # 前端逻辑（轮询自动刷新）
```

---

## 六、录入规则（重要 · 询问 / 租出 / 回款可能不在同一天）

本系统的统计口径是「**汇总全部日期的记录**」，所以**询问日、租出日、回款日可以各填各的日期**，系统会自动把数字归到各自真实的日子，不用把三个动作硬塞进同一天。

> **核心原则：每条记录只填「当天真实发生」的数字，没发生的填 0。**

### 示例：一位客户的完整周期
客户 1/5 来问 3 条「法式碎花裙」并预定 → 1/7 来取货、租出（赊账）→ 1/10 才打款 400 元。应分别填 **3 条**：

| 日期 | 当天发生的事 | 询问 | 租出 | 回款 | 记录人 |
|------|------|------|------|------|--------|
| 1/5 | 来问 + 预定 | 3 | 0 | 0 | 小王 |
| 1/7 | 来取货、租出（还没付钱）| 0 | 2 | 0 | 小王 |
| 1/10 | 客户打款 | 0 | 0 | 400 | 小王 |

系统自动汇总：**总询问 3 · 总租出 2 · 总回款 400 · 转化率 66.7%**。无论隔几天，总额与转化率都算得准。

> 📌 已确认的业务口径：**只算总账**，不追踪「已租出未回款」的挂账。若以后想看应收账款，再在表单加一个「应收金额」字段即可（改动集中在前端表单与后端读写函数）。

