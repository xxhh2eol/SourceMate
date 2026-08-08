import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Empty,
  Layout,
  List,
  Menu,
  Rate,
  Select,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  Input,
  Space,
  message,
  Skeleton
} from 'antd'
import {
  RobotOutlined,
  FileTextOutlined,
  TagsOutlined,
  EditOutlined,
  ReloadOutlined,
  SaveOutlined,
  StarOutlined,
  ForkOutlined,
  TranslationOutlined,
  LinkOutlined,
  HistoryOutlined,
  CopyOutlined
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ColumnsType } from 'antd/es/table'
import type {
  AiSummaryInfo,
  ProjectWithTags,
  ReadmeAnalysisInfo,
  ReleaseAnalysisInfo,
  ReleaseFileInfo,
  ReleaseInfo,
  TagSource
} from '@shared/types'
import MarkdownViewer from '../components/MarkdownViewer'
import { formatCount, formatRelativeTime } from '../utils/format'
import { cleanErrorMessage } from '../utils/error'

/** 标签来源徽标颜色：语言/话题/手动/AI */
const TAG_SOURCE_COLOR: Record<TagSource, string> = {
  language: 'geekblue',
  topic: 'gold',
  user: 'blue',
  ai: 'purple'
}

const TABS = [
  // AI 摘要已暂停（README 优先），恢复时取消注释
  // { key: 'summary', icon: <RobotOutlined /> },
  { key: 'readme', icon: <FileTextOutlined /> },
  { key: 'releases', icon: <TagsOutlined /> },
  { key: 'versions', icon: <HistoryOutlined /> },
  { key: 'notes', icon: <EditOutlined /> }
]

/** Repository 详情页（设计文档 §8）：二级导航 + 内容 tab（默认 README） */
export default function Repository(): React.JSX.Element {
  const { id, tab: rawTab = 'readme' } = useParams()
  // AI 摘要已暂停：旧链接 /repository/:id/summary 统一落到 README
  const tab = rawTab === 'summary' ? 'readme' : rawTab
  const navigate = useNavigate()
  const { t } = useTranslation()
  const projectId = Number(id)

  const [project, setProject] = useState<ProjectWithTags | null>(null)
  const [allProjects, setAllProjects] = useState<ProjectWithTags[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [p, list] = await Promise.all([
        window.api.getProject(projectId),
        window.api.listProjects()
      ])
      setProject(p)
      setAllProjects(list)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Layout style={{ height: '100%' }}>
      <Layout.Sider
        theme="light"
        width={180}
        style={{ borderRight: '1px solid rgba(0, 0, 0, 0.06)', overflow: 'auto' }}
      >
        <Menu
          mode="inline"
          selectedKeys={[tab]}
          onClick={({ key }) => navigate(`/repository/${id}/${key}`)}
          items={TABS.map((tab) => ({ ...tab, label: t(`repository.${tab.key}`) }))}
        />
      </Layout.Sider>
      <Layout.Content style={{ minWidth: 0, overflow: 'auto' }}>
        <div className="page-container">
          {loading ? (
            <Skeleton active />
          ) : !project ? (
            <Empty description={t('repository.notFound')} />
          ) : (
            <>
              {/* 面包屑：首页列表入口 → 当前项目（IA 调整后列表统一在 Dashboard） */}
              <Breadcrumb
                style={{ marginBottom: 12 }}
                items={[
                  {
                    title: (
                      <a
                        onClick={(e) => {
                          e.preventDefault()
                          navigate('/dashboard')
                        }}
                      >
                        {t('repository.home')}
                      </a>
                    )
                  },
                  { title: project.name }
                ]}
              />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                {/* 项目切换器：显示当前项目，下拉切换 */}
                <Select
                  style={{ minWidth: 180, maxWidth: 320 }}
                  value={projectId}
                  showSearch
                  optionFilterProp="label"
                  onChange={(newId) => navigate(`/repository/${newId}/${tab}`)}
                  options={allProjects.map((p) => ({ value: p.id, label: p.name }))}
                />
                <Typography.Link href={project.githubUrl} target="_blank">
                  {project.owner}/{project.repo} <LinkOutlined />
                </Typography.Link>
              </div>
              <Space size={16} style={{ margin: '8px 0 4px' }}>
                <span>
                  <StarOutlined style={{ color: '#faad14', marginRight: 4 }} />
                  {formatCount(project.starCount)}
                </span>
                <span>
                  <ForkOutlined style={{ marginRight: 4 }} />
                  {formatCount(project.forkCount)}
                </span>
                {project.language && (
                  <Typography.Text type="secondary">{project.language}</Typography.Text>
                )}
                <Typography.Text type="secondary">
                  {t('repository.updatedAt', { time: formatRelativeTime(project.updatedAt) })}
                </Typography.Text>
                {project.lastVersion && (
                  <Tag color="blue">
                    {t('repository.latestVersion', { version: project.lastVersion })}
                  </Tag>
                )}
              </Space>
              {project.tags.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {/* topic 标签仅入库暂不展示（后续统一处理），三维 + 语言标签正常显示 */}
                  {project.tags
                    .filter((t) => t.dimension !== 'topic')
                    .map((t) => (
                      <Tag
                        key={t.id}
                        color={TAG_SOURCE_COLOR[t.source]}
                        style={t.status === 'candidate' ? { borderStyle: 'dashed' } : undefined}
                      >
                        {t.nameCn ?? t.name}
                      </Tag>
                    ))}
                </div>
              )}

              {tab === 'summary' && <SummaryTab project={project} />}
              {tab === 'readme' && <ReadmeTab project={project} onReload={load} />}
              {tab === 'releases' && <ReleasesTab project={project} />}
              {tab === 'versions' && <VersionsTab project={project} />}
              {tab === 'notes' && <NotesTab projectId={projectId} />}
            </>
          )}
        </div>
      </Layout.Content>
    </Layout>
  )
}

/** AI Summary：展示 AI 生成的分析（M4），未分析时可触发分析任务 */
function SummaryTab({ project }: { project: ProjectWithTags }): React.JSX.Element {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<AiSummaryInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [enqueueing, setEnqueueing] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setSummary(await window.api.getAiSummary(project.id))
    setLoading(false)
  }, [project.id])

  useEffect(() => {
    void load()
    const unsubscribe = window.api.onTaskProgress(() => void load())
    return unsubscribe
  }, [load])

  const startAnalysis = async (): Promise<void> => {
    setEnqueueing(true)
    try {
      await window.api.enqueueAi(project.id)
      message.info(t('repository.queued'))
    } catch (err) {
      message.warning(cleanErrorMessage(err))
    } finally {
      setEnqueueing(false)
    }
  }

  if (loading) return <Skeleton active style={{ marginTop: 12 }} />

  if (!summary) {
    return (
      <Card style={{ marginTop: 12 }} title={t('repository.summaryTitle')}>
        <Empty>
          <Button
            type="primary"
            icon={<RobotOutlined />}
            loading={enqueueing}
            onClick={() => void startAnalysis()}
          >
            {t('repository.startAnalysis')}
          </Button>
        </Empty>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
          {t('repository.analysisTip')}
        </Typography.Paragraph>
      </Card>
    )
  }

  const learningValue = JSON.parse(summary.learningValue ?? '{}') as {
    score?: number
    reason?: string
  }

  return (
    <div style={{ marginTop: 12 }}>
      <Space style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('repository.generated', {
            model: summary.model ?? '-',
            time: formatRelativeTime(summary.createdAt),
            tokens: summary.tokensUsed
          })}
        </Typography.Text>
        <Button
          size="small"
          icon={<RobotOutlined />}
          loading={enqueueing}
          onClick={() => void startAnalysis()}
        >
          {t('repository.reAnalyze')}
        </Button>
      </Space>
      <Card>
        <Typography.Title level={5} style={{ marginTop: 0 }}>
          {t('repository.intro')}
        </Typography.Title>
        <Typography.Paragraph>{summary.intro}</Typography.Paragraph>
        <Typography.Title level={5}>{t('repository.usage')}</Typography.Title>
        <Typography.Paragraph>{summary.usage}</Typography.Paragraph>
        <Typography.Title level={5}>{t('repository.techAnalysis')}</Typography.Title>
        <Typography.Paragraph>{summary.techAnalysis}</Typography.Paragraph>
        <Typography.Title level={5}>{t('repository.learningValue')}</Typography.Title>
        <Typography.Paragraph>
          <Rate disabled value={learningValue.score} />（{learningValue.score}/5）
          <br />
          <Typography.Text type="secondary">{learningValue.reason}</Typography.Text>
        </Typography.Paragraph>
        {project.description && (
          <>
            <Typography.Title level={5}>{t('repository.githubDesc')}</Typography.Title>
            <Typography.Paragraph type="secondary">{project.description}</Typography.Paragraph>
          </>
        )}
      </Card>
    </div>
  )
}

/** README 视图：中文 / 原始 / AI 分析（Menu 导航） */
type ReadmeView = 'zh' | 'en' | 'analysis'

/** README：Markdown 渲染 + 安全消毒，可重新拉取 */
function ReadmeTab({
  project,
  onReload
}: {
  project: ProjectWithTags
  onReload: () => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<ReadmeView>('en')
  const [analysis, setAnalysis] = useState<ReadmeAnalysisInfo | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [translating, setTranslating] = useState(false)

  // 有中文版（真实或 AI 翻译）时默认展示中文，否则展示原始 README
  const hasZhContent = Boolean(project.readmeZh || project.readmeZhAi)
  useEffect(() => {
    setView(hasZhContent ? 'zh' : 'en')
  }, [hasZhContent])

  // 当前视图内容：中文视图取 真实中文 > AI 翻译；原始视图取 英文 > 主 README
  const content =
    view === 'zh'
      ? (project.readmeZh ?? project.readmeZhAi)
      : (project.readmeEn ?? project.readmeCache ?? project.readmeZh)

  // 分析按当前视图对应的语言读取/生成
  const analysisLang: 'zh' | 'en' = view === 'zh' ? 'zh' : 'en'
  const loadAnalysis = useCallback((): void => {
    window.api
      .getReadmeAnalysis(project.id, analysisLang)
      .then(setAnalysis)
      .catch(() => {})
  }, [project.id, analysisLang])

  useEffect(() => {
    loadAnalysis()
  }, [loadAnalysis])

  const startAnalysis = async (): Promise<void> => {
    setAnalyzing(true)
    try {
      const r = await window.api.analyzeReadme(project.id, analysisLang)
      setAnalysis(r)
    } catch (err) {
      message.warning(cleanErrorMessage(err))
    } finally {
      setAnalyzing(false)
    }
  }

  /** AI 翻译英文 README 为中文（仅无中文版时提供） */
  const startTranslate = async (): Promise<void> => {
    setTranslating(true)
    try {
      const r = await window.api.translateReadme(project.id)
      if (r.ok) {
        message.success(t('repository.readmeTranslated'))
        await onReload() // 刷新 project 对象以拿到 readmeZhAi，菜单自动出现「中文 README」并切换
      } else {
        message.warning(t('repository.fetchFailed'))
      }
    } catch (err) {
      message.warning(cleanErrorMessage(err))
    } finally {
      setTranslating(false)
    }
  }

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      const r = await window.api.refreshProjectMeta(project.id)
      if (r.ok) {
        message.success(t('repository.readmeUpdated'))
        await onReload()
      } else {
        message.warning(r.error ?? t('repository.fetchFailed'))
      }
    } finally {
      setRefreshing(false)
    }
  }

  const keyPoints = useMemo(() => {
    try {
      const arr = JSON.parse(analysis?.keyPoints ?? '[]') as unknown
      return Array.isArray(arr) ? arr.map((k) => String(k)) : []
    } catch {
      return []
    }
  }, [analysis])

  // 菜单项：有中文时「中文 README」排首位；只有英文时仅一项「README」。
  // README 分析 (AI) 已隐藏（与 AI 翻译重叠），恢复时在 menuItems 追加 { key: 'analysis', label: t('repository.readmeAnalysisMenu') }
  const menuItems = [
    ...(hasZhContent ? [{ key: 'zh', label: t('repository.readmeZh') }] : []),
    { key: 'en', label: t('repository.readme') }
  ]

  return (
    <div style={{ marginTop: 12 }}>
      <Menu
        mode="horizontal"
        selectedKeys={[view]}
        onClick={({ key }) => setView(key as ReadmeView)}
        items={menuItems}
        style={{ marginBottom: 12, borderBottom: '1px solid rgba(5, 5, 5, 0.06)' }}
      />
      <Space style={{ marginBottom: 8 }} wrap>
        <Typography.Text type="secondary">{t('repository.readmeSource')}</Typography.Text>
        {/* AI 翻译：无中文版 + 有英文版时提供（专注中文） */}
        {!hasZhContent && Boolean(project.readmeEn) && (
          <Tooltip title={t('repository.readmeTranslateTip')}>
            <Button
              size="small"
              icon={<TranslationOutlined />}
              loading={translating}
              onClick={() => void startTranslate()}
            >
              {project.readmeZhAi
                ? t('repository.readmeRetranslate')
                : t('repository.readmeTranslate')}
            </Button>
          </Tooltip>
        )}
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={refreshing}
          onClick={() => void refresh()}
        >
          {t('repository.reFetch')}
        </Button>
      </Space>

      {view === 'analysis' ? (
        <Card
          size="small"
          title={
            <Space size={6}>
              <RobotOutlined />
              {t('repository.readmeAnalysis')}
            </Space>
          }
          extra={
            analysis && (
              <Space size={12}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('repository.generated', {
                    model: analysis.model ?? '-',
                    time: formatRelativeTime(analysis.createdAt),
                    tokens: analysis.tokensUsed
                  })}
                </Typography.Text>
                <Button
                  size="small"
                  icon={<RobotOutlined />}
                  loading={analyzing}
                  onClick={() => void startAnalysis()}
                >
                  {t('repository.reAnalyze')}
                </Button>
              </Space>
            )
          }
        >
          {analysis ? (
            <div>
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                {analysis.overview}
              </Typography.Paragraph>
              {keyPoints.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {keyPoints.map((k, i) => (
                    <li key={i} style={{ marginBottom: 2 }}>
                      <Typography.Text style={{ fontSize: 13 }}>{k}</Typography.Text>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('repository.readmeAnalysisEmpty')}
            >
              <Button
                type="primary"
                size="small"
                icon={<RobotOutlined />}
                loading={analyzing}
                onClick={() => void startAnalysis()}
              >
                {t('repository.analyzeReadme')}
              </Button>
            </Empty>
          )}
        </Card>
      ) : content ? (
        <Card>
          {/* AI 翻译版标记 */}
          {view === 'zh' && !project.readmeZh && project.readmeZhAi && (
            <div style={{ marginBottom: 8 }}>
              <Tag color="purple" style={{ marginRight: 0 }}>
                {t('repository.readmeAiTranslated')}
              </Tag>
            </div>
          )}
          <MarkdownViewer content={content} owner={project.owner} repo={project.repo} />
        </Card>
      ) : (
        <Empty description={t('repository.readmeEmpty')} />
      )}
    </div>
  )
}

/** Releases：24h 新鲜度窗口读库，失败返回本地缓存；「刷新」按钮强制请求 */
function ReleasesTab({ project }: { project: ProjectWithTags }): React.JSX.Element {
  const { t } = useTranslation()
  const [releases, setReleases] = useState<ReleaseInfo[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    (force: boolean): void => {
      const req = force
        ? window.api.getReleases(project.id, true)
        : window.api.getReleases(project.id)
      req
        .then((r) => {
          setError(null)
          setReleases(r)
        })
        .catch((err) => {
          if (force) {
            // 手动刷新失败：保留已有数据，仅提示
            message.warning(cleanErrorMessage(err))
          } else {
            setError(t('repository.releasesFailed'))
          }
        })
        .finally(() => {
          setLoading(false)
          setRefreshing(false)
        })
    },
    [project.id, t]
  )

  useEffect(() => {
    load(false)
  }, [load])

  // 上次成功刷新时间（所有记录 checked_at 的最大值）
  const lastChecked = useMemo(() => {
    let max: string | null = null
    for (const r of releases ?? []) {
      if (r.checkedAt && (!max || r.checkedAt > max)) max = r.checkedAt
    }
    return max
  }, [releases])

  if (loading) return <Spin style={{ display: 'block', margin: '60px auto' }} />
  if (error) return <Alert type="warning" showIcon message={error} style={{ marginTop: 12 }} />
  if (!releases || releases.length === 0) {
    return (
      <div style={{ marginTop: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 8
          }}
        >
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {lastChecked
              ? t('repository.releaseLastChecked', { time: formatRelativeTime(lastChecked) })
              : ''}
          </Typography.Text>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={refreshing}
            onClick={() => load(true)}
          >
            {t('repository.releaseRefresh')}
          </Button>
        </div>
        <Empty description={t('repository.noReleases')} style={{ marginTop: 24 }} />
      </div>
    )
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {lastChecked
            ? t('repository.releaseLastChecked', { time: formatRelativeTime(lastChecked) })
            : ''}
        </Typography.Text>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={refreshing}
          onClick={() => load(true)}
        >
          {t('repository.releaseRefresh')}
        </Button>
      </div>
      <List
        itemLayout="vertical"
        dataSource={releases}
        renderItem={(r) => (
          <List.Item key={r.id}>
            <List.Item.Meta
              title={
                <Space>
                  <Typography.Text strong>{r.tagName}</Typography.Text>
                  {r.publishedAt && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(r.publishedAt).toLocaleDateString()}
                    </Typography.Text>
                  )}
                  {r.htmlUrl && (
                    <Typography.Link href={r.htmlUrl} target="_blank">
                      {t('repository.view')} <LinkOutlined />
                    </Typography.Link>
                  )}
                </Space>
              }
            />
            {r.body ? (
              <div className="markdown-body">
                <MarkdownViewer
                  content={r.body.slice(0, 4000)}
                  owner={project.owner}
                  repo={project.repo}
                />
              </div>
            ) : (
              <Typography.Text type="secondary">{t('repository.noNotes')}</Typography.Text>
            )}
          </List.Item>
        )}
      />
    </div>
  )
}

/** 历史版本记录：每版本表头「分析」按钮，只 AI 分析该版本附带的文件（名称 / SHA-256 / 下载链接 / 平台说明） */
function VersionsTab({ project }: { project: ProjectWithTags }): React.JSX.Element {
  const { t } = useTranslation()
  const [analyses, setAnalyses] = useState<ReleaseAnalysisInfo[] | null>(null)
  const [rawReleases, setRawReleases] = useState<ReleaseInfo[]>([])
  const [analyzingVersion, setAnalyzingVersion] = useState<string | null>(null)

  const load = useCallback((): void => {
    // AI 分析结果 + 原始发布记录（含附件；进页面拉 API 并入库，失败返回本地缓存）
    Promise.all([
      window.api.listReleaseAnalyses(project.id),
      window.api.getReleases(project.id)
    ])
      .then(([a, r]) => {
        setAnalyses(a)
        setRawReleases(r)
      })
      .catch(() => setAnalyses([]))
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])

  /** 只分析指定版本（结果覆盖写入） */
  const analyzeOne = async (version: string): Promise<void> => {
    setAnalyzingVersion(version)
    try {
      await window.api.analyzeReleaseOne(project.id, version)
      message.success(t('repository.versionsUpdated'))
      load()
    } catch (err) {
      message.warning(cleanErrorMessage(err))
    } finally {
      setAnalyzingVersion(null)
    }
  }

  // 合并：AI 分析结果优先；未分析但有附件的版本用原始数据兜底展示（断网也可看文件清单）
  const versionRows = useMemo(() => {
    const aiMap = new Map((analyses ?? []).map((a) => [a.version, a]))
    const rows: Array<{
      version: string
      analysis: ReleaseAnalysisInfo | null
      raw: ReleaseInfo | null
    }> = (analyses ?? []).map((a) => ({ version: a.version, analysis: a, raw: null }))
    for (const r of rawReleases) {
      if (!aiMap.has(r.tagName) && r.assets.length > 0) {
        rows.push({ version: r.tagName, analysis: null, raw: r })
      }
    }
    return rows.sort((x, y) => {
      const tx = x.analysis?.createdAt ?? x.raw?.publishedAt ?? ''
      const ty = y.analysis?.createdAt ?? y.raw?.publishedAt ?? ''
      return ty.localeCompare(tx)
    })
  }, [analyses, rawReleases])

  const copySha = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      message.success(t('repository.shaCopied'))
    } catch {
      // 剪贴板不可用时静默
    }
  }

  const fileColumns: ColumnsType<ReleaseFileInfo> = [
    {
      title: t('repository.colFileName'),
      dataIndex: 'name',
      render: (name: string) => <Typography.Text code>{name}</Typography.Text>
    },
    {
      title: t('repository.colSha256'),
      dataIndex: 'sha256',
      width: 200,
      render: (sha: string | null) =>
        sha ? (
          <Space size={4}>
            <Tooltip title={sha}>
              <Typography.Text code style={{ fontSize: 12 }}>
                {sha.slice(0, 16)}…
              </Typography.Text>
            </Tooltip>
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => void copySha(sha)} />
          </Space>
        ) : (
          '-'
        )
    },
    {
      title: t('repository.colDownload'),
      dataIndex: 'url',
      width: 110,
      render: (url: string) =>
        url ? (
          <Typography.Link href={url} target="_blank">
            {t('repository.download')} <LinkOutlined />
          </Typography.Link>
        ) : (
          '-'
        )
    },
    {
      title: t('repository.colNote'),
      dataIndex: 'note',
      render: (note: string) => note || '-'
    }
  ]

  if (analyses === null) return <Spin style={{ display: 'block', margin: '60px auto' }} />

  return (
    <div style={{ marginTop: 12 }}>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        {t('repository.versionsTip')}
      </Typography.Text>

      {versionRows.length === 0 ? (
        <Empty description={t('repository.versionsEmpty')} style={{ marginTop: 40 }} />
      ) : (
        versionRows.map((row) =>
          row.analysis ? (
            <Card
              key={row.version}
              size="small"
              style={{ marginBottom: 12 }}
              title={
                <Space size={8}>
                  <Tag color="blue">{row.version}</Tag>
                  {row.analysis.createdAt && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(row.analysis.createdAt).toLocaleDateString()}
                    </Typography.Text>
                  )}
                </Space>
              }
              extra={
                <Space size={8}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('repository.generated', {
                      model: row.analysis.model ?? '-',
                      time: formatRelativeTime(row.analysis.createdAt),
                      tokens: row.analysis.tokensUsed
                    })}
                  </Typography.Text>
                  {/* 重新分析该版本（结果覆盖） */}
                  <Button
                    size="small"
                    icon={<RobotOutlined />}
                    loading={analyzingVersion === row.version}
                    onClick={() => void analyzeOne(row.version)}
                  >
                    {t('repository.analyze')}
                  </Button>
                </Space>
              }
            >
              {row.analysis.descriptionZh || row.analysis.description ? (
                <div>
                  {/* 发布说明为 AI 中文翻译版（原版为其他语言）时标记 */}
                  {row.analysis.descriptionZh && row.analysis.description !== row.analysis.descriptionZh && (
                    <Tag color="purple" style={{ marginBottom: 4 }}>
                      {t('repository.releaseAiTranslated')}
                    </Tag>
                  )}
                  <div className="markdown-body" style={{ marginBottom: 12 }}>
                    <MarkdownViewer
                      content={(row.analysis.descriptionZh ?? row.analysis.description ?? '').slice(0, 4000)}
                      owner={project.owner}
                      repo={project.repo}
                    />
                  </div>
                </div>
              ) : null}
              <Table<ReleaseFileInfo>
                size="small"
                rowKey="name"
                pagination={false}
                dataSource={row.analysis.files}
                columns={fileColumns}
              />
            </Card>
          ) : (
            /* 未分析版本：展示库中原始附件信息（名称 / digest / 下载链接），表头「分析」按钮触发单版本 AI 分析 */
            <Card
              key={row.version}
              size="small"
              style={{ marginBottom: 12 }}
              title={
                <Space size={8}>
                  <Tag color="blue">{row.version}</Tag>
                  {row.raw?.publishedAt && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(row.raw.publishedAt).toLocaleDateString()}
                    </Typography.Text>
                  )}
                  <Tag>{t('repository.versionsPending')}</Tag>
                </Space>
              }
              extra={
                <Button
                  size="small"
                  type="primary"
                  icon={<RobotOutlined />}
                  loading={analyzingVersion === row.version}
                  onClick={() => void analyzeOne(row.version)}
                >
                  {t('repository.analyze')}
                </Button>
              }
            >
              <Table<ReleaseFileInfo>
                size="small"
                rowKey="name"
                pagination={false}
                dataSource={(row.raw?.assets ?? []).map((a) => ({
                  name: a.name,
                  sha256: a.sha256,
                  url: a.url,
                  note: ''
                }))}
                columns={fileColumns}
              />
            </Card>
          )
        )
      )}
    </div>
  )
}

/** Notes：个人笔记（Markdown 文本编辑 + 保存） */
function NotesTab({ projectId }: { projectId: number }): React.JSX.Element {
  const { t } = useTranslation()
  const [content, setContent] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    window.api.getNote(projectId).then((n) => {
      setContent(n)
      setDirty(false)
    })
  }, [projectId])

  if (content === null) return <Spin style={{ display: 'block', margin: '60px auto' }} />

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await window.api.saveNote(projectId, content)
      setDirty(false)
      message.success(t('repository.noteSaved'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <Space style={{ marginBottom: 8 }}>
        <Button
          type="primary"
          size="small"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={!dirty}
          onClick={() => void save()}
        >
          {t('common.save')}
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('repository.notesTip')}
        </Typography.Text>
      </Space>
      <Input.TextArea
        value={content}
        onChange={(e) => {
          setContent(e.target.value)
          setDirty(true)
        }}
        style={{ minHeight: 480, fontFamily: 'Consolas, Menlo, monospace' }}
        placeholder={t('repository.notesPlaceholder')}
      />
    </div>
  )
}
