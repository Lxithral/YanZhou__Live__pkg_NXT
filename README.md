# 烟洲直播包装

本地 Node.js 服务提供控制面板与 OBS 透明浏览器来源。控制台在浏览器里调整包装内容，OBS 里的输出页实时同步；不使用 obs-websocket。

当前包含三个包装模块：

- **Logo 挂角**：校徽与主副标题
- **主持字幕**：主持人标签与姓名信息条
- **节目单**：正在演出、接下来与下个节目

每个模块都可以独立显示/隐藏、整体缩放、调整透明度、移动到画布任意位置，并单独设置出场与退场动画（无、淡入淡出、上浮、下沉、左滑、右滑、缩放）和动画时长（200–2000 ms）。

## 启动与 OBS 接入

1. 双击 `start.cmd`，或者在项目目录运行 `npm start`。保留服务窗口。
2. 浏览器打开 `http://localhost:3000/control.html`。
3. 在 OBS 添加「浏览器」来源，URL 填 `http://localhost:3000/overlay.html`，宽度 1920、高度 1080。
4. 浏览器来源自定义帧率设为 60；为保持实时控制，关闭「不可见时关闭来源」与「场景激活时刷新浏览器」。OBS 输出帧率也建议设为 60。

包装页面本身完全透明，控制面板的背景与安全区不会进入 OBS 输出。两个页面都从同一个服务取得状态；页面刷新与重连会重新取得最新设置。

## 控制面板

左侧「包装模块」切换 Logo 挂角 / 主持字幕 / 节目单，当前模块的名称、内容与局部放大同步切换。每个模块的设置分为四段：

- **01 显示内容**：各模块文字（Logo 主副标题、主持人标签与名单、节目名与预告等）。
- **02 外观**：校徽色/强调色与文字颜色、整体大小、透明度。
- **03 位置**：水平 X / 垂直 Y 滑条与像素输入，也可直接拖动预览中的模块，或用方向键微调（按住 Shift 每次 10 px），并支持四角快捷定位。滑条范围会随模块实际尺寸调整，不会移出画面。
- **04 出场 / 退场**：分别选择出场与退场动画以及动画时长。

右上角「自动保存」显示当前状态；同一局域网内多个控制台与 OBS 输出页会实时同步。控制面板主题自动跟随系统深色或浅色模式，监看背景可以单独切换，不影响 OBS 输出。

`previews/control-panel-v2.png` 与 `previews/overlay-modules.png` 是当前版本的界面与输出示例。

## 设置保存

设置记录在项目根目录的 `settings.json`。实时画面先更新；连续拖动与输入在停止约 120 ms 后合并写入磁盘，面板显示「所有设置已保存」后代表文件已写入完成。服务使用临时文件加原子替换，避免写出半截 JSON；正常退出会保存最后的修改。下次启动会读取该文件。

如要手动编辑 `settings.json`，先正常退出服务再修改；启动时发现文件损坏会报错并保留原文件。

旧版（只有 Logo 挂角）的 `version: 1` 设置会在启动时自动迁移为模块结构并写回，原有 Logo 内容、颜色与位置都会保留。

## 设置结构

```json
{
  "version": 2,
  "canvas": { "width": 1920, "height": 1080 },
  "modules": {
    "logo": {
      "visible": true, "title": "中山市烟洲中学", "subtitle": "YANZHOU · LIVE",
      "color": "#D4AB78", "textColor": "#F4F0E8",
      "x": 72, "y": 64, "scale": 1, "opacity": 100,
      "animation": { "enter": "fade-up", "exit": "fade-down", "duration": 600 }
    },
    "hosts": { "visible": false, "label": "主持人", "names": "张三\n李四", "accentColor": "#D4AB78", "textColor": "#F4F0E8", "...": "..." },
    "program": { "visible": false, "label": "正在演出", "current": "节目名称", "nextLabel": "接下来", "next": "下一个节目", "...": "..." }
  }
}
```

颜色使用六位 HEX；坐标范围 0–1920 / 0–1080，整体大小 25–300%，透明度 0–100%，动画时长 200–2000 ms。

## 文件结构

- `server.js`：静态文件、`/api/state`、`/health`、WebSocket `/ws`（Origin 校验、单模块原子 patch、广播 `state` / `saved`、15 秒心跳、退出保存）。
- `public/module-layer.js`：所有模块共用的定位、缩放、透明度与动画层。
- `public/logo-renderer.js`、`public/hosts-renderer.js`、`public/program-renderer.js`：三个模块的渲染器。
- `public/control.html` / `control.js` / `control.css`：控制面板。
- `public/overlay.html` / `overlay.js` / `overlay.css`：OBS 输出页。
- `test/server.test.js`：9 项集成测试（保存、防抖、退出保存、非法 patch、静态安全、损坏文件、旧版迁移、模块同步、未知模块拒绝）。
- `assets/`：字体与原始素材；`logo-mask.png` 为由原校徽派生的透明着色版本，原图没有修改。

## 开发与检查

首次安装依赖：`npm install --no-audit --no-fund`。测试：`npm test`。

默认只监听本机 `127.0.0.1:3000`。如端口已有其他程序使用，可设置环境变量 `PORT` 为其他端口，并同步修改浏览器及 OBS 地址。服务不使用数据库或云端服务。OBS 中的实际出画延迟尚未做端到端实测。
