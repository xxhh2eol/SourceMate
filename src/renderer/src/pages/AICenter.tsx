import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  message,
  Modal,
  notification,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import {
  MergeCellsOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RiseOutlined,
  StopOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { CandidateTagView, ProjectWithTags, TagDimension, TaskItem } from '@shared/types'
import { formatRelativeTime } from '../utils/format'
import { cleanErrorMessage } from '../utils/error'
import { analysisStatusOf, type AnalysisStatus } from '../utils/analysisStatus'

const STATUS_META: Record<TaskItem['status'], { color: string }> = {
  pending: { color: 'default' },
  running: { color: 'processing' },
  done: { color: 'success' },
  failed: { color: 'error' }
}

/** 可拖拽调宽的表头单元格（任务进度表格用）：拖动右手柄实时改列宽，最小 80px */
function ResizableTitle(
  props: React.HTMLAttributes<HTMLTableCellElement> & {
    width?: number
    onResize?: (w: number) => void
  }
): React.JSX.Element {
  const { width, onResize, children, ...rest } = props
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { startX: e.clientX, startWidth: width ?? 100 }
    setDragging(true)
    const onMove = (ev: MouseEvent): void => {
      if (dragRef.current && onResize) {
        onResize(Math.max(80, dragRef.current.startWidth + ev.clientX - dragRef.current.startX))
      }
    }
    const onUp = (): void => {
      dragRef.current = null
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <th {...rest} style={{ position: 'relative', ...rest.style }}>
      {children}
      {onResize && (
        <div
          onMouseDown={onMouseDown}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 6,
            cursor: 'col-resize',
            userSelect: 'none',
            zIndex: 1,
            background: dragging ? 'rgba(22, 119, 255, 0.25)' : 'transparent'
          }}
        />
      )}
    </th>
  )
}

/** 项目 + 最新 AI 摘要（含分析时间/模型）与最近完成的分析任务时间 */
interface ProjectRow extends ProjectWithTags {
  summary: {
    intro: string | null
    usage: string | null
    model: string | null
    createdAt: string | null
  } | null
  /** 最近一次完成的 readme_sync 任务时间（摘要功能暂停后作为「上次分析」依据） */
  lastSyncAt: string | null
  /** 最近一次历史版本分析使用的模型（「使用模型」列回退来源之一） */
  lastReleaseModel: string | null
}

/** 「上次分析」时间：优先 AI 摘要生成时间（旧功能），否则用最近完成的分析任务时间 */
function lastAnalyzedAt(p: ProjectRow): string | null {
  return p.summary?.createdAt ?? p.lastSyncAt
}

const ANALYSIS_STATUS_META: Record<AnalysisStatus, { color: string; labelKey: string }> = {
  analyzing: { color: 'processing', labelKey: 'aiCenter.analysisAnalyzing' },
  analyzed: { color: 'success', labelKey: 'aiCenter.analysisAnalyzed' },
  failed: { color: 'error', labelKey: 'aiCenter.analysisFailed' },
  none: { color: 'default', labelKey: 'aiCenter.analysisNone' }
}

/** 未分析在前，已分析按分析时间倒序在后 */
function sortByAnalyzed(list: ProjectRow[]): ProjectRow[] {
  return [...list].sort((a, b) => {
    const atA = lastAnalyzedAt(a)
    const atB = lastAnalyzedAt(b)
    if (!atA && atB) return -1
    if (atA && !atB) return 1
    return (atB ?? '').localeCompare(atA ?? '')
  })
}

/**
 * AI 分析页（设计文档 §4 / §8）
 * 上部：全项目勾选管理（未分析默认勾选、排序在前；已分析显示模型与时间）
 * 下部：任务进度（进行中 / 失败重试）
 */
export default function AICenter(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(false)
  const [busy, setBusy] = useState(false)
  // 是否已配置可用模型（已配置则不显示配置引导提示）
  const [hasModel, setHasModel] = useState(false)
  // 项目表分页（每页条数可选；全选只作用于当前页，要选更多就调大 limit）
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  // 首次加载标记：默认勾选只作用于第一次进入时
  const initializedRef = useRef(false)
  // 本次入队的任务 id（批次完成后弹结果汇总；全部终态后清空）
  const batchRef = useRef<{ ids: Set<number> } | null>(null)
  // 候选标签数（候选 tab 徽标；任务完成时随 refresh 更新）
  const [candidateCount, setCandidateCount] = useState(0)
  // 当前 tab（批次完成通知可切到候选）
  const [activeTab, setActiveTab] = useState('projects')

  /** 本次入队的任务全部进入终态（done/failed）时，弹一次结果汇总 */
  const checkBatchDone = useCallback(
    (list: TaskItem[]): void => {
      const batch = batchRef.current
      if (!batch || batch.ids.size === 0) return
      const byId = new Map(list.map((t) => [t.id, t]))
      let done = 0
      let failed = 0
      for (const id of batch.ids) {
        const task = byId.get(id)
        if (!task || task.status === 'pending' || task.status === 'running') return
        if (task.status === 'done') done++
        else failed++
      }
      batchRef.current = null
      notification.info({
        message: t('aiCenter.batchDoneTitle'),
        description: t('aiCenter.batchDoneDesc', { done, failed }),
        placement: 'bottomRight',
        duration: 8,
        btn: (
          <Button
            size="small"
            type="primary"
            onClick={() => {
              // 切换到候选 tab 并滚动到候选表格
              setActiveTab('candidates')
              setTimeout(() => {
                document.getElementById('candidate-section')?.scrollIntoView({ behavior: 'smooth' })
              }, 100)
              notification.destroy()
            }}
          >
            {t('aiCenter.viewCandidates')}
          </Button>
        )
      })
    },
    [t]
  )

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [list, p, rows, hm, cands] = await Promise.all([
        window.api.listTasks(),
        window.api.getAiPaused(),
        window.api.listProjectsWithSummaries(),
        window.api.hasModel(),
        window.api.listCandidateTags()
      ])
      setTasks(list)
      setPaused(p)
      setProjects(rows)
      setHasModel(hm)
      setCandidateCount(cands.length)
      checkBatchDone(list)
      setSelectedIds((prev) => {
        // 已分析完成的项目自动取消勾选（避免重复分析）
        const analyzed = new Set(rows.filter((r) => lastAnalyzedAt(r)).map((r) => r.id))
        const next = new Set(prev)
        for (const id of analyzed) next.delete(id)
        // 首次进入：默认勾选仅限当前页的未分析项目（其他页需翻页后再勾选）
        if (!initializedRef.current) {
          initializedRef.current = true
          return new Set(
            sortByAnalyzed(rows)
              .filter((r) => !lastAnalyzedAt(r))
              .slice(0, pageSize)
              .map((r) => r.id)
          )
        }
        return next
      })
    } finally {
      setLoading(false)
    }
  }, [pageSize, checkBatchDone])

  useEffect(() => {
    void refresh()
    const unsubscribe = window.api.onTaskProgress(() => {
      void refresh()
    })
    return unsubscribe
  }, [refresh])

  const stats = useMemo(
    () => ({
      total: tasks.length,
      done: tasks.filter((t) => t.status === 'done').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      active: tasks.filter((t) => t.status === 'pending' || t.status === 'running').length
    }),
    [tasks]
  )

  // 有进行中任务的项目 id（项目列表行流光 + 处理中标记）
  const runningProjectIds = useMemo(
    () =>
      new Set(
        tasks
          .filter((t) => t.status === 'pending' || t.status === 'running')
          .map((t) => t.projectId)
      ),
    [tasks]
  )

  const toggleSelected = (id: number): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // 全选/取消全选仅作用于当前页（跨页累计选中；要一次选更多就调大每页条数）
  const toggleAll = (): void => {
    const pageIds = currentPageProjects.map((p) => p.id)
    if (pageIds.length === 0) return
    const allSelected = pageIds.every((id) => selectedIds.has(id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of pageIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const analyzeSelected = async (): Promise<void> => {
    if (selectedIds.size === 0) return
    Modal.confirm({
      title: t('aiCenter.confirmTitle', { count: selectedIds.size }),
      content: t('aiCenter.confirmContent'),
      okText: t('aiCenter.confirmOk'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        setBusy(true)
        try {
          const r = await window.api.enqueueAiMany([...selectedIds])
          if (r.taskIds.length > 0) {
            batchRef.current = { ids: new Set(r.taskIds) }
          }
          message.success(t('aiCenter.queued', { count: r.queued }))
          await refresh()
        } catch (err) {
          message.warning(cleanErrorMessage(err))
        } finally {
          setBusy(false)
        }
      }
    })
  }

  const togglePause = async (): Promise<void> => {
    const r = await window.api.setAiPaused(!paused)
    setPaused(r.paused)
  }

  const retry = async (id: number): Promise<void> => {
    await window.api.retryTask(id)
    await refresh()
  }

  // 未分析在前，已分析按分析时间倒序在后
  const sortedProjects = useMemo(() => sortByAnalyzed(projects), [projects])

  // 每页条数选项：10 / 20 / 50 / 100；总数据超过 100 时追加「总条数」选项，便于一页全选
  const pageSizeOptions = useMemo(() => {
    const base = [10, 20, 50, 100]
    if (sortedProjects.length > 100 && !base.includes(sortedProjects.length)) {
      return [...base, sortedProjects.length]
    }
    return base
  }, [sortedProjects.length])

  // 数据刷新后若当前 limit 已不在选项中（如项目被删除），回退到默认值
  useEffect(() => {
    if (!pageSizeOptions.includes(pageSize)) {
      setPageSize(10)
      setPage(1)
    }
  }, [pageSizeOptions, pageSize])

  // 当前页展示的项目（与 Table 分页切片保持一致）
  const pageStart = (page - 1) * pageSize
  const currentPageProjects = sortedProjects.slice(pageStart, pageStart + pageSize)
  // 当前页未分析项目（「选中本页未分析」按钮：随 limit 变化，不跨页；再次点击释放）
  const currentPageUnanalyzed = currentPageProjects.filter(
    (p) => analysisStatusOf(p, tasks) === 'none'
  )
  const allUnanalyzedSelected =
    currentPageUnanalyzed.length > 0 &&
    currentPageUnanalyzed.every((p) => selectedIds.has(p.id))

  const toggleUnanalyzedOnPage = (): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const p of currentPageUnanalyzed) {
        if (allUnanalyzedSelected) next.delete(p.id)
        else next.add(p.id)
      }
      return next
    })
  }

  const projectColumns: ColumnsType<ProjectRow> = [
    {
      title: (
        <Checkbox
          checked={
            currentPageProjects.length > 0 &&
            currentPageProjects.every((p) => selectedIds.has(p.id))
          }
          indeterminate={
            currentPageProjects.some((p) => selectedIds.has(p.id)) &&
            !currentPageProjects.every((p) => selectedIds.has(p.id))
          }
          onChange={toggleAll}
        />
      ),
      key: 'check',
      width: 40,
      render: (_, p) => (
        <Checkbox
          checked={selectedIds.has(p.id)}
          onChange={() => toggleSelected(p.id)}
          onClick={(e) => e.stopPropagation()}
        />
      )
    },
    {
      title: t('aiCenter.colProject'),
      key: 'name',
      render: (_, p) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* 仅项目名可点击进入详情（整行点击太灵敏，误触率高） */}
          <Typography.Link onClick={() => navigate(`/repository/${p.id}`)}>
            {p.name}
          </Typography.Link>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {p.owner}/{p.repo}
          </Typography.Text>
        </div>
      )
    },
    {
      title: t('aiCenter.colStatus'),
      key: 'status',
      width: 160,
      render: (_, p) => {
        const meta = ANALYSIS_STATUS_META[analysisStatusOf(p, tasks)]
        // 低置信：存在 AI 置信度 < 0.5 的标签（不入失败，正常写库，建议人工核对）
        const lowConfidence = p.tags.some(
          (tag) => tag.source === 'ai' && tag.confidence !== null && tag.confidence < 0.5
        )
        return (
          <Space size={4}>
            <Tag color={meta.color}>{t(meta.labelKey)}</Tag>
            {lowConfidence && (
              <Tooltip title={t('aiCenter.lowConfidenceTip')}>
                <Tag color="warning">{t('aiCenter.lowConfidence')}</Tag>
              </Tooltip>
            )}
          </Space>
        )
      }
    },
    {
      title: t('aiCenter.colSummary'),
      key: 'summary',
      width: 260,
      render: (_, p) =>
        p.cnSummary ? (
          <Tooltip title={p.cnSummary}>
            <Typography.Text ellipsis style={{ fontSize: 12, maxWidth: 240 }}>
              {p.cnSummary}
            </Typography.Text>
          </Tooltip>
        ) : (
          '-'
        )
    }
  ]

  // 任务表格列宽（表头拖拽调整，仅会话内生效）
  const [taskColWidths, setTaskColWidths] = useState<Record<string, number>>({})

  const taskColumns: ColumnsType<TaskItem> = [
    {
      title: t('aiCenter.colProject'),
      dataIndex: 'projectName',
      key: 'projectName',
      width: taskColWidths.projectName ?? 180,
      onHeaderCell: () =>
        ({
          width: taskColWidths.projectName ?? 180,
          onResize: (w: number) => setTaskColWidths((s) => ({ ...s, projectName: w }))
        }) as React.HTMLAttributes<HTMLTableCellElement>,
      render: (name: string | undefined, r) => (
        <Typography.Link onClick={() => navigate(`/repository/${r.projectId}`)}>
          {name ?? `#${r.projectId}`}
        </Typography.Link>
      )
    },
    {
      title: t('aiCenter.colTask'),
      dataIndex: 'type',
      key: 'type',
      width: taskColWidths.type ?? 140,
      onHeaderCell: () =>
        ({
          width: taskColWidths.type ?? 140,
          onResize: (w: number) => setTaskColWidths((s) => ({ ...s, type: w }))
        }) as React.HTMLAttributes<HTMLTableCellElement>,
      render: (type: string) =>
        type === 'readme_sync'
          ? t('aiCenter.taskReadmeSync')
          : type === 'tag_analysis'
            ? t('aiCenter.taskTagAnalysis')
            : type === 'update_check'
              ? t('aiCenter.taskUpdateCheck')
              : type
    },
    {
      title: t('aiCenter.colStatus'),
      dataIndex: 'status',
      key: 'status',
      width: taskColWidths.status ?? 110,
      onHeaderCell: () =>
        ({
          width: taskColWidths.status ?? 110,
          onResize: (w: number) => setTaskColWidths((s) => ({ ...s, status: w }))
        }) as React.HTMLAttributes<HTMLTableCellElement>,
      render: (s: TaskItem['status']) => (
        <Tag color={STATUS_META[s].color}>
          {t(`aiCenter.status${s[0].toUpperCase()}${s.slice(1)}`)}
        </Tag>
      )
    },
    {
      title: t('aiCenter.colProgress'),
      dataIndex: 'progress',
      key: 'progress',
      width: taskColWidths.progress ?? 140,
      onHeaderCell: () =>
        ({
          width: taskColWidths.progress ?? 140,
          onResize: (w: number) => setTaskColWidths((s) => ({ ...s, progress: w }))
        }) as React.HTMLAttributes<HTMLTableCellElement>,
      render: (p: number, r) =>
        r.status === 'running' ? (
          <Progress percent={p} size="small" />
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {p}%
          </Typography.Text>
        )
    },
    {
      title: t('aiCenter.colError'),
      key: 'error',
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          {r.error && (
            <Tooltip title={r.error}>
              <Typography.Text type="danger" ellipsis style={{ maxWidth: 260, fontSize: 12 }}>
                {r.error}
              </Typography.Text>
            </Tooltip>
          )}
          {r.retryCount > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('aiCenter.retried', { count: r.retryCount })}
            </Typography.Text>
          )}
        </Space>
      )
    },
    {
      title: t('aiCenter.colCreated'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: taskColWidths.createdAt ?? 110,
      onHeaderCell: () =>
        ({
          width: taskColWidths.createdAt ?? 110,
          onResize: (w: number) => setTaskColWidths((s) => ({ ...s, createdAt: w }))
        }) as React.HTMLAttributes<HTMLTableCellElement>,
      render: (v: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {formatRelativeTime(v)}
        </Typography.Text>
      )
    },
    {
      title: t('aiCenter.colActions'),
      key: 'actions',
      width: taskColWidths.actions ?? 90,
      onHeaderCell: () =>
        ({
          width: taskColWidths.actions ?? 90,
          onResize: (w: number) => setTaskColWidths((s) => ({ ...s, actions: w }))
        }) as React.HTMLAttributes<HTMLTableCellElement>,
      render: (_, r) =>
        r.status === 'failed' ? (
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void retry(r.id)}>
            {t('common.retry')}
          </Button>
        ) : r.status === 'done' ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('aiCenter.done')}
          </Typography.Text>
        ) : null
    }
  ]

  return (
    <div className="page-container">
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'projects',
            label: t('aiCenter.tabProjects'),
            children: (
              <>
                <div
                  style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}
                >
                  <Space>
                    {/* 选中/释放当前页全部未分析项目（随分页大小变化，不跨页） */}
                    <Button
                      disabled={currentPageUnanalyzed.length === 0}
                      onClick={toggleUnanalyzedOnPage}
                    >
                      {t(
                        allUnanalyzedSelected
                          ? 'aiCenter.unselectUnanalyzed'
                          : 'aiCenter.selectUnanalyzed',
                        { count: currentPageUnanalyzed.length }
                      )}
                    </Button>
                    <Button
                      type="primary"
                      icon={<ThunderboltOutlined />}
                      loading={busy}
                      disabled={selectedIds.size === 0}
                      onClick={() => void analyzeSelected()}
                    >
                      {t('aiCenter.analyzeSelected', { count: selectedIds.size })}
                    </Button>
                  </Space>
                </div>
                {/* 未配置模型时显示配置引导；已配置默认模型后隐藏 */}
                {!hasModel && (
                  <Alert type="info" showIcon message={t('aiCenter.tip')} style={{ marginBottom: 16 }} />
                )}
                {/* 项目勾选管理：未分析默认勾选、排序在前；仅项目名可点击进详情 */}
                <Table<ProjectRow>
                  rowKey="id"
                  loading={loading}
                  columns={projectColumns}
                  dataSource={sortedProjects}
                  pagination={{
                    current: page,
                    pageSize,
                    pageSizeOptions,
                    showSizeChanger: true,
                    // 不隐藏分页器：否则选到「总条数」选项只剩一页时分页器消失，limit 无法再调整
                    size: 'small',
                    onChange: (p, size) => {
                      setPage(p)
                      if (size !== pageSize) setPageSize(size)
                    }
                  }}
                  size="small"
                  rowClassName={(p) => (runningProjectIds.has(p.id) ? 'agm-row-processing' : '')}
                />
              </>
            )
          },
          {
            key: 'tasks',
            label: (
              <Badge count={stats.active} size="small" offset={[6, -2]}>
                {t('aiCenter.tabTasks')}
              </Badge>
            ),
            children: (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <Button
                    icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                    onClick={() => void togglePause()}
                  >
                    {paused ? t('aiCenter.resume') : t('aiCenter.pause')}
                  </Button>
                </div>
                <Table<TaskItem>
                  rowKey="id"
                  loading={loading}
                  columns={taskColumns}
                  dataSource={tasks}
                  components={{ header: { cell: ResizableTitle } }}
                  pagination={{ defaultPageSize: 10, hideOnSinglePage: true, size: 'small' }}
                  size="small"
                />
              </>
            )
          },
          {
            key: 'candidates',
            label: (
              <Badge count={candidateCount} size="small" offset={[6, -2]}>
                {t('aiCenter.tabCandidates')}
              </Badge>
            ),
            children: <CandidateSection onCountChange={setCandidateCount} />
          }
        ]}
      />
    </div>
  )
}

/** 维度中文名（候选表格展示用） */
const DIMENSION_LABEL: Record<TagDimension, string> = {
  type: 'dimType',
  tech: 'dimTech',
  purpose: 'dimPurpose',
  audience: 'dimAudience',
  domain: 'dimDomain',
  capability: 'dimCapability',
  language: 'dimLanguage',
  topic: 'dimTopic'
}

/**
 * 候选标签审核（AI 环节三产出）：升级为正式 / 合并到正式 / 拒绝。
 * 任务进度广播（tag_analysis 完成后）自动刷新；数量变化回调父组件（tab 徽标）。
 */
function CandidateSection({
  onCountChange
}: {
  onCountChange?: (n: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [candidates, setCandidates] = useState<CandidateTagView[]>([])
  const [officialOptions, setOfficialOptions] = useState<Array<{ value: number; label: string }>>(
    []
  )
  const [mergeTarget, setMergeTarget] = useState<CandidateTagView | null>(null)
  const [mergeValue, setMergeValue] = useState<number>()
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    const [cs, all] = await Promise.all([window.api.listCandidateTags(), window.api.listTags()])
    setCandidates(cs)
    setOfficialOptions(
      all.filter((x) => x.status === 'official').map((x) => ({ value: x.id, label: x.name }))
    )
    // 数量变化同步父组件（待审核 tab 徽标实时更新）
    onCountChange?.(cs.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
    const unsubscribe = window.api.onTaskProgress(() => void load())
    return unsubscribe
  }, [load])

  const run = async (fn: () => Promise<unknown>, okMsg: string): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      message.success(okMsg)
      await load()
    } catch (err) {
      message.warning(cleanErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const confirmMerge = async (): Promise<void> => {
    if (!mergeTarget || !mergeValue) return
    setBusy(true)
    try {
      const r = await window.api.mergeTag(mergeTarget.id, mergeValue)
      if (!r.ok) message.warning(r.error ?? t('common.failed'))
      else message.success(t('aiCenter.merged'))
      setMergeTarget(null)
      setMergeValue(undefined)
      await load()
    } catch (err) {
      message.warning(cleanErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const columns: ColumnsType<CandidateTagView> = [
    {
      title: t('aiCenter.colTag'),
      key: 'tag',
      render: (_, r) => (
        <Space size={4}>
          <Tag>{r.nameCn ?? r.name}</Tag>
          <Tag color="purple" style={{ fontSize: 10, lineHeight: '16px', marginRight: 0 }}>
            {t(`aiCenter.${DIMENSION_LABEL[r.dimension]}`)}
          </Tag>
        </Space>
      )
    },
    {
      title: t('aiCenter.colProjects'),
      dataIndex: 'count',
      key: 'count',
      width: 90,
      render: (count: number, r) => (
        <Tooltip title={r.projectNames.join('、')}>
          <span>{count}</span>
        </Tooltip>
      )
    },
    {
      title: t('aiCenter.colAction'),
      key: 'action',
      width: 210,
      render: (_, r) => (
        <Space size={4}>
          <Button
            size="small"
            type="primary"
            ghost
            icon={<RiseOutlined />}
            onClick={() => void run(() => window.api.promoteTag(r.id), t('aiCenter.promoted'))}
          >
            {t('aiCenter.promote')}
          </Button>
          <Button
            size="small"
            icon={<MergeCellsOutlined />}
            onClick={() => {
              setMergeTarget(r)
              setMergeValue(undefined)
            }}
          >
            {t('aiCenter.merge')}
          </Button>
          <Popconfirm
            title={t('aiCenter.rejectConfirm')}
            onConfirm={() => void run(() => window.api.rejectTag(r.id), t('aiCenter.rejected'))}
          >
            <Button size="small" danger icon={<StopOutlined />}>
              {t('aiCenter.reject')}
            </Button>
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <>
      <div id="candidate-section">
        <Table<CandidateTagView>
          rowKey="id"
          loading={busy}
          columns={columns}
          dataSource={candidates}
          pagination={{ defaultPageSize: 10, hideOnSinglePage: true, size: 'small' }}
          size="small"
          locale={{ emptyText: t('aiCenter.candidatesEmpty') }}
        />
      </div>
      <Modal
        title={t('aiCenter.mergeTitle')}
        open={mergeTarget !== null}
        onOk={() => void confirmMerge()}
        onCancel={() => setMergeTarget(null)}
        okButtonProps={{ disabled: !mergeValue, loading: busy }}
      >
        <p style={{ marginBottom: 12 }}>{t('aiCenter.mergeHint', { name: mergeTarget?.name })}</p>
        <Select
          showSearch
          style={{ width: '100%' }}
          placeholder={t('aiCenter.mergePlaceholder')}
          options={officialOptions}
          value={mergeValue}
          onChange={setMergeValue}
          optionFilterProp="label"
        />
      </Modal>
    </>
  )
}
