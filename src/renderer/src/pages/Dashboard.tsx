import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Empty,
  Input,
  Masonry,
  message,
  Select,
  Segmented,
  Space,
  Spin,
  Switch,
  Typography
} from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SyncOutlined,
  AppstoreOutlined,
  TableOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import BubbleFilter from '../components/BubbleFilter'
import ProjectCard from '../components/ProjectCard'
import ProjectTableView from '../components/ProjectTableView'
import AddProjectModal from '../components/AddProjectModal'
import { useProjectStore } from '../stores/projectStore'
import { useFilterStore } from '../stores/filterStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useBubbleFilter } from '../hooks/useBubbleFilter'
import { cleanErrorMessage } from '../utils/error'

type SortKey = 'updatedAt' | 'starCount' | 'name'
type ViewMode = 'card' | 'table'

/**
 * Dashboard 首页（设计文档 §8 / 页面图 §2）
 * 气泡标签筛选 + 项目卡片/表格视图 + 工具栏（搜索 / 添加 / 检查更新 / 排序）
 * 分类浏览走侧栏「我的分类」→ 项目列表页（/projects）
 */
export default function Dashboard(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projects, tags, loading, load, addProject, deleteProject, assignTag, removeTag } =
    useProjectStore()
  const keyword = useFilterStore((s) => s.keyword)
  const selectedTagIds = useFilterStore((s) => s.selectedTagIds)
  const setKeyword = useFilterStore((s) => s.setKeyword)
  const projectColorMode = useSettingsStore((s) => s.projectColorMode)
  const setProjectColorMode = useSettingsStore((s) => s.setProjectColorMode)
  const toggleTag = useFilterStore((s) => s.toggleTag)
  const clearFilters = useFilterStore((s) => s.clearFilters)

  const [sortKey, setSortKey] = useState<SortKey>('updatedAt')
  const [view, setView] = useState<ViewMode>('card')
  const [addOpen, setAddOpen] = useState(false)
  // 正在检查更新的项目 id（驱动卡片边框流光动效）
  const [checkingIds, setCheckingIds] = useState<Set<number>>(() => new Set())

  useEffect(() => {
    void load()
  }, [load])

  // 批量检查时订阅主进程逐项目进度广播，实时点亮/熄灭对应卡片流光
  useEffect(() => {
    const unsubscribe = window.api.onUpdateProgress(({ projectId, status }) => {
      setCheckingIds((prev) => {
        const next = new Set(prev)
        if (status === 'checking') next.add(projectId)
        else next.delete(projectId)
        return next
      })
    })
    return unsubscribe
  }, [])

  // 先按侧栏分类收窄，再交给气泡筛选/搜索/排序（气泡计数基于分类内项目）
  const bubble = useBubbleFilter(projects, tags, selectedTagIds)

  const visibleProjects = useMemo(() => {
    let list = bubble.filteredProjects
    if (keyword.trim()) {
      const k = keyword.trim().toLowerCase()
      list = list.filter(
        (p) =>
          (p.name ?? '').toLowerCase().includes(k) ||
          (p.repo ?? '').toLowerCase().includes(k) ||
          (p.description ?? '').toLowerCase().includes(k) ||
          (p.cnSummary ?? '').toLowerCase().includes(k)
      )
    }
    const sorted = [...list]
    if (sortKey === 'starCount') sorted.sort((a, b) => b.starCount - a.starCount)
    else if (sortKey === 'name') sorted.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    // 项目真实更新时间（pushed_at）优先
    else
      sorted.sort((a, b) =>
        (b.pushedAt ?? b.updatedAt ?? '').localeCompare(a.pushedAt ?? a.updatedAt ?? '')
      )
    return sorted
  }, [bubble.filteredProjects, keyword, sortKey])

  // 已存在项目（owner/repo 小写集合，添加弹窗预览标记「已存在」）
  const existingProjectKeys = useMemo(
    () => new Set(projects.map((p) => `${p.owner}/${p.repo}`.toLowerCase())),
    [projects]
  )

  const handleAdd = async (urls: string[]): Promise<{ added: string[] }> => {
    let added = 0
    let duplicates = 0
    const errors: string[] = []
    const addedKeys: string[] = []
    for (const url of urls) {
      try {
        const r = await addProject(url)
        if (r.duplicate) duplicates++
        else {
          added++
          addedKeys.push(`${r.project.owner}/${r.project.repo}`.toLowerCase())
        }
        if (r.metaError) errors.push(r.metaError)
      } catch (err) {
        errors.push(cleanErrorMessage(err))
      }
    }
    const parts: string[] = []
    if (added > 0) parts.push(t('dashboard.added', { added }))
    if (duplicates > 0) parts.push(t('dashboard.duplicates', { duplicates }))
    if (errors.length > 0) parts.push(t('dashboard.failed', { count: errors.length }))
    message.success(parts.join('，'))
    if (errors.length > 0) message.warning(errors.slice(0, 3).join('；'))
    // 刷新项目列表：已存在判断与库保持同步（本次添加的成为「已存在」）
    await load()
    return { added: addedKeys }
  }

  const refreshMeta = async (id: number): Promise<string | null> => {
    try {
      const r = await window.api.refreshProjectMeta(id)
      if (r.ok) await load()
      return r.ok ? null : r.error
    } catch {
      return '刷新失败'
    }
  }

  const checkUpdate = async (id: number) => {
    setCheckingIds((prev) => new Set(prev).add(id))
    try {
      const r = await window.api.checkUpdate(id)
      await load()
      return r
    } catch {
      return null
    } finally {
      setCheckingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const [checkingAll, setCheckingAll] = useState(false)
  const checkAllUpdates = async (): Promise<void> => {
    setCheckingAll(true)
    try {
      const r = await window.api.checkUpdateAll()
      await load()
      const updated = r.results.filter((x) => x.hasUpdate)
      if (updated.length > 0) {
        const names = updated
          .map((u) => u.name)
          .slice(0, 3)
          .join('、')
        message.info(
          t('dashboard.foundUpdate', {
            count: updated.length,
            names: `${names}${updated.length > 3 ? ' 等' : ''}`
          })
        )
      } else {
        message.success(t('dashboard.checkedAll', { count: r.checked }))
      }
    } finally {
      setCheckingIds(new Set())
      setCheckingAll(false)
    }
  }

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div>
          <Typography.Title level={4} className="page-title">
            {t('dashboard.title')}
          </Typography.Title>
          <Typography.Paragraph className="page-desc">
            {t('dashboard.desc')} · {t('dashboard.projectCount', { count: projects.length })}
          </Typography.Paragraph>
        </div>
        <Space>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => setAddOpen(true)}>
            {t('dashboard.addProject')}
          </Button>
        </Space>{' '}
      </div>

      {projects.length > 0 && (
        <>
          <BubbleFilter
            tags={tags}
            selectedTagIds={selectedTagIds}
            onToggle={toggleTag}
            onClear={clearFilters}
            bubble={bubble}
          />

          <Space style={{ marginBottom: 16 }}>
            <Segmented<ViewMode>
              value={view}
              onChange={setView}
              options={[
                {
                  value: 'card',
                  label: t('dashboard.viewCards'),
                  icon: <AppstoreOutlined />
                },
                {
                  value: 'table',
                  label: t('dashboard.viewTable'),
                  icon: <TableOutlined />
                }
              ]}
            />
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder={t('dashboard.searchPlaceholder')}
              style={{ width: 260 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Select<SortKey>
              value={sortKey}
              onChange={setSortKey}
              style={{ width: 140 }}
              options={[
                { value: 'updatedAt', label: t('dashboard.sortUpdated') },
                { value: 'starCount', label: t('dashboard.sortStar') },
                { value: 'name', label: t('dashboard.sortName') }
              ]}
            />
            <Button
              icon={<ReloadOutlined />}
              loading={checkingAll}
              onClick={() => void checkAllUpdates()}
            >
              {t('common.checkUpdate')}
            </Button>
            <Button icon={<SyncOutlined />} onClick={() => void load()}>
              {t('common.refresh')}
            </Button>
            {/* 卡片/表格行配色模式：彩色（按项目名淡色相）| 黑白 */}
            <Switch
              checked={projectColorMode === 'color'}
              onChange={(checked) => setProjectColorMode(checked ? 'color' : 'mono')}
              checkedChildren={t('dashboard.colorMode')}
              unCheckedChildren={t('dashboard.monoMode')}
            />
          </Space>
        </>
      )}

      {loading ? (
        <Spin style={{ display: 'block', margin: '80px auto' }} />
      ) : visibleProjects.length === 0 ? (
        <Empty
          description={
            projects.length === 0 ? t('dashboard.emptyFirst') : t('dashboard.emptyNoMatch')
          }
        >
          {projects.length === 0 && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
              {t('dashboard.addProject')}
            </Button>
          )}
        </Empty>
      ) : view === 'table' ? (
        <ProjectTableView
          projects={visibleProjects}
          onOpen={(id) => navigate(`/repository/${id}/summary`)}
          onDelete={async (id) => {
            await deleteProject(id)
            clearFilters()
          }}
        />
      ) : (
        /* 瀑布流卡片视图（antd Masonry）：卡片高度不一（AI 简介有无），自动错落排列 */
        <Masonry
          columns={{ xs: 1, sm: 2, md: 3, xl: 4 }}
          gutter={[16, 16]}
          items={visibleProjects.map((p) => ({
            key: p.id,
            data: p,
            children: (
              <ProjectCard
                project={p}
                allTags={tags}
                checking={checkingIds.has(p.id)}
                onDelete={async (id) => {
                  await deleteProject(id)
                  clearFilters()
                }}
                onRefreshMeta={refreshMeta}
                onCheckUpdate={checkUpdate}
                onAssignTag={assignTag}
                onRemoveTag={removeTag}
              />
            )
          }))}
        />
      )}

      <AddProjectModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={handleAdd}
        existingKeys={existingProjectKeys}
      />
    </div>
  )
}
