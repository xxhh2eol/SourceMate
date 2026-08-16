import { app, shell } from 'electron'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { closeDatabase, getDb, getDbPath, initDatabase } from '../db'
import { ensureReleaseFileTypesRebuilt, getSetting, setSetting } from '../db/dao'
import type {
  AutoBackupSettings,
  BackupDirInfo,
  BackupFileInfo
} from '../../shared/types'

/**
 * 数据管理（设计文档 §5.4 Data）
 * - 备份：VACUUM INTO 生成一致性快照
 * - 恢复：关闭连接 → 替换 db 文件 → 重新初始化
 * - 自动备份：启动立即备份一次；运行中数据变化后按可配置间隔备份
 * - 保留份数、备份目录、间隔均可在设置页配置
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

/** 自动备份设置（settings key-value，主进程定时器读取） */
export function getBackupSettings(): AutoBackupSettings {
  return {
    enabled: getSetting<boolean>('backup.auto.enabled', true),
    dir: getSetting<string>('backup.auto.dir', getBackupsDir()),
    keepCount: getSetting<number>('backup.auto.keepCount', 5),
    intervalMinutes: getSetting<number>('backup.auto.intervalMinutes', 30)
  }
}

export function saveBackupSettings(input: AutoBackupSettings): {
  ok: boolean
  error?: string
} {
  const dir = input.dir.trim()
  const keepCount = Math.min(999, Math.max(1, Math.floor(input.keepCount) || 5))
  const intervalMinutes = Math.min(
    1440,
    Math.max(1, Math.floor(input.intervalMinutes) || 30)
  )
  if (!dir) return { ok: false, error: '备份目录不能为空' }
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  setSetting('backup.auto.enabled', input.enabled)
  setSetting('backup.auto.dir', dir)
  setSetting('backup.auto.keepCount', keepCount)
  setSetting('backup.auto.intervalMinutes', intervalMinutes)
  return { ok: true }
}

/** 本地时区时间戳：YYYY-MM-DDTHH-MM-SS（字典序=时间序；Windows 文件名不允许冒号，用 - 代替） */
function localStamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

export function autoBackup(): { ok: boolean; error?: string } {
  try {
    const settings = getBackupSettings()
    if (!settings.enabled) return { ok: true }
    const dir = settings.dir
    mkdirSync(dir, { recursive: true })
    const name = `auto-${localStamp()}.db`
    const result = backupDatabase(join(dir, name))
    if (!result.ok) return result
    pruneAutoBackups(dir, settings.keepCount)
    return { ok: true }
  } catch (err) {
    // 自动备份失败不影响主流程
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 只清理 auto- 前缀的自动备份，手动备份不碰 */
function pruneAutoBackups(dir: string, keepCount: number): void {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('auto-') && f.endsWith('.db'))
    .sort()
  while (files.length > Math.max(1, keepCount)) {
    rmSync(join(dir, files[0]), { force: true })
    files.shift()
  }
}

function parseAutoStamp(name: string): string | null {
  const m = name.match(
    /^auto-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.db$/
  )
  if (!m) return null
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6])
  ).toISOString()
}

/** 备份目录内文件列表 + 目录总大小（目录总大小包含所有普通文件） */
export function listBackupFiles(): BackupDirInfo {
  const dir = getBackupSettings().dir
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // 目录不可创建时按空目录返回
  }
  const files: BackupFileInfo[] = []
  let totalSize = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const path = join(dir, entry.name)
      let size = 0
      let mtime = 0
      try {
        const st = statSync(path)
        size = st.size
        mtime = st.mtimeMs
      } catch {
        continue
      }
      totalSize += size
      if (!entry.name.toLowerCase().endsWith('.db')) continue
      const kind = entry.name.startsWith('auto-') ? 'auto' : 'manual'
      files.push({
        name: entry.name,
        path,
        size,
        kind,
        createdAt:
          kind === 'auto' ? parseAutoStamp(entry.name) : new Date(mtime).toISOString()
      })
    }
  } catch {
    // 读取失败按空目录返回
  }
  files.sort(
    (a, b) =>
      (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.name.localeCompare(a.name)
  )
  return { dir, files, totalSize }
}

/**
 * 打开自动备份目录（系统文件管理器）。目录不存在时先创建再打开，
 * shell.openPath 内部适配各平台（Win 资源管理器 / mac Finder / Linux 默认文件管理器）。
 */
export async function openBackupsDir(): Promise<{ ok: boolean; error?: string }> {
  const dir = getBackupSettings().dir
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const err = await shell.openPath(dir)
  return err ? { ok: false, error: err } : { ok: true }
}

// ---- 自动备份定时器 ----

let autoBackupTimer: NodeJS.Timeout | null = null
let lastBackupDataMtime = 0

/** 数据库文件 + WAL 的最新修改时间（WAL 模式下写库主要落在 -wal 文件） */
function getDataMtime(): number {
  let max = 0
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const st = statSync(`${getDbPath()}${suffix}`)
      max = Math.max(max, st.mtimeMs)
    } catch {
      // 文件不存在时跳过
    }
  }
  return max
}

export function stopAutoBackupScheduler(): void {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer)
    autoBackupTimer = null
  }
}

/**
 * 启动自动备份调度：
 * - 立即备份一次
 * - 之后每个间隔检查一次数据是否变化，有变化才备份
 */
export function startAutoBackupScheduler(): void {
  stopAutoBackupScheduler()
  const settings = getBackupSettings()
  if (!settings.enabled) return

  const startup = autoBackup()
  if (startup.ok) lastBackupDataMtime = getDataMtime()

  const intervalMs = Math.max(1, settings.intervalMinutes) * 60_000
  autoBackupTimer = setInterval(() => {
    try {
      const mtime = getDataMtime()
      if (mtime <= lastBackupDataMtime) return
      const result = autoBackup()
      if (result.ok) lastBackupDataMtime = getDataMtime()
    } catch {
      // 定时备份异常静默，下个周期再试
    }
  }, intervalMs)
}

export function restartAutoBackupScheduler(): void {
  startAutoBackupScheduler()
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
    ensureReleaseFileTypesRebuilt()
  } catch (err) {
    // 回滚：还原替换前的库并重新初始化，尽量让应用回到可用状态
    try {
      rmSync(target, { force: true })
      if (existsSync(recovery)) copyFileSync(recovery, target)
      rmSync(walPath, { force: true })
      rmSync(shmPath, { force: true })
      initDatabase()
      ensureReleaseFileTypesRebuilt()
    } catch {
      // 回滚也失败：原库仍保留在 recovery 文件，重启后可通过手动恢复找回
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    rmSync(recovery, { force: true })
  }
  return { ok: true }
}
