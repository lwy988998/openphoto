# Openphoto AI Color

开放访问的 GPT 图像编辑调色 Web 应用。首页仅保留品牌入口，工作台支持最多 10 张图片的批量调色、逐张结果展示、单独下载和单图重新处理。

## 功能

- 无需访问密码
- PNG / JPG / WEBP 多图上传
- 每张原图与对应结果独立成卡
- 全局提示词批量处理，单图可改提示词后重新处理
- IndexedDB 保存当前批次，刷新后恢复原图、结果和任务轮询
- 服务端代理 API Key，仅执行 AI 摄影调色
- 独立 `/reference.html` 参考氛围工作台：AI 用两轮图像编辑读取参考图的光影、色彩、柔焦、动感、颗粒和光晕，再从原图像素制作结果；支持风格强度和刷新恢复

## 本地运行

```bash
npm install
cp .env.example .env
npm start
```

默认监听 `39006` 端口。访问 `/` 进入欢迎页，点击“开始”进入 `/studio.html`。
在原工作台点击“参考图调色”进入独立页面；该页面的原图、参考图和结果保存在独立的浏览器 IndexedDB，不会清除多图工作台的数据。

## 服务器配置

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

- `GET /api/status`：服务状态
- `POST /api/batch`：提交批量或单图任务
- `GET /api/batch/:id`：查询任务状态与结果
- `POST /api/reference`：提交单张原图及参考图；沿用 `GET /api/batch/:id` 查询任务

`POST /api/reference` 使用 multipart 字段 `source`、`reference`（各一张 PNG/JPG/WEBP，最大 20 MB）、`jobId`、`imageId`（UUID）、`strength`（0–100，默认 70）。相同 `jobId` 不重复处理。两轮 AI 分别生成风格样张与原图氛围候选，服务端只提取其摄影特征，不直接采用候选画面的场景像素；任务查询增加阶段 `stage`，结果包含影像特征 `styleSignals`。0% 不调用风格分析且输出原图。

`POST /api/batch` 使用 multipart 字段：

- `images`：最多 10 张图片
- `jobId`：可选 UUID；重复提交同一 ID 会返回原任务
- `imageIds`：与图片顺序对应的唯一 UUID JSON 数组
- `prompt`、`model`、`quality`、`size`

任务保存在服务进程内存中并在完成 30 分钟后清理。浏览器刷新可以恢复；服务器重启后任务会失效。
