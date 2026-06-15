<h1 align="center">DeepSeek V4 for Copilot Chat</h1>

<p align="center">
  <!-- marketplace-readme:remove-start -->
  <a href="https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot"><img src="https://img.shields.io/badge/VS%20Code%20Marketplace-Install-007ACC?logo=visualstudiocode&logoColor=white&style=for-the-badge" alt="从 VS Code Marketplace 安装"></a>
  <a href="https://open-vsx.org/extension/Vizards/deepseek-v4-for-copilot"><img src="https://img.shields.io/badge/Open%20VSX-Install-6A4FB6?style=for-the-badge" alt="从 Open VSX 安装"></a>
  <br/>
  <!-- marketplace-readme:remove-end -->
  <img src="https://img.shields.io/github/v/release/Vizards/deepseek-v4-for-copilot?style=for-the-badge&label=Version" alt="版本" />
  <img src="https://vsmarketplacebadges.dev/installs-short/Vizards.deepseek-v4-for-copilot.svg?style=for-the-badge" alt="安装量" />
</p>

<p align="center">
  <a href="https://github.com/Vizards/deepseek-v4-for-copilot/blob/main/README.md">English</a> |
  简体中文
</p>

**在 Copilot Chat 模型选择器中直接使用 DeepSeek V4——无需离开你熟悉的 Copilot 工作流。**

<p align="center">
  <img src="resources/screenshots/01-picker.png" alt="DeepSeek V4 Pro 和 Flash 出现在 Copilot Chat 模型选择器中，带有可按模型独立设置的思考深度下拉菜单（停用 / 标准 / 深度）" width="800">
</p>

喜欢 DeepSeek 的性价比，但不想放弃 GitHub Copilot 的 Agent 模式、工具调用和成熟的交互体验？本扩展将 **DeepSeek V4 Pro 和 Flash** 直接接入 Copilot Chat 模型选择器，支持**视觉识别**、**思考模式**，使用你自己的 API Key。

## 为什么选这个扩展？

- **不是替换 Copilot，而是增强它。** 没有新的侧边栏，没有新的聊天界面需要学习。只是在你已经在用的模型选择器中多了一个选项。
- **Agent 模式、工具调用、Instructions、MCP、Skills——全部正常运作。** Copilot 的完整能力栈，现在跑在 DeepSeek 上。
- **让纯文本模型也能"看"图片。** DeepSeek V4 本身不支持图片输入。本扩展会将你拖入聊天的图片通过你已安装的其他 Copilot 模型进行描述，再把描述文本喂给 DeepSeek——全程透明无感。
- **需自行提供 API Key，直接向 DeepSeek 付费。** 你的 API Key，你的账单，你的速率限制。密钥存储在操作系统密钥链中，不会以明文形式写入磁盘。

## 功能特性

### DeepSeek V4 Pro & Flash 出现在模型选择器中
两个模型与 GPT-4o、Claude 等并列在 Copilot Chat 的模型选择器中。均支持 1M Token 上下文。可在对话中途切换模型，不丢失聊天历史。

### 透明视觉代理
DeepSeek V4 是纯文本模型。将截图拖入聊天，本扩展会自动将图片交给你已安装的其他 Copilot 模型（Claude、GPT-4o 等）进行描述，再将描述结果反馈给 DeepSeek。**零配置**——只需选择一次你偏好的视觉代理模型即可。

此代理为兼容性桥接方案；如果 DeepSeek 后续支持原生视觉能力，本扩展将向更统一的视觉路径迁移。

<p align="center">
  <img src="resources/screenshots/03-vision.png" alt="将图片拖入 Copilot Chat，DeepSeek 通过视觉代理响应" width="800">
</p>

### 思考模式与推理深度控制
完整支持 DeepSeek V4 的 `reasoning_content`。通过 Copilot Chat 模型选择器的菜单选择 `停用`、`标准`（均衡，默认）或 `深度`（适用于复杂 Agent 任务）。

### 继承全部 Copilot 能力
由于本扩展接入的是 Copilot 的原生 provider API，你免费获得完整能力栈：
- **Agent 模式**——自主执行多步骤任务
- **工具调用**——文件编辑、终端操作、工作区搜索、Git、测试
- **Instructions & Skills**——你的 `.instructions.md`、`AGENTS.md` 和各项 Skills 开箱即用
- **Prompt 缓存统计**——在输出通道中记录 DeepSeek 缓存命中率，直观看到成本节省

<p align="center">
  <img src="resources/screenshots/04-agent.png" alt="DeepSeek V4 Pro 运行 Copilot 的 Agent 模式，执行工具调用" width="800">
</p>

### 安全优先
API Key 存储在 VS Code 的 `SecretStorage` 中（macOS 钥匙串 / Windows 凭据管理器 / Linux 密钥环）。绝不会出现在 `settings.json` 中，也不会被提交到 Git 历史。

### 零运行时依赖
纯 VS Code API + Node.js 内置模块。无需 Python、Docker 或本地代理进程。

## 快速开始

### 前置条件

- VS Code 1.116 及以上版本。本扩展依赖非公开的 Copilot Chat API，较新的 VS Code 版本可能存在兼容性问题——如遇到请[提交 Issue](https://github.com/Vizards/deepseek-v4-for-copilot/issues)。
- GitHub Copilot 订阅（Free / Pro / Enterprise——免费版即可使用）
- DeepSeek API Key，从 [platform.deepseek.com](https://platform.deepseek.com) 获取；使用自定义 `deepseek-copilot.baseUrl` 时也可使用兼容的 provider token

### 安装方式

根据你所使用的编辑器选择对应的注册表安装：

1. **Microsoft VS Code** — 从 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Vizards.deepseek-v4-for-copilot) 安装。
2. **使用 Open VSX 的编辑器** — 从 [Open VSX](https://open-vsx.org/extension/Vizards/deepseek-v4-for-copilot) 安装。

### 使用步骤

1. 通过命令面板（`Cmd+Shift+P`）运行 **DeepSeek: 设置 API Key**
2. 粘贴你的 Key 或兼容的 provider token（官方 DeepSeek Key 通常以 `sk-` 开头）
3. 打开 Copilot Chat，点击模型选择器，选择 **DeepSeek V4 Pro** 或 **DeepSeek V4 Flash**
4. 搞定——开始聊天

## 模型

| 模型 | 适用场景 |
|---|---|
| **DeepSeek V4 Flash** | 日常快速编码、小改动、低成本迭代 |
| **DeepSeek V4 Pro** | 复杂重构、Agent 任务、深度推理 |

两者均支持可选的思考模式、工具调用和 1M Token 上下文。

## 设置项

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `deepseek-copilot.baseUrl` | `https://api.deepseek.com` | API 端点——可改为自托管或代理部署地址 |
| `deepseek-copilot.maxTokens` | `0` | 最大输出 Token 数（`0` = 不限制）。可用于成本控制 |
| `deepseek-copilot.modelIdOverrides` | 预填官方 ID 映射 | DeepSeek V4 Flash / Pro 对应的 API 模型 ID。仅在使用模型名不同的兼容第三方 API 时修改 |
| `deepseek-copilot.debugMode` | `minimal` | 诊断模式：`minimal` 仅上报 token 用量，`metadata` 输出隐私安全日志，`verbose` 将完整请求 dump 和 pipeline snapshot 写入扩展 global storage。完整 dump 可能包含敏感提示词文本、工具定义、文件片段和图片描述。使用 `DeepSeek: 打开请求 Dump 目录` 打开 dump 位置 |
| `deepseek-copilot.visionModel` | *(自动)* | 用作图片代理的 VS Code 视觉模型。请通过 `DeepSeek: 配置视觉代理` 设置；新版保存为 `vendor/id`，旧版裸模型 ID 仍兼容读取 |
| `deepseek-copilot.visionPrompt` | *(内置)* | 用于描述图片附件的提示词 |
| `deepseek-copilot.experimental.stabilizeToolList` | `false` | 实验性设置。尝试预先激活 VS Code/Copilot 的虚拟工具，让传给 DeepSeek API 的 `tools` 参数在多轮对话中更完整、更稳定。当已启用工具跨轮次变化时，可能提高上下文缓存命中率。代价是 input tokens 可能增加；缓存命中的 input tokens 单价更低，但仍会计入用量。64 个或更少已启用工具时通常无需开启，除非工具列表仍在跨轮次变化；超过 128 个已启用工具时不建议开启 |

思考深度可通过 Copilot Chat 的模型选择器对每个 DeepSeek 模型单独设置。

兼容 API 代理的 `settings.json` 配置示例：

```json
{
  "deepseek-copilot.modelIdOverrides": {
    "deepseek-v4-flash": "your-flash-model-id",
    "deepseek-v4-pro": "your-pro-model-id"
  }
}
```

## 方案对比

| | 本扩展 | 本地代理（如 LiteLLM） | 独立 DeepSeek 扩展 |
|---|---|---|---|
| 在 Copilot Chat 内使用 | ✅ | ✅ | ❌ 独立界面 |
| Agent 模式、工具、Skills | ✅ | ✅ | ⚠️ 自行实现 |
| 视觉支持 | ✅ 代理模式 | ❌ | ❌ |
| 无需额外运行进程 | ✅ | ❌ | ✅ |
| 一键安装 | ✅ | ❌ | ✅ |
| API Key 存系统密钥链 | ✅ | ❌ | ⚠️ 各异 |

## 许可证

[MIT](LICENSE)
