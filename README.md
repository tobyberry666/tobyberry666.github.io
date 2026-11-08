# Toby — 代码与感受

个人技术主页。静态 HTML、CSS 与 JavaScript，可直接托管于 GitHub Pages。

## 本地预览

需要 Node.js，无需安装依赖：

```sh
node preview.cjs
```

打开 http://127.0.0.1:4173 。若已有预览进程运行，直接打开该地址。

## 验证

```sh
node --check app.js
node --test tests/*.test.cjs
```

若所在环境禁止 Node 派生子进程（`node --test` 报 `spawn EPERM`），直接执行测试文件，结论等价：

```sh
node tests/site.test.cjs
node tests/motion.test.cjs
```

浏览器端行为验证与截图（需要本机 Chrome，脚本通过 DevTools 协议驱动，先启动 `preview.cjs`）：

```sh
node tools/verify.cjs   # 51 项实际断言，结果写入 docs/verification.txt
node tools/shoot.cjs    # 桌面/手机/矮屏/reduced-motion 截图，写入 docs/screenshots/
```

`verify.cjs` 只统计真实断言（不把标题计入）：可见性以「元素矩形完整落在视口内，且中心点 `elementFromPoint` 命中自身」为准；交互一律发送真实 `Input.dispatchKeyEvent` / `dispatchMouseEvent`，不调用 `.click()`。

## 素材

`assets/images/source/` 保存用户提供的两张原图（只读，不修改）。展示用裁切图由脚本生成：

```sh
python tools/make-assets.py
```

输出 `portrait-{560,900,1400}.{jpg,webp}` 与 `easter-egg-{420,760}.{jpg,webp}`。倒茶照采用摄影裁切而非抠图，因为头发与手臂边缘不够干净；面膜照裁为面部近景，作为可点击、可用键盘打开的彩蛋。

## 结构

- `index.html`：七个 `.scene` 章节；首屏含真实人像主视觉与彩蛋按钮，彩蛋在原生 `<dialog>` 中打开。
- `styles.css`：暖白 `#F1EDE5`、炭黑 `#242321`、朱红 `#C74432` 三色令牌；作品章节转入深色；字体使用系统衬线/黑体/等宽，无外部字体请求。
- `app.js`：GSAP `matchMedia` + ScrollTrigger 驱动横向章节推进；视差、卡片倾斜、磁吸按钮仅在精细指针下启用；彩蛋不依赖动画库。
- `tools/`：素材生成、截图与验证脚本。
- `docs/superpowers/specs/` 与 `docs/superpowers/plans/`：已批准的设计与实施计划。

GSAP 3.15.0 与 ScrollTrigger 复用现有本机文件，存放于 `assets/vendor/`，保留上游许可说明。原生滚动推进七个横向章节，背景由暖白连续过渡到炭黑；底部圆点和顶部导航可直接切换章节，键盘焦点也会带入对应场景。

开启减少动态效果、视口窄于 781px、桌面视口高度小于 620px 或动画库不可用时，采用可正常滚动阅读的纵向布局，七章内容、人像与彩蛋均可访问。手机上人像、正文、项目入口与彩蛋都按内容高度排布，可以正常滚动到达。后台标签页暂停环境动画，跨手机／桌面布局切换保留探索进度。无需劫持滚轮或强制吸附。

公开内容使用昵称、在读学生身份、编程兴趣、人机交互与情感计算方向和简短奖学金信息；隐去学校与实验室。项目图形为概念示意。旧版图片及识别性介绍已从旧版本移除；本次由用户明确授权加入两张本人照片。
