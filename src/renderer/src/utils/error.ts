/**
 * 清洗 Electron IPC 错误信息：去掉 "Error invoking remote method 'xxx': Error: " 前缀，
 * 只保留主进程抛出的原始错误内容，避免把内部通道信息展示给用户
 */
export function cleanErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const match = raw.match(/^Error invoking remote method '[^']+': Error: ([\s\S]*)$/)
  const body = match ? match[1] : raw
  return body.trim()
}
