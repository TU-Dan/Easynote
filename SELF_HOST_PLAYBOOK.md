# 自托管 Supabase + PWA 部署 Playbook（可复用）

把一个「静态 PWA 前端 + Supabase 后端」的应用，从 Vercel/Supabase 云端，迁到**中国大陆服务器自托管**，让大陆直连快、数据自控。本文是通用流程，EasyNote(轻松记)是已跑通的样例。其他 app 照此复用。

---

## 1. 适用场景 / 目标

- 应用 = 纯静态前端(HTML/JS/CSS，PWA)+ Supabase(Postgres + Auth + REST + Realtime)。
- 痛点：Vercel + Supabase 云端在大陆慢/打不开。
- 方案：自己买大陆服务器，跑开源版 Supabase（Docker），前端也由本机 Caddy 服务，全程不出境。
- 备案前用非标端口 8443 临时上线，备案下证后切 443。

## 2. 架构

```
手机/浏览器
   │  HTTPS
   ▼
Caddy (:8443 备案前 / :443 备案后)   ← 同机服务静态前端 + 反代 Supabase
   ├── /          → 静态前端文件 (/srv)
   └── /auth /rest /realtime /storage /functions → Kong (:8000)
                                                      ├── GoTrue (Auth, JWT)
                                                      ├── PostgREST (表 CRUD)
                                                      └── Realtime (订阅)
                                                            ▼
                                                        Postgres
```

前端与 API **同源**(都在 `https://域名:8443`)→ 没有 CORS 问题。

## 3. 用到 / 不用的 Supabase 组件

- **用**：Postgres、GoTrue(Auth)、PostgREST、Realtime、Kong、`@supabase/supabase-js`。
- **不用(可关掉省内存)**：Storage、imgproxy、Edge Functions、Studio、postgres-meta、Analytics(logflare)、Vector、Supavisor。4GB 机器建议裁掉这些。

## 4. 服务器与基础环境

- 机器：腾讯云轻量(Lighthouse)**4核4GB 起**(全套吃内存)，地域选大陆(上海等)，镜像 Ubuntu LTS。买 ≥3 个月以满足备案。
- 装 Docker（大陆 `get.docker.com` 会被重置，走阿里云 apt 源）：
  ```bash
  sudo apt-get update && sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  ```
- 镜像加速(腾讯云内网直连，拉 Docker Hub 镜像不卡)：
  ```bash
  echo '{ "registry-mirrors": ["https://mirror.ccs.tencentyun.com"] }' | sudo tee /etc/docker/daemon.json
  sudo systemctl restart docker
  sudo usermod -aG docker $USER   # 重新登录生效
  ```
- 长任务务必在 **tmux** 里跑（SSH 大陆链路易断）。客户端 `~/.ssh/config` 加 `ServerAliveInterval 30`。

## 5. 部署 Supabase

```bash
cd ~
git clone --depth 1 --filter=blob:none --sparse https://github.com/supabase/supabase
cd supabase && git sparse-checkout set docker && cd docker
cp .env.example .env
```

**生成密钥并写入 .env**（关键，别用示例默认值）。用脚本随机生成 `POSTGRES_PASSWORD / JWT_SECRET / DASHBOARD_PASSWORD / SECRET_KEY_BASE / VAULT_ENC_KEY / PG_META_CRYPTO_KEY`，并用 `JWT_SECRET` 签出 `ANON_KEY / SERVICE_ROLE_KEY`。

> **⚠️ 坑：JWT issued at future。** 签 anon/service key 时 `iat` 要**回退一段时间**(例如一年前)，否则服务器/设备时钟稍有偏差，GoTrue 会判 token「来自未来」而拒登。`iat = now - 31536000`，`exp` 给十年后。

同时设：`ENABLE_EMAIL_AUTOCONFIRM=true`(几十人内部用，免邮件验证、免 SMTP)；`API_EXTERNAL_URL / SUPABASE_PUBLIC_URL / SITE_URL` 指向最终对外地址(`https://域名:8443`)。

启动：`docker compose up -d`，`docker compose ps` 全 healthy 即可。

## 6. 表结构 + 多租户隔离(每个 app 自定义)

每张业务表带 `user_id uuid references auth.users(id)`，开 RLS，策略 `using/with check (auth.uid() = user_id)`。这是隔离的核心——**数据库内核逐行放行**，客户端绕不过(service_role 只在服务器)。需要实时同步的表 `alter publication supabase_realtime add table ...`。

## 7. 域名 + HTTPS(备案前用 8443)

大陆对**未备案域名的 80/443 做拦截**(返回备案页)。非标端口 **8443 不在拦截范围**，备案前用它。

1. **DNS**：在 DNS 控制台加 A 记录 `子域名 → 服务器IP`。
2. **防火墙**：放通 TCP 8443（22 已开）。
3. **证书**：80 被拦 → 不能用 HTTP-01，用 **DNS-01**。
   > **⚠️ 坑：caddy-dns/dnspod 编译失败**(libdns 版本不兼容)。改用 **acme.sh + 标准 Caddy**。
   > **⚠️ 坑：dns_dp vs dns_tencent。** 域名注册在腾讯云 → DNS 托管在腾讯云，用 acme.sh 的 `dns_tencent` + **腾讯云 CAM 密钥**(不是 DNSPod.cn 的 Token，那是另一个账号体系，会报 invalid domain)。
   > **⚠️ 坑：LE 二次校验 NXDOMAIN。** 腾讯 DNS 多权威服务器传播慢，加 `--dnssleep 120`。
   ```bash
   curl https://get.acme.sh | sh -s email=you@example.com
   ~/.acme.sh/acme.sh --set-default-ca --server letsencrypt
   export Tencent_SecretId=xxx Tencent_SecretKey=yyy
   ~/.acme.sh/acme.sh --issue --dns dns_tencent -d 子域名.example.com --dnssleep 120
   ~/.acme.sh/acme.sh --install-cert -d 子域名.example.com \
     --key-file ~/caddy/certs/key.pem --fullchain-file ~/caddy/certs/cert.pem \
     --reloadcmd "docker restart caddy"
   ```
4. **腾出 8443**：Supabase 的 Kong 默认占用 8443(它的 HTTPS)。改 `.env` 的 `KONG_HTTPS_PORT=8453`，`docker compose up -d kong`。
5. **Caddy**（标准镜像，挂证书，host 网络，反代 Kong + 服务静态前端）：
   ```
   {
       auto_https off
   }
   子域名.example.com:8443 {
       tls /certs/cert.pem /certs/key.pem
       encode gzip
       @api path /auth/* /rest/* /realtime/* /storage/* /functions/*
       handle @api { reverse_proxy 127.0.0.1:8000 }
       handle {
           root * /srv
           try_files {path} /index.html
           file_server
       }
   }
   ```
   ```bash
   docker run -d --name caddy --restart unless-stopped --network host \
     -v ~/caddy/Caddyfile:/etc/caddy/Caddyfile:ro \
     -v ~/前端目录:/srv:ro \
     -v ~/caddy/certs:/certs:ro \
     caddy:2
   ```
6. **前端文件**：从 Mac `scp` 到服务器的 `~/前端目录/`，Caddy 直接 serve。

**备案下证后**：开 80/443 防火墙，Caddy 站点改 `:443`，前端配置去掉 `:8443`，按省份做公安备案。

## 8. 前端接入(supabase-js)

- 配置：`url = https://子域名.example.com:8443`，`anonKey = <自托管 ANON_KEY>`。
- PWA 要**安全上下文**(https 或 localhost)才能用 `crypto.randomUUID`、service worker。裸 IP over http 不行。
- service worker 建议**网络优先**(在线总拉最新)，发版时升缓存版本号。
- 加主屏图标/名字：iOS 在「加到主屏」那刻固定，改了要删旧图标重加。

> **⚠️ 坑：同步逻辑误删数据。** 若 app 的同步是「本地为准 + 删除远端多余行」，空白端登录先 push 会清空远端。务必**先 pull 再 push**。

## 9. 云端 → 自托管 数据迁移(若原来在 Supabase 云)

从云端 `pg_dump` 出 `auth.users + auth.identities`(保账号密码) + 业务表，灌进自托管。
> **⚠️ 坑：PG 版本。** 云端可能是 PG17，本机 db 容器是 PG15，旧 `pg_dump` 导不了高版本。用 `docker run --rm postgres:17 pg_dump ...` 匹配版本。
> **⚠️ 坑：PG17 dump 里的 `\restrict` 和 `SET transaction_timeout`** 老 psql 不认，导入前 `sed` 删掉这些行。
> 连接串密码含 `#` 会破坏 URI 解析 → 用 `PGPASSWORD` + 独立参数(`-h -U -d`)，别用 URI。

## 10. 运维：备份 + 安全

- **备份(高优先级)**：数据单点在服务器，必须备份。
  - 本机 cron 每天 `docker compose exec -T db pg_dump -U postgres -d postgres | gzip > ~/backups/app-$(date +%F).sql.gz`，留最近 14 天。
  - 异地：传一份到腾讯云 COS(私有桶)。
  - `pg_dump` 走超级用户、**绕过 RLS**，一份备份含全员数据 → 备份文件按敏感处理，桶设私有。
- **最小权限**：acme.sh / COS 用一个 **CAM 子用户**(只给 DNSPod + COS 权限)，别用主账号密钥。
- **续费**：服务器到期被回收 = 数据销毁，记得续。

## 11. 多 app 复用同一台服务器

- 每个 app 一个**子域名**(`app1.example.com:8443`、`app2...`)，Caddy 加一个 site 块即可。PWA 用子域名最干净(SW 作用域独立)。
- 后端可共用一套 Supabase：各 app 用各自的表(表名前缀区分)，RLS 照旧按 `user_id`。或各 app 独立 schema。
- 一张泛域名证书 / 每个子域名各签一张，acme.sh 都支持。

## 12. 每个新 app 的改动清单（其余复用）

1. 业务表 schema + RLS 策略(按 `user_id`)。
2. 一个子域名 + DNS A 记录 + 证书。
3. 前端 `supabase-config`：url(子域名:8443) + 该实例的 anon key。
4. Caddy 加一个 site 块(或共用，按路径/子域名分流)。
5. 前端文件 scp 到对应目录。

服务器、Docker、Supabase 栈、备份、安全这些都**一次搭好、长期复用**，新 app 只动以上 5 点。

---

## 样例实例(EasyNote / 轻松记)
- 域名 `easynote.brainpowerai.com.cn:8443`，服务器 上海 Lighthouse 4核4GB。
- 表：`qsj_entries / qsj_summaries / qsj_kanban_cards / qsj_user_settings`，均 RLS。
- 备份：`~/backups/` 每天 03:30 + (待接)COS。
