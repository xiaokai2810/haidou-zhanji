# 云服务器部署

本部署将游戏挂在现有站点的 `http://101.132.103.55/haidou-zhanji/`，双人入口为 `http://101.132.103.55/haidou-zhanji/duel.html`。服务器已有其他网站使用 80 端口，因此保留原有 Nginx `server` 块，只往其中加入 [`nginx-location.conf`](nginx-location.conf)。Node 服务仅监听 `127.0.0.1:3000`，由 Nginx 提供公网入口。房间资料写入 `/var/lib/haidou-zhanji/rooms`，与程序目录分开。

## 首次安装

以下以 Ubuntu/Debian、拥有 `sudo` 权限的 SSH 用户为例。先在云平台安全组放行 TCP 80，保留现有 SSH 规则；如启用了 UFW，再放行 `80/tcp`。服务器运行时只需 Node.js 18.19+，本机构建网页需 Node.js 20.19+ 或 22.12+。

在服务器上安装运行组件并创建无登录权限的服务账号：

```bash
sudo apt update
sudo apt install -y nodejs nginx
node --version
sudo useradd --system --home /nonexistent --shell /usr/sbin/nologin haidou
sudo install -d -o root -g haidou -m 0750 /opt/haidou-zhanji
```

`useradd` 仅首次执行。若服务器上的 `node --version` 低于 `18.19`，先安装受支持的 Node.js 再继续。不要在服务器使用 Vite 开发服务器或 `npm run preview` 对公网开放。

在本机项目目录中测试并构建。`GITHUB_PAGES=true` 让构建后的资源和 API 请求以 `/haidou-zhanji/` 为前缀；Nginx 会剥离此前缀再转发给 Node。

```bash
npm ci
npm test
GITHUB_PAGES=true npm run build
```

将 `server/`、`src/`、`dist/`、`public/`、`deploy/` 和 `package.json` 上传到服务器的 `/opt/haidou-zhanji/`；文件可由 root 拥有，服务账号需要读取权限。房间目录不要放在程序目录中，也不要将房间资料提交到 Git。示例使用已配置的 SSH，将 `YOUR_SSH_USER` 改成实际用户名：

```bash
ssh_user=YOUR_SSH_USER
ssh "$ssh_user@101.132.103.55" 'mkdir -p /tmp/haidou-release'
rsync -az server src dist public deploy package.json "$ssh_user@101.132.103.55:/tmp/haidou-release/"
```

随后在服务器上由管理员复制本次发布文件：

```bash
sudo cp -a /tmp/haidou-release/. /opt/haidou-zhanji/
sudo chown -R root:haidou /opt/haidou-zhanji
```

也可以通过 Git 获取源文件，再仅上传本机构建的 `dist/`。部署包中的 `package.json` 保留 ES module 配置；当前服务端运行不需在服务器上安装 npm 依赖。

安装 systemd 服务，并将 Nginx 片段 `include` 到**现有**监听 80 端口的 `server { ... }` 内。不要另建 `default_server`，也不要覆盖现有网站配置。

```bash
sudo cp /opt/haidou-zhanji/deploy/haidou-zhanji.service /etc/systemd/system/haidou-zhanji.service
sudo cp /opt/haidou-zhanji/deploy/nginx-location.conf /etc/nginx/snippets/haidou-zhanji.conf
sudo systemctl daemon-reload
sudo systemctl enable --now haidou-zhanji
```

在现有的 Nginx `server { ... }` 中加入一行：

```nginx
include /etc/nginx/snippets/haidou-zhanji.conf;
```

检查配置后再重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 检查与日常操作

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://101.132.103.55/haidou-zhanji/api/health
sudo systemctl status haidou-zhanji --no-pager
sudo journalctl -u haidou-zhanji -n 100 --no-pager
sudo systemctl restart haidou-zhanji
```

客户端通过 `Authorization: Bearer` 请求头提交房间访问令牌。Nginx 片段关闭了该路径的访问日志；故障排查时也不要公开带令牌的请求头。IP 上的 HTTP 通信未加密；若未来需要账号或长期身份资料，应先绑定域名并启用 HTTPS。

## 更新与备份

每次更新先在本机执行测试和构建，再上传同一组发布文件，最后 `sudo systemctl restart haidou-zhanji`。更新前备份房间资料：

```bash
sudo install -d -m 0700 /var/backups/haidou-zhanji
sudo systemctl stop haidou-zhanji
sudo tar -C /var/lib -czf "/var/backups/haidou-zhanji/rooms-$(date +%Y%m%d-%H%M%S).tgz" haidou-zhanji
sudo systemctl start haidou-zhanji
```

备份归档含房间信息，应仅供管理员读取。更新失败时，恢复上一个发布包并重启服务；备份资料只有在房间状态需要回退时才恢复。
