# ClawZ - AI Agent 场景工坊

ClawZ 是一款基于 **Tauri v2** 的 macOS 桌面应用，为 [OpenClaw](https://openclaw.ai) 开源 AI Agent 框架提供可视化管理界面。用户无需手动输入 CLI 命令，即可通过图形界面完成 AI 模型配置、消息渠道接入、Agent 人设编排、定时任务管理和多 Agent 路由等操作。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri v2（`tauri@2.10`，Rust 后端 + Webview 前端） |
| 前端 | React 19 + TypeScript 5.9 + Vite 7 |
| 样式 | Tailwind CSS v4（通过 `@tailwindcss/vite` 插件） |
| 路由 | React Router v7 |
| 状态管理 | Zustand v5 |
| 图标 | lucide-react |
| 国际化 | 自定义 Hook（`useT()`），支持 zh-CN / en-US |
| 包管理器 | pnpm（v10.30.3） |
| 测试 | Vitest |

## 项目结构

```
ClawKit/
├── src/                          # 前端（React/TypeScript）
│   ├── App.tsx                   # 根组件：StartupGuard + 路由表
│   ├── pages/                    # 页面级组件
│   │   ├── Dashboard.tsx         # 网关状态总览
│   │   ├── ScenarioWorkshop.tsx  # 场景模板 + 人设编辑器
│   │   ├── AgentManagement.tsx   # Agent 增删改查 + 渠道绑定
│   │   ├── ModelManagement.tsx   # 模型供应商/模型配置
│   │   ├── ChannelManagement.tsx # 渠道管理 + 多账户
│   │   ├── LogCenter.tsx         # 网关 & 应用日志查看
│   │   ├── CostDashboard.tsx     # Token 用量 & 成本追踪
│   │   ├── ThemePackDetail.tsx    # 场景详情 + 一键/自定义部署
│   │   ├── MultiAgentDetail.tsx  # 多 Agent 场景部署向导
│   │   ├── Settings.tsx          # 高级设置、安全、货币、语言、主题、备份/恢复、关于/卸载
│   │   └── onboarding/           # 首次使用引导向导（5 步：Welcome→ModelConfig→ChannelConnect→ScenarioSelect→Complete）
│   ├── components/
│   │   ├── layout/               # AppShell、Sidebar、Header、NavItem
│   │   ├── ui/                   # 通用组件：Button、Input、Card、Drawer、TabBar、ErrorBoundary 等
│   │   ├── shared/               # ThemePackCard
│   │   ├── model/                # AddProviderModal（模型供应商添加/OAuth 弹窗）
│   │   └── channel/              # AddChannelModal（渠道添加弹窗）
│   ├── stores/                   # Zustand 状态仓库
│   │   ├── appStore.ts           # 全局：网关状态、Agent 列表、配置（带 localStorage 缓存）
│   │   ├── settingsStore.ts      # 主题、语言、货币（通过 Tauri Store 持久化）
│   │   ├── onboardingStore.ts    # 引导向导步骤数据
│   │   └── agentStore.ts         # Agent 相关 UI 状态
│   ├── data/
│   │   └── scenarios/            # 场景包 JSON 数据（内置场景）
│   │       ├── schema.ts         # ScenarioPackage、CronJobDef 等类型定义
│   │       ├── index.ts          # builtinScenarios 导出
│   │       ├── default.json      # 默认场景
│   │       ├── writer.json       # 内容创作管线
│   │       ├── morning.json      # 每日晨报
│   │       ├── email.json        # 邮件管家
│   │       ├── ops.json          # 运营仪表盘
│   │       └── debate.json       # 多 Agent 辩论
│   ├── lib/                      # 工具库 & 静态数据
│   │   ├── tauri.ts              # 所有 Tauri invoke() 调用封装（带类型）
│   │   ├── bindings.ts           # 绑定关系的解析/格式化工具
│   │   ├── channels.ts           # 渠道定义（CHAT_CHANNELS、HIDDEN_CHANNELS）
│   │   ├── constants.ts          # 应用常量（APP_NAME、GATEWAY_PORT、OPENCLAW_DIR）
│   │   ├── providers.ts          # 模型供应商定义
│   │   ├── retiredModels.ts      # 已退役模型列表、isRetiredModel() 过滤
│   │   ├── channelGuides.ts      # 渠道配置分步教程
│   │   ├── scenarioTemplates.ts  # 场景模板桥接层（localizeScenario、applyScenarioCron）
│   │   ├── exportScenario.ts     # 场景导出为 JSON 文件
│   │   ├── logos.ts              # 渠道 SVG Logo 映射
│   │   ├── env.ts                # isTauriEnv()、extractErrorMessage()
│   │   ├── buildInfo.ts          # 自动生成（gitignore），版本/构建号/commit hash
│   │   ├── onboardingProgress.ts # 引导进度持久化
│   │   └── i18n/                 # 翻译文件
│   │       ├── index.ts          # useT() Hook、detectSystemLocale()
│   │       ├── zh-CN.ts          # 中文翻译（主语言）
│   │       └── en-US.ts          # 英文翻译
│   └── types/                    # TypeScript 类型定义
│       ├── channel.ts            # ChatChannel、ChannelField、ChannelAccount
│       ├── provider.ts           # ModelProvider、ValidateKeyResult
│       ├── binding.ts            # AgentBinding、BindingMatch
│       ├── agent.ts              # Agent 类型（agentStore 使用）
│       ├── theme-pack.ts         # ThemePack 类型
│       └── settings.ts           # AppSettings 类型
├── src-tauri/                    # Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json           # 应用配置（identifier: com.clawz.app）
│   ├── entitlements.plist        # macOS 权限声明（allow-jit + disable-library-validation）
│   ├── capabilities/default.json # Tauri 权限声明
│   └── src/
│       ├── lib.rs                # 插件注册 + 命令注册列表
│       ├── main.rs               # 入口
│       └── commands/             # 所有 Tauri 命令模块
│           ├── mod.rs            # 模块声明
│           ├── cli.rs            # oc_run() — 公共 CLI 执行器，含 JSON 提取
│           ├── agents.rs         # Agent 增删、绑定、会话、单 Agent 模型切换
│           ├── channel.rs        # 渠道添加/禁用/删除、插件安装、凭证验证
│           ├── config.rs         # 读写 openclaw.json
│           ├── cron.rs           # 定时任务增删改查
│           ├── env_check.rs      # 环境检测（含自动修复、npm 镜像源测试）
│           ├── gateway.rs        # 网关启停/重启、状态查询
│           ├── installer.rs      # OpenClaw 安装/卸载 + CLI symlink 管理
│           ├── model.rs          # 供应商配置、模型列表、API Key 验证
│           ├── scenario.rs       # 应用人设、工具配置、Skills 扫描/启用
│           ├── system.rs         # 系统信息、前端日志桥接
│           ├── usage.rs          # Token 用量统计（UTC→本地时区转换）
│           ├── backup.rs         # 配置导出/导入
│           └── logs.rs           # 日志文件读取
├── scripts/                      # 构建辅助脚本
│   ├── gen-build-info.sh         # 生成 buildInfo.ts（dev/build 前自动运行）
│   ├── build-dmg.sh              # 构建 DMG（含 Node.js + openclaw）
│   ├── bundle-openclaw.sh        # 安装 openclaw 到 resources/openclaw/ 供打包
│   └── download-node.sh          # 下载 Node.js 并打包为 NodeHelper.app（macOS Helper App）
└── docs/                         # 设计文档
```

## 核心架构

### 前后端通信

所有后端调用都通过 `src/lib/tauri.ts` 中的类型化 `invoke()` 封装函数完成。每个 Tauri 命令在 `src-tauri/src/lib.rs` 的 `generate_handler![]` 中注册。

后端本质上是一个 **CLI 包装层** — 大部分命令通过 `bash -l -c` 执行 `openclaw <子命令>` 并解析 JSON 输出。公共执行器位于 `commands/cli.rs::oc_run()`，负责：
- 过滤插件日志噪音（`[plugins]`、`Config ` 开头的行）
- 从混合 stdout 中提取 JSON
- 结构化错误上报（`pick_error()`）

### OpenClaw 配置

OpenClaw 的配置存储在 `~/.openclaw/openclaw.json`。应用通过 `readOpenClawConfig()` 读取，通过 `openclaw config set` CLI 或直接 JSON 操作写入。

主要配置路径：
- `auth.profiles.{provider}:default` — Provider 认证元数据（provider name + auth mode）
- `agents.defaults.model` — 全局默认模型（JSON 对象 `{ "primary": "provider/model" }`）
- `agents.list.{idx}.model` — 单 Agent 模型覆盖
- `agents.defaults.maxConcurrent` / `subagents.maxConcurrent` / `compaction.mode` — Agent 高级设置
- `models.fallbacks` — 降级模型列表
- `models.providers.{provider}` — 自定义 Provider 配置（baseUrl、api、models 数组）
- `models.mode` — 设为 `"merge"` 以启用自定义 Provider
- `channels.{渠道ID}.accounts.{账户ID}.*` — 多账户渠道配置
- `channels.{渠道ID}.enabled` — 渠道启用/禁用
- `channels.{渠道ID}.dmPolicy` / `allowFrom` / `groupPolicy` — 安全策略
- `tools.profile` — Agent 工具集等级
- `skills.entries.<name>.enabled` — Skill 启用/禁用
- `plugins.installs.*` — 已安装插件
- `session.dmScope` / `messages.ackReactionScope` — 会话与消息策略
- `gateway.mode` — 网关模式（必须设为 `"local"` 才能启动，openclaw v2026.3.8+ 要求）
- `gateway.port` / `gateway.auth.token` — 网关端口与认证令牌

### 多账户渠道系统

每个渠道支持多个 Bot 账户，基于 OpenClaw 的 account 机制：
- CLI：`openclaw channels add --channel <id> --account <accountId> --token <value>`
- 配置结构：`channels.{渠道ID}.accounts.{账户ID}.{字段}`
- 绑定规格：`{渠道ID}:{账户ID}`（如 `telegram:ops-bot`）
- 首次配置渠道时自动绑定到 "main" Agent；添加额外账户时跳过自动绑定（`__skipAutoBind` 标志）
- 删除账户：`openclaw channels remove --channel <id> --account <acctId> --delete`

### Agent 绑定系统

Agent 通过绑定关系与渠道建立消息路由：
- `openclaw agents bind --agent <id> --bind <spec>` — 绑定渠道/账户
- `openclaw agents unbind --agent <id> --bind <spec>` — 解除绑定
- `openclaw agents bindings --agent <id> --json` — 查询绑定列表
- 绑定匹配字段：channel、accountId、peer（kind+id）、guildId、teamId、roles
- **Config-based 绑定解析**：`lib/bindings.ts::parseBindingsFromConfig(config)` 从 `openclaw.json` 的 `config.bindings` 数组直接解析所有绑定，避免 N+1 次 CLI 调用。AgentManagement、ChannelManagement、MultiAgentDetail 均使用此方式
- 旧方式 `parseBindings()` 仍保留用于解析单个 CLI JSON 响应
- **创建 Agent 向导**使用 `BindableUnit`（channel + accountId 对）作为可绑定单元，以账户级粒度展示和选择，避免同一渠道下未绑定的账户被误判为"已被占用"
- **Flat config 渠道**（无 `accounts` 子对象）隐式视为 `default` 账户，绑定 key 为 `{channel}:default`
- **路由下拉过滤**：当前 Agent 已有渠道级绑定时，该渠道下所有账户单元从下拉列表中排除

### 单 Agent 模型切换

- Agent 默认使用全局模型（`agents.defaults.model`），支持单独切换
- 后端命令：`set_agent_model(agent_id, model)` — 读取 `agents.list` 定位索引，通过 `config set agents.list.{idx}.model` 写入
- 前端：AgentManagement OverviewTab 的模型卡片提供编辑入口，选择后自动重启网关

### Provider ID 映射

前端 provider ID、OpenClaw provider ID、OAuth provider ID 是三套不同的标识符：

| 前端 ID | `ocProviderId` | `oauthProviderId` | 说明 |
|---------|---------------|-------------------|------|
| `openai` | `openai` | `openai-codex` | OAuth 使用 chatgpt.com 后端 |
| `Codex` | `anthropic` | `Codex-cli` | — |
| `minimax` | `minimax` | `minimax-portal` | — |
| `zhipu` | `zai` | — | 仅 API Key |
| `qwen` | `qwen-portal` | `qwen-portal` | — |

- 前端映射：`providers.ts` 的 `OC_PROVIDER_MAP`（反向映射）
- 后端映射：`model.rs` 的 `ProviderMeta` + `provider_meta()` 函数
- 特殊：OpenAI OAuth 模式运行时将 `oc_provider` 从 `"openai"` 突变为 `"openai-codex"`

### OAuth 认证系统

`model.rs` 实现了三种 OAuth 流程（~800 行），是后端最复杂的子系统：

**1. PKCE OAuth**（OpenAI、Anthropic/Codex）
- 在 `127.0.0.1:1455` 启动本地 HTTP 回调服务器
- 浏览器打开授权 URL → 用户授权 → 重定向到本地回调
- 用授权码 + code_verifier 换取 access_token + refresh_token
- OpenAI 用 form-urlencoded，Codex 用 JSON body（`token_json: bool` 控制）
- Codex token endpoint 必须使用 `console.anthropic.com/v1/oauth/token`（与 OpenClaw 运行时 pi-ai 库一致）

**2. GitHub Copilot Device Code**
- 经典设备码授权：展示 code + verification URL，轮询等待用户在浏览器完成授权
- 固定 client_id：`Iv1.b507a08c87ecfe98`

**3. Device Code + PKCE 混合**（通义千问、MiniMax）
- 设备码 UX（展示 code） + PKCE 安全（code_challenge/verifier）
- Qwen 用 `device_code` 字段，MiniMax 用 `user_code` 字段

**事件协议**：
- 后端通过 `emit("oauth-progress", OAuthProgress)` 向前端推送状态：`device_code`、`waiting`、`success`、`error`
- `OAUTH_CANCELLED` 全局 AtomicBool 实现协作式取消（`cancel_oauth_flow()` 命令）
- 不支持的 provider 返回 `"TERMINAL_REQUIRED:{providerId}"` 哨兵错误，前端捕获后静默忽略（不作为错误展示）

### 双重 Auth 存储

Provider 凭证存储在两个位置（增删时必须同时处理）：

| 位置 | 路径 | 存储内容 |
|------|------|---------|
| 全局配置 | `~/.openclaw/openclaw.json` → `auth.profiles.{profileId}` | provider name + auth mode（元数据） |
| Agent 级别 | `~/.openclaw/agents/{id}/agent/auth-profiles.json` → `profiles.{profileId}` | 实际凭证（API Key / OAuth tokens） |

Profile ID 格式：`{oc_provider}:default`（如 `anthropic:default`、`openai-codex:default`）

凭证结构因 auth 类型不同：
- API Key：`{ "type": "api_key", "provider": "...", "key": "..." }`
- OAuth：`{ "type": "oauth", "provider": "...", "access": "...", "refresh": "...", "expires": <epoch_ms> }`

`remove_provider()` 必须清理两处：全局通过 `openclaw config unset`，Agent 级别通过直接 JSON 操作。全局删除失败为非致命（profile 可能仅存在于 Agent 级别）。

### 已退役模型过滤

`src/lib/retiredModels.ts` 维护一个 append-only 的已下线模型列表（provider 侧返回 HTTP 404 确认后添加）：
- `ModelSwitcher` 和 Fallback 候选列表自动过滤已退役模型
- 若当前默认模型已退役，显示红色警告提示用户切换
- 模型 key 格式：`"provider/model-id"`（如 `"anthropic/Codex-3-5-haiku-20241022"`）

### 场景数据与本地化

场景包数据存放在 `src/data/scenarios/*.json`，每个文件遵循 `ScenarioPackage` schema（`schema.ts`）。

**本地化模型**：根数据为中文（zh-CN），`locales` 字段包含其他语言的覆盖。`localizeScenario()` 函数负责合并：
- 仅覆盖可翻译字段（name、description、soul、identity、heartbeat、cron 的 name/message）
- 不可翻译字段（schedule、value、skills、toolsProfile）始终来自根数据，通过 `...spread` 保留
- 多 Agent 场景中，`locales.cron` 是**全局扁平数组**（跨所有 Agent），索引按 Agent 顺序累加

### 定时任务系统

场景部署创建定时任务时，使用 **upsert 模式**（`upsertScenarioCronJobs()`）：
1. 先查询已有任务列表（`listCronJobs()`）
2. 按 `(agentId, name)` 匹配：存在则 `editCronJob` 更新，不存在则 `createCronJob` 新建
3. 避免重复应用场景时产生重复定时任务

手动创建定时任务（AgentManagement CronTab）直接使用 `createCronJob`，不走 upsert。

OpenClaw cron 调度格式：
- `--cron "0 8 * * *"` — 标准 5/6 字段 cron 表达式
- `--every 4h` — 固定间隔（支持 `30m`、`1h`、`6h` 等）

### Skills 系统

场景模板（`scenarioTemplates.ts`）中每个模板包含：
- `skills: string[]` — OpenClaw Skill ID 列表（如 `"summarize"`、`"blogwatcher"`、`"weather"`）
- `toolsProfile: ToolsProfile` — Agent 工具集等级（`"minimal"` | `"coding"` | `"messaging"` | `"full"`）

**多 Agent 场景部署默认模型**：`MultiAgentDetail` 中每个 Agent 的 model 默认为空字符串，表示使用系统默认模型（`agents.defaults.model`）。场景 JSON 中的 `recommendedModel` 字段仅用于 UI 展示推荐，**不作为实际部署的模型值**（它是人类可读名称如 "Codex Sonnet"，非有效的 `provider/model-id` 格式）。

部署场景时（ThemePackDetail / MultiAgentDetail），在应用人设后依次调用：
1. `setToolsProfile(profile)` — 设置 `tools.profile` 配置
2. `enableScenarioSkills(skills)` — 通过 `oc_config_set("skills.entries.<name>.enabled", "true")` 启用

后端 `scenario.rs` 提供 `list_skills(agent_id)` 命令，从三个目录扫描可用 Skills：
1. workspace skills（`~/.openclaw/agents/{id}/workspace/skills/`）— 最高优先级
2. managed skills（`~/.openclaw/skills/`）
3. bundled skills（npm 全局安装目录下 `openclaw/skills/`）

每个 Skill 通过解析 `SKILL.md` 的 YAML frontmatter 获取 name/description，并检查 `requires.bins` 依赖是否在 PATH 中。

**依赖自动安装**（场景部署时）：
1. `check_skill_deps()` 使用 shell-aware 检测（`user_shell() -l -c "command -v <bin>"`），扩展 PATH 包含 `~/go/bin`、`~/.cargo/bin`、`/opt/homebrew/bin`
2. 若缺少前置工具（如 `go` 未安装但 Skill 需要 `go install`），自动通过 `brew install go` 安装前置
3. 安装完成后，`ensure_path_in_rc()` 将工具目录（如 `$HOME/go/bin`）幂等写入 `~/.zshrc`，确保 OpenClaw 网关进程也能找到

### macOS 子进程图标抑制

macOS GUI 应用启动的子进程会继承父进程的 `__CFBundleIdentifier` 环境变量，导致每个 `node`/`bash` 进程都在 Dock 和菜单栏短暂出现图标。通过两层机制解决：

**1. NodeHelper.app（Node.js 专用）**：生产环境中 Node.js 不直接放在 resources 目录，而是包裹在 `resources/NodeHelper.app/Contents/MacOS/node` 中。该 Helper App 的 `Info.plist` 设置了 `LSUIElement=true` + `LSBackgroundOnly=true`，macOS 不会为其显示 Dock/菜单栏图标。`scripts/download-node.sh` 负责下载 Node.js 二进制并打包为该 Helper App。`cli.rs::bundled_node()` 在生产环境优先查找此路径。

**2. bg_command 工厂函数（bash 等其他子进程）**：`cli.rs` 提供两个工厂函数，在创建子进程前取消设置 `__CFBundleIdentifier` 等 env var：
- `bg_command(program)` — 用于 `tokio::process::Command`（异步）
- `bg_std_command(program)` — 用于 `std::process::Command`（同步）

**覆盖范围**：`cli.rs`、`gateway.rs`、`channel.rs`、`scenario.rs`、`env_check.rs`、`installer.rs`、`model.rs`、`backup.rs` 中所有子进程创建点均已替换。**新增子进程时必须使用这两个工厂函数，禁止直接使用 `Command::new()`。**

### CLI Symlink 管理

应用启动时自动在 `~/.local/bin/openclaw` 创建符号链接，指向 app bundle 内的 CLI wrapper 脚本（`resources/cli/openclaw`）。该 wrapper 脚本通过 resolve symlink 定位 bundled Node.js 和 `openclaw.mjs`，使用户在终端也能直接运行 `openclaw` 命令。

- **自动安装**：`lib.rs` setup 阶段异步调用 `install_cli_symlink()`
- **备份机制**：若 `~/.local/bin/openclaw` 已存在且非 ClawZ 创建，备份为 `openclaw.pre-clawz`
- **刷新**：若已是 ClawZ symlink（target 包含 `ClawZ.app`），删除重建（适应 app 路径变化）
- **PATH 注入**：自动将 `~/.local/bin` 追加到 `~/.zshrc`（幂等）
- **卸载恢复**：`uninstall_cli_symlink()` 删除 symlink，若存在 `.pre-clawz` 备份则自动恢复

### Hardened Runtime 与 Node.js JIT

Tauri 使用 ad-hoc 签名 + Hardened Runtime（`flags=0x10002(adhoc,runtime)`）。Node.js V8 JIT 在 Hardened Runtime 下需要 `com.apple.security.cs.allow-jit` 权限，否则启动时立即 `SIGTRAP` 崩溃。

`src-tauri/entitlements.plist` 声明了两项权限：
- `com.apple.security.cs.allow-jit` — Node.js V8 JIT 编译
- `com.apple.security.cs.disable-library-validation` — 加载未同证书签名的 `.node` 原生插件（如 koffi）

`tauri.conf.json` 的 `bundle.macOS.entitlements` 指向此文件。

### 网关启动流程

`start_gateway()` 执行完整的网关初始化链路：
1. `oc_config_set("gateway.mode", "local")` — 必须设置（openclaw v2026.3.8+ 要求，否则拒绝启动）
2. `evict_existing_gateway()` — 清理旧 launchd 服务 + kill 占用网关端口的残留进程
3. `openclaw gateway install` — 安装 launchd 服务（指向 bundled runtime）
4. `openclaw gateway start` — 启动网关

`restart_gateway()` 仅发送 restart 信号给已有服务。**首次启动必须用 `start_gateway()`**，不能用 `restart_gateway()`。

### 环境检测与自动修复

`env_check.rs` 负责环境检测（macOS、Node.js、npm、端口、磁盘、内存）和自动修复。

**`rc_prefix()` PATH 注入**：所有 `run_cmd()` / `run_fix_cmd()` 调用前会通过 `rc_prefix()` 注入常用工具路径（brew node@22、go、cargo、homebrew），确保即使 `.zshrc` 写入失败，后续检测仍能找到工具。

**Node.js 自动修复策略**（`auto_fix_env("Node.js")`）：
1. 优先 nvm（若已安装）
2. 其次 brew：`brew install node@22` → `chmod + brew link`（修复 Intel Mac 权限） → 若 link 失败，遍历 `.zshrc` / `.zprofile` / `.profile` 找第一个可写文件写入 PATH → 注入当前 session PATH → `node -v` 验证
3. 最后 tarball 安装 nvm + Node 22

### 路由表

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | Dashboard | 网关状态、快速概览 |
| `/workshop` | ScenarioWorkshop | 场景模板、Agent 人设编辑 |
| `/agents` | AgentManagement | Agent 列表、创建/删除、渠道绑定 |
| `/models` | ModelManagement | 供应商认证、模型选择、降级链 |
| `/channels` | ChannelManagement | 渠道列表、多账户管理、启用/禁用 |
| `/logs` | LogCenter | 网关 + 应用日志，支持过滤 |
| `/cost` | CostDashboard | Token 用量分析、按模型统计成本 |
| `/settings` | Settings | 高级设置、安全、货币、语言、主题、备份/恢复、关于/卸载（7 个 Tab） |
| `/onboarding/*` | 引导向导 | 首次使用：欢迎 → 模型配置 → 渠道接入 → 场景选择 → 完成（共 5 步，无安装步骤） |

### 设置页（Settings）

Settings 页面包含 7 个 Tab，左侧栏切换：

| Tab | 功能 |
|-----|------|
| Advanced | Agent 并发（`maxConcurrent`、`subagents.maxConcurrent`）、压缩模式（`compaction.mode`）、工具集等级、DM 策略、确认反应策略、Skill 来源管理、Gateway Dashboard 入口 |
| Security | 绑定地址、认证配置、安全审计结果展示 |
| Currency | 货币单位（CNY/USD）、汇率设置 |
| Language | 界面语言切换 |
| Appearance | 主题模式（亮色/暗色/跟随系统） |
| Backup | 配置导出/导入（ZIP 格式），导入前校验版本兼容性，导入成功后自动重启 Gateway |
| About | 版本信息、OpenClaw 版本、卸载功能 |

**Advanced Tab 增量保存**：保存时对比当前配置快照，仅写入实际发生变化的字段，避免无变更时产生多余 CLI 调用。

### 国际化（i18n）

- Hook：`useT()`（`src/lib/i18n/index.ts`），返回 `t(key, params?)` 翻译函数
- 支持两种语言：`zh-CN`（中文系统默认）、`en-US`
- 参数插值：`t("key", { name: "值" })` 替换模板中的 `{name}`
- 语言检测：基于 `navigator.language`，中文 locale 映射为 `zh-CN`，其余为 `en-US`
- 持久化在 Tauri Store（`clawz-state.json`）
- 添加新文案时，**必须同时更新** `zh-CN.ts` 和 `en-US.ts`

### 状态管理

四个 Zustand Store：
- **appStore** — 网关状态（带 localStorage 缓存以实现秒开）、Agent 列表、openclaw 配置快照、`modelsStatus`/`catalogModels`（模型管理页跨导航缓存，避免每次进入重新拉取）
- **settingsStore** — 主题模式（light/dark/system）、语言、货币、汇率。通过 `@tauri-apps/plugin-store` 持久化。提供 `resetSettings()` 方法供卸载时清除持久化数据
- **onboardingStore** — 引导向导的用户选择
- **agentStore** — Agent 相关 UI 状态

### 版本与构建

- 基础版本号定义在 `src-tauri/tauri.conf.json` 的 `version` 字段（如 `0.1.0`）
- `scripts/gen-build-info.sh` 在每次 dev/build 前自动生成 `src/lib/buildInfo.ts`（已 gitignore），包含：
  - `APP_VERSION` — 基础版本号
  - `BUILD_NUMBER` — git commit 总数（自动递增）
  - `BUILD_HASH` — git 短 SHA
  - `VERSION_DISPLAY` — 显示用版本（如 `v0.1.0 (build 72)`）
- **DMG 构建**：`bash scripts/build-dmg.sh`，输出 `ClawZ_{版本}+{build号}_{架构}.dmg`（含 Node.js 运行时 + openclaw）
- **OpenClaw 版本锁定**：`installer.rs` 中 `OPENCLAW_VERSION = "~2026.3.0"`（tilde 范围，仅允许同月份 patch 更新）。升级 OpenClaw 版本时需修改此常量
- Tauri 不支持 semver `+` build metadata 作为 version 字段，因此 `tauri.conf.json` 保持纯 `X.Y.Z` 格式，build number 仅体现在文件名和 UI 中
- **Bundled Resources**：DMG 包含三个资源目录：`openclaw/`（CLI + 依赖）、`NodeHelper.app/`（macOS Node.js wrapper）、`cli/`（终端 CLI wrapper 脚本）

### 样式规范

- **Tailwind CSS v4** — 工具类优先，无独立 CSS 文件
- 通过 CSS 变量实现主题切换（`data-theme` 属性）：
  - `--bg-main`、`--bg-surface` — 背景层级
  - `--text-primary`、`--text-secondary`、`--text-white` — 文字颜色
  - `--primary`、`--secondary` — 品牌色
  - `--success`、`--danger`、`--warning` — 状态色
  - `--border` — 边框颜色
- 字号：`text-[10px]`、`text-[11px]`、`text-xs`、`text-sm`、`text-base`（紧凑 UI）
- 统一圆角：卡片 `rounded-xl`，按钮 `rounded-lg`，间距用 `gap-`
- 图标来自 lucide-react，常用尺寸：10-18px

### UI 组件库

通用组件位于 `src/components/ui/`：
- `Button` — `variant="primary"|"secondary"`，`size="sm"|"md"`，`icon` 属性（LucideIcon）
- `Input` — 支持 label、placeholder、密码输入
- `Card` — 带标题的容器
- `Drawer` — 右侧滑入面板
- `TabBar` — 标签页导航
- `Tag` — 状态/标签徽章
- `StatusIndicator` — 在线/离线状态点
- `ProgressBar` — 进度条
- `StepIndicator` — 引导步骤指示器
- `EmojiPicker` — Emoji 选择器
- `ProviderLogo` — 模型供应商 Logo
- `ErrorBoundary` — 全局异常捕获，通过 `appLog()` 记录崩溃日志，展示恢复 UI

## 开发命令

```bash
# 安装依赖
pnpm install

# 开发模式（热重载）
pnpm tauri dev

# 仅类型检查
pnpm build                        # 前端：tsc && vite build
cd src-tauri && cargo check       # Rust 类型检查

# 构建 DMG（含 Node.js + openclaw）
bash scripts/bundle-openclaw.sh  # 先打包 openclaw 到 resources/（首次或更新版本时）
bash scripts/build-dmg.sh        # 输出：ClawZ_0.1.0+72_aarch64.dmg

# 运行测试
pnpm test                         # Vitest 单元测试
pnpm test:coverage                # 带覆盖率报告 + 阈值检查
pnpm test:watch                   # 监听模式
```

## 测试体系

### 测试结构

```
src/
├── test/
│   └── tauri-mock.ts              # 标准化 Tauri mock（所有 invoke 函数的默认 mock）
├── lib/__tests__/
│   ├── env.test.ts                # 环境工具函数
│   ├── bindings.test.ts           # 绑定解析/格式化（parseBindings、toBindSpec 等）
│   ├── channels.test.ts           # 渠道定义、显示名称
│   ├── i18n.test.ts               # 翻译查找 + 中英 key 一致性检查
│   ├── mergeModels.test.ts        # 模型列表合并（catalog + configured 去重）
│   ├── onboardingProgress.test.ts # 进度持久化纯函数
│   ├── onboardingScenarios.test.ts# 引导向导场景化测试
│   ├── providers.test.ts          # Provider 定义、显示名称
│   └── agentWorkflow.test.ts      # Agent 创建/绑定场景化测试
└── stores/__tests__/
    ├── appStore.test.ts
    ├── agentStore.test.ts
    ├── onboardingStore.test.ts
    └── settingsStore.test.ts
```

### Mock 策略

- **Tauri invoke mock**：通过 `src/test/tauri-mock.ts` 提供标准化 mock 模块，覆盖 `tauri.ts` 所有导出函数
- 使用方式：`vi.mock("../../lib/tauri", () => tauriMock)`，在 `afterEach` 中调用 `resetTauriMocks()`
- 每个 mock 函数返回合理默认值（空数组、`"ok"` 等），测试只需 override 关心的部分
- Store 测试在 `beforeEach` 中重置 state，无需 jsdom 环境

### 覆盖率目标（vitest.config.ts 中强制）

| 类别 | 目标 | 说明 |
|------|------|------|
| 纯工具函数（bindings、env） | 90%+ | 无外部依赖，应完全覆盖 |
| Store 逻辑（onboarding、agent） | 80%+ | 核心状态流转 |
| Tauri 依赖模块（settings、app） | 按实际设 | node 环境下 `isTauriEnv()` 分支不可达 |

### CI 门禁

`.github/workflows/check.yml` 在 PR/push 到 main 时自动执行：
- **前端 job**：`tsc --noEmit` + `pnpm test:coverage`（含覆盖率阈值检查）
- **Rust job**：`cargo check` + `cargo clippy -- -D warnings`
- 两个 job 并行，全部通过才能合并

### Skill 安装系统

每个 OpenClaw Skill 的 `SKILL.md` 中包含结构化安装元数据（`metadata.openclaw.install`），支持多种安装方式：

| kind | 命令模板 | 示例 |
|------|---------|------|
| `brew` | `brew install {formula}` | `brew install himalaya` |
| `go` | `go install {module}` | `go install github.com/.../blogwatcher@latest` |
| `npm` / `node` | `npm install -g {package}` | `npm install -g clawhub` |
| `uv` | `uv tool install {package}` | `uv tool install nano-pdf` |
| `download` | `curl -fsSL {url}` | 二进制下载 |
| `apt` | `apt install {package}` | Linux 专用 |

- Rust 端 `scenario.rs` 解析 SKILL.md 的 `install` 和 `homepage` 字段，按平台过滤不兼容的方式（macOS 过滤 apt，Linux 过滤 brew）
- 前端展示正确的安装命令（而非硬编码 `brew install`），安装失败时展示 homepage 链接引导手动安装
- `install_skill_deps` 命令支持接收完整命令字符串，通过白名单验证命令前缀

## Git 工作流与多 Agent 协作

### 工作区隔离（Worktree）

同一项目可能有多个 Codex Agent 并行工作。为避免文件编辑冲突、Git 暂存区混乱和构建资源竞争，**每个 Agent 必须在独立的 Git Worktree 中工作**。

**命名规范**：`<项目名>-ws-{name}`，创建在主仓库的同级目录下

- `{name}` 为简短标识，描述 Agent 的职责领域（如 `ui`、`backend`、`infra`）
- 示例：`ClawKit-ws-ui`、`ClawKit-ws-backend`

**Worktree 是持久的** — 一个 Agent 对应一个固定 worktree，跨多次任务复用，不随单次任务结束而删除。仅在 Agent 职责永久撤销时才清理。

**会话启动时**：检查当前工作目录，如果在主仓库则切到自己的 worktree（已有则直接进入，没有则创建）：
```bash
# 创建（首次）
git worktree add ../ClawKit-ws-{name} --detach main
# 进入（后续）
cd ../ClawKit-ws-{name}
```

### 分支工作流

在自己的 worktree 内，每次接受新任务时遵循以下流程：

1. **同步 main** — `git pull origin main`（或 `git merge main`）确保基于最新代码
2. **创建任务分支** — `git checkout -b feat/<简短描述>` 或 `git checkout -b fix/<简短描述>`，所有改动在该分支上完成
3. **分支命名强约束** — 新创建的 Git 分支前缀**只能**是 `feat/` 或 `fix/`。禁止使用 `ws/`、`codex/`、`chore/`、`docs/`、`refactor/` 或任何其他前缀；worktree 名称可以带 `-ws-`，但那只是目录名，不是 Git 分支名
4. **合并回 main** — 任务完成后切回 main 合并：`git checkout main && git merge --no-ff <任务分支名>`
5. **清理任务分支** — 合并确认后删除：`git branch -d <任务分支名>`

### 注意事项

- **禁止直接在主仓库目录下编辑文件**，除非确认当前只有一个 Agent 在工作
- 构建（`pnpm tauri build`）必须在 worktree 内执行，避免多 Agent 同时构建冲突
- AGENTS.md 是仓库的一部分，所有 worktree 共享同一份；Agent 记忆文件（`~/.Codex/` 下）独立于 worktree
- 若当前分支名称不符合上述约束，Agent 必须先切到新的 `feat/` 或 `fix/` 分支，再开始改动文件

## 关键编码约定

1. **CLI 执行一律使用 `bash -l -c`** — 加载用户的登录 shell 配置以确保 `openclaw` 在 PATH 中。禁止直接 `Command::new("openclaw")`。

2. **`shell_escape()` 防注入** — 所有拼入 CLI 命令的用户输入必须通过 `cli.rs::shell_escape()` 转义。

3. **UTF-8 安全截断** — 禁止使用 `&s[..n]` 直接截断含中文/多字节字符的字符串，会在字符边界处 panic。必须使用 `is_char_boundary()` 找到安全截断点。参见 `cli.rs::truncate()`。

4. **async task panic 捕获** — Tokio async task 中的 panic 会被静默吞掉（task 直接 drop，IPC 响应永不发送，前端 Promise 永不 resolve）。`lib.rs` 已注册全局 panic hook 记录到日志系统。编写 async 命令时，优先使用 `Result` 而非 `unwrap()`/`expect()`。

5. **内部配置键以 `__` 为前缀** — `__accountId`、`__targetAgent`、`__skipAutoBind`、`__accountName`、`__allowFrom` 等键仅用于前后端传参，不会写入 CLI 命令。Rust 后端在处理时跳过 `__` 前缀的键。

6. **网关重启合并** — 配置变更后调用 `scheduleGatewayRestart()`（前端），内部会 debounce 2 秒后执行一次重启，避免频繁重启。

7. **Tauri 错误处理** — `invoke()` 拒绝时返回的是**纯字符串**而非 `Error` 实例。务必使用 `extractErrorMessage(err)`（`lib/env.ts`）来提取错误信息。

8. **插件噪音过滤** — OpenClaw CLI 的 stdout 经常在 JSON 前混入 `[plugins]` 和 `Config ` 日志行。`cli.rs` 中的 `extract_json()` 负责清理这些噪音。

9. **配置读取模式** — 页面通过 `readOpenClawConfig()` 读取配置，缓存到 `appStore`，首次渲染使用缓存数据实现秒开。刷新时重新拉取最新数据。

10. **并行数据加载** — 从多个 Agent/数据源加载数据时使用 `Promise.all()`，禁止串行 `for...of` 循环。加载过程中展示 loading 状态。

11. **绑定关系加载** — 绑定数据通过 `parseBindingsFromConfig(config)` 从 `openclaw.json` 一次性解析（`config.bindings` 数组，`type: "route"`）。**禁止**逐 Agent 调用 `getAgentBindings()` CLI 命令（N+1 性能问题）。配置变更后通过 `refreshConfig()` 刷新 appStore 即可同步绑定状态。

12. **渠道字段到 CLI 标志的映射** — `channel.rs::field_to_cli_flag()` 将前端字段键（如 `botToken`）映射为 CLI 标志（如 `--token`）。无映射的字段回退到 `config set` 写入。

13. **操作日志** — 所有关键操作（安装、配置变更、场景部署、渠道绑定等）必须记录操作日志；所有可能出错的地方必须记录详细上下文日志（含输入参数、错误原因），便于后续排查。Rust 后端使用 `log::info!` / `log::warn!` / `log::error!`，前端使用 `appLog()` 桥接到 Tauri 日志系统。

14. **TDD 思维** — 新功能优先编写单元测试（Vitest），确保核心逻辑有测试覆盖。纯工具函数、状态管理、数据解析等模块必须有单测；涉及完整用户流程的功能考虑补充 E2E 测试。

15. **超时限制** — 所有可能超时的外部调用（CLI 执行、网络请求、进程等待）必须设置超时，默认 30 秒。Rust 后端使用 `tokio::time::timeout()`，前端使用 `AbortController` 或 `Promise.race()`。Skill 依赖安装例外，超时 5 分钟。

16. **多语言覆盖** — 所有面向用户展示的文本必须使用 `t()` 翻译函数，禁止硬编码中/英文字符串。新增文案时**必须同时更新** `zh-CN.ts` 和 `en-US.ts`。

17. **性能意识** — 对可能产生性能问题的功能点（大列表渲染、频繁状态更新、重复 CLI 调用等）必须考虑优化方案：虚拟列表、`useMemo`/`useCallback`、防抖/节流、缓存、分页加载等。

18. **多选择路径确认** — 遇到多种实现方案且各有利弊时，先列出选项和权衡，与用户确认后再动手实现。不要自行假设用户偏好。

19. **沟通语言** — 与用户的所有交流讨论必须使用**中文**。代码注释、commit message、变量命名等技术内容不受此限制。

20. **优先查阅 OpenClaw 官方资料** — 在做新功能设计或旧功能完善/重构时，优先搜索查阅 OpenClaw 官方文档和源码（`~/.openclaw/` 目录、npm 全局安装的 openclaw 包、CLI `--help` 输出等），以官方实际支持的能力为依据进行方案设计，避免凭假设实现不存在或不兼容的功能。

21. **构建前清理旧 DMG** — `pnpm tauri build` 前需卸载旧 DMG 挂载卷（`hdiutil detach`）并删除旧 DMG 文件，否则构建可能因卷名冲突失败。

22. **卸载时清除缓存** — 卸载流程必须同时清除 `localStorage`（`clawz_status_cache`）和 Tauri Store（`settingsStore.resetSettings()`），否则重新安装后会看到旧数据。

23. **全局异常捕获** — `ErrorBoundary` 包裹整个应用（在 `App.tsx` 最外层），使用 `appLog("error", ...)` 记录 React 渲染崩溃（含 componentStack 和 error stack），展示用户友好的恢复界面。ErrorBoundary 内的文本硬编码中文（因为 i18n 系统可能在崩溃时不可用）。

24. **子进程必须用 `bg_command` / `bg_std_command`** — 在 macOS 上，`Command::new()` 创建的子进程会继承 `__CFBundleIdentifier`，导致 Dock/菜单栏出现多余图标。所有子进程创建点必须改用 `cli.rs` 中的 `bg_command()`（tokio 异步）或 `bg_std_command()`（std 同步）。

25. **时间戳必须转换本地时区** — OpenClaw JSONL 日志中的时间戳为 ISO 8601 UTC 格式。按日期聚合统计（如"今日用量"）时，必须先转换为本地时区再提取日期，否则在 UTC+N 时区会导致跨日错位。Rust 端使用 `chrono::DateTime::parse_from_rfc3339()` + `with_timezone(&chrono::Local)`。

26. **Git 提交信息禁止 AI 署名** — commit message 中不得包含 `Co-Authored-By` 等 AI co-author 信息。

27. **日志语言规范** — 所有后端日志（`log::info!` / `log::warn!` / `log::error!`）和前端日志（`appLog()`）一律使用英文。需要在界面上展示给用户的信息必须通过 `t()` 翻译函数处理，遵循国际化规范。
