# Open Tools（`mfy.pi-desktop-open-tools`）

在 PI-Desktop 的**输入框工具栏**放一个按钮：点开下拉菜单，用本机已安装的外部工具打开**当前项目文件夹**。
装了哪些工具就列哪些，没装的不出现、也不会有「点了没反应」的条目。

- 工具集合：VS Code、资源管理器、命令提示符 (cmd)、Windows PowerShell、PowerShell 7、Git Bash、Windows 终端 (wt)、WSL
- 目标路径：当前项目根目录（同时作为子进程的工作目录）
- 启动失败会弹通知（`notify` 权限），不会静默失败
- 没有打开项目时按钮置灰，悬停提示给出原因
- 双击/回车打开菜单，方向键移动，Esc 或点空白处关闭

版本 `0.4.2`，manifest 为 `schemaVersion: 1`，中英双语（zh-CN / en）。

> **id 变更**：0.4 之前插件的 id 是 `local.pi-open-tools`。宿主强制 id 必须含点
> （`^[a-z0-9]+(\.[a-z0-9_-]+)+$`），所以现在叫 `mfy.pi-desktop-open-tools`，显示名不变。
> 第一次读取时会自动把旧数据目录里的 `tools.json` 复制过来
> （`plugins\data\local.pi-open-tools` → `plugins\data\mfy.pi-desktop-open-tools`），配置不会丢；
> 插件页里那条旧 id 的开发/安装条目可以删掉。

## 安装

**方式 A：开发模式（改代码即时热重载）**

1. PI-Desktop → 插件页 → 选择文件夹（开发模式）→ 选中本目录
   `D:\CommonWorkspace\aiProjects\pi-plugin-open-tools`
2. 加载后输入框左侧出现一个小图标按钮（↗）。
3. 改 `main.js` / `renderer/index.mjs` 保存即热重载。
   注意：**加权限**这类改动不会热生效，需要重新在插件页加载一次。

**方式 B：安装发布包**

1. 先生成包：见下面「验证」里的 `scripts/pack.mjs`（产物 `dist/mfy.pi-desktop-open-tools-0.4.2.piplug`）
2. 插件页 → 安装本地插件 → 选这个 `.piplug`

两种方式都需要在**打开了项目**的会话里使用（插件把当前项目根目录作为目标）。

## 发布包里有什么

包装的是**运行时，不是仓库**：`manifest.json` 加上 manifest 指向的每一个文件
（`main` / `renderer` / `ui.panel` / `contributes.skills` / `contributes.agentExtensions` /
`contributes.themes[].path` / `contributes.views[].entry`）。当前只有三个文件：

```
manifest.json
main.js
renderer/index.mjs
```

`scripts/`、`README.md`、`.gitignore`、`.gitattributes`、`dist/` 一律不进包。原因是插件市场
审计会逐个读取包内文件，任何一处动态代码执行都会判定为阻断项：

```
SEC003 <包名>:<文件>:<行号>: dynamic or remote code execution: dynamic module loading
```

开发脚本为了加载被测模块用的 `import(path)` 正是这种形态，所以它们只留在仓库里。
`scripts/pack.mjs` 采集文件时只认 manifest 的引用（引用越界或文件缺失直接 `FAIL`），
`scripts/verify-package.mjs` 再反过来断言「包内条目集合 == manifest 引用集合」，并对包内
`.js/.mjs/.cjs` 做一次和审计同形的扫描（`import(...)`、`eval(...)`、`new Function(...)`、
`importScripts(...)`、非字面量的 `require(...)`）。运行时三个文件里只有字面量 `require("node:…")`。

## 日常使用

1. 打开一个项目。
2. 点输入框左侧的 ↗ 按钮。
3. 菜单顶部显示将要打开的项目路径，下面是本机真实存在的工具，选中即用该工具打开这个目录。

## 验证（本机没有系统 Node/npm 时的运行方式）

本机可用的运行时有两个，都不需要额外安装：

- `ELECTRON_RUN_AS_NODE=1` + PI-Desktop 自带运行时（Node v24.20.0）
- `bun`（`~/.bun/bin/bun.exe`）

PowerShell 示例（把 `$exe` 指向自己的 PI-Desktop）：

```powershell
$plug = 'D:\CommonWorkspace\aiProjects\pi-plugin-open-tools'
$exe  = "$env:LOCALAPPDATA\Programs\PI-Desktop\PI-Desktop.exe"
$env:ELECTRON_RUN_AS_NODE = '1'

# 1) 语法检查（两个入口各跑一次，退出码 0）
& $exe --check "$plug\main.js"
& $exe --check "$plug\renderer\index.mjs"

# 2) 离线自测（桩宿主 + 桩 react，不开窗口、不联网）
& $exe "$plug\scripts\selftest.mjs"

# 3) manifest 规则校验（同宿主安装器规则 + 本插件的承诺）
& $exe "$plug\scripts\verify-manifest.mjs"

# 4) 打包 + 校验发布包（store-only zip）
& $exe "$plug\scripts\pack.mjs"
& $exe "$plug\scripts\verify-package.mjs"

# 5) 真实启动冒烟（会真的打开窗口！打印 id/可执行文件/argv/pid）
& $exe "$plug\scripts\smoke.mjs" $plug
```

`bun` 也能跑这些脚本（`bun run scripts/selftest.mjs`），但语法检查用上面的 `--check` 更直接。

**在真实宿主里核对（需要你点一次）**

1. 插件页以开发模式加载本目录（方式 A）。
2. 看日志里有没有加载记录，且没有 `load_error`：

```powershell
Select-String -Path "$env:USERPROFILE\.pi-desktop\logs\app\plugin.log" -Pattern 'mfy.pi-desktop-open-tools'
```

3. 点一次工具栏按钮、选一个工具，然后看插件自己的启动记录（工具 id + 解析出的项目根路径）：

```powershell
Select-String -Path "$env:USERPROFILE\.pi-desktop\logs\app\plugin.log" -Pattern '\[open-tools\] launch'
```

 顺手核对两件事：菜单里到底列了哪些工具（`vscode` 应当出现），以及有没有被跳过的工具：

 ```powershell
 Select-String -Path "$env:USERPROFILE\.pi-desktop\logs\app\plugin.log" -Pattern '\[open-tools\] list|skipped tool'
```

## 配置外部工具（图形界面，不用改代码）

点工具栏按钮 → 菜单底部 **「配置外部工具…」**，会在应用内浮起一块面板，列表上的每件事都在这里：

| 想做什么 | 怎么做 |
| --- | --- |
| 启用 / 停用 | 每行右侧的开关。停用的工具留在列表里（灰点、名称变淡），但不出现在菜单里 |
| 改名 | 直接点名称就地编辑 |
| 改程序 | 点行尾 `▾` 展开设置，第一栏填 `.exe` 绝对路径覆盖自动探测到的那个（留空 = 继续自动探测） |
| 改参数 | 同一处第二栏，一行一个参数；`{dir}` 代表项目文件夹，必须单独占一行 |
| 控制台窗口 | 自定义工具展开后勾选「需要控制台窗口」，由 Windows 终端替它开窗口 |
| 排序 | 行首 `▲` / `▼`，列表顺序就是菜单顺序 |
| 删除 | 行尾 `✕`；之后可以在「＋ 添加工具」里加回来 |
| 新增 | 右上角 **「＋ 添加工具」**：下拉里是当前不在列表中的内置工具，选 `自定义工具…` 则填名称 + `.exe` + 参数 |
| 恢复默认 | 左下角「恢复默认」，回到内置八项与默认顺序 |

行首的圆点是状态：绿色 = 可用、橙色 = 本机没装（或缺它需要的 Windows 终端）、灰色 = 已停用。
面板里的数据只在点「保存」时才落盘，「取消」/`Esc` / 点空白处都是丢弃；**保存成功后弹框自动关闭**，
保存被拒时留在原地，把主进程给的原因显示在底部。

面板只建一次、之后都是局部更新（开关与展开就地改自己那一行），所以点开关、点按钮不会整块重绘闪一下。

**这是唯一的编辑入口。** 插件不声明任何设置项，所以插件管理里没有第二份 JSON 编辑器——
写入只有一个入口：面板把整份列表交给主进程校验（`saveToolConfig`），任何一条不合格就不写盘。
列表改动对**已经开着的聊天窗口**同样立即生效：工具栏按钮每次点开菜单都会重新读一遍列表，
而不是用窗口打开时读到的那一份。不用重载插件，也不用重开聊天。

### 落盘格式（一般不用手改）

整份菜单就是插件数据目录里的一个文件：
`%USERPROFILE%\.pi-desktop\plugins\data\mfy.pi-desktop-open-tools\tools.json`

```json
{
  "version": 1,
  "tools": [
    { "id": "explorer" },
    { "id": "vscode", "label": "我的 VS Code" },
    { "id": "cmd", "enabled": false },
    { "id": "notepad", "label": "记事本", "executable": "C:\\Windows\\System32\\notepad.exe", "args": ["{dir}"] }
  ]
}
```

`"tools": null` 表示「内置默认」。条目只写与默认不同的字段，所以没动过的工具就只是一行 `{ "id": "vscode" }`。

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `id` | 是 | 匹配 `^[a-z][a-z0-9_-]{0,31}$`，不能重复。等于某个内置 id 就是「改那一项」，否则是自定义工具 |
| `label` | 否 | 菜单里的显示名；留空用内置默认名（自定义工具用 id） |
| `enabled` | 否 | `false` = 留在列表里但不在菜单中出现 |
| `executable` | 自定义工具必填 | **绝对路径**、`.exe` 后缀、必须真实存在 |
| `args` | 自定义工具必填 | 字符串数组，必须**正好有一个**元素就是 `"{dir}"` |
| `consoleHost` | 否 | 只支持 `"wt"`：控制台程序要 Windows 终端替它开窗口 |

`{dir}` 始终**独占一个 argv 元素**；写成 `"--cwd={dir}"` 会被拒绝，因为那就是把路径拼进字符串。
文件写坏（不是合法 JSON、不是对象）时只记一条 `[open-tools] tools.json …` 日志并退回内置默认，
不会崩；写盘是「先写临时文件再改名」，中途失败不会留下半个列表。

自定义工具与内置工具走**同一条**启动路径（`shell: false`、目录同时作为 `cwd`、`detached`），
也同样只需要那两个权限。最多 32 条。

> 0.2 的 `customTools` 与 0.3 的 `tools` 设置会在第一次读取时被搬进这个文件（只搬一次），
> 之后插件再也不看宿主设置。

## 扩展工具表
所有工具都在 `main.js` 顶部的 `TOOLS` 数组里，加一项即可（探测不到就不会显示）。
只是想多一个工具、不想改代码的话，用面板里的「＋ 添加工具」就够了（见上文「配置外部工具」）；下表是给内置项用的：

```js
{
  id: "myeditor",
  label: { en: "My Editor", "zh-CN": "我的编辑器" },
  executableNames: ["MyEditor.exe"],                       // PATH 上找这些文件名
  candidates: (env) => [                                    // 固定安装位置，先查这些
    path.join(env.LOCALAPPDATA || "", "Programs", "MyEditor", "MyEditor.exe")
  ],
  argv: (root) => [root]                                    // 目标目录作为最后一个参数
}
```

约定与边界：

- `argv(root)` 必须把项目目录放在**恰好一个**元素里，并且（除下面 Git Bash 这种特例外）是**最后**一个元素。
- 启动永远是 `spawn(可执行文件, argv, { shell: false, cwd: root, detached: true, stdio: "ignore", env: 补全后的环境 })`：
  不经 shell、不拼命令行、不把路径塞进字符串命令里。
- 需要控制台窗口的 shell（cmd / Windows PowerShell / PowerShell 7）要声明 `consoleHost: "wt"`：
  见下面「为什么 shell 要经过 Windows 终端」。GUI 程序（VS Code、资源管理器）与自带启动器的
  工具（`git-bash.exe`、`wt.exe`、`wsl.exe`）不需要它。
- 探测只看固定安装位置与 PATH 上已有的目录，不递归遍历、不写缓存（内存里缓存 1 分钟）。
- 只接受 `.exe`（真实可执行文件或 Windows 应用执行别名）。`code.cmd` 这类脚本**不**收：启动它们就得过 shell。
- 新工具**不需要**新权限：插件只申请 `renderer.extension`（一个工具栏按钮）和 `notify`（失败通知）。

## 为什么 shell 要经过 Windows 终端

插件跑在 PI-Desktop 自己的无控制台进程里。实测（无控制台父进程，四种 spawn 形状）：
`cmd.exe` / `powershell.exe` / `pwsh.exe` 被 spawn 出来后都会**立刻退出**——它们不会自己分配控制台，
而 Node 的 `spawn` 一定会重定向 stdio，交互式 shell 读到 EOF 就结束了。表现就是「点了没反应」。

因此这三项声明 `consoleHost: "wt"`：由 **Windows 终端**（GUI 程序，自己创建窗口）开窗口，
再把 shell 作为它的命令行参数运行，例如
`wt.exe  C:\Windows\System32\cmd.exe /k cd /d <项目目录>`。
项目目录仍然是**最后一个** argv 元素、只出现一次，`shell: false` 不变。
装不到 Windows 终端时这三项**不出现在菜单里**（`detectTools` 会跳过，直接调用则返回
`CONSOLE_HOST_MISSING`），绝不会留下点了没反应的条目。

## 环境变量：为什么启动前必须补全

宿主启动插件进程时把环境变量裁得很干净，只留 `PATH`、`SystemRoot`、`windir`、`TEMP`、`TMP`、`TMPDIR`、
`LANG`、`HOME`、`USER`、`USERPROFILE`（外加 `PI_PLUGIN_ID`、`NODE_ENV`）。用**真实的裁剪环境**跑一遍
`main.js`，对照结果如下：

| | 直接用继承的 env（修复前） | 补全后 |
| --- | --- | --- |
| `LOCALAPPDATA` / `APPDATA` / `USERNAME` | 不存在 | `C:\Users\<you>\AppData\Local` 等 |
| VS Code 的候选路径 | `Programs\Microsoft VS Code\Code.exe`（**相对路径**，探测必然失败 ⇒ 菜单里根本没有 VS Code） | `C:\Users\<you>\AppData\Local\Programs\Microsoft VS Code\Code.exe` |
| 子进程里 `cmd /c set` 看到 | `USERPROFILE`、`COMSPEC`、`PATHEXT`、`ELECTRON_RUN_AS_NODE=1` | `LOCALAPPDATA`、`APPDATA`、`USERNAME`、`HOMEDRIVE`、`HOMEPATH`、`COMPUTERNAME`、`ComSpec`… |
| Windows 终端 | 解析不到 `%LOCALAPPDATA%\Packages\…\LocalState\settings.json` ⇒ 报「无法从文件加载设置…暂时使用默认设置」 | 正常读自己的设置 |
| `Code.exe --version` | 打印 `v24.21.0`（**被当成 Node 跑了**） | 启动真正的 VS Code |

所以是三件事一起修的：

1. **探测本身也用补全后的环境**（`makeContext` → `defaultEnvironment`）。VS Code 的安装位置是从
   `%LOCALAPPDATA%` 推出来的，不补全就永远探测不到——这才是「菜单里没有 VS Code」的真正原因。
2. **子进程继承补全后的环境**（`buildLaunch().options.env`），Windows 终端因此能找到自己的设置。
3. **剥掉宿主自己的标记**：`ELECTRON_RUN_AS_NODE`（不剥就等于让 VS Code / Cursor / Postman 这类
   Electron 程序「以 Node 模式启动」，进程立刻退出、窗口不出现，表现正是「点了没反应」）、
   `ELECTRON_NO_ATTACH_CONSOLE`、`PI_PLUGIN_ID`、`NODE_ENV`。

补全只做「推导 + 核实」：`USERPROFILE` → `LOCALAPPDATA`/`APPDATA`/`TEMP`，`SystemRoot` → `System32` 等标准目录，
再加 `USERNAME`/`COMPUTERNAME`/`NUMBER_OF_PROCESSORS`/`PROCESSOR_ARCHITECTURE`/`ComSpec`/`PATHEXT`；
**每个目录都先 `statSync` 确认存在，不存在就不写**。不读注册表、不联网、不编造值。
`PATH` 只保留继承来的段、补上真实存在的标准目录，不重排也不替换。

自测里把这件事钉死了：用只有那 10 个键的环境 + 一份假的磁盘（`%USERPROFILE%\AppData\Local\Programs\Microsoft VS Code\Code.exe`）
断言 VS Code 仍被探测到；断言补全后的 env 里有 `LOCALAPPDATA`/`APPDATA`/`USERNAME`/`ComSpec`/`PATHEXT`；
断言 `ELECTRON_RUN_AS_NODE` 不会传给子进程。

## 设计说明与已知边界

- **manifest 的 `author` 必须是字符串**：`PluginCheck`（JS 规则）允许 `{ "name": … }`，但宿主安装器用更严格的结构校验，
  写对象会在导入时报 `PLUGIN_INVALID: invalid type: map, expected a string`。本仓库的
  `scripts/verify-manifest.mjs` 已按安装器口径把 `id/name/version/description/author/main/renderer` 统一断言为字符串。
- **渲染器只递 id**：工具栏按钮通过 `plugin.call` 问主进程「能开什么 / 打开某个 id」，
  永远递不出可执行文件路径或目录，所以没有命令注入面。
  `manifest.rendererActions` 只有 `plugin.call`；`rendererCallMethods` 是 `projectRoot` / `listTools` / `openTool`，
  与 `main.js` 的 `HANDLERS` 一一对应（`scripts/selftest.mjs` 与 `scripts/verify-manifest.mjs` 都会断言这一点）。
- **Git Bash 的参数形状**：`git-bash.exe` 不接受「裸目录」参数（这样传它会试图把目录当程序执行、窗口根本不出现），
  只认 `--cd=<目录>`。所以这一项的目录是最后一个 argv 元素的**尾部**（`--cd=D:\path`），同时目录也作为工作目录传入。
  实测证据：用 `--cd=<dir>` 启动后 bash 的 `pwd` 就是目标目录；用裸目录参数则什么都没有启动。
- **Windows 终端的探测**：`wt.exe` 是 Windows 应用执行别名，`statSync` 会返回 `EACCES`，
  因此探测会退回 `lstatSync`，把「存在且不是目录」的条目当作可启动项（别名由系统在 `CreateProcess` 时解析）。
- 菜单绘制在 `pi.ui.openLayer()` 提供的图层里（`composerControl` 槽自身是 `overflow: clip`，下拉放不下）。
- 失败反馈：立刻失败（如项目目录被删）走 toast 与返回值；异步失败（spawn 后的 `error` 事件）走 `notify` 通知并写日志。
- 工具**不会**随插件卸载而关闭：子进程 `detached` + `unref()`，其生命周期归用户。
- 不做：多文件夹切换 UI、对选中文件打开、侧栏项目 `...` 菜单里的入口。最后一项是宿主限制，不是取舍：
  `contributes` 里没有 `menus` 这类贡献点，渲染器可用 slot 也只有 `composerControl` 等固定几个，
  那个菜单是宿主渲染器里硬编码的数组，插件既加不进去、也拿不到「这一行对应哪个项目」。
- **只有一块配置面板**：插件不声明 `contributes.settings`，所以插件管理里没有「设置」按钮，
  也就没有第二份 JSON 编辑器。宿主会把每个声明的设置项画成它自己弹窗里的一行（`json` 就是一整块文本框），
  与面板并存只会让同一份列表有两个编辑入口；列表因此改存插件数据目录，写入只经过面板这一条路。
  代价是 `PluginCheck` 会多一条 `contributes.empty` 警告（「manifest 没有任何贡献，插件没有可见效果」）：
  这个插件的界面来自顶层 `renderer` + `renderer.extension`，不是 `contributes`，所以那条警告在这里是预期的。

## 权限

| 权限 | 用途 | 风险 |
| --- | --- | --- |
| `renderer.extension` | 在输入框工具栏画一个按钮和下拉菜单 | 高（宿主标注） |
| `notify` | 启动失败时的通知 | 低 |

不申请、也不使用：`fs.read` / `fs.write` / `fs.delete`、`net.*`、`agent.*`、`mcp.*`、`clipboard.*`、`shell.openExternal`。
不读写任何项目文件、不联网、不落盘缓存；唯一写盘的是它自己的工具列表
`%USERPROFILE%\.pi-desktop\plugins\data\mfy.pi-desktop-open-tools\tools.json`（先写临时文件再改名）。

## 文件

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | 插件清单（id / 权限 / 渲染器 / 渲染器白名单 / 中英双语；不声明任何设置项） |
| `main.js` | 插件主进程：环境补全、工具探测、可配置工具表（校验/合并/解析）、`tools.json` 读写、`plugin.call` 处理器、`spawn` 启动 |
| `renderer/index.mjs` | 渲染器模块：`composerControl` 按钮 + 下拉菜单 + 配置面板（纯 DOM，无 JSX、无构建） |
| `scripts/selftest.mjs` | 离线自测（桩宿主、桩 react，277 条断言） |
| `scripts/verify-manifest.mjs` | manifest 规则校验（同宿主安装器规则，79 条断言） |
| `scripts/pack.mjs` | 生成 store-only `.piplug`（只采集 manifest 引用的运行时文件） |
| `scripts/verify-package.mjs` | 发布包校验：结构/CRC/路径/体积 + 包内条目集合 == manifest 引用集合 + 动态代码扫描（同 SEC003 口径） |
| `scripts/smoke.mjs` | 对每个探测到的工具做一次真实启动 |
| `dist/*.piplug` | 发布产物（不进包、不进版本库） |
