# WorkBuddy Score Badge（WorkBuddy 积分徽章）

在 **WorkBuddy 对话框右上角**常驻显示积分余额的桌面插件。参照 `codexpp-deepseek-token-usage` 的设计思路（注入式用户脚本 + API 数据 + 热重载守卫），针对 WorkBuddy 桌面端（Electron）重新实现。

![badge](https://img.shields.io/badge/version-1.0.0-f5c451) ![runtime](https://img.shields.io/badge/runtime-Node%2022+-339933)

## 效果

- 对话窗口右上角一枚深色玻璃质感药丸：`● 💰 900 积分`
- 状态点：🟢 今日已记录 / 🟡 今日未记录 / 🔴 查询失败
- 鼠标悬停展开详情卡：连续登录天数、今日记录状态、连续奖励下一档缺口、派猫猫旅行状态（含到达倒计时/可领积分）、数据更新时间
- 点击 `⟳` 立即刷新；药丸可拖动，位置自动记忆；点击药丸可固定/收起详情卡

## 工作原理

```
┌─ start.cmd ──────────────────────────────────────────────┐
│ 1. 设置 WORKBUDDY_REMOTE_DEBUGGING_PORT=9223 后启动      │
│    WorkBuddy（官方支持的环境变量，主进程原生处理，         │
│    见 app.asar 内 applyCliCommandLineSwitches）           │
│ 2. 通过 VBS 在后台隐藏拉起 bridge 守护进程                │
└──────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─ wb_score_badge.mjs（Node 22 零依赖）────────────────────┐
│ · 每 3s 轮询 CDP /json/list，发现对话窗口 page target     │
│ · Runtime.evaluate 注入 badge.js（幂等，热重载安全）      │
│ · 每 5min（或徽章点击刷新时）调用积分技能查询数据          │
│ · window.__wbScoreBadge.update(data) 推送到页面           │
│ · WorkBuddy 退出 90s 后 bridge 自行退出，不留常驻进程     │
└──────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─ badge.js（注入脚本，closed Shadow DOM）─────────────────┐
│ · 浮动徽章 UI，与宿主样式完全隔离                          │
│ · window.__wbScoreBadge 为主人守卫：新版本注入后旧实例     │
│   自动"退休"（移除 DOM、停止定时器），杜绝双实例打架       │
│ · 页面导航/重载后由 bridge 心跳检测并自动重新注入          │
└──────────────────────────────────────────────────────────┘
```

### 与参照插件（Codex++ DeepSeek 用量面板）的机制对照

| 设计要素 | Codex++ 插件 | 本插件 |
|---|---|---|
| 注入机制 | Codex++ 宿主注入 user_scripts | WorkBuddy 官方 CDP 通道（`WORKBUDDY_REMOTE_DEBUGGING_PORT`） |
| 数据来源 | 监听 DeepSeek API 响应 + 本机助手推送 | 复用 totorosir-workbuddy-score 技能（本机登录态解密 + Buddy 加油站接口） |
| UI 载体 | 顶栏入口 + 可拖动图表面板 | 右上角浮动徽章 + 悬停详情卡 |
| 热重载 | `window.__deepseekUsagePanel` 主人退休机制 | 同款 `window.__wbScoreBadge` 守卫 |
| 生命周期 | 计划任务看门狗 | 随 WorkBuddy 启停，退出自动清场 |

### 数据来源与安全

- 查询脚本：`~/.workbuddy/skills/totorosir-workbuddy-score/scripts/buddy_station.py --json --no-toast --no-push`（需已安装该技能并登录 WorkBuddy 客户端；登录态 accessToken 为 AES-256-GCM 信封，由该技能在本机解密，token 绝不落日志、不进页面）
- 也支持演示模式：设置环境变量 `WB_SCORE_MOCK_DATA`（JSON）即可脱离技能运行
- 徽章为纯展示组件：只读查询，不触发任何写接口（不签到、不派旅行）

## 安装

```cmd
cd wb-score-badge
install.cmd                 REM 安装 + 桌面快捷方式
install.cmd --autostart     REM 另加登录自启（计划任务）
install.cmd --no-shortcut   REM 不建桌面快捷方式
```

安装位置：`%LOCALAPPDATA%\wb-score-badge\`（含探测到的 WorkBuddy/技能/Node 路径写入 `config.cmd`）。

## 使用

1. 若 WorkBuddy 正在运行，先**完全退出**（环境变量只对新进程生效）
2. 双击桌面 `WorkBuddy Score Badge`（或运行 `%LOCALAPPDATA%\wb-score-badge\start.cmd`）
3. WorkBuddy 启动后约 3~5 秒，徽章出现在对话窗口右上角

> 用普通方式启动的 WorkBuddy 没有 CDP 端口，启动器会明确提示，不会静默失败。

## 配置（config.cmd 或环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `CDP_PORT` / `WB_SCORE_CDP_PORT` | 9223 | CDP 调试端口 |
| `WB_SCORE_POLL_MS` | 3000 | 注入/心跳轮询间隔 |
| `WB_SCORE_DATA_INTERVAL_MS` | 300000 | 数据自动刷新间隔（5 分钟） |
| `WB_SCORE_MOCK_DATA` | — | JSON 演示数据（跳过技能查询） |
| `WB_SCORE_URL_FILTER` | — | 只注入 URL 含此子串的页面 |
| `WB_SCORE_SKILL_SCRIPT` | 自动探测 | 指定 buddy_station.py 路径 |
| `WB_SCORE_PYTHON` | 自动探测 | 指定 Python 解释器 |
| `WB_SCORE_LOG` | — | bridge 日志追加文件 |

## 卸载

运行 `uninstall.cmd`：移除插件目录、计划任务与桌面快捷方式。**不修改 WorkBuddy 本体任何文件**；以普通方式启动 WorkBuddy 即回到原生状态。

## 已知边界

- CDP 注入随窗口重载自动恢复；若 WorkBuddy 升级改变了页面结构，徽章因使用 fixed 定位 + Shadow DOM，通常不受影响
- 积分明细（流水）等无只读接口的数据一律显示 `--`，不编造
- 查询失败（未登录/token 过期/断网）徽章转红并在详情卡显示原因，恢复后自动继续
