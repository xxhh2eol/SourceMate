/**
 * 密钥加解密（设计文档 §1 安全基线）
 * Electron 环境用 safeStorage（系统钥匙串），纯 Node 测试环境退化明文
 */

export function encryptSecret(plain: string): string {
  if ('electron' in process.versions) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { safeStorage } = require('electron') as typeof import('electron')
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(plain).toString('base64')
    }
  }
  return 'plain:' + plain
}

export function decryptSecret(stored: string): string {
  if (stored.startsWith('enc:')) {
    if ('electron' in process.versions) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { safeStorage } = require('electron') as typeof import('electron')
      try {
        return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
      } catch {
        return ''
      }
    }
    return ''
  }
  return stored.startsWith('plain:') ? stored.slice(6) : stored
}
