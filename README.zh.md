<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/ai-playtest/readme.png" alt="ai-playtest" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/ai-playtest/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/ai-playtest/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://mcp-tool-shop-org.github.io/ai-playtest/"><img src="https://img.shields.io/badge/Landing_Page-live-brightgreen" alt="Landing Page"></a>
</p>

# AI 游戏测试

针对回合制游戏的、具有多样化家庭背景的 AI 游戏测试。模型玩家驱动游戏——
通过终端、伪终端或套接字连接到您的游戏引擎——由来自*其他*家庭的模型组成的评审团对每个游戏记录进行评估，并生成一份报告，汇总所有评审结果，以及每个游戏会话实际体验了多少游戏内容。

一个人进行一次游戏，只能告诉你他看到了什么。五个家庭玩相同的四十回合游戏，就能告诉你整个世界会发生什么。

**在正式发布之前，这是一个私有项目。** 不在 npm 上；通过从兄弟仓库中导入的方式使用。

## 谁来评估

首先要了解的一点，也是大多数类似工具容易出错的地方：**一个评估者永远不会评估自己的游戏。** 默认情况下，每个游戏记录由一个“非参与者”进行评估（`panelSize`，如果不同意，可以提高这个值——而不是取平均值以获得更高的分数），而参与者自己的评估则作为*证据*——
记录了它感到困惑的地方，以及它尝试做的事情——但绝不会作为最终分数。

这种区分非常重要。大多数研究表明，大型语言模型（LLM）评估者表现出的自我偏好，实际上更多的是能力，而不是自恋（只有约 10.4% 的评估者超过了与能力相匹配的对照组，数据来自 37,448 对数据——[Roytburg et al. 2026](https://arxiv.org/html/2601.22548)），**但剩余的偏好集中在主观领域，而在可验证的领域则会消失**——而“游戏世界是否感觉鲜活”就是一个非常主观的标准。与此同时，自我评价实际上会降低准确性，而外部评估者则会提高准确性：在“24 游戏”中，自我评价的准确率为 5%，而外部评估者的准确率为 38%（[Stechly et al. 2024](https://arxiv.org/abs/2402.08115)）。

默认情况下，采用**一个“非参与者”评估者**，而不是一个由三名评估者组成的评审团。[Verga et al. 2024](https://arxiv.org/abs/2404.18796)（PoLL）表明，一个廉价的异构评审团在人类一致性方面，以 7-8 倍更低的成本击败了 GPT-4（κ 0.763 与 0.627），这说明了不值得为单个*大型*评估者付费，而不是说三个家庭会产生三个独立的投票。[Kohli 2026](https://arxiv.org/abs/2605.29800) 在 Kish 游戏中，对来自七个家庭的九名评估者进行了测量，结果表明 **n_eff = 2.18**；该评审团（72.0%）*没有*胜过最佳的单个评估者（71.8%）；跨家庭 φ 值为 0.389，而同一家庭 φ 值为 0.437。在 `panelSize: 3` 中，这相当于 **≈1.68 个独立的投票**。Dawid-Skene 方法无法解决这个问题（最多只能弥补 11% 的康多塞差距）。[Kim et al. 2025](https://arxiv.org/abs/2506.07962) 发现，当两者都出错时，配对的评估者大约有 60% 的时间会达成一致。因此，额外的评审员只是一个“不同意”标志，而不是一个更高的分数。**预算从评估者转移到游戏运行次数。** `--runs 3` 仅用于描述，而不是进行显著性检验；CLI 仍然默认设置为一次游戏运行，因此测试仍然是一次性的。n=3 永远无法达到 p<0.05（下限 `2/2^n` = 0.25）。请参见 `docs/research-2.md` §A 和 `docs/research-3.md`。

这并**不**会改变“将评估者从其自己的评审团中移除”这一做法，而这一做法是基于 Panickssery / Stechly / Huang 的研究。

**“不同意”的情况会被报告，而不是被平均掉。** 分歧的评估结果通常意味着*评估标准*不够明确，而不是游戏本身存在歧义，因此分歧的结果会标明其数量，并显示每个评估者的意见分散程度。

如果只有一个家庭参与评估，则没有有效的评估者。该工具不会悄悄地将游戏记录返回给其作者——它不会形成任何评审团，并且报告会说明该评估结果是自我评估，并解释为什么这种评估结果不可靠。配置验证仍然会拒绝让两个玩家来自同一个家庭：第二个家庭的存在才是让“非参与者”评审团成为可能（[Panickssery et al. 2024](https://arxiv.org/abs/2404.13076)）。

## 驱动程序——游戏是如何被观察的

| 驱动程序 | 通道 | 用于 |
|---|---|---|
| `stdio` | 行 | 基于行的文本游戏（默认设置） |
| `pty` | 渲染的终端**网格** | 全屏 TUI（ratatui、ncurses） |
| `rpc` | 通过 TCP 传输的结构化状态 | Godot、Unreal，任何你可以对其进行插桩的游戏引擎 |

排序方式是根据通道的*结构化程度*，而不是个人喜好。在 [OSWorld](https://arxiv.org/abs/2404.07972) 中，基于可访问性树的观察结果，大约可以将仅基于截图的成功率提高一倍（12.24% 与 5.26%）；在 [BALROG](https://arxiv.org/abs/2411.13543) 中，*添加*视觉信息实际上降低了几个模型的性能（GPT-4o 从 32.34% 降至 22.56%）；在 [VideoGameBench](https://arxiv.org/abs/2505.18134) 中，未经辅助的像素游戏完成率接近于零（0.48%）；而 [Voyager](https://arxiv.org/abs/2305.16291) 仍然是最强大的开放式游戏代理，它使用结构化的 API，并且从未见过任何像素。

因此，截图只是观察结果的*可选附件*，而不是唯一的通道。**如果你的游戏可以描述自己，它就应该这样做**——请参阅 [docs/engine-bridge.md](docs/engine-bridge.md），其中包含一个可以直接粘贴并使用的 Godot 4 自动加载程序，其中 `_observation()` 和 `_apply()` 是你唯一需要编写的函数，以及 Unreal 的路由。

### 为什么 `pty` 即使对于文本游戏也很重要

在管道中，C 程序的 stdout 会被完全缓冲，因此“输出停止 N 毫秒”可能意味着“尚未刷新”，而不是“正在等待你的输入”。PTY 恢复了行缓冲，并使就绪规则变得合理。在 Windows 上，管道根本无法捕获通过控制台 API 绘制的游戏的任何内容。

它还确定了重绘的外观。在测试 TUI 上进行测量：网格可以容纳**115 个当前屏幕上的字符**，而行追加视图可以容纳**416 个字符**，其中包含三个堆叠的重绘，以及玩家回显的输入，并且*包含三个相互矛盾的 HP 值*。模型必须猜测哪个是当前状态。

`pty` 需要可选的 `node-pty` 和 `@xterm/headless`。它们在 Windows 和 macOS 上安装预构建的版本；node-pty 在 Linux 上进行编译。如果没有它们，该驱动程序将以编码错误的形式失败，并显示安装命令——其他内容不受影响。

## 每个评估者实际看到了多少内容

一个不进行探索的模型玩家会生成一份关于它几乎没有仔细观察过的游戏的自信报告。因此，每次运行都会产生一个覆盖率块，该块仅根据回合记录进行计算——没有工具检测，没有额外的模型调用：新颖性曲线和半衰期、重复/循环/自循环率、动作熵，以及一个简单的 `thin` / `moderate` / `broad` 读取，并附带原因。

这值得拥有，因为失败是经过测量的，而不是理论上的。
以任务为导向的 LLM 代理 63.4% 的时间会重复其之前的动作，循环率为 16.0%，而对于经过 *训练* 以进行探索的代理，该比例为 24.9% / 7.7% ([Ye 等人，2026](https://arxiv.org/html/2605.16143))。将其理解为，乐队代理的重复行为实际上是在某个范围内——而不是某种人格字符串所能提供的，因为仅仅提示代理进行探索，平均通过率仅提高 **+2.57** ([Englander 等人，2026](https://arxiv.org/html/2604.17609))。低动作熵也表明 *低* 成功率，而不是效率，因此，一份简洁的记录，其中包含很少的独特输入，是一个警告信号，而不是一个好兆头。

## 如何解读结论

**排名很重要；不要相信绝对分数。** 这是该工具中最重要的一点，它来自两篇独立的文献。LLM 评估叙事质量时，系统级别的 τ 约为 0.70，而人类的上限为 0.73，但故事级别的 τ 仅为 0.16–0.25——几乎与 BERTScore 相当 ([Chhun 等人，2024](https://arxiv.org/abs/2405.13769))。自动游戏测试也以相同的方式验证：在 95,266 名玩家中，AI 的通过率与人类的通过率相关性为 ρ = 0.80 ([Roohi 等人，2021](https://arxiv.org/abs/2107.12061))，而绝对的代理技能则完全无法转移。

因此，“构建 B 在 *对玩家的反应* 方面得分低于构建 A”是一个该工具支持的说法。“这款游戏充满活力：是”则不是，并且报告的编写方式旨在保持这种区别。

**已知的差距，明确说明：** 我们没有找到任何研究来衡量由代理游戏测试者发现的问题与由人类游戏测试者发现的问题之间的协议程度，*用于评估体验质量*。自动游戏测试仅针对难度和能力进行验证。该工具的核心前提——即模型的困惑类似于玩家的困惑——因此，在文献中，无论哪种方式，都没有经过测试。将死点和困惑视为需要检查的线索，而不是结论。

## 工作原理

1. **观察。** 驱动程序生成一个 `Observation`：始终是 `text`，可选地是一个终端 `grid`，结构化的 `state`，一个 `image` 附件，以及当前合法的 `actions`。它还会记录 *它是如何* 知道这是玩家的回合——一个游戏发出的哨兵信号、一个终端就绪信号、一个提示模式，或者一个静默猜测——这样你就可以区分知识和推断。
2. **脚本设置。** 与 `setup[].match` 正则表达式匹配的提示将从配置中进行回答，无需玩家参与，也不需要消耗一个回合，因此每个系列都从相同的角色开始。
3. **玩家** 看到自上次输入以来的屏幕，以及上次的 `playerMemoryTurns` 交互，并由 `persona`（目标和注册表——绝不是正在测试的机制）进行简要说明，然后用一行文字进行回答。格式错误的答案将回退到 `look`。
4. **执行。** 当观察结果包含 `actions` 时，清理后的回复将映射到 `choose` / `key` / `line`。一个封闭集合的错误是一个框架事件——运行程序不会在游戏回合中处理它。设置和退出将保持 `kind:line`。
5. **退出。** 在 `turns` 个输入之后，运行程序会发送 `quitInputs`（例如，`save`、`quit`）。这些是 *运行程序* 的输入：它们不包括在回合计数和证据中，而它们产生的终端屏幕则会被保留——崩溃或保存摘要是证据。
6. **陪审团**——默认情况下，由一位不参与的作者组成，温度为 0——根据 `criteria[]` 评估记录。额外的陪审员（如果 `panelSize` > 1）会标记分歧；它们不会被平均到一个更强的分数中。参与游戏的席位的自己的解读是证词。
7. **确定性检查** 在回合记录上运行：吸收式 SCC（Tarjan，绝不标记为陷阱）、忽略的输入归因、可选的解析器/胜利/死亡正则表达式、无进展窗口、实体出现线索，以及（当 `state` 是一个对象时）HP/库存不变性。
8. **报告** 汇总：按系列划分的标准，并标记陪审员的分歧，覆盖率作为抽样限定符，验证块，以及每个死点和困惑的名称——首先是陪审员的发现，然后是作者的证词。符号（`!`、`H(a)`、`repeat`、`loop`）在页面上带有图例。

在 `<runsDir>/<label>/<seat>/` 下，每个席位生成的工件：`transcript.txt`、`critique.json`、`meta.json`（固定 `schemaVersion` + `toolVersion`）、`stderr.txt`（如果游戏写入了任何内容）。`REPORT.md` 和 `REPORT.json`（`kind: "single-run-report"`）位于标签根目录。

## 用法

```bash
export OPENROUTER_API_KEY=...
npm run build
node dist/cli.js run path/to/game.playtest.json --label phase9
node dist/cli.js run path/to/game.playtest.json --label smoke --seats mistral --turns 8
node dist/cli.js run path/to/game.playtest.json --label compare --runs 3   # descriptive; cannot reach p<0.05
node dist/cli.js run path/to/game.playtest.json --label rpc --serial       # one game, several seats; needed for RPC until you multiplex
node dist/cli.js report path/to/game.playtest.json --label phase9   # rebuild REPORT.md + REPORT.json from disk
```

`--serial` 依次运行席位。在 RPC 驱动程序中，它重用一个 TCP 客户端，并在席位之间调用 `reset()`。如果没有 `--serial`，每个 RPC 席位都是它自己的进程——如果它们共享一个侦听游戏，它们会发生冲突。

退出代码：0 正常 · 1 用法 · 2 配置 · 3 提供程序（缺少密钥，模型没有端点）· 4 运行错误（每个席位都以错误结束，或者没有席位生成结论）。错误会打印 `error:` 和 `hint:`。

## 配置参考

| key | meaning |
|---|---|
| `name` | playtest name (报告标题) |
| `driver` | `{"kind":"stdio"}`（默认值）、`{"kind":"pty","cols":100,"rows":30,"readySentinel":"..."}` 或 `{"kind":"rpc","port":7777,"host":"127.0.0.1"}` |
| `game.command`, `game.args`, `game.cwd` | 如何启动游戏；`cwd` 相对于配置文件进行解析。对于 `rpc` 驱动程序，不需要，因为它附加到一个正在运行的游戏。 |
| `game.env` | 游戏的额外环境变量；一个值 `$NAME` 读取运行程序的环境变量。 |
| `game.inheritEnv` | 将运行程序的整个环境变量传递给游戏。**默认情况下关闭**——请参见下文。 |
| `game.promptPatterns` | 正则表达式，含义为“等待一行”，针对剥离后的尾部（`stdio`）或呈现的游标行（`pty`）进行测试。 |
| `game.promptQuietMs` / `idleQuietMs` / `screenTimeoutMs` | 等待规则（默认值 800 / 6000 / 180000 毫秒） |
| `game.quitInputs` | 在最后一个回合之后发送的行数（默认 `["quit"]`） |
| `seats[]` | `{ id, family, model }` — OpenRouter 标识符；每个家庭一个席位 |
| `panelSize` | 每个脚本，作者不参与评审（默认 **1**；如果需要标记不同意见，可以增加，而不是为了平均出一个更高的分数） |
| `verifiers` | 可选的正则表达式列表（`unparsed`、`refused`、`victory`、`death`；为空则不进行猜测）。占用：`absorbingMinTurns`（默认 4）、`noProgressWindow`（默认 5）、`noOpVerbs` |
| `setup[]` | `{ match, answer }` 用于设置提示的脚本答案 |
| `turns` | 每个席位的游戏输入（设置答案和退出输入不计入；默认 40） |
| `persona` | 玩家简介 |
| `criteria[]` | `{ id, check }` 游戏自身的存活标准 |
| `screenChars` | 每回合保留在屏幕上的字符数（默认 6000） |
| `playerMemoryTurns` | 玩家可以看到的最近回合数（默认 8） |
| `playerTemperature` | 玩家采样温度（默认 0.7）；评论者的温度始终为 0 |
| `runsDir` | 运行结果的保存位置（默认 `runs`，根据配置文件解析） |

一个可用的配置：`claude-rpg/dogfood/playtest/claude-rpg.playtest.json`（已发布的 Claude 叙述者通过 OpenRouter 的 Anthropic 兼容端点 — `ANTHROPIC_BASE_URL=https://openrouter.ai/api`，SDK 附加 `/v1/messages` — 使用游戏的 `CLAUDE_RPG_MODEL` 覆盖命名一个 `anthropic/...` 标识符）。

### 关于 `game.inheritEnv` 的说明

游戏进程会获得一个小的允许列表，以及您的 `game.env`，**而不是** `OPENROUTER_API_KEY`。 这并非一直如此：之前，该密钥会传递到游戏中，并且可以观察到它被渲染到屏幕文本中，然后流入玩家的上下文和书面报告中。 如果您有在修复之前生成的运行结果，请将用于这些结果的密钥视为已暴露。 `inheritEnv: true` 恢复了完整的继承性——仅将其用于您信任的与运行程序本身一样信任的游戏。

有关完整说明，请参阅 [SECURITY.md](SECURITY.md)。

## 信任模型

**涉及的数据：** 游戏测试 JSON、任何 `game.command` / RPC 桥接程序打印的内容、OpenRouter 聊天完成结果（玩家 + 评审团），以及运行程序写入的文件（位于 `runsDir` 处）（`transcript.txt`、`critique.json`、`meta.json`、`REPORT.md`、`REPORT.json`）。

**不涉及的数据：** 运行程序不发送任何遥测数据，也不收集任何分析数据。 除非您设置 `game.inheritEnv: true`，否则游戏进程不会接收 `OPENROUTER_API_KEY`。 不会将任何内容写入 `runsDir` 之外的位置。

**权限：** `game.command` 等同于 `child_process.spawn`——游戏测试配置可以像可执行文件一样运行。 像审查 shell 脚本一样审查它。 出站 HTTPS 仅是配置的 OpenRouter 基本 URL。 没有沙盒。

## 遥测

无。 没有分析数据，没有崩溃报告，也没有“回家”功能。 唯一的网络调用是您为模型配置的网络调用。

## 标准合规性（工作流程标准，评分 0-3）

- **PIN_PER_STEP — 2。** 每个席位都会固定其模型标识符；玩家和评论者的提示都是代码常量；配置是可以重复使用的输入。 OpenRouter 不会固定提供商路由，因此重复运行的结果在提示上是相同的，而不是在字节上完全相同。
*修复方法：在 `meta.json` 中记录每次调用的提供商。*
- **ANDON_AUTHORITY — 2。** 如果一个席位停止（`screenTimeoutMs`）、过早退出或耗尽重试次数，则会记录原因；如果没有任何席位生成结果，则运行结果将为 4 而不是 0，因此静默的评论失败不能被视为正常。
- **NAMED_COMPENSATORS — 跳过：** 运行程序的唯一工件是运行目录；删除它就是全部撤销。 游戏的副作用是它自身的，并且不在运行程序的控制范围之内——这也是为什么游戏测试配置被视为可以像可执行文件一样运行的原因。
- **DECOMPOSE_BY_SECRETS — 3。** `driver.ts` 是观察的边界，`openrouter.ts` 是唯一的网络边界，`panel.ts` 是判断的边界；每个边界都有其自身的测试，并且在另一侧都有一个模拟。
- **UNCERTAINTY_GATED_HUMANS — 3。** 报告会汇总信息，但不会做出判断，并且会说明其自身的不确定性：拆分的结果、覆盖范围不足、样本量过少警告以及没有评论者回答的标准都会被呈现出来，而不是被平滑处理。
- **EXTERNAL_VERIFIER — 3。** 每个脚本都由一个没有生成该脚本的家庭进行评审（默认一个作者不参与评审的席位；如果需要标记不同意见，可以增加 `panelSize`），并且会报告不同意见。 **在 2026-09-14 的测试中，此项的评分是 3，而代码却执行了相反的操作**——评论者与进行游戏的模型相同。 现在，声明与实现相符，并且 `pickJurors` 会返回一个空的评审团，而不是退回到作者。

## 开发

```bash
npm install
npm run verify      # typecheck (src AND tests) + vitest
npm run coverage    # vitest --coverage
```

182 个测试。 `tsconfig.test.json` 的存在是因为构建配置排除了测试文件，这意味着没有任何测试文件会被任何东西进行类型检查——它在第一次运行时就捕获了真实的类型错误。

---

由 [MCP Tool Shop](https://mcp-tool-shop.github.io/) 构建。
