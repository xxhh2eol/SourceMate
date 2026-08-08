/**
 * 网络工具：统一 fetch 出口
 * - Electron 环境用 net.fetch（走 Chromium 网络栈，代理配置通过 session.setProxy 生效）
 * - 纯 Node 测试环境用全局 fetch
 */

export async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  if ('electron' in process.versions) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { net } = require('electron') as typeof import('electron')
    return net.fetch(url, init)
  }
  return fetch(url, init)
}

export interface ProxyConfig {
  enabled: boolean
  protocol: 'http' | 'socks5'
  host: string
  port: number
}

/**
 * 代理规则转 Electron proxyRules 格式：
 * - HTTP 代理使用不带 scheme 的 host:port（Chromium 对「所有 URL scheme 生效」的写法）
 * - SOCKS5 必须使用 socks5:// 前缀的代理 URI（urlScheme 不支持 socks5）
 */
export function toProxyRules(proxy: ProxyConfig): string {
  if (!proxy.enabled || !proxy.host || !proxy.port) return ''
  if (proxy.protocol === 'socks5') return `socks5://${proxy.host}:${proxy.port}`
  return `${proxy.host}:${proxy.port}`
}

/** git 命令环境变量（git 协议请求走子进程，需显式传代理） */
export function gitProxyEnv(proxy: ProxyConfig): Record<string, string> {
  if (!proxy.enabled || !proxy.host || !proxy.port) return {}
  const url = `${proxy.protocol}://${proxy.host}:${proxy.port}`
  return { HTTP_PROXY: url, HTTPS_PROXY: url, http_proxy: url, https_proxy: url }
}
