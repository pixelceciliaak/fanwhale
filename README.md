# 凡鲸行动 / Fanwhale — 完整源码

导出时间：2026/11/12 16:05:43

## 目录结构

```
web/                    浏览器端（零外部资源，无构建步骤）
  index.html              外壳 3.5 KB —— 只负责全屏与承载 iframe
  game.html               游戏本体 1.46 MB —— three.js 内联，全部资源代码生成
  auth.js                 账号门禁 + 大厅 + 世界频道 84 KB
  feedback.html           意见反馈独立页
  404.html
  *.bak.*                 历史备份

admin/                  管理后台（React 18 + Ant Design 5）
  app.jsx                 全部源码，单文件
  package.json
  dist/                   已构建，可直接部署
    bundle.js / bundle.css / index.html / feedback.html

api/                    后端（纯 Node 内置模块，零第三方依赖）
  server.js
  data/
    about.json            关于游戏内容
    notices.json          公告数据

nginx/
  ai_couple_game.conf     站点配置（/api/ 反代 · /ws/ WebSocket · /admin/ 别名）
  saltline-sec.conf       安全响应头（含 CSP）
```

## 为什么有外壳 + game.html 两层

全屏状态是绑在**具体页面**上的，页面一导航就丢。而游戏换关卡必须重建整个场景，
引擎没有热切换入口，只能重载页面。

所以拆成两层：

```
index.html（外壳，全屏挂在它身上，永不导航）
  └── iframe → game.html?level=xxx
                点地图时只换 iframe，外壳纹丝不动
```

全屏因此全程保持。`auth.js` 里的 `__gamePath()` 负责分流：
在 iframe 内返回 `/game.html`，独立打开时返回 `/`。

## 未包含

- `node_modules/`（约 160 MB，`npm install` 重装）
- 用户数据：`users.json` `chat.jsonl` `audit.jsonl` `feedback.json` `avatars/`
- 管理员凭据：`admin.json` `admin-init.txt` `atokens.json`

## 部署

### 后端

```bash
cd api
node --check server.js
node server.js          # 默认 7801，首次运行会打印初始管理员密码
pm2 start server.js --name fanwhale-api
pm2 save
```

### 后台（改了 app.jsx 才需要）

```bash
cd admin
npm install
npx esbuild app.jsx --bundle --minify --format=iife --jsx=automatic \
  --loader:.jsx=jsx --define:process.env.NODE_ENV='"production"' \
  --outfile=dist/bundle.js
```

### 前端

`web/` 下文件直接丢到站点根目录，无构建。

### Nginx

```nginx
location / {
    root /www/wwwroot/fanwhale;
    try_files $uri $uri/ =404;
}
location /api/ {
    proxy_pass http://127.0.0.1:7801;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location /ws/ {
    proxy_pass http://127.0.0.1:7801;
    proxy_http_version 1.1;                          # 这三行缺一不可
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host       $host;
    proxy_set_header X-Real-IP  $remote_addr;
    proxy_read_timeout 3600s;
    proxy_buffering off;
}
location /admin/ {
    alias /www/wwwroot/fanwhale-admin/dist/;
    index index.html;
    add_header Cache-Control "no-store" always;
}
```

CSP 必须包含 `frame-src 'self'` 和 `'unsafe-eval'`（three.js 需要），
否则游戏白屏或 iframe 不加载。

## 关键技术参数

| 项 | 值 |
|---|---|
| 后端端口 | 7801（只听 127.0.0.1） |
| 密码哈希 | scrypt，32 字节 |
| 会话 token | 24 字节随机 hex |
| 在线判定 | 90 秒窗口 |
| 合作房间 | 4 字符码，10 Hz 快照 |
| 关卡 | dock / warehouse / freighter / pumpstation |
| 前端总体积 | 约 1.6 MB（gzip 后约 490 KB） |
| 后台 bundle | 1.12 MB |

## 接口速查

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/reg | 注册 |
| POST | /api/login | 登录 |
| GET | /api/announce | 公告 |
| POST | /api/feedback | 提交反馈（需登录） |
| GET | /api/feedback | 我的反馈（需登录） |
| POST | /api/admin/login | 管理员登录 |
| GET | /api/admin/feedback | 全部反馈（管理员） |
| POST | /api/admin/fb-reply | 回复（管理员） |
| POST | /api/admin/fb-del | 删除（管理员） |
| WS | /ws/coop | 世界频道 + 合作同步 |
