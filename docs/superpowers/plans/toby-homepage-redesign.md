# 实施计划：Toby 主页从柔和彩色技术页改为个人交互展览

依据 `docs/superpowers/specs/toby-homepage-redesign.md`（用户已批准）。本计划只记录工程落地顺序，不重复授权。

## 现状

- 仓库 `tobyberry666.github.io`，HEAD `9077b12`，分支 `redesign/personality-exhibition`。
- 架构：`index.html` 七个 `.scene` + `.viewport` 固定 + `.rail` 横向位移；`app.js` 用 GSAP `matchMedia` 驱动 ScrollTrigger 相机；`styles.css` 单文件约 20KB。
- 现有观感问题：珊瑚、薰衣草、青柠三色同时出现，装饰图形（球体雕塑、轨迹线、括号）数量多但缺少主视觉焦点；首屏只有文字，没有真实的人。

## 素材决策

| 项 | 决定 |
| --- | --- |
| 倒茶照 | 采用**摄影裁切**，不做抠图。理由：头发边缘与手臂遮挡导致抠图边缘不可靠，设计文档第 14 行允许此种降级。裁切框 `(790,300)-(1860,1773)`，保留头部、双臂与倒茶动作，背景暖白墙面与花卉挂画自带编辑感。 |
| 面膜照 | 裁切为面部近景彩蛋，`(150,60)-(1300,1800)`，保留双眼。 |
| 输出 | `assets/images/portrait-{560,900,1400}.{jpg,webp}`、`easter-egg-{420,760}.{jpg,webp}`，由 `tools/make-assets.py` 生成，可重跑。原图留在 `assets/images/source/`，只读不改。 |
| 调色 | 饱和度 0.88、对比 1.06、亮度 1.02，使照片贴近 `#F1EDE5` 暖白。 |

## 设计令牌

```
--paper #F1EDE5   暖白底
--ink   #242321   炭黑正文
--red   #C74432   朱红强调
--sand  #DCD3C4   分隔线/浅填充
--charcoal-scene  作品章节转入深色
```

字体：标题 `Georgia, 'Times New Roman', serif`（系统自带、零请求），正文中文黑体栈，编号与元信息 `Consolas` 等宽。不加载外部中文字库，避免大体积与失败风险。

## 实施顺序

1. **素材**：`tools/make-assets.py` 生成尺寸与压缩版本，记录字节数。✅
2. **index.html**
   - 首屏改为两栏：左 `Toby.` 大字 + 中文双句文案；右 `.portrait-figure` 用 `<picture>` 提供 webp/jpg，`<img>` 带尺寸属性与替代文本。
   - 新增 `.egg-trigger` 按钮（真按钮、可 Tab、可点击、`aria-expanded`），打开 `.egg-panel` 对话框显示面膜照，内含关闭按钮。
   - 保持七个 `section` 的 id（home/about/feel/work/code/vocab/connect）、`aria-labelledby`、项目真实外链与 `rel`。
   - 移除球体雕塑 SVG、轨迹线、orbit-words 等装饰层，替换为统一的编号、贯线符号。
3. **styles.css**
   - 重写 `:root` 令牌与全部颜色引用，删掉 coral/lavender/lime 语义类，改为 `--red` 单一强调。
   - 新首屏网格、人像构图、作品章节深色场景、彩蛋面板、移动布局（人像在手机上置于标题下方并裁切为横幅比例）。
   - 直接改原规则，不追加覆盖；保留 `prefers-reduced-motion`、矮屏、`max-width:350px` 的既有降级。
4. **app.js**
   - 保留 `matchMedia`、阅读布局降级、进度恢复、清理函数。
   - 背景色序列改为暖白→炭黑的连续过渡；人像加轻微视差（只在 `pointer` 条件内）。
   - 新增彩蛋：`openEgg/closeEgg`，支持 Escape、焦点返回按钮、点击遮罩关闭；不依赖悬停。
5. **测试**
   - 既有 12 项必须全绿。`site.test.cjs` 中「禁止 `<img>`」一条与本次批准的设计冲突：照片是用户授权加入的真实素材，需按新设计更新该断言，改为校验图片在本站内、带替代文本、带尺寸，并且**仍禁止 data:image 与虚构外链**。
   - 新增：彩蛋按钮可访问性、图片替代文本、无装饰 SVG 冗余、色彩令牌不含旧三色。

## 验证

- `node --check app.js`
- 直接执行 `node tests/site.test.cjs`、`node tests/motion.test.cjs`（沙箱内 `node --test` 派生子进程会被拒，故用直跑方式，结论等价）
- 预览：`node preview.cjs`，端口 4173
- 截图：1440×900、390×844、320×568、矮屏 1440×600、reduced-motion

## 不做

不 push、不发布、不改 DS Bot 配置、不安装依赖、不上传照片到任何外部服务。
