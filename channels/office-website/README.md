# Office-Website Channel Plugin

OpenClaw Gateway 渠道插件，用于 office-website 项目的 Agent 接入。

> **说明**：此插件是 office-website 项目的附属产物，存放在 office-website 项目中统一管理，但需要安装到你的 OpenClaw 实例中才能使用。

## 功能特性

- **完整 ChannelPlugin** - 使用 `api.registerChannel()` 注册，支持调用 Agent Core
- **HTTP API 接入** - 通过 HTTP API 连接 OpenClaw Gateway
- **SSE 流式响应** - 支持 Server-Sent Events 实时消息推送
- **会话管理** - 完整的会话创建、销毁、状态管理
- **记忆系统** - 集成 OpenClaw Memory Manager
- **文档感知** - 感知当前打开的文档内容和状态
- **权限控制** - 编辑、批注、查看权限控制
- **安全防护** - 时序攻击防护、敏感信息掩码、安全响应头

## 架构说明

本插件使用 **ChannelPlugin 模式**，通过 `api.registerChannel()` 注册为完整渠道插件。

```
┌─────────────────┐        ┌─────────────────┐
│  office-website │        │  OpenClaw       │
│  (前端)         │        │  Gateway        │
│                 │        │                 │
│  ┌───────────┐  │  HTTP  │  ┌───────────┐  │
│  │ Chat UI   │◄─┼────────┼─►│ Monitor   │  │
│  │           │  │  API   │  │ (消息监控) │  │
│  └───────────┘  │        │  └─────┬─────┘  │
│                 │        │        │        │
│                 │        │        ▼        │
│                 │        │  ┌───────────┐  │
│                 │        │  │ Agent     │  │
│                 │        │  │ Core      │  │
│                 │        │  └─────┬─────┘  │
│                 │        │        │        │
│                 │        │        ▼        │
│                 │        │  ┌───────────┐  │
│  ┌───────────┐  │  HTTP  │  │ Reply     │  │
│  │ 接收回复  │◄─┼────────┼─┤ Dispatcher│  │
│  └───────────┘  │  SSE   │  └───────────┘  │
└─────────────────┘        └─────────────────┘
```

**与基础版插件的区别**：

| 维度 | 基础版 (registerHttpRoute) | 完整版 (registerChannel) |
|------|---------------------------|-------------------------|
| 注册方式 | `api.registerHttpRoute()` | `api.registerChannel()` |
| 能否调用 Agent | 不能 | 可以 |
| 消息流向 | 单向（前端→Gateway） | 双向（前端↔Agent） |
| 功能范围 | 仅 HTTP API | 完整渠道能力 |

## 安装

### 方法一：复制到 OpenClaw 的 extensions 目录

```powershell
# 假设你的 OpenClaw 实例路径为 $OPENCLAW_HOME
# 将整个 channels/office-website 目录复制到 extensions 目录

Copy-Item -Recurse -Force "d:\测试\office-website\channels\office-website" "$OPENCLAW_HOME\extensions\"
```

### 方法二：通过配置文件加载

在 OpenClaw 配置文件中添加：

```yaml
plugins:
  load:
    paths:
      - "d:/测试/office-website/channels/office-website"
```

## 配置

在 OpenClaw Gateway 配置文件中添加：

```yaml
channels:
  office-website:
    enabled: true
    accounts:
      default:
        enabled: true
        token: "your-secret-token"  # 可选，用于认证
        sessionTimeout: 3600000     # 会话超时时间（毫秒）
        maxSessions: 100            # 最大会话数
        memoryEnabled: true         # 启用记忆系统
        memoryProvider: "openai"    # 记忆提供者
        embeddingModel: "text-embedding-3-small"  # Embedding 模型
```

## API 端点

> **注意**：以下 API 端点由 OpenClaw Gateway 自动提供，通过 ChannelPlugin 模式注册。

插件注册以下 HTTP API 端点：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/office-website/message` | POST | 发送消息 |
| `/api/office-website/stream` | GET | SSE 流式响应 |
| `/api/office-website/session` | GET | 获取会话状态 |
| `/api/office-website/document` | POST | 同步文档信息 |
| `/api/office-website/history` | GET | 获取历史记录 |
| `/api/office-website/ping` | GET | 心跳检测 |

### 消息格式

**POST /api/office-website/message**

```json
{
  "sessionId": "session-123",
  "content": "请帮我分析这份文档",
  "documentContext": {
    "documentId": "doc-456",
    "documentName": "项目报告.docx",
    "documentType": "document",
    "content": "文档内容...",
    "selectedText": "选中的文本",
    "permissions": {
      "canView": true,
      "canAnnotate": true,
      "canEdit": false
    }
  }
}
```

**GET /api/office-website/stream?sessionId=session-123**

SSE 事件格式：
```
event: connected
data: {"sessionId":"session-123","timestamp":1234567890}

event: message_delta
data: {"text":"正在分析文档..."}

event: message_end
data: {"timestamp":1234567890}
```

## 前端配置

在 office-website 前端项目中配置 Gateway 地址：

```typescript
// 在设置页面或配置文件中
const gatewayConfig = {
  url: 'http://your-gateway-host:18789',
  token: 'your-secret-token',  // 可选
};
```

## 文件结构

```
channels/office-website/
├── openclaw.plugin.json    # 插件清单
├── plugin.ts               # 插件入口（符合 OpenClaw 插件规范）
├── index.ts                # 渠道注册（原始格式，供参考）
├── api.ts                  # HTTP API 详细实现
├── auth.ts                 # 认证中间件（含时序攻击防护）
├── config.ts               # 配置定义
├── document-operations.ts  # 文档操作
├── memory-integration.ts   # 记忆系统集成
├── monitor.ts              # 渠道监控
├── permissions.ts          # 权限控制
├── reply-dispatcher.ts     # 回复分发器
├── runtime.ts              # PluginRuntime API 封装
├── send.ts                 # 消息发送
├── session.ts              # 会话管理
├── templates.ts            # 消息模板
├── utils.ts                # 工具函数（含敏感信息掩码）
└── README.md               # 本文档
```

## 开发

### 编译测试

```powershell
# 在 office-website 项目目录
cd d:\测试\office-website
npx tsc --noEmit channels/office-website/plugin.ts
```

### 调试

1. 启动 OpenClaw Gateway
2. 安装插件
3. 启动 office-website 前端
4. 打开文档，连接 Gateway
5. 查看 Gateway 日志确认插件加载

## 许可证

MIT

## 变更记录

### 2026-03-06 (v6)
- **修复**：将所有 HTTP 路由的 `auth: "none"` 改为 `auth: "plugin"`
  - 问题原因：OpenClaw Gateway 的 `registerHttpRoute` 只支持 `"gateway"` 和 `"plugin"` 两种认证模式，`"none"` 是无效值
  - `auth: "plugin"` 表示插件自行处理认证，Gateway 不会强制验证
  - 这样 OPTIONS 预检请求可以到达插件的 handler，由 handler 返回 CORS 头
  - 修改文件：`channels/office-website/index.ts`

### 2026-03-06 (v5)
- **修复**：将所有 HTTP 路由的 `auth: "gateway"` 改为 `auth: "none"`，解决 CORS 预检请求被 Gateway 认证层拒绝的问题
  - 问题原因：OPTIONS 预检请求不携带 Authorization 头，导致 Gateway 认证层直接拒绝
  - 解决方案：路由层放行预检请求，认证检查移至 handler 内部处理
  - 修改路由：
    - `GET /api/office-website/ping`
    - `GET /api/office-website/session`
    - `GET /api/office-website/history`
    - `POST /api/office-website/message`
    - `GET /api/office-website/stream`
  - 修改文件：`channels/office-website/index.ts`

### 2026-03-06 (v4)
- **修复**：为所有 HTTP API 端点添加 CORS 响应头支持，解决前端跨域请求被阻止的问题
  - 新增函数：`setCorsHeaders()` - 设置 CORS 响应头
  - 新增函数：`handleOptionsRequest()` - 处理 OPTIONS 预检请求
  - 修改函数：`handleMessageHttpRequest` - 添加 CORS 支持
  - 修改函数：`handleDocumentHttpRequest` - 添加 CORS 支持
  - 修改函数：`handleHistoryHttpRequest` - 添加 CORS 支持
  - 修改函数：`handleSessionHttpRequest` - 添加 CORS 支持
  - 修改函数：`handlePingHttpRequest` - 添加 CORS 支持
  - 修改函数：`handleStreamHttpRequest` - 添加 CORS 支持
  - 修改文件：`channels/office-website/api.ts`
  - CORS 头配置：
    - `Access-Control-Allow-Origin: *`
    - `Access-Control-Allow-Methods: GET, POST, OPTIONS`
    - `Access-Control-Allow-Headers: Content-Type, Authorization`
    - `Access-Control-Max-Age: 86400` (仅预检请求)

### 2026-03-06 (v2)
- **新增**：在 `register()` 函数中添加 HTTP 路由注册，支持前端 HTTP API 模式
  - 新增路由：`GET /api/office-website/ping` - 心跳测试
  - 新增路由：`GET /api/office-website/session` - 会话状态查询
  - 新增路由：`GET /api/office-website/history` - 消息历史查询
  - 新增路由：`POST /api/office-website/message` - 发送消息
  - 新增路由：`GET /api/office-website/stream` - SSE 流式响应
  - 修改文件：`channels/office-website/index.ts`
  - 使用 `api.registerHttpRoute()` 注册 HTTP 端点

### 2026-03-06 (v3)
- **修复**：修复 `handleStreamHttpRequest` 函数中 sessionId 验证逻辑
  - 问题：当没有 sessionId 时返回 400 错误，导致 SSE 流式响应无法建立
  - 修复：当没有 sessionId 时自动生成默认值 `session-{timestamp}-{uuid}`
  - 修改文件：`channels/office-website/api.ts` (第790-798行)
  - 影响：前端现在可以在不提供 sessionId 的情况下连接 SSE 流

### 2026-03-06 (v1)
- **修复**：移除所有 `.ts` 文件中导入路径的 `.js` 后缀，解决 OpenClaw Gateway 直接加载 `.ts` 文件时的路径解析问题
  - 修改文件：`index.ts`, `api.ts`, `monitor.ts`, `auth.ts`, `send.ts`, `plugin.ts`, `reply-dispatcher.ts`, `session.ts`, `outbound.ts`, `document-operations.ts`, `memory-integration.ts`
  - 替换数量：44 处导入路径
