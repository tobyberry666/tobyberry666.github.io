# `timeout Page.enable` 排查记录与复现方式

对象：`tools/verify.cjs` 在独立复验会话中报 `verify failed: timeout Page.enable`（WEB-02 / WEB-02-R1 两次）。
结论先行：**页面实现不是原因**；命令超时发生在浏览器会话层。本文记录实测证据、已确认与未确认的部分，以及审校官可独立执行的复现步骤。

## 1. 现象与边界

`Page.enable` 是 DevTools 协议里最基础的空操作命令之一，不依赖页面代码。它超时意味着连接建立到了某个 target，但该 target 没有处理命令。可能的位置只有三处：

| 位置 | 现象 |
| --- | --- |
| A. 进程根本没起来 | `/json/list` 无响应或没有 page target |
| B. 起来了，但连到了别的实例 | `/json/list` 返回的目标不是本次拉起的浏览器 |
| C. 起来了，目标是本次的，但 DevTools 通道不工作 | WebSocket 打开，命令无返回 |

`Page.enable` 超时只可能落在 C，或落在 B 且对方已失效。A 会在更早一步失败。

## 2. 实测证据

### 2.1 本次环境里完整会话是通的

`node tools/cdp-doctor.cjs`（日志 `docs/cdp-doctor.log`）逐条记录：

```
+0.02s port 9525 free (ECONNREFUSED)
+0.29s /json/list ok after 2 attempts (257ms): 5 targets, page ws=ws://127.0.0.1:9525/devtools/page/...
+0.29s WebSocket open
+0.29s   -> Page.enable
+0.29s   <- Page.enable answered in 2ms
+0.30s   <- Runtime.enable answered in 1ms
+0.30s   <- Page.navigate answered in 7ms
+2.81s   <- Runtime.evaluate answered in 1ms
+2.85s   <- Page.captureScreenshot answered in 31ms
=== result: SESSION OK ===
```

同一条序列在 `verify.cjs` 里连续执行四次，均为 51/51 通过。所以脚本逻辑本身可以在这个环境跑通。

### 2.2 端口被占用会让脚本连到旧实例（已复现）

实验：先让一个 Chrome 占住 9601，再按脚本原本的方式拉起第二个 Chrome 并读 `/json/list`：

```
holder target: 5E3FBB99...
second run sees target: 5E3FBB99... (same as holder? true)
second chrome stderr lines: 2
  [66720:64672] bind() returned an error: Only one usage of each socket address ... (0x2740)
  DevTools listening on ws://[::1]:9601/devtools/browser/...
Page.enable on the stale target: answered in time
```

结论：**第二个 Chrome 绑定失败，`/json/list` 返回的是第一个实例的目标**。本次实验中占位的实例是健康的，所以命令仍然有响应；如果占位的实例已经失效（被中断、被挂起、渲染进程没起来），同一条命令就不再返回。这就是 B+C 的组合。

修复：`verify.cjs` 启动前先探 `/json/version`，端口被占用直接报错并提示换端口，不再静默连上去。

### 2.3 修好后的行为

```
$ CDP_PORT=9600 node tools/verify.cjs
verify failed: debugger port 9600 is already in use by another Chrome; re-run with CDP_PORT set to a free port
```

失败从"卡 60 秒后超时"变成"立即说明原因"。

## 3. 根因判定

| 环节 | 判定 | 依据 |
| --- | --- | --- |
| 页面代码导致 `Page.enable` 超时 | 排除 | `Page.enable` 在导航前发出，与页面内容无关；同页面在健康会话中 2ms 返回 |
| 端口残留给旧实例（B） | 已复现，已加防护 | 2.2 的 bind 失败 + 目标 id 相同 |
| 旧实例本身失效（C） | 未能在本环境复现 | 需要制造"Chrome 活着但 DevTools 通道断开"，本环境没有可复现手段；不宣称已验证 |
| 执行环境的进程/IPC 限制 | 有强相关旁证，未确证 | 本轮早期同一台机器上，受限文件沙箱下 Chrome 曾以 `FATAL:mojo\public\cpp\platform\platform_channel.cc:112] Check failed: . : Access is denied.` 直接卡死 180 秒不退出；放行后立刻恢复正常。审校官所在会话的进程查询也返回 `Access denied`，说明其会话权限边界更紧 |

因此：**审校官复验时的超时，最可能是其会话里 Chrome 无法建立自有的 IPC/mojo 通道（C 的一个具体成因），叠加脚本未检测端口占用（B 的放大）。** 这一条属于推断，报告里不当作已证事实。

## 4. 审校官可独立复现的步骤

```powershell
cd C:\Users\Toby\DS Bot\projects\toby-homepage

# 0. 预览服务须在运行
node preview.cjs            # 另开一个终端，或复用已在跑的 4173

# 1. 先做最小判定，约 3 秒
node tools/cdp-doctor.cjs
#   === result: SESSION OK ===            -> 浏览器会话可用，继续第 2 步
#   日志停在某条命令                       -> 读 docs/cdp-doctor.log 末尾的 chrome stderr
#   报 port ... ALREADY ANSWERING        -> 换端口：$env:CDP_PORT="9500"

# 2. 完整验证
node tools/verify.cjs
```

`cdp-doctor.cjs` 会把 `Page.enable`、`Runtime.enable`、`Page.navigate`、`Runtime.evaluate`、`Page.captureScreenshot` 每一步的耗时打进日志，能直接看出停在哪一步。

若第 1 步的日志里出现下列任一行，即可判定为执行环境限制，而不是页面缺陷：

- `mojo\public\cpp\platform\platform_channel.cc ... Access is denied`
- `crashpad_client_win.cc ... OpenProcess: Access is denied`
- 进程存活但日志在一分钟内没有任何 `<-` 行

## 5. 本次对工具的改动（最小面）

- `verify.cjs`：启动前检查调试端口占用并给出可操作的报错；捕获 Chrome stderr，失败时打印尾部；端口可用 `CDP_PORT` 覆盖。
- 新增 `cdp-doctor.cjs`：不修改任何页面代码，只做会话诊断。
- 未修改任何超时时长、未终止他人进程、未更改沙箱或权限设置。

## 6. 仍未验证的部分

- C 类故障（Chrome 存活但 DevTools 通道断开）在本环境没有可复现手段，只能凭 stderr 旁证判断。
- 若审校官会话确有限制，需要在其会话内放开对 Chrome 的进程/IPC 约束后重跑，本工程无法代为绕过。
