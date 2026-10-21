# 呆萌兔古诗 · 幼儿古诗开放知识库

一个面向儿童的**古诗词阅读应用**：标签即分类、内容开放可增删、朗读可听、云端共享。
Web 端直接可用，也可打包成 Android App（内置 WebView 加载线上站点）。

- 在线体验：<https://gushici.app.workbuddy.host/>
- 技术栈：Vue 3 + Vite 5 + Element Plus

---

## 功能特性

| 模块 | 说明 |
| --- | --- |
| 诗词浏览 | 瀑布式卡片列表，支持搜索、按标签筛选 |
| 标签分类 | 侧边栏由全量标签**动态聚合**生成（含计数），新增标签自动进入目录 |
| 拼音注音 | 基于 `pinyin-pro`，一键在诗句上显示拼音 |
| 简繁切换 | 基于 `opencc-js`，整站文字实时简繁体转换 |
| 朗读 | 优先播放**预录 mp3**（`public/audio/poems`），不可用时回退 Web Speech API |
| 收藏 | 本地/云端记录喜欢的诗词 |
| 学习 / 我的 | 学习模式与个人页 |
| 云同步 | 诗词数据存云端数据表 `public.poems`，手机/电脑/多人共享同一份数据 |
| 超管模式 | 口令校验后可新增 / 编辑 / 删除诗词、移除标签（普通用户仅浏览与加标签） |
| 开源库导入 | 支持从 GitHub 的 [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry) 批量导入 |
| 数据交换 | 支持 JSON 导入 / 导出，便于备份与迁移 |
| 移动端适配 | `viewport-fit=cover` + `env(safe-area-inset-*)`，兼容刘海屏与 WebView 安全区 |

## 技术栈

- **框架**：Vue 3（Composition API）+ Vite 5
- **UI**：Element Plus（`unplugin-vue-components` 按需引入，控制首屏体积）
- **云服务**：`@tencent-ai/workbuddy-cloud-sdk`（数据库 / 存储 / 登录）
- **拼音**：`pinyin-pro`　**简繁**：`opencc-js`
- **构建拆分**：`vue`、`pinyin-pro` 单独成 chunk，便于长期缓存

## 目录结构

```
gushici/
├── app.config.json           # 打包 App 的配置（应用名/包名/版本/远程地址/闪屏）
├── index.html
├── vite.config.js
├── public/                   # 静态资源（构建时原样拷入 dist）
│   ├── audio/poems/          # 预录朗读 mp3（1000 条）
│   ├── icons/                # 应用图标 icon-daimengtu.png (500×500)
│   ├── splash/               # 启动闪屏 splash-haoyu.png (1024×1536)
│   ├── js/api.js             # 运行时注入的接口配置
│   └── assets/
├── scripts/                  # 数据/音频/打包辅助脚本（Node + Python）
└── src/
    ├── App.vue               # 应用外壳与路由式视图切换
    ├── main.js
    ├── cloud.js              # 云服务客户端初始化（endpoint + publishableKey）
    ├── config.js             # 超管口令等客户端配置
    ├── githubImport.js       # chinese-poetry 导入
    ├── components/           # Sidebar / PoemCard / PoemDetailView / 编辑器 / 收藏 / 学习 / 登录 ...
    ├── composables/          # usePoems / useAuth / useAdmin / useSpeech / usePinyin / useUserStore / useBridge
    ├── utils/                # 简繁转换、诗词排版
    ├── data/seed.js          # 初始种子数据
    └── styles.css            # 全局样式与设计变量
```

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
```

## 构建与发布

```bash
npm run build      # 产物输出到 dist/
npm run preview    # 本地预览 dist
```

`build:base` 用于「云服务接入版」发布，它在 build 后额外执行：

```bash
npm run build:base
# = vite build
# + node scripts/inject-api.js dist      注入接口配置
# + node scripts/sync-to-base.js         同步到基座
# + node scripts/apply-app-meta.js       写入应用元信息
```

> **注意**：`vite build` 会清空 `dist/`。所有需要长期保留的静态资源（尤其朗读 mp3）**必须放在 `public/` 下**，由构建自动拷贝进 `dist/`，切勿手工放进 `dist/`。

## 数据与云服务

- 云端配置在 `src/cloud.js`：`endpoint` 指向托管站点，`publishableKey` 是**可公开**的前端键（不含密钥，可安全提交到仓库）。
- 诗词数据表为 `public.poems`，公开读写，多端共享。
- **诗词唯一性规则**：`标题 + 作者` 去重；标签可重复，标签本身即分类维度。
- 正文按行拆分为句数组存储。

## 朗读音频

- 目录：`public/audio/poems/*.mp3`，当前约 **1000 条**，文件名形如 `静夜思_李白.mp3`。
- 云端 `audio_url` 字段指向对应文件；缺失时组件自动回退到浏览器 TTS。
- 相关脚本：
  - `scripts/gen_audio.py` —— 生成音频
  - `scripts/sync-audio-url.mjs` —— 同步音频地址到云端

## 打包为 Android App

`app.config.json` 描述 WebView 壳工程的关键参数：

```json
{
  "appName": "古诗词 · 开放知识库",
  "apkName": "GuShiCi",
  "applicationId": "com.qux.gushici",
  "versionName": "1.0.3",
  "versionCode": 4,
  "splashBackgroundColor": "#f3f9ff",
  "statusBarStyle": "dark-content",
  "remoteUrl": "https://gushici.app.workbuddy.host/",
  "h5DevUrl": ""
}
```

- 启动闪屏：`public/splash/splash-haoyu.png`（儿童插画风，纯白背景）
- 桌面图标：`public/icons/icon-daimengtu.png`（500×500，「呆萌兔」抱胡萝卜）

## 权限说明

- **普通用户**：浏览、搜索、给诗词添加标签。
- **超管**：在口令校验通过后，可新增 / 编辑 / 删除诗词、移除标签。
- 口令位于 `src/config.js`，仅作**前端闸门**，不构成真实的服务端安全边界。如需严格权限，应改用云端登录 + 服务端角色校验。

## 数据来源与致谢

- 诗词内容可来自公开数据集 [chinese-poetry](https://github.com/chinese-poetry/chinese-poetry)，遵循其原始许可。
- 朗读音频由项目自行生成，仅供学习交流使用。
