import { app, shell } from 'electron'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync
} from 'node:fs'
import { closeDatabase, getDb, getDbPath, initDatabase } from '../db'

/**
 * 数据管理（设计文档 §5.4 Data）
 * - 备份：VACUUM INTO 生成一致性快照
 * - 恢复：关闭连接 → 替换 db 文件 → 重新初始化
 * - 自动备份：每次启动备份，保留最近 7 份
 */

function escapeSql(s: string): string {
  return s.replace(/'/g, "''")
}

export function backupDatabase(destPath: string): { ok: boolean; error?: string } {
  try {
    getDb().exec(`VACUUM INTO '${escapeSql(destPath)}'`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 自动备份目录：用户数据目录 data/backups 下 */
export function getBackupsDir(): string {
  return join(app.getPath('userData'), 'data', 'backups')
}

/** 本地时区时间戳：YYYY-MM-DDTHH-MM-SS（字典序=时间序；Windows 文件名不允许冒号，用 - 代替） */
function localStamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

export function autoBackup(): void {
  try {
    const dir = getBackupsDir()
    mkdirSync(dir, { recursive: true })
    const name = `auto-${localStamp()}.db`
    backupDatabase(join(dir, name))
    // 保留最近 7 份自动备份
    const files = readdirSync(dir)
      .filter((f) => f.startsWith('auto-'))
      .sort()
    while (files.length > 7) {
      rmSync(join(dir, files[0]), { force: true })
      files.shift()
    }
  } catch {
    // 自动备份失败静默，不影响主流程
  }
}

/**
 * 打开自动备份目录（系统文件管理器）。目录不存在时先创建再打开，
 * shell.openPath 内部适配各平台（Win 资源管理器 / mac Finder / Linux 默认文件管理器）。
 */
export async function openBackupsDir(): Promise<{ ok: boolean; error?: string }> {
  const dir = getBackupsDir()
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const err = await shell.openPath(dir)
  return err ? { ok: false, error: err } : { ok: true }
}

/**
 * 恢复备份：关闭连接 → 替换文件（含清理 WAL 残留）→ 重新初始化。
 * 替换前把当前库复制到临时文件作为兜底；任何一步失败都回滚还原原库并重新初始化，
 * 避免应用停留在「数据库不可用」状态（此前失败会保持 db 为 null 直到重启）。
 */
export function restoreDatabase(srcPath: string): { ok: boolean; error?: string } {
  let target: string
  try {
    target = getDbPath()
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (!existsSync(srcPath)) return { ok: false, error: '备份文件不存在' }

  // 恢复前校验：备份文件必须是可打开的 SQLite 且完整性检查通过，避免把损坏/非库文件写进正式库
  try {
    const probe = new DatabaseSync(srcPath, { readOnly: true })
    try {
      const row = probe.prepare('PRAGMA integrity_check').get() as
        | { integrity_check: string }
        | undefined
      if (row?.integrity_check !== 'ok') {
        return { ok: false, error: '备份文件完整性校验失败，已取消恢复' }
      }
    } finally {
      probe.close()
    }
  } catch {
    return { ok: false, error: '备份文件不是有效的 SQLite 数据库' }
  }

  const dir = join(target, '..')
  const recovery = join(dir, 'ai-github-manager.db.pre-restore')
  const walPath = join(dir, 'ai-github-manager.db-wal')
  const shmPath = join(dir, 'ai-github-manager.db-shm')

  closeDatabase()
  try {
    // 当前库快照：恢复失败时用它回滚
    if (existsSync(target)) copyFileSync(target, recovery)
    rmSync(walPath, { force: true })
    rmSync(shmPath, { force: true })
    copyFileSync(srcPath, target)
    initDatabase()
  } catch (err) {
    // 回滚：还原替换前的库并重新初始化，尽量让应用回到可用状态
    try {
      rmSync(target, { force: true })
      if (existsSync(recovery)) copyFileSync(recovery, target)
      rmSync(walPath, { force: true })
      rmSync(shmPath, { force: true })
      initDatabase()
    } catch {
      // 回滚也失败：原库仍保留在 recovery 文件，重启后可通过手动恢复找回
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    rmSync(recovery, { force: true })
  }
  return { ok: true }
}
