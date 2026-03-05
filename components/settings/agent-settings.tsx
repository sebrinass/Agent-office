"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Settings,
  Server,
  Key,
  Shield,
  Database,
  ChevronDown,
  ChevronUp,
  Save,
  RotateCcw,
  Check,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWebSocketStore } from "@/lib/websocket/store";
import { usePermissionStore, PERMISSION_CONFIGS } from "@/lib/permission/permission-store";
import {
  embeddingConfigManager,
  PROVIDER_DEFAULTS,
  type EmbeddingProviderType,
  type EmbeddingConfig,
} from "@/lib/vector/embedding-config";
import { getEmbeddingServiceInfo, type EmbeddingServiceInfo } from "@/lib/vector/embedding-service";
import type { AgentPermission } from "@/types/agent";

// ============================================================================
// 子组件：配置区块
// ============================================================================

interface ConfigSectionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function ConfigSection({ title, icon, defaultOpen = false, children }: ConfigSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-foreground">{title}</span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-text-secondary" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-secondary" />
        )}
      </button>
      {isOpen && <div className="p-4 space-y-4">{children}</div>}
    </div>
  );
}

// ============================================================================
// 子组件：Gateway 配置
// ============================================================================

function GatewayConfigSection() {
  const gatewayUrl = useWebSocketStore((state) => state.gatewayUrl);
  const gatewayToken = useWebSocketStore((state) => state.gatewayToken);
  const autoConnect = useWebSocketStore((state) => state.autoConnect);
  const setGatewayUrl = useWebSocketStore((state) => state.setGatewayUrl);
  const setGatewayToken = useWebSocketStore((state) => state.setGatewayToken);
  const setAutoConnect = useWebSocketStore((state) => state.setAutoConnect);

  const [localUrl, setLocalUrl] = useState(gatewayUrl);
  const [localToken, setLocalToken] = useState(gatewayToken);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(() => {
    setGatewayUrl(localUrl);
    setGatewayToken(localToken);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [localUrl, localToken, setGatewayUrl, setGatewayToken]);

  const handleReset = useCallback(() => {
    setLocalUrl("ws://127.0.0.1:18789");
    setLocalToken("");
  }, []);

  return (
    <ConfigSection title="Gateway 连接" icon={<Server className="w-4 h-4 text-primary" />} defaultOpen>
      <div className="space-y-3">
        {/* WebSocket 地址 */}
        <div className="space-y-1">
          <label className="text-xs text-text-secondary">WebSocket 地址</label>
          <input
            type="text"
            value={localUrl}
            onChange={(e) => setLocalUrl(e.target.value)}
            placeholder="ws://127.0.0.1:18789"
            className={cn(
              "w-full px-3 py-2 text-sm rounded-lg border border-border bg-background",
              "text-foreground placeholder:text-text-secondary",
              "focus:outline-none focus:ring-2 focus:ring-primary/50"
            )}
          />
        </div>

        {/* Token（可选） */}
        <div className="space-y-1">
          <label className="text-xs text-text-secondary">
            Token <span className="text-text-secondary/60">(可选)</span>
          </label>
          <input
            type="password"
            value={localToken}
            onChange={(e) => setLocalToken(e.target.value)}
            placeholder="认证 Token"
            className={cn(
              "w-full px-3 py-2 text-sm rounded-lg border border-border bg-background",
              "text-foreground placeholder:text-text-secondary",
              "focus:outline-none focus:ring-2 focus:ring-primary/50"
            )}
          />
        </div>

        {/* 自动连接 */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="autoConnect"
            checked={autoConnect}
            onChange={(e) => setAutoConnect(e.target.checked)}
            className="w-4 h-4 rounded border-border"
          />
          <label htmlFor="autoConnect" className="text-sm text-foreground">
            启动时自动连接
          </label>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "transition-colors text-sm font-medium"
            )}
          >
            {saved ? (
              <>
                <Check className="w-4 h-4" />
                已保存
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                保存配置
              </>
            )}
          </button>
          <button
            onClick={handleReset}
            className={cn(
              "flex items-center justify-center gap-2 px-3 py-2 rounded-lg",
              "bg-muted text-foreground hover:bg-muted/80",
              "transition-colors text-sm"
            )}
          >
            <RotateCcw className="w-4 h-4" />
            重置
          </button>
        </div>
      </div>
    </ConfigSection>
  );
}

// ============================================================================
// 子组件：Embedding 配置
// ============================================================================

function EmbeddingConfigSection() {
  const [config, setConfig] = useState<EmbeddingConfig>(embeddingConfigManager.getConfig());
  const [serviceInfo, setServiceInfo] = useState<EmbeddingServiceInfo>(getEmbeddingServiceInfo());
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);

  useEffect(() => {
    const unsubscribe = embeddingConfigManager.subscribe((newConfig) => {
      setConfig(newConfig);
      setServiceInfo(getEmbeddingServiceInfo());
    });
    return unsubscribe;
  }, []);

  const handleProviderChange = useCallback((provider: EmbeddingProviderType) => {
    const defaults = PROVIDER_DEFAULTS[provider];
    const newConfig: Partial<EmbeddingConfig> = {
      provider,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
    };
    embeddingConfigManager.updateConfig(newConfig);
  }, []);

  const handleSave = useCallback(() => {
    embeddingConfigManager.updateConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [config]);

  const handleReset = useCallback(() => {
    embeddingConfigManager.reset();
  }, []);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // 简单测试：尝试获取一个测试文本的向量
      const response = await fetch(embeddingConfigManager.getApiEndpoint(), {
        method: "POST",
        headers: embeddingConfigManager.getHeaders(),
        body: JSON.stringify(
          config.provider === "ollama"
            ? { model: config.model, prompt: "test" }
            : { model: config.model, input: "test" }
        ),
      });

      if (response.ok) {
        setTestResult("success");
      } else {
        setTestResult("error");
      }
    } catch {
      setTestResult("error");
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  }, [config]);

  const validation = embeddingConfigManager.validateConfig();

  return (
    <ConfigSection title="Embedding 服务" icon={<Database className="w-4 h-4 text-primary" />}>
      <div className="space-y-3">
        {/* 启用开关 */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="embeddingEnabled"
            checked={config.enabled}
            onChange={(e) => embeddingConfigManager.updateConfig({ enabled: e.target.checked })}
            className="w-4 h-4 rounded border-border"
          />
          <label htmlFor="embeddingEnabled" className="text-sm text-foreground">
            启用 Embedding 服务
          </label>
        </div>

        {config.enabled && (
          <>
            {/* 提供者选择 */}
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">提供者</label>
              <select
                value={config.provider}
                onChange={(e) => handleProviderChange(e.target.value as EmbeddingProviderType)}
                className={cn(
                  "w-full px-3 py-2 text-sm rounded-lg border border-border bg-background",
                  "text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                )}
              >
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama (本地)</option>
                <option value="custom">自定义</option>
              </select>
            </div>

            {/* API 基础 URL */}
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">API 基础 URL</label>
              <input
                type="text"
                value={config.baseUrl}
                onChange={(e) => embeddingConfigManager.updateConfig({ baseUrl: e.target.value })}
                placeholder={PROVIDER_DEFAULTS[config.provider].baseUrl}
                className={cn(
                  "w-full px-3 py-2 text-sm rounded-lg border border-border bg-background",
                  "text-foreground placeholder:text-text-secondary",
                  "focus:outline-none focus:ring-2 focus:ring-primary/50"
                )}
              />
            </div>

            {/* API 密钥 */}
            {PROVIDER_DEFAULTS[config.provider].requiresApiKey && (
              <div className="space-y-1">
                <label className="text-xs text-text-secondary">API 密钥</label>
                <input
                  type="password"
                  value={config.apiKey || ""}
                  onChange={(e) => embeddingConfigManager.updateConfig({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  className={cn(
                    "w-full px-3 py-2 text-sm rounded-lg border border-border bg-background",
                    "text-foreground placeholder:text-text-secondary",
                    "focus:outline-none focus:ring-2 focus:ring-primary/50"
                  )}
                />
              </div>
            )}

            {/* 模型选择 */}
            <div className="space-y-1">
              <label className="text-xs text-text-secondary">模型</label>
              <input
                type="text"
                value={config.model}
                onChange={(e) => embeddingConfigManager.updateConfig({ model: e.target.value })}
                placeholder={PROVIDER_DEFAULTS[config.provider].model}
                className={cn(
                  "w-full px-3 py-2 text-sm rounded-lg border border-border bg-background",
                  "text-foreground placeholder:text-text-secondary",
                  "focus:outline-none focus:ring-2 focus:ring-primary/50"
                )}
              />
            </div>

            {/* 服务状态 */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-text-secondary">状态:</span>
              <span
                className={cn(
                  "px-2 py-0.5 rounded text-xs",
                  serviceInfo.status === "ready" && "bg-green-500/10 text-green-500",
                  serviceInfo.status === "disabled" && "bg-gray-500/10 text-gray-500",
                  serviceInfo.status === "error" && "bg-red-500/10 text-red-500"
                )}
              >
                {serviceInfo.status === "ready" && "就绪"}
                {serviceInfo.status === "disabled" && "已禁用"}
                {serviceInfo.status === "error" && "错误"}
              </span>
              {serviceInfo.error && (
                <span className="text-xs text-red-500 truncate flex-1">{serviceInfo.error}</span>
              )}
            </div>

            {/* 验证错误 */}
            {!validation.valid && (
              <div className="text-xs text-red-500 bg-red-500/10 rounded px-2 py-1">
                {validation.errors.join("; ")}
              </div>
            )}
          </>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={config.enabled && !validation.valid}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "transition-colors text-sm font-medium",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {saved ? (
              <>
                <Check className="w-4 h-4" />
                已保存
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                保存配置
              </>
            )}
          </button>
          {config.enabled && (
            <button
              onClick={handleTest}
              disabled={testing || !validation.valid}
              className={cn(
                "flex items-center justify-center gap-2 px-3 py-2 rounded-lg",
                "bg-muted text-foreground hover:bg-muted/80",
                "transition-colors text-sm",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {testing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : testResult === "success" ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : testResult === "error" ? (
                <AlertCircle className="w-4 h-4 text-red-500" />
              ) : (
                "测试"
              )}
            </button>
          )}
          <button
            onClick={handleReset}
            className={cn(
              "flex items-center justify-center gap-2 px-3 py-2 rounded-lg",
              "bg-muted text-foreground hover:bg-muted/80",
              "transition-colors text-sm"
            )}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>
    </ConfigSection>
  );
}

// ============================================================================
// 子组件：权限默认值配置
// ============================================================================

function PermissionConfigSection() {
  const permissions = usePermissionStore((state) => state.permissions);
  const setPermissions = usePermissionStore((state) => state.setPermissions);
  const resetToDefault = usePermissionStore((state) => state.resetToDefault);

  const handleTogglePermission = useCallback(
    (permission: AgentPermission) => {
      if (permission === "view") return; // view 权限不能关闭

      const newPermissions = permissions.includes(permission)
        ? (permissions.filter((p) => p !== permission) as AgentPermission[])
        : ([...permissions, permission] as AgentPermission[]);

      setPermissions(newPermissions);
    },
    [permissions, setPermissions]
  );

  return (
    <ConfigSection title="权限默认值" icon={<Shield className="w-4 h-4 text-primary" />}>
      <div className="space-y-3">
        <p className="text-xs text-text-secondary">
          设置 Agent 的默认操作权限。查看权限始终开启。
        </p>

        <div className="space-y-2">
          {Object.values(PERMISSION_CONFIGS).map((permConfig) => {
            const isEnabled = permissions.includes(permConfig.permission);
            const isView = permConfig.permission === "view";

            return (
              <div
                key={permConfig.permission}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg border border-border",
                  isEnabled ? "bg-primary/5" : "bg-muted/30"
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: permConfig.color }}
                  />
                  <div>
                    <div className="text-sm font-medium text-foreground">{permConfig.label}</div>
                    <div className="text-xs text-text-secondary">{permConfig.description}</div>
                  </div>
                </div>
                {isView ? (
                  <span className="text-xs text-green-500 bg-green-500/10 px-2 py-1 rounded">
                    始终开启
                  </span>
                ) : (
                  <button
                    onClick={() => handleTogglePermission(permConfig.permission)}
                    className={cn(
                      "relative w-10 h-6 rounded-full transition-colors",
                      isEnabled ? "bg-primary" : "bg-muted"
                    )}
                  >
                    <div
                      className={cn(
                        "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
                        isEnabled ? "translate-x-5" : "translate-x-1"
                      )}
                    />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <button
          onClick={resetToDefault}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg",
            "bg-muted text-foreground hover:bg-muted/80",
            "transition-colors text-sm"
          )}
        >
          <RotateCcw className="w-4 h-4" />
          重置为默认
        </button>
      </div>
    </ConfigSection>
  );
}

// ============================================================================
// 主组件：Agent 设置面板
// ============================================================================

interface AgentSettingsProps {
  className?: string;
}

export function AgentSettings({ className }: AgentSettingsProps) {
  return (
    <div className={cn("p-4 space-y-4", className)}>
      {/* 标题 */}
      <div className="flex items-center gap-2 mb-4">
        <Settings className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Agent 设置</h2>
      </div>

      {/* 配置区块 */}
      <GatewayConfigSection />
      <EmbeddingConfigSection />
      <PermissionConfigSection />

      {/* 帮助信息 */}
      <div className="text-xs text-text-secondary bg-muted/30 rounded-lg p-3">
        <p className="font-medium mb-1">配置说明</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>Gateway 地址：OpenClaw Gateway 的 WebSocket 连接地址</li>
          <li>Embedding 服务：用于向量检索的文本向量化服务</li>
          <li>权限默认值：Agent 启动时的默认操作权限</li>
        </ul>
      </div>
    </div>
  );
}

export default AgentSettings;
