# motorbench

**在线试玩（任务页面）：<https://sqchenxiyuan.github.io/motorbench/>**

给 computer-use agent 用的**基础操作** benchmark：只考最底层的鼠标/键盘动作做得准不准——点得中吗、能不能沿着一条带子/一个区域的边走完不出界、拖拽能不能放准、滚动、打字、快捷键。不考规划，不考对某个应用的了解。

- 21 个任务、5 类技能，每个任务 3 档难度，由 `(task, level, seed)` 完全确定，可复现、不怕背题。
- 任务是**自评分的网页**（canvas 渲染）。agent 只拿得到截图，只能发鼠标/键盘动作；页面根据真实输入事件自己算分。
- 连续得分（0–1，有部分分）+ 严格通过（pass/fail）。
- 自带校准基线：参考解必须 100 分，什么都不做必须 0 分，随机输入约 0 分。

## 快速开始

需要 Node ≥ 24（直接运行 TypeScript，无需构建）。

```bash
npm install
npx playwright install chromium        # 本机没有 Playwright 的 Chromium 时才需要

node bench.ts list                     # 任务和 agent 列表
node bench.ts run --agent oracle       # 参考解跑全量：21 任务 × 3 难度 × 3 seed，应为 100 分
node bench.ts serve                    # 启动服务：http://127.0.0.1:8765/ 手动试玩或网页版完整评分，/api/ 给远程 agent，/runs/ 看结果
```

跑完后看 `results/<时间>-<agent>/report.html`：分数表 + 每一集的最终截图，截图上叠了指针轨迹（品红 = 没按键移动，橙色 = 按住拖动，虚线 = 参考路径），一眼能看出 agent 哪里走歪了。

常用参数（完整列表见 `node bench.ts --help`）：

```bash
node bench.ts run --agent noisy --sigma 5 --tasks path,drag --levels 2,3 --seeds 5
node bench.ts run --agent anthropic --model claude-opus-5-5 --tasks trace-path --seeds 1,2
```

`--tasks` 接受任务 id、类别名（`pointing` `path` `drag` `scroll` `keyboard`）或 `all`；`--seeds 3` 表示 seed 1..3，`--seeds 4,9` 表示指定列表。

## 在网页上直接跑完整评分

任务页面自己就能跑一整套并给出成绩单，不需要 harness，也不需要服务端——[在线版](https://sqchenxiyuan.github.io/motorbench/)就可以用：

1. 打开菜单页，选一种规模（也可以直接打开 `…/?start=standard`）：

   | 规模 | 集数 | 内容 |
   |---|---:|---|
   | **Quick** | 21 | 每个任务做一次，难度 L2 |
   | **Standard** | 63 | 每个任务三档难度各一次 |
   | **Full** | 189 | 三档难度各 3 个实例，与 harness 默认的 `--seeds 3` 是同一批题 |

2. 一集完成后**自动进入下一集**。做不出来就点顶栏的 **Done ›**，按当前得分继续。每集限时 300 秒。
3. 全部做完显示**成绩单**：总分、通过率、各类别和每个任务各难度的分数，可以下载 JSON。

进度存在浏览器的 localStorage 里，中途关掉可以回到菜单页点 Resume 继续。

规则：

- 使用固定的 1280×800 舞台，所以题目与 harness 默认生成的完全一致，分数可以直接对比。窗口不够大时页面会提示放大窗口或缩小缩放比例，够大后自动开始。
- 进行中不显示得分，只在一集结束时闪一下结果。
- 一集只能做一次：回退到已计分的那一集会被送回当前未完成的一集。没结束前刷新页面可以重来，但次数会记在成绩单上。
- 没做的集按 0 分计入总分。
- 和 harness 的区别：这里没有动作预算，只有时间限制。

可选的 URL 参数：`tasks=click,drag`（只跑部分任务或类别）、`levels=1,3`、`seeds=1,2`、`limit=600`（每集秒数）、`viewport=window`（按当前窗口大小出题，成绩不再可比）。

这个模式适合人手动评测，也适合**自己控制真实浏览器或桌面的 agent**：让它打开 `?start=…` 一路做下去，最后读成绩单或下载 JSON。计分全部在浏览器本地完成、代码又是公开的，所以这种成绩是自报的，适合自测；需要可信的成绩时用下面的服务端 API。

菜单页下半部分是单个任务的练习模式：顶栏实时显示得分，做完自动换下一个实例。

## 任务

| 类别 | 任务 | 做什么 | L1 → L3 难度 | 得分 |
|---|---|---|---|---|
| pointing | `click` | 点击蓝色圆 | 半径 36 / 18 / 8 px，干扰圆 0 / 4 / 10 个 | 命中得 1，每次点空或按错键 −0.25 |
| | `double-click` | 双击蓝色圆 | 同上 | 同上；单击目标不扣分但不算完成 |
| | `right-click` | 右键点击蓝色圆 | 同上 | 同上；左键点击算失误 |
| | `click-sequence` | 按 1..N 顺序点击编号圆 | N = 3 / 5 / 8，半径 28 / 20 / 13 | 完成比例 × (1 − 0.2 × 错误点击数) |
| | `hover` | 移到目标上停留 1 秒，不按键 | 半径 36 / 18 / 9 | 最长停留比例；按过键则减半 |
| path | `trace-path` | **沿带子从绿端走到红端，不出界** | 带宽 44 / 26 / 14 px；折线 → 折线/蛇形 → 曲线/螺旋 | 带子覆盖率 × 在带内的路程占比 |
| | `trace-outline` | **从绿点出发沿区域边界走一圈** | 带宽 36 / 22 / 12 px；圆/矩形 → 多边形/椭圆 → 星形/不规则形 | 边界覆盖率 × 在带内的路程占比 |
| | `maze` | 指针从起点格走到终点格，不穿墙 | 4×3 / 6×4 / 9×6 格 | 到达得 1（未到达按进度最多 0.5），每次撞墙 −0.25 |
| drag | `drag-drop` | 把方块拖进虚线框并松开 | 每边余量 36 / 12 / 4 px | 方块落在框内的面积比例；没松手减半 |
| | `drag-bins` | 把每个圆片拖进同字母同色的框 | 3 个圆片 2 个框 → 5 / 3 → 7 / 4；框 170×120 → 120×96 → 80×68 px | (放对数 − 0.5 × 放错数) / 圆片总数 |
| | `reorder` | 把列表里的卡片拖成从小到大 | 3 张（1 张错位）→ 5 张乱序 → 7 张乱序且卡片更矮 | 乱序的卡片对相比初始减少的比例 |
| | `resize` | 拖角柄把方框缩放到与虚线框重合 | 容差 10 / 5 / 3 px，角柄 18 / 13 / 9 px；L3 要拖两个角 | 各边超出容差的偏差相比初始减少的比例；没松手减半 |
| | `slider` | 把滑块拖到指定数值 | 每单位 50 / 5 / 2.4 px | 1 − 误差 / (量程的 10%)；没松手减半 |
| | `rotate` | 拖旋钮的手柄转到指定角度 | 刻度步长 15° / 5° / 1° | 1 − 角度误差 / 45°；没松手减半 |
| | `pan` | 拖动地图，把红色图钉移进视野中心的圆环 | 圆环半径 40 / 24 / 13 px；一次拖动可达 → 要拖几次 → 很远 | 到圆环的距离相比初始缩短的比例；没松手减半 |
| | `draw-trace` | 按住左键沿虚线描一遍 | 容差 12 / 8 / 5 px；直线 → 折线 → 曲线/圆 | 虚线覆盖率 × 落在容差内的笔迹占比 |
| | `marquee` | 拉框选中所有蓝点、不含红点 | 框边可用间隙 50 / 22 / 9 px | Jaccard = 选中蓝点 / (全部蓝点 + 选中红点) |
| | `text-select` | 拖选指定的一段文字 | 字符宽 18 / 13 / 10 px；一个词 → 同一行的短语 → 跨行的短语 | 选中范围与目标范围的重合度（交 / 并） |
| scroll | `scroll-click` | 滚动列表找到指定行并点击 | 40 / 160 / 500 行 | 点中得 1，点错行 −0.25；只滚到可见得 0.3 |
| keyboard | `type-text` | 点击文本框并精确输入 | 两个单词 → 带数字标点的句子 → 先清空已有内容再输入随机串 | 相对初始内容的编辑距离改善量 |
| | `hotkey` | 按键 / 组合键 | 单键 → 带修饰键的组合 → 连续 3 组 | 完成比例 × (1 − 0.25 × 错误按键数) |

**pass**（严格通过）要求任务完成且没有失误：点击类零失误；路径类走完全程且带内路程 ≥ 99%（`draw-trace` 为 ≥ 97%）；`maze` 零撞墙；拖拽/键盘类结果完全正确（`resize` 是各边都在容差内，`pan` 是图钉在圆环内）并且已经松手。

**总分** = 各任务平均分的平均（每个任务权重相同）。因为拖拽类任务最多（10 个），总分里拖拽的比重也最大；报告和终端输出里同时给出每个类别的平均分和每个任务在各难度下的分数，需要按类别比较时看那几行。

### 路径类任务怎么判分

这是本 benchmark 的重点，规则刻意做得不容易被钻空子：

- 指针在相邻两个位置之间**按直线行进**，页面把每一段直线切成 ≤ 1.5 px 的小步逐点判定，所以"瞬移"到终点和老老实实走直线是一回事，抄近路会被算作出界。得分与浏览器实际送来多少个 move 事件无关。
- `trace-path` / `trace-outline`：指针到过绿色起点附近之后才开始计分，所以怎么接近图形不影响分数。之后把带子沿长度切成约 3 px 的小段，统计每一小段有没有被**带内**的指针经过，得到覆盖率；同时统计带内路程占总路程的比例，得到准确率。**得分 = 覆盖率 × 准确率**。
  - 抄近路：只覆盖到很少几段，而且大部分路程在带外，两个因子都很低。
  - 中途出界：出界那一段不算覆盖，回到带内可以继续，带外的路程拉低准确率。
  - 完全没去过绿色起点：不计分（结果里 `started: false`）。
- `maze`：一个"棋子"跟随指针但不能穿墙。指针穿墙时棋子留在原地并记一次撞墙，直到指针回到棋子所在格才继续，所以穿墙永远不产生进度。

## 环境约定

- 视口默认 1280×800，截图与 CSS 像素 1:1，坐标原点在左上角。
- 指针由页面自己画出来（黑色箭头，尖端是指针位置），所以截图里看得到。
- 任务说明显示在顶部深色栏，同时以文本形式给 agent（`env.task.instruction`）。
- 每集有动作预算：`2 × 参考解动作数 + 10`。截图不计入动作。
- 任务一完成就自动结束（`act()` 返回 `done: true`）；agent 也可以随时自行停止，按当前状态计分。
- 只有浏览器的真实输入（trusted events）计分；agent 接触不到页面的 DOM 和 JS。
- 新一集开始时指针停在顶栏右端。

## 动作空间

harness 自己的动作格式（`src/types.ts`），与具体模型无关：

| 动作 | 字段 | 说明 |
|---|---|---|
| `move` | `x, y` | 直线移动到该点 |
| `click` | `x?, y?, button?, count?, modifiers?` | 省略坐标则原地点击；`count: 2` 为双击 |
| `mouse_down` / `mouse_up` | `button?` | 按下 / 松开，配合 `move` 做任意形状的拖拽 |
| `drag` | `path: [x, y][]` | 在第一个点按下，依次经过各点，在最后一点松开 |
| `scroll` | `x?, y?, dx, dy` | 滚轮，单位像素 |
| `type` | `text` | 输入文本 |
| `key` | `keys, repeat?, holdSeconds?` | 按键或组合键，写法宽松：`Enter`、`ctrl+a`、`Control+Shift+KeyK`、`Page_Down` 都认 |
| `wait` | `seconds` | 等待（上限 10 秒） |

坐标越界、未知按键之类的无效动作不会抛异常：`act()` 返回 `{ ok: false, error }`，并消耗一次动作预算。

## 接入自己的 agent

实现 `Agent` 接口（`src/types.ts`），在 `src/agents/index.ts` 里登记一行即可：

```ts
import type { Agent, Env } from '../types.ts';
import { describeEnvironment } from '../types.ts';

export class MyAgent implements Agent {
  readonly name = 'my-agent';

  async run(env: Env): Promise<void> {
    const prompt = describeEnvironment(env.task);   // 统一的环境说明 + 任务指令
    while (!env.done) {
      const png = await env.screenshot();            // Buffer，1280×800 PNG
      const action = await decide(prompt, png);      // 你的模型
      if (!action) break;                            // 自行结束
      const res = await env.act(action);             // { ok, error?, done }
    }
  }
}
```

`run()` 可能被并发调用（不同的集），每集的状态请放在函数内部。`env.zoom([x0, y0, x1, y1])` 返回该区域的 2 倍分辨率截图，`env.report({...})` 可以把 token 用量之类的数据写进结果。

想自己写评测循环而不用 `runSuite`，可以直接用 `src/session.ts` 的 `Bench` / `Episode`：

```ts
import { Bench } from './src/session.ts';

const bench = await Bench.start();
const ep = await bench.open({ task: 'trace-path', level: 2, seed: 1 });
await ep.env.act({ type: 'move', x: 400, y: 300 });
const { status } = await ep.finish('final.png');     // { score, success, done, metrics }
await ep.close();
await bench.close();
```

## 服务端：远程 agent / 其他语言

`node bench.ts serve` 启动一个 HTTP 服务，浏览器和计分都在服务端，agent 可以用任何语言、在任何机器上通过 HTTP 接进来：

```bash
node bench.ts serve                                          # 仅本机：http://127.0.0.1:8765
MOTORBENCH_TOKEN=换成你的密钥 node bench.ts serve --host 0.0.0.0   # 对外提供服务，必须设 token
```

同一个端口上有三样东西：

| 路径 | 内容 |
|---|---|
| `/api/…` | 给 agent 用的 JSON API（设了 token 时需要 `Authorization: Bearer <token>`） |
| `/` | 任务页面，可以手动试玩 |
| `/runs/` | 所有已完成 run 的列表，点进去是每个 run 的报告（本地 `bench.ts run` 写在同一目录下的结果也会列出来） |

### Python 客户端

`clients/python/motorbench.py` 只依赖标准库，拷走就能用：

```python
from motorbench import Client

client = Client("http://127.0.0.1:8765", token=None)
run = client.start_run("my-agent", tasks=["path", "drag"], levels=[1, 2, 3], seeds=3,
                       config={"model": "..."})            # config 会原样记录在结果里
for spec in run.episodes:                                    # [{"task", "level", "seed"}, ...]
    ep = run.open(spec)
    while True:
        png = ep.screenshot()                                # PNG bytes，1280×800
        action = decide(ep.prompt, png)                      # 你的模型；ep.prompt = 环境说明 + 任务指令
        if action is None or ep.act(action)["done"]:         # 动作格式见上面的"动作空间"
            break
    print(ep.finish()["score"])                              # 结算这一集
summary = run.finish()                                       # 汇总并生成报告
print(summary["score"], client.url(summary["reportUrl"]))
```

`clients/python/example_agent.py` 是一个可以直接运行的完整例子：它解码截图、按颜色找到蓝色目标再去点，不依赖任何答案，能把四个"蓝色圆"任务做到满分。

```bash
python3 clients/python/example_agent.py --url http://127.0.0.1:8765
```

### API

| 请求 | 说明 |
|---|---|
| `GET /api/health` · `GET /api/tasks` | 服务状态；任务目录 |
| `POST /api/runs` | 声明一个 run：`{"agent", "tasks"?, "levels"?, "seeds"?, "config"?}` → `{"id", "episodes": [...], "reportUrl"}` |
| `GET /api/runs/:run` | 进度：已完成 / 进行中 / 剩余的集，以及已完成部分的结果 |
| `POST /api/runs/:run/episodes` | 开一集：`{"task", "level", "seed"}` → `{"id", "task": {instruction, viewport, maxActions…}, "prompt", "limits"}` |
| `GET /api/episodes/:id/screenshot` | 当前屏幕，`image/png` |
| `POST /api/episodes/:id/zoom` | `{"region": [x0, y0, x1, y1]}` → 该区域的 2 倍分辨率 PNG |
| `POST /api/episodes/:id/act` | 一个动作 → `{"ok", "error"?, "done", "actionsLeft"}`；或 `{"actions": [...]}` 批量执行（遇到被拒绝的动作或本集结束就停）→ `{"results": [...], "done", "actionsLeft"}` |
| `GET /api/episodes/:id` | 本集状态（不含分数） |
| `POST /api/episodes/:id/finish` | 结算本集，可附带 `{"agent": {…}}`（如 token 用量）→ 完整结果，含 `score` |
| `POST /api/runs/:run/finish` | 结束 run，写 `summary.json` 和 `report.html` → 汇总 + `reportUrl` |

出错时返回 `{"error": {"code", "message"}}` 和对应的状态码（400 请求有误、401 未授权、404 不存在、409 状态冲突、429 超出限额）。无效的**动作**不算请求错误：返回 200 和 `{"ok": false, "error": …}`，并消耗一次动作预算，和本地运行一致。

为了让不同 agent 的分数可比、不被刷分，服务端有这些规则：

- 一个 run 里每一集**只能尝试一次**，不能重开。
- 分数只在结算时给出；进行中只能知道 `done`，拿不到得分反馈。
- run 结束时，计划内**没做的集按 0 分**计入总分。
- 同时打开的集数有上限（`--max-episodes`，默认 8）；单集有总时长上限（`--timeout`，默认 600 秒）；超过 `--idle-timeout`（默认 120 秒）没有任何请求的集会被自动结算并关闭。
- 参考解不通过 API 暴露。但任务生成是确定性的、代码是公开的，所以这套规则防的是无意的偏差，不防蓄意作弊；要做公开排行榜，需要再加不公开的 seed。

### 部署到服务器

- 直接运行：服务器上装 Node ≥ 24，`npm ci && npx playwright install --with-deps chromium`，然后用上面带 token 的命令启动。结果写在 `--out` 指定的目录（默认 `results/`）。
- GitHub Pages 上只有静态的任务页面（`.github/workflows/pages.yml` 在 `web/` 有改动时自动发布），可以手动试玩；harness 和 API 服务端需要自己找机器运行。
- Docker：仓库里有 `Dockerfile`（`docker build -t motorbench .`，运行参数见文件头部注释）。**这个 Dockerfile 还没有实际构建过**（开发机上没有 Docker），第一次用时请留意构建输出。
- token 只保护 `/api/`，任务页面和结果页对能访问到端口的人都是公开的。服务本身是明文 HTTP，放到公网时请在前面加一层带 TLS 的反向代理。
- 每一集占用一个浏览器页面，CPU 是主要瓶颈：4 核机器上同时跑 4 集左右比较合适。

## 用 Claude 跑

```bash
export ANTHROPIC_API_KEY=...
node bench.ts run --agent anthropic --model claude-opus-5-5 --effort medium --seeds 2 --concurrency 2
```

适配器在 `src/agents/anthropic.ts`，使用 computer-use toolset（`computer_toolset_20260801`，适用于 Claude Fable 5.2 / Opus 5.5 / Sonnet 5.5 / Haiku 5.5）。模型的 `mouse_move`、`left_click`、`left_click_drag`、`left_mouse_down/up`、`scroll`、`type`、`key`、`zoom` 等调用被逐一翻译成上面的动作；`scroll_amount` 的一格按 100 px 计。每集的 token 用量记录在结果的 `agent.usage` 里。

注意：

- 全量 189 集会产生不少 API 费用（每集多轮、每轮带截图），建议先用 `--tasks`、`--seeds 1` 小范围试跑。
- 模型拒答时该集标记为 `error` 并按当时的页面状态计分（通常是 0）；没有启用自动回退到其他模型，这样分数始终属于 `--model` 指定的那个模型。
- 这个适配器目前只用脚本化的假客户端测过（`test/anthropic.test.ts`：请求格式、工具结果回传、批量动作、出错中止、拒答），**还没有对真实 API 跑过**。

## 输出

```
results/<run>/
  config.json        本次运行的配置
  results.jsonl      每集一行：score、success、endedBy、actions、seconds、metrics…
  summary.json       按任务 / 难度 / 类别的汇总和总分
  report.html        分数表 + 每集的回看截图
  episodes/<task>-L<level>-s<seed>/
    final.png        最终画面 + 指针轨迹
    trace.json       动作日志（每步之后的得分）和页面收到的全部输入事件
```

`endedBy` 取值：`task_complete`（任务自动完成）、`agent_stopped`（agent 自行停止）、`budget`（动作预算用完）、`timeout`、`error`。

## 校准基线

`oracle` 重放参考解；`noisy` 在参考解的每个坐标上加高斯噪声，用来看分数随"手抖"程度怎么变化；`random` 随机乱点乱按；`noop` 什么都不做。下表为全量（21 × 3 × 3 = 189 集）的分数（0–100）：

| agent | 总分 | pass % | L1 | L2 | L3 |
|---|---:|---:|---:|---:|---:|
| `oracle`（参考解） | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| `noisy --sigma 3`（每个坐标 ±3 px 噪声） | 98.1 | 88.4 | 100.0 | 99.7 | 94.6 |
| `noisy --sigma 8` | 80.7 | 60.9 | 92.5 | 85.6 | 64.1 |
| `random` | 0.8 | 0.0 | 0.4 | 1.5 | 0.6 |
| `noop` | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |

L1 基本不受几像素噪声影响，L3 明显下降——说明三档难度确实在区分定位精度。

随机输入不是严格的 0 分：有部分分的任务里，乱动偶尔会碰巧做对一点。主要来自 `pan`（7.5 分，随便拖一下地图就可能让图钉离圆环近一些）和 `text-select`（7.8 分，随手拖过文字会选中与目标有重叠的一段），其余任务都在 2 分以下。看单个任务的低分时请把这个底噪考虑进去。

## 添加任务

在 `web/tasks/` 新建模块并在 `web/tasks/index.js` 登记：

```js
export const myTask = {
  id: 'my-task', title: '…', category: 'pointing', summary: '…',
  create({ rng, level, area, W, H, widgets, now }) {   // rng 已按 (task, level, seed) 播种
    return {
      instruction: '给 agent 的一句话指令',
      onEvent(ev) {},        // move / down / up / click / dblclick / context / wheel / keydown
      draw(g) {},            // 每帧绘制到 canvas（视口坐标）
      status: () => ({ done, success, score, metrics }),
      solution: () => [],    // 参考解：harness 动作列表（oracle 用，也决定动作预算）
      reveal(g) {},          // 可选：回看截图上额外画的参考线
    };
  },
};
```

`move` 事件带 `prev`（上一个位置），需要沿路径判定时用 `web/lib/geom.js` 的 `walk(prev, cur, step)` 逐点走，或直接用 `web/lib/track.js` 里现成的 `CoverageTracker`。新任务加进去后 `npm test` 会自动检查它：参考解得 1 分、不操作得 0 分、同一 seed 结果一致。

## 测试

```bash
npm test          # 约 5 分钟（4 核机器），会启动无头 Chromium
npm run typecheck
```

- `suite.test.ts`：所有任务 × 难度 × 多个 seed，参考解 = 1 分、不操作 = 0 分、实例确定性、预算充足。
- `scoring.test.ts`：不完美和投机取巧的操作——抄近路、倒着走、跳段、穿墙、点错、拖一半、漏选、错别字——得分是否符合规则。
- `fidelity.test.ts`：页面收到的输入与发出的完全一致（快速连发时不丢轨迹点、滚轮增量精确、截图像素精确）。
- `anthropic.test.ts` / `keys.test.ts` / `runner.test.ts`：Claude 适配器（假客户端）、按键名归一化、超时/报错/预算耗尽的收尾与汇总。
- `webrun.test.ts`：网页版的完整评分和练习模式——自动进入下一集、成绩单、Done 不算误点、限时、不能重做、题目与 harness 一致。
- `api.test.ts`：HTTP 服务端——完整的 run 流程、一集只能做一次、未做的集记 0 分、各种畸形输入、并发与限额、鉴权、空闲超时，以及用 Python 客户端和示例 agent 实际跑一遍。

## 设计取舍与局限

- **直线行进是环境语义。** 真实桌面上有的驱动方式是瞬移指针；这里统一规定为直线，否则"沿路径走"无从判定。模型侧的环境说明（`describeEnvironment`）里明确告知了这一点。
- **`hover` 依赖真实时间**（停留 1 秒）。机器极度过载时不影响得分，但会让该任务跑得更慢。
- **只考察像素级操作**：任务画在 canvas 上，依赖 DOM/可访问性树的 agent 不在评测范围内。
- 任务说明目前只有英文。
- 通过服务端接入的 agent 用的是 harness 的动作格式和 Playwright 驱动的浏览器。自己控制真实桌面的 agent（自己截屏、自己发系统级鼠标事件）走的是上面网页版的完整评分，成绩由浏览器本地计算，不经过服务端。
