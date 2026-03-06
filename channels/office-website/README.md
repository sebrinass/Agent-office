# Office-Website Channel Plugin

OpenClaw Gateway 渠道插件，用于 office-website 项目的 Agent 接入。

## 功能特性

- **HTTP API 接入** - 通过 HTTP API 连接 OpenClaw Gateway
- **SSE 流式响应** - 支持 Server-Sent Events 实时消息推送
- **会话管理** - 完整的会话创建、销毁、状态管理
- **记忆系统** - 集成 OpenClaw Memory Manager
- **文档感知** - 感知当前打开的文档内容和状态
- **权限控制** - 编辑、批注、查看权限控制

## 安装

### 1. 复制插件到 OpenClaw 项目

```bash
# 将此目录复制到 OpenClaw 项目中
cp -r channels/office-website /path/to/openclaw/src/channels/
```

### 2. 注册插件

在 OpenClaw 的渠道注册文件中添加：

```typescript
import { registerOfficeWebsiteChannel } from './channels/office-website/index.js';

// 注册渠道
registerOfficeWebsiteChannel();
```

### 3. 配置 Gateway

在 Gateway 配置文件中添加：

```yaml
channels:
  office-website:
    enabled: true
    token: "your-secret-token"
    memoryEnabled: true
    memoryProvider: "openai"
    embeddingModel: "text-embedding-3-small"
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/office-website/message` | POST | 发送消息 |
| `/api/office-website/stream` | GET | SSE 流式响应 |
| `/api/office-website/session` | GET | 获取会话状态 |
| `/api/office-website/document` | POST | 同步文档信息 |
| `/api/office-website/history` | GET | 获取历史记录 |
| `/api/office-website/ping` | GET | 心跳检测 |

## 前端配置

在 office-website 前端项目中配置：

```typescript
// lib/websocket/store.ts
const config = {
  gatewayUrl: 'http://192.168.1.174:18789',
  token: 'your-secret-token',
  sessionId: 'your-session-id',
};
```

## 开发

### 目录结构

```
office-website/
├── channels/
│   └── office-website/
│       ├── index.ts              # 插件入口
│       ├── config.ts             # 配置定义
│       ├── monitor.ts            # 监控函数
│       ├── api.ts                # HTTP API
│       ├── send.ts               # 消息发送
│       ├── session.ts            # 会话管理
│       ├── auth.ts               # 认证中间件
│       ├── permissions.ts        # 权限控制
│       ├── memory-integration.ts # 记忆系统
│       └── document-operations.ts # 文档操作
├── lib/
│   ├── websocket/                # 前端连接模块
│   └── document/                 # 文档同步模块
└── types/
    └── agent.ts                  # 类型定义
```

### 编译

```bash
# OpenClaw 项目
cd /path/to/openclaw
npx tsc --noEmit

# office-website 项目
cd /path/to/office-website
npx pnpm build
```

## 许可证

MIT
