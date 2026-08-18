# dsh-updater

`@dsh-ext/dsh-updater` 是 DeepSeek Harness 的更新检查 bundle 插件：插件
**生效时（Cordis `apply` 运行）自动检查** `deepseek-harness` 远端仓库是否
有新提交，在 Web 的 **设置 → 通用设置 → DeepSeek Harness 更新** 行里提供
一个 **一键更新**按钮，点击后自动克隆/拉取新内容，并**提醒用户重启**。

> 理论上可行吗？可行。关键是边界：插件运行在 harness 进程内部，不能热替换
> 正在运行中的自己。所以本插件只把新内容写入本地 checkout（clone 或
> fetch + detached checkout），随后要求重启；下一次启动才真正加载新版本。
> 这与 `start.py` 现有的 “固定 commit、不自动更新” 策略互补，而不是冲突。

## 工作原理

```text
plugin apply (effect)
        │
        ├─ ctx.effect: 定时器（默认每 10 分钟检查，卸载时自动清理）
        ├─ 立即异步检查一次
        │     git ls-remote --symref <repo> HEAD   → 默认分支
        │     git ls-remote <repo> refs/heads/<b>  → 远端 commit
        │     git -C <target> rev-parse HEAD       → 本地 commit
        └─ 快照 → GET /dsh-updater/status

浏览器通用设置行（15 秒轮询状态）
        ├─ 显示 状态/远端短 commit；详情可展开查看
        ├─ 有新提交时启用 “一键更新”
        │     POST /dsh-updater/update
        │       ├─ 本地目录不存在 → git clone --depth=1 --branch <b>
        │       ├─ 本地目录已存在 → git fetch + checkout --detach FETCH_HEAD
        │       └─ 工作区有未提交改动 → 拒绝（可配置 force）
        └─ restartRequired = true → 显示 “请重启 DSH”
```

## 目录自动发现

`targetDir` 默认留空，插件按以下顺序定位本地 `deepseek-harness` checkout：

1. `$DSH_UPDATER_TARGET_DIR`（优先级最高）；
2. 插件配置里的 `targetDir`（相对路径按 `process.cwd()` 解析）；
3. `process.cwd()` 及其祖先目录中 origin 与 `repoUrl` 匹配的 git 仓库；
4. `<process.cwd()>/vendor/deepseek-harness`。

`codemaker2deepseek-harness` 的 `start.py` 以
`vendor/deepseek-harness` 为 cwd 启动 `pnpm dsh`，因此第 3 条直接命中，无需
配置。其他布局请显式配置 `targetDir`。

## 安装

前提：已有 DSH profile，且已安装 dsh-package-manager（或使用 harness 自带
`dsh plugin` 命令）。

```bash
# 方式一：dsh-package-manager（推荐，写入 profile cordis.patch.yml 托管块）
dpm install --profile web --source github:space-spacee-clamation/dsh-updater

# 方式二：dsh plugin
cd vendor/deepseek-harness
pnpm dsh plugin --profile web add github:space-spacee-clamation/dsh-updater
```

安装后打开 Web UI：**设置 → 通用设置 → DeepSeek Harness 更新**。安装本身
走 dsh-bundle 热挂载，无需重启；只有当它检测到 harness 更新并执行更新后，
才需要重启 DSH。

## 配置

配置位于 profile 的 `cordis.patch.yml` 托管块（由包管理器写入）或直接编辑
bundle patch：

```yaml
- insert:
    - id: dsh-updater
      name: '@dsh-ext/dsh-updater'
      config:
        repoUrl: https://github.com/deepseek-ai/deepseek-harness.git
        branch: ''                 # 空 = 跟随远端默认分支（symref 自动探测）
        targetDir: ''              # 空 = 自动发现本地 checkout
        checkOnLoad: true          # effect 时立即检查一次
        checkIntervalMs: 600000    # 周期检查间隔；0 = 关闭定时器
        force: false               # 工作区脏时是否强制覆盖
        apiPrefix: /dsh-updater   # 与浏览器半边约定一致，一般不要改
```

## Web API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/dsh-updater/status` | 读取检查快照 |
| `POST` | `/dsh-updater/check` | 立即检查（需请求头 `x-dsh-updater: 1`） |
| `POST` | `/dsh-updater/update` | 克隆/拉取新内容（需请求头 `x-dsh-updater: 1`） |

响应统一为 `{ "ok": true, "value": ... }`。

## 开发

```bash
pnpm install
pnpm run typecheck   # tsc -p tsconfig.json && tsc -p tsconfig.client.json
pnpm run test        # vitest run
pnpm run build       # tsdown（node + browser 双产物）
pnpm run check
```

| 路径 | 内容 |
| --- | --- |
| `lib/index.js` / `lib/index.d.ts` | Node 侧：`DshUpdaterService`、Config、git 工具导出 |
| `lib/web.js` / `lib/web.d.ts` | Web 路由：`/dsh-updater/*` |
| `lib/client.js` | 浏览器侧：通用设置里的 DeepSeek Harness 更新行 |
| `cordis.patch.yml` | bundle patch：注入 root + web 两个 loader 行 |

## Model Experience

### Request context and condition

#### What the model sees

None, as this plugin contributes no model-visible context; it performs
out-of-band git checks and presents a General-settings preference row only.

#### Token effect

Zero-direct token effect.

#### KV Cache effect

Independent: this plugin does not participate in model request construction or
system-prompt assembly, so it does not grow, replace, or invalidate KV cache
reuse.

## Known Limitations and Deferred Work

- **更新不等价于热重启** — 运行中的 harness 进程不会被替换；新内容写入磁盘
  后必须重启 DSH。插件只能提示，不会自动杀掉或拉起进程。
- **不执行依赖安装和构建** — 只做 `git clone` / `git fetch` + checkout。
  如果新版 harness 的锁文件变化，重启前可能需要手动执行
  `pnpm install` 和 `pnpm run build`。
- **Windows 文件占用** — 当前进程可能占用部分 checkout 文件，`git checkout`
  偶发失败会以错误状态展示在 UI 中；关闭 DSH 后重试即可。
- **工作区脏检查** — 默认拒绝覆盖本地**已跟踪**改动（未跟踪文件通常不影响
  checkout，冲突时 git 会报错并保持原样）；`force: true` 会丢弃已跟踪改动。
- **网络依赖** — 检查与更新都依赖 `git` 命令和 GitHub 可达性；离线时状态
  为 error，不会破坏本地 checkout。
