import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/** 数据目录：Electron 环境用 userData，纯 Node 测试环境用 .test-data；AGM_DATA_DIR 可覆盖（测试用） */
function resolveDataDir(): string {
  if (process.env.AGM_DATA_DIR) return process.env.AGM_DATA_DIR
  if ('electron' in process.versions) {
    const { app } = require('electron') as { app: { getPath: (name: string) => string } }
    return join(app.getPath('userData'), 'data')
  }
  return join(process.cwd(), '.test-data')
}

/** 迁移目录：Electron 构建产物位于 out/main，向上两级到项目根；纯 Node 环境用 cwd */
function resolveMigrationsDir(): string {
  if ('electron' in process.versions) return join(__dirname, '../../drizzle')
  return join(process.cwd(), 'drizzle')
}

/**
 * SQLite 数据层（设计文档 §3）
 * 采用 Node 内置 node:sqlite（Electron 43 / Node 24 内置，零原生依赖，无需编译）。
 * 表结构由 drizzle-kit 从 schema.ts 生成纯 SQL 迁移（drizzle/ 目录），
 * 启动时按 _journal.json 顺序执行，不依赖 drizzle 运行时。
 */

let db: DatabaseSync | null = null
let dbPath: string | null = null

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not initialized')
  return db
}

/** 当前数据库文件路径（M5 备份/恢复用） */
export function getDbPath(): string {
  if (!dbPath) throw new Error('Database not initialized')
  return dbPath
}

/** 关闭数据库连接（M5 恢复备份时先关闭再替换文件） */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
    dbPath = null
  }
}

/** 执行 drizzle-kit 生成的迁移（记录于 drizzle/meta/_journal.json），幂等 */
function runMigrations(sqlite: DatabaseSync, migrationsDir: string): void {
  sqlite.exec(
    `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
       hash TEXT PRIMARY KEY,
       created_at TEXT NOT NULL
     )`
  )

  const journal = JSON.parse(
    readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf-8')
  ) as { entries: Array<{ idx: number; tag: string }> }

  const appliedRows = sqlite
    .prepare('SELECT hash FROM __drizzle_migrations')
    .all() as Array<{ hash: string }>
  const applied = new Set(appliedRows.map((r) => r.hash))

  for (const entry of journal.entries) {
    const hash = entry.tag
    if (applied.has(hash)) continue
    const sql = readFileSync(join(migrationsDir, `${hash}.sql`), 'utf-8')
    sqlite.exec(sql)
    sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run(hash, new Date().toISOString())
  }
}

/** 初始化 SQLite（WAL + 外键约束），并在启动时执行迁移 */
export function initDatabase(): DatabaseSync {
  if (db) return db

  const dataDir = resolveDataDir()
  mkdirSync(dataDir, { recursive: true })

  dbPath = join(dataDir, 'ai-github-manager.db')
  const sqlite = new DatabaseSync(dbPath)
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = ON')

  runMigrations(sqlite, resolveMigrationsDir())
  db = sqlite
  return db
}
