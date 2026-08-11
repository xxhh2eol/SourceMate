import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  DatePicker,
  Dropdown,
  Empty,
  Input,
  Masonry,
  message,
  Popover,
  Select,
  Segmented,
  Space,
  Spin
} from 'antd'
import {
  AppstoreOutlined,
  FilterOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SyncOutlined,
  TableOutlined
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
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
import { analysisStatusOf, type AnalysisStatus } from '../utils/analysisStatus'

type SortKey = 'updatedAt' | 'starCount' | 'name'
type ViewMode = 'card' | 'table'
type AnalysisStatusFilter = 'all' | AnalysisStatus

/** 时间范围过滤：本地日期取整天的起止，null 表示不限 */
function inDateRange(
  value: string | null | undefined,
  range: [Dayjs | null, Dayjs | null] | null
): boolean {
  if (!range) return true
  const [start, end] = range
  if (!value) return false
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return false
  if (start && t < start.startOf('day').valueOf()) return false
  if (end && t > end.endOf('day').valueOf()) return false
  return true
}

/**
 * Dashboard 首页（设计文档 §8 / 页面图 §2）
 * 气泡标签筛选 + 项目卡片/表格视图 + 工具栏（搜索 / 添加 / 检查更新 / 排序）
 * 分类浏览走侧栏「我的分类」→ 项目列表页（/projects）
 */
export default function Dashboard(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { projects, tags, tasks, loading, load, addProject, deleteProject, assignTag, removeTag } =
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
  const [addedRange, setAddedRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [updatedRange, setUpdatedRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [analysisFilter, setAnalysisFilter] = useState<AnalysisStatusFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  // 正在检查更新的项目 id（驱动卡片边框流光动效）
  const [checkingIds, setCheckingIds] = useState<Set<number>>(() => new Set())

  useEffect(() => {
    void load()
  }, [load])

  // 分析任务状态变化时刷新，保证「是否分析过」筛选实时准确
  useEffect(() => {
    const unsubscribe = window.api.onTaskProgress(() => void load())
    return unsubscribe
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
    if (addedRange) list = list.filter((p) => inDateRange(p.createdAt, addedRange))
    if (updatedRange) {
      list = list.filter((p) => inDateRange(p.pushedAt ?? p.updatedAt, updatedRange))
    }
    if (analysisFilter !== 'all') {
      list = list.filter((p) => analysisStatusOf(p, tasks) === analysisFilter)
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
  }, [
    bubble.filteredProjects,
    keyword,
    sortKey,
    addedRange,
    updatedRange,
    analysisFilter,
    tasks
  ])

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
    // 全部添加完毕后的统一结果提示
    message.success(
      t('dashboard.batchAddResult', {
        added,
        duplicates,
        failed: errors.length
      })
    )
    if (errors.length > 0) message.warning(errors.slice(0, 3).join('；'))
    // 先返回结果让弹窗立即把本次添加项标记为「已添加」，再异步刷新列表；
    // 若先 await load()，「已存在」判断会抢先刷新并覆盖掉「已添加」的显示
    void load()
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

  const checkAllUpdates = async (): Promise<void> => {
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
    }
  }

  const activeFilterCount =
    (addedRange ? 1 : 0) + (updatedRange ? 1 : 0) + (analysisFilter !== 'all' ? 1 : 0)

  const clearAllFilters = (): void => {
    setAddedRange(null)
    setUpdatedRange(null)
    setAnalysisFilter('all')
    clearFilters()
    setFilterOpen(false)
  }

  const handleMore = ({ key }: { key: string }): void => {
    if (key === 'checkUpdate') void checkAllUpdates()
    else if (key === 'refresh') void load()
    else if (key === 'color') {
      setProjectColorMode(projectColorMode === 'color' ? 'mono' : 'color')
    }
  }

  const filterContent = (
    <Space direction="vertical" size={8} style={{ minWidth: 300 }}>
      <DatePicker.RangePicker
        allowClear
        placeholder={[t('dashboard.filterAddedStart'), t('dashboard.filterAddedEnd')]}
        value={addedRange}
        onChange={(dates) => setAddedRange(dates)}
      />
      <DatePicker.RangePicker
        allowClear
        placeholder={[t('dashboard.filterUpdatedStart'), t('dashboard.filterUpdatedEnd')]}
        value={updatedRange}
        onChange={(dates) => setUpdatedRange(dates)}
      />
      <Select<AnalysisStatusFilter>
        value={analysisFilter}
        onChange={setAnalysisFilter}
        style={{ width: '100%' }}
        options={[
          { value: 'all', label: t('dashboard.filterStatusAll') },
          { value: 'analyzed', label: t('dashboard.filterStatusAnalyzed') },
          { value: 'none', label: t('dashboard.filterStatusNone') },
          { value: 'analyzing', label: t('dashboard.filterStatusAnalyzing') },
          { value: 'failed', label: t('dashboard.filterStatusFailed') }
        ]}
      />
      <Button size="small" onClick={clearAllFilters}>
        {t('dashboard.filterClear')}
      </Button>
    </Space>
  )

  return (
    <div className="page-container" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button icon={<PlusOutlined />} type="primary" onClick={() => setAddOpen(true)}>
          {t('dashboard.addProject')}
        </Button>
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

          <Space wrap style={{ marginBottom: 12 }}>
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
              style={{ width: 200 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Select<SortKey>
              value={sortKey}
              onChange={setSortKey}
              style={{ width: 120 }}
              options={[
                { value: 'updatedAt', label: t('dashboard.sortUpdated') },
                { value: 'starCount', label: t('dashboard.sortStar') },
                { value: 'name', label: t('dashboard.sortName') }
              ]}
            />
            <Popover
              open={filterOpen}
              onOpenChange={setFilterOpen}
              trigger="click"
              placement="bottomLeft"
              content={filterContent}
            >
              <Badge count={activeFilterCount} size="small">
                <Button icon={<FilterOutlined />}>{t('dashboard.filter')}</Button>
              </Badge>
            </Popover>
            <Dropdown
              menu={{
                items: [
                  { key: 'checkUpdate', label: t('common.checkUpdate'), icon: <ReloadOutlined /> },
                  { key: 'refresh', label: t('common.refresh'), icon: <SyncOutlined /> },
                  { type: 'divider' },
                  {
                    key: 'color',
                    label:
                      projectColorMode === 'color'
                        ? t('dashboard.switchToMono')
                        : t('dashboard.switchToColor')
                  }
                ],
                onClick: handleMore
              }}
            >
              <Button icon={<MoreOutlined />} />
            </Dropdown>
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
          scrollY="calc(100vh - 280px)"
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
