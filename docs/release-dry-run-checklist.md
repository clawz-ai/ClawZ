# ClawZ 发布流程 Dry Run 检查清单

## 目的

这份清单用于按真实发布流程演练当前的三层发布模型：

1. `RC Release`
2. `Publish Emergency RC`
3. `Promote Stable Release`

目标不是“随便跑通一个 workflow”，而是验证下面几件事是否真的成立：

- 构建版本号由 CI 注入，而不是来自 Git 历史长度
- RC 标签只生成 candidate release
- 同一基础版本只允许最新 RC 继续进入 emergency / stable 流程
- emergency 发布只会公开 RC，不会污染 stable
- stable 晋升前必须拿到 notarized macOS 资产
- 主下载入口只指向 stable，不再默认要求用户手工执行 `xattr`

## 演练范围

建议完整跑以下 4 段：

1. RC 构建演练
2. Emergency 发布演练
3. Stable 晋升演练
4. 发布后回收与验证演练

## 演练前准备

### 1. 选择演练版本

使用一个明确的演练版本，不要复用线上已存在的正式版本。

建议：

- `appVersion`: 一个尚未发布的版本号
- RC tag: `vX.Y.Z-rc.1`
- Stable tag: `vX.Y.Z`

例如：

```text
appVersion = 0.1.4
rc tag     = v0.1.4-rc.1
stable tag = v0.1.4
```

### 2. 确认版本源一致

检查以下文件已经同步：

- `build-manifest.json`
- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `.nvmrc`

本地执行：

```bash
node scripts/build-manifest.mjs check
```

通过标准：

- 输出 `build-manifest is in sync`

### 3. 确认 GitHub Secrets 完整

至少确认以下 secrets 已配置：

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

如果这些 secrets 不完整：

- RC 构建可以演练一部分
- 但无法完整验证 notarization -> stable promotion 链路

### 4. 确认本地基础检查通过

本地先执行：

```bash
pnpm install --frozen-lockfile
pnpm build
cd src-tauri && cargo check --locked
```

通过标准：

- 前端构建成功
- Rust `cargo check --locked` 成功

## Phase A: RC Release Dry Run

### 目标

验证 `v*-rc.*` 标签只会创建 candidate release，并且会上传 notarization 元数据。

### 操作步骤

1. 创建演练 RC tag

```bash
git tag vX.Y.Z-rc.1
git push origin vX.Y.Z-rc.1
```

2. 打开 GitHub Actions

确认 `RC Release` workflow 被触发。

3. 等待所有 matrix job 完成

需要关注：

- macOS aarch64
- macOS x86_64
- Linux x86_64
- Linux arm64
- 如果同一版本已有更早的 RC，确认它们会被标记为 `Superseded by vX.Y.Z-rc.N`

### 必查项

- workflow 是否读取 `.nvmrc`
- `pnpm install --frozen-lockfile` 是否成功
- `node scripts/build-manifest.mjs check` 是否成功
- build info 中的 `BUILD_NUMBER` 是否来自 `github.run_number`
- RC release 是否保持 `draft`
- release title 是否是 candidate 语义
- 是否上传了 `notarization-*.json`

### 通过标准

- GitHub Releases 中生成 `vX.Y.Z-rc.1`
- 该 release 仍是 `draft`
- macOS 资产存在
- `notarization-aarch64-apple-darwin.json` 和 `notarization-x86_64-apple-darwin.json` 已上传
- notarization 元数据中的 `status` 为以下之一：
  - `notarized`
  - `pending`
  - `submit_failed`
  - `missing_dmg`
- 如果存在旧 RC，新 RC 成功后旧 RC 会被标记为 `Superseded by ...`

### 失败判定

出现以下任一情况视为 RC dry run 失败：

- RC tag 没有触发 workflow
- release 被直接公开，而不是 draft
- build number 仍然显示为 Git 历史计数
- macOS job 没有生成 notarization 元数据

## Phase B: Emergency RC Dry Run

### 目标

验证应急发布只会公开 RC prerelease，不会影响 stable 主入口。

### 前置条件

RC release 已存在，且仍处于 draft。

### 操作步骤

1. 手动触发 GitHub Actions 工作流：

- Workflow: `Publish Emergency RC`
- 输入：
  - `rc_tag = vX.Y.Z-rc.1`
  - `allow_superseded_rc = false`

2. 等待 workflow 完成

3. 打开 GitHub Releases 页面检查结果

### 必查项

- RC release 是否从 draft 变为 prerelease
- title 是否包含 `Emergency Release Candidate`
- 说明文案中是否明确写了：
  - 这是应急版
  - 只推荐给受影响用户
  - stable 会在 notarization 完成后补发
- `xattr` 指引是否只出现在 emergency release notes 中
- README 主下载入口是否未被修改成指向 prerelease
- 如果存在 `vX.Y.Z-rc.2`，`vX.Y.Z-rc.1` 是否会被默认拒绝发布

### 通过标准

- `vX.Y.Z-rc.1` 被公开为 `prerelease`
- 没有生成或覆盖 stable release
- main README 仍然只描述 stable/notarized 下载路径
- superseded RC 默认不能被发布，除非显式设置 `allow_superseded_rc = true`

### 失败判定

以下情况任一出现即失败：

- prerelease 被错误标成 latest / stable
- emergency workflow 生成了新的 stable tag
- release 文案没有明确说明 signed-only / 临时性质

## Phase C: Stable Promotion Dry Run

### 目标

验证 stable 只能从已 notarized 的 RC 资产晋升，不能绕过约束。

### 前置条件

以下条件至少要满足：

- RC release 已存在
- macOS notarization 元数据已上传
- 两个 macOS 目标的状态都是 `notarized`
- `signedOnly` 都为 `false`

### 操作步骤

1. 手动触发 GitHub Actions 工作流：

- Workflow: `Promote Stable Release`
- 输入：
  - `rc_tag = vX.Y.Z-rc.1`
  - `stable_tag = vX.Y.Z`
  - `allow_superseded_rc = false`

2. 等待 workflow 完成

3. 打开 GitHub Releases 页面检查 stable 结果

### 必查项

- stable tag 是否必须与 `build-manifest.json` 的 `appVersion` 一致
- workflow 是否先校验 `notarization-*.json`
- 如果 metadata 中还有 `pending` 或 `signedOnly=true`，workflow 是否会直接失败
- stable release 是否从 RC 资产复制生成
- stable release title 是否是正式版语义
- RC release 是否被标记为 `Superseded`
- 如果存在更新的 RC，旧 RC 是否会被默认拒绝晋升 stable

### 通过标准

- 成功创建 `vX.Y.Z`
- stable release 不再是 prerelease
- stable release 的 macOS 资产来自 notarized RC
- RC release 标题变成 `Superseded`
- 非最新 RC 默认不能晋升 stable，除非显式设置 `allow_superseded_rc = true`

### 反向验证

建议额外做一次故障演练：

1. 在某个 `notarization-*.json` 中模拟 `status = pending`
2. 再触发 `Promote Stable Release`

期望结果：

- stable promotion 被拒绝
- workflow 输出明确错误
- 不会生成新的 stable release

建议再补一组 superseded 演练：

1. 创建 `vX.Y.Z-rc.2`
2. 再尝试把 `vX.Y.Z-rc.1` 用于 emergency 或 stable

期望结果：

- `vX.Y.Z-rc.1` 被识别为 superseded
- workflow 默认拒绝继续发布旧 RC
- 只有在你明确设置 `allow_superseded_rc = true` 时，才允许手工回退到旧 RC

## Phase D: 发布后回收与用户入口检查

### 目标

验证 stable 已成为唯一默认入口，应急版本只保留辅助作用。

### 必查项

- GitHub `Latest` 是否落在 stable release
- README 是否仍然没有默认展示 `xattr`
- prerelease 仍然保留，但标题或说明里标记为已被 stable 替代
- stable release notes 是否不再要求用户默认绕过 Gatekeeper

### 通过标准

- stable 是唯一默认入口
- prerelease 仍可追溯，但不会误导普通用户下载

## 建议记录项

每次 dry run 建议记录以下内容：

- 演练日期
- 演练 commit SHA
- RC tag
- Stable tag
- GitHub run number
- notarization 提交 ID
- 是否发生超时
- 是否走了 emergency 分支
- 最终是否成功晋升 stable
- 遇到的问题与修复建议

## 建议产出

演练结束后至少保留一份简短结论：

```text
Dry run result: PASS / FAIL
RC workflow: PASS / FAIL
Emergency workflow: PASS / FAIL
Stable promotion: PASS / FAIL
Latest points to stable: YES / NO
Open issues:
- ...
```

## 快速结论模板

如果这次只是做一次最小闭环验证，最终至少回答下面 6 个问题：

1. RC tag 会不会只生成 draft candidate？
2. build number 是不是来自 CI 注入？
3. emergency workflow 会不会只公开 prerelease？
4. stable promotion 会不会拒绝未 notarized 的 macOS 资产？
5. `rc.2` 出现后，`rc.1` 会不会默认失去晋升资格？
6. stable 发布后，默认下载入口是不是只指向 stable？
7. `xattr` 是否已经从主 README 中移除，只保留在应急发布说明里？

只要这 7 个问题都能明确回答“是”，这次 dry run 才算真正通过。
