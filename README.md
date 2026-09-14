# Openphoto AI Color

个人试用版 GPT 图像编辑调色 Web 应用：上传原图，输入调色提示词，后端调用 OpenAI 兼容 Images Edit API。

## 功能

- 一次选择最多 10 张 PNG / JPG / WEBP 原图
- 使用同一条提示词按顺序批量调色，并显示每张图片的处理状态
- 输入中文调色提示词
- 内置电影感、阳光闪耀、Smart HDR、Portra 胶片、卡片机预设
- 可选“画质提升到 8K”：GPT 调色完成后，服务端把结果最长边放大到 7680px 并锐化
- 简单访问密码保护批量接口
- 服务端代理 API Key，不暴露到前端
- 支持自定义 OpenAI 兼容端点，例如 `https://bya.re/v1`

## 本地运行

```bash
npm install
cp .env.example .env
npm start
```

默认监听 `39006` 端口。

## 服务器配置

推荐把密钥放到服务器环境文件中，不要提交到 GitHub：

```bash
mkdir -p /etc/openphoto-ai-color
cat > /etc/openphoto-ai-color/openai.env <<'EOF'
OPENAI_BASE_URL=https://bya.re/v1
OPENAI_API_KEY=你的_API_Key
EOF
chmod 600 /etc/openphoto-ai-color/openai.env
systemctl restart openphoto-ai-color
```

## API

- `GET /api/status`：查看服务状态
- `GET /api/access`：检查当前请求是否已通过访问密码
- `POST /api/batch`：提交批量任务，立即返回任务 ID
- `GET /api/batch/:id`：查询批量任务进度和结果

`POST /api/batch` 使用 multipart 表单字段：

- `images`：图片文件，最多 10 张
- `prompt`：调色提示词
- `model`：默认 `gpt-image-2.5-sunburst`
- `quality`：默认 `auto`
- `size`：默认 `auto`
- `upscale8k`：传入 `on` 或 `true` 时启用 8K 后处理

批量接口需要请求头：

```text
x-openphoto-password: 你的访问密码
```

## 注意

当前版本是个人试用 MVP，没有用户账号、计费和持久化历史记录。任务在服务进程内存中保存，服务重启后会失效。上游图像编辑是长耗时请求，因此采用后台任务 + 前端轮询，避免 Cloudflare 524 超时页面。
