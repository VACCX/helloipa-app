# HelloIPA — 可直接编译成 .ipa 的 iOS 工程模板

一个真能跑起来的 SwiftUI App（设备信息面板 + Base64/URL 编解码工具），
外加一套不依赖第三方库的打包管线：**xcodebuild → .app → Payload/*.ipa**。

```
DSH-Go/
├─ .github/workflows/build-ipa.yml   # 没 Mac 也能出 IPA：GitHub Actions 跑 macOS
└─ HelloIPA/
   ├─ HelloIPA.xcodeproj/            # 手写且已静态校验的工程文件
   │  ├─ project.pbxproj
   │  └─ xcshareddata/xcschemes/HelloIPA.xcscheme
   ├─ HelloIPA/
   │  ├─ HelloIPAApp.swift           # @main 入口
   │  ├─ ContentView.swift           # TabView：设备 / 工具
   │  ├─ DeviceInfo.swift            # 机型、系统、存储、bundle 信息
   │  ├─ ToolView.swift              # Base64 / URL 编解码
   │  ├─ Info.plist
   │  └─ Assets.xcassets/            # AppIcon(空) + AccentColor(空)
   ├─ scripts/
   │  ├─ build-ipa.sh                # macOS 一键：干净 archive + 打 ipa
   │  ├─ make-ipa.mjs                # 零依赖 ZIP 打包器（node>=18）
   │  └─ check-project.mjs           # 无 Xcode 环境的工程自检
   ├─ project.yml                    # 可选：xcodegen 重新生成工程
   └─ build/                         # 产物目录（已忽略）
```

## 1. 有 Mac：一条命令出 IPA

```bash
cd HelloIPA
chmod +x scripts/build-ipa.sh
BUNDLE_ID=com.yourname.helloipa ./scripts/build-ipa.sh
```

产物：

```
build/HelloIPA-unsigned.ipa
build/HelloIPA.xcarchive/Products/Applications/HelloIPA.app
```

要求：macOS + Xcode 15 以上（`#Preview` 宏需要 Xcode 15）、node >= 18。
脚本里已关掉签名（`CODE_SIGNING_ALLOWED=NO`），所以**不需要开发者账号**。

## 2. 没有 Mac：GitHub Actions 出 IPA

### 2.1 一条命令全自动（建仓 → 推送 → 触发构建 → 等完成 → 下载 ipa）

```bash
GITHUB_TOKEN=ghp_xxx node HelloIPA/scripts/publish-github.mjs
```

可选参数：

```bash
REPO_NAME=myapp        # 仓库名，默认 helloipa-app
PRIVATE=0              # 0 = 公开仓库，默认 1 私有
BRANCH=main            # 默认 main
INCLUDE_ALL=1          # 默认只推 .github/ 与 HelloIPA/，设为 1 推整个工作区
DRY_RUN=1              # 只跑本地预检，不碰网络写操作
```

token 怎么拿（30 秒）：

1. GitHub → 右上头像 → Settings
2. 左侧最底 → Developer settings
3. Personal access tokens → Tokens (classic) → Generate new token (classic)
4. 过期时间随便选，勾选 **repo** 和 **workflow** 两个大项 → Generate
5. 复制 `ghp_` 开头那串

脚本做的事：`GET /user` 验 token → 不存在就建仓 → 逐文件 `git/blobs` → `git/trees` →
`git/commits` → 更新 ref → `workflow_dispatch` → 每 15 秒轮询 run → 成功后取 artifact →
用自带的 `scripts/zip.mjs` 解出 `build/HelloIPA-unsigned.ipa`。

### 2.2 手动方式（不想给 token）

1. 把**本目录整体**（含 `.github/` 与 `HelloIPA/`）推到 GitHub 仓库根。
2. 仓库 Actions 页 → `build-ipa` → Run workflow（可填 `bundle_id`）。
3. 跑完在 run 页面底部下载 artifact `HelloIPA-unsigned-ipa`（zip 里是 .ipa）。

工作流做的事：`check-project.mjs` 自检 → `xcodebuild archive`（macos-14 免费 runner）
→ `make-ipa.mjs` 打包 → `unzip -l` 校验 `Payload/HelloIPA.app/Info.plist` 存在 → 上传 artifact。

## 3. 装到 iPhone（未签名 IPA 必须重签）

| 工具 | 平台 | 说明 |
|---|---|---|
| Sideloadly | Win/macOS | 拖入 .ipa，登录普通 Apple ID，自动签名并安装；免费账号 7 天有效 |
| AltStore / SideStore | Win/macOS + iOS | 同上，支持到期自动续签 |
| Xcode | macOS | `Window > Devices` 拖 .ipa，或直接 Run 到真机 |
| TrollStore | 仅特定 iOS | 免签直接装（依赖 CoreTrust 漏洞版本） |
| ldid + 自签证书 | Linux/macOS | 已越狱设备：`ldid -S app.entitlements Payload/Xxx.app/Xxx` 后重打包 |

## 4. 改成你自己的 App

三处最小改动：

1. `HelloIPA/HelloIPA/Info.plist` 里 `CFBundleDisplayName` 改成中文名。
2. 包名：构建时传 `BUNDLE_ID=com.yourco.yourapp`（工程里默认 `com.quqi.helloipa`）。
3. 功能：直接改 `ContentView.swift` / `ToolView.swift`。

**加新 Swift 文件**有两种正确做法，别手改 pbxproj 后再忘了登记：

- 用 Xcode 打开工程，`File > Add Files`（会自动登记）；
- 或者改完文件列表后跑 `xcodegen generate`（`project.yml` 已列好 sources 目录，自动收集）。

改完先自检再构建：

```bash
node scripts/check-project.mjs     # 12 项：括号平衡 / 对象 ID / 文件引用 / Sources / 关键设置 / scheme
```

## 5. 打包器单独用

`make-ipa.mjs` 不依赖 zip/命令行工具，可以拿任意 `.app` 打 ipa：

```bash
node scripts/make-ipa.mjs /path/to/Any.app /path/to/Any.ipa
# OK  /path/to/Any.ipa
#     entries=…  size=… bytes  (… MiB)
#     payload=Payload/Any.app
```

内部实现要点：ZIP 本地头 + 中央目录 + EOCD 手写；deflate 用 `zlib.deflateRawSync`，
压缩后不比原文件小就退回 store；权限位按条目类型写入（目录 0755 / 可执行 0755 / 普通 0644 / 符号链接 120777）；
文件名走 UTF-8 标志位（0x0800）。

## 6. 已执行 / 未执行的边界（诚实标注）

- 已执行（observed）：
  - `check-project.mjs` 12 项全过；
  - `make-ipa.mjs` 在合成 `.app` 上产出的 IPA 被 `unzip -l` 正确列出
    `Payload/HelloIPA.app/{HelloIPA,Info.plist,zh-Hans.lproj/InfoPlist.strings}`，可执行位 `-rwxr-xr-x` 保留；
  - `zip.mjs` 反向解析同一个 IPA，5 个条目、deflate/store 判定正确；
  - `publish-github.mjs` 预检 19 项通过（文件齐、工作流引用的 project/scheme/脚本全在、API 可达），
    唯一 FAIL 是 `GITHUB_TOKEN` 未设置。
- 未执行：`xcodebuild archive`、真机安装、以及带 token 的实推——当前机器是 iOS 上的 node 运行时，
  没有 macOS/Xcode，且仓库里没有任何 GitHub 凭据。上面第 1、2 节给的是可直接复跑的完整命令。
