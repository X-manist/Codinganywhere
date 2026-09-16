# ZCode Provider 适配器(二次开发记录)

本 fork 在 CloudCLI(claudecodeui)中新增了 `zcode` 作为第五个 provider,与 claude / codex / cursor / opencode 并列。全部改动基于上游 1.37.3。

## 快速开始

```bash
npm install
npm run dev          # 前端 http://localhost:5173,API http://localhost:3001
```

- 首次打开浏览器会进入 onboarding 创建账号(本地开发库:`~/.cloudcli/auth.db`)。
- 前提:ZCode 桌面版已安装(`/Applications/ZCode.app`),且 `~/.zcode/cli/config.json` 配置了模型 provider。若 CLI 报 "Model config is missing",结构如下:

```json
{
  "provider": {
    "builtin:bigmodel-coding-plan": {
      "name": "BigModel - Coding Plan", "kind": "anthropic",
      "options": { "apiKey": "...", "baseURL": "https://open.bigmodel.cn/api/anthropic" },
      "models": { }
    }
  },
  "model": { "main": "builtin:bigmodel-coding-plan/GLM-5.3-Flash" }
}
```

- 覆盖 CLI 路径:环境变量 `ZCODE_CLI_PATH`(可指向 `.cjs` 脚本或独立二进制)。

## 验证

```bash
# 适配器直连 e2e(新建 + --resume 续接,真实调用 CLI)
npx tsx --tsconfig server/tsconfig.json scripts/zcode-adapter-e2e.ts

# HTTP 全链路(x-api-key 见 设置→API Keys)
curl -N -X POST http://localhost:3001/api/agent \
  -H 'x-api-key: ck_...' -H 'Content-Type: application/json' \
  -d '{"message":"hi","provider":"zcode","projectPath":"/tmp/your-project","sessionId":null}'
```

## zcode 运行方式

- 无头调用:`zcode.cjs -p "<prompt>" --json --no-color --cwd <项目目录>`,续接加 `--resume sess_...`。
- 权限模式映射:`plan`→`--mode plan`,`acceptEdits`→`--mode build`,`bypassPermissions`/默认→zcode 无头默认(yolo)。
- `--json` 终端载荷:`{sessionId, response, usage, projection}` → 适配器转成 `session_created` / `status(token_budget)` / `text` / `complete` 事件流。
- zcode CLI 无 `--model` 参数,模型由 config.json 的 `model.main` 决定;目录里预置了 GLM-5.3-Flash / GLM-5.3 两个目录项。

## 接入点清单(加一个新 provider 需要动的所有地方)

服务端:
- `server/modules/providers/list/zcode/` — 适配器本体(runtime / models / auth / mcp / skills / sessions / session-synchronizer / provider)
- `server/modules/providers/provider.registry.ts` — 注册
- `server/shared/types.ts` — `LLMProvider` 联合类型
- `server/modules/database/schema.ts` — provider_models 表 CHECK 约束(**注意:改后需删除旧库或写迁移**)
- `server/modules/providers/services/provider-capabilities.service.ts` — 能力矩阵
- `server/modules/providers/services/session-synchronizer.service.ts` — 计数器
- `server/index.ts` — `getRunner('zcode')` + 传入 agent 路由
- `server/modules/agent/agent.module.ts`、`agent.routes.ts` — REST 依赖与分发分支、provider 白名单
- `server/modules/agent/tests/agent.routes.test.ts` — 测试夹具

前端:
- `src/shared/types.ts`(联合类型)、`selectedProvider.ts`、`userSettings.ts`、`constants.ts`(MCP 四张表 + 权限偏好 key)
- `src/shared/ui/ZcodeLogo.tsx`(新增)+ `LLMProviderLogo.tsx`
- `useChatProviderState.ts`(默认模型 + 权限模式 fallback)
- `useProviderAuthStatus.ts`、`ProviderLoginModal.tsx`、`AgentsSettingsTab.tsx`、`AgentSelectorSection.tsx`、`AccountContent.tsx`、`ProviderSkills.tsx`、`McpServers.tsx`、`ProviderSelectionEmptyState.tsx`、`sidebarProjectFormatting.ts`

## 已知限制(按优先级的下一步)

1. **无流式输出**:`--json` 只在运行结束时输出一次。下一步改接 `zcode app-server`(zcode 自带的 stdio JSON-RPC 协议服务,对标 codex app-server),可获得 token 级流式和工具调用事件。
2. **会话历史回放为空**:UI 里重开 zcode 会话看不到历史消息(会话本身可用 `--resume` 续接)。等 app-server 的 transcript 读取接入后,在 `ZcodeSessionsProvider.fetchHistory` 与 `ZcodeSessionSynchronizer` 中补齐。
3. **图片/文件附件未接**(zcode 有 `--attach` 可用)。
4. **消息编辑 / 会话 fork 不支持**(能力矩阵已如实标记 false)。
5. 手机端:PWA + 微信 iLink / 飞书 bot 薄层、Tailscale 组网 —— 属于 server 层新增,不在 provider 层。
