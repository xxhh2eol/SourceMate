import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Dropdown,
  Empty,
  Layout,
  List,
  Menu,
  Modal,
  Rate,
  Select,
  Spin,
  Table,
  Tag,
  Tabs,
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
  CopyOutlined,
  AppstoreOutlined,
  MenuOutlined,
  ScheduleOutlined
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ColumnsType } from 'antd/es/table'
import type {
  AiSummaryInfo,
  ProjectProfile,
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
import { splitReadmeSections } from '../utils/readmeSections'
import { useSettingsStore, type ReadmeSectionLayout } from '../stores/settingsStore'
import {
  classifyReleaseFile
  // 类型过滤暂时注释：恢复时取消下面这行
  // releaseFileFilterLabel
} from '@shared/releaseFileType'
import { hasChineseReadme, hasEnglishReadme } from '@shared/readme'

/** 标签来源徽标颜色：语言/话题/手动/AI */
const TAG_SOURCE_COLOR: Record<TagSource, string> = {
  language: 'geekblue',
  topic: 'gold',
  user: 'blue',
  ai: 'purple'
}

const TABS = [
  { key: 'summary', icon: <RobotOutlined /> },
  { key: 'readme', icon: <FileTextOutlined /> },
  { key: 'releases', icon: <TagsOutlined /> },
  { key: 'versions', icon: <HistoryOutlined /> },
  { key: 'notes', icon: <EditOutlined /> }
]

/** Repository 详情页（设计文档 §8）：二级导航 + 内容 tab（默认 README） */
export default function Repository(): React.JSX.Element {
  const { id, tab = 'readme' } = useParams()
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
      // 进详情即视为「已查看」该项目的更新，清除可更新标记
      if (p?.hasUpdate) void window.api.markUpdateSeen(projectId)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  // topic 标签仅入库暂不展示（后续统一处理），三维 + 语言标签正常显示
  const visibleProjectTags = useMemo(
    () => (project?.tags ?? []).filter((t) => t.dimension !== 'topic'),
    [project]
  )

  return (
    <Layout style={{ height: '100%' }}>
      <Layout.Sider
        theme="light"
        width={240}
        style={{ borderRight: '1px solid rgba(0, 0, 0, 0.06)', overflow: 'hidden' }}
      >
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Menu
            mode="inline"
            selectedKeys={[tab]}
            onClick={({ key }) => navigate(`/repository/${id}/${key}`)}
            items={TABS.map((tab) => ({ ...tab, label: t(`repository.${tab.key}`) }))}
            style={{ flexShrink: 0, borderInlineEnd: 'none' }}
          />
          {project && (
            <>
              {/* 标签区：占中间动态高度，可滚动；项目信息区固定在底部 */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  padding: '12px 16px 8px'
                }}
              >
                {visibleProjectTags.length > 0 ? (
                  <div>
                    {visibleProjectTags.map((t) => (
                      <Tag
                        key={t.id}
                        color={TAG_SOURCE_COLOR[t.source]}
                        style={t.status === 'candidate' ? { borderStyle: 'dashed' } : undefined}
                      >
                        {t.nameCn ?? t.name}
                      </Tag>
                    ))}
                  </div>
                ) : (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {t('repository.noTags')}
                  </Typography.Text>
                )}
              </div>
              {/* 项目信息区：固定底部 */}
              <div
                style={{
                  flexShrink: 0,
                  padding: '12px 16px 16px',
                  borderTop: '1px solid rgba(0, 0, 0, 0.06)'
                }}
              >
                <Typography.Text
                  type="secondary"
                  style={{ display: 'block', fontSize: 12, marginBottom: 8 }}
                >
                  {t('repository.projectInfo')}
                </Typography.Text>
                {/* 项目切换器：显示当前项目，下拉切换 */}
                <Select
                  style={{ width: '100%' }}
                  size="small"
                  value={projectId}
                  showSearch
                  optionFilterProp="label"
                  onChange={(newId) => navigate(`/repository/${newId}/${tab}`)}
                  options={allProjects.map((p) => ({ value: p.id, label: p.name }))}
                />
                <Typography.Link
                  href={project.githubUrl}
                  target="_blank"
                  style={{
                    display: 'block',
                    marginTop: 8,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {project.owner}/{project.repo} <LinkOutlined />
                </Typography.Link>
                <Space size={12} wrap style={{ margin: '10px 0 6px' }}>
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
              </div>
            </>
          )}
        </div>
      </Layout.Sider>
      <Layout.Content style={{ minWidth: 0, overflow: 'auto' }}>
        <div className="page-container">
          {loading ? (
            <Skeleton active />
          ) : !project ? (
            <Empty description={t('repository.notFound')} />
          ) : (
            <>
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

/** 五维项目画像：定位 / 痛点 / 上手 / 时机 / 效果（升级版 ai_summaries） */
function SummaryTab({ project }: { project: ProjectWithTags }): React.JSX.Element {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<AiSummaryInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    setSummary(await window.api.getAiSummary(project.id))
    setLoading(false)
  }, [project.id])

  useEffect(() => {
    void load()
    const unsubscribe = window.api.onTaskProgress(() => void load())
    return unsubscribe
  }, [load])

  const profile = useMemo<ProjectProfile | null>(() => {
    if (!summary?.profile) return null
    try {
      return JSON.parse(summary.profile) as ProjectProfile
    } catch {
      return null
    }
  }, [summary])

  const startGenerate = async (): Promise<void> => {
    if (generating) return
    setGenerating(true)
    try {
      await window.api.generateProfile(project.id)
      await load()
    } catch (err) {
      message.warning(cleanErrorMessage(err))
    } finally {
      setGenerating(false)
    }
  }

  if (loading) return <Skeleton active style={{ marginTop: 12 }} />

  if (!profile) {
    return (
      <Card style={{ marginTop: 12 }} title={t('repository.profileTitle')}>
        <Empty description={t('repository.profileEmpty')}>
          <Button
            type="primary"
            icon={<RobotOutlined />}
            loading={generating}
            onClick={() => void startGenerate()}
          >
            {t('repository.profileGenerate')}
          </Button>
        </Empty>
      </Card>
    )
  }

  const sections = [
    { title: t('repository.profilePositioning'), content: profile.positioning, color: '#1677ff' },
    { title: t('repository.profilePainPoints'), content: profile.painPoints, color: '#fa8c16' },
    {
      title: t('repository.profileGettingStarted'),
      content: profile.gettingStarted,
      color: '#52c41a'
    }
  ]

  return (
    <div style={{ marginTop: 12 }}>
      <Card
        title={t('repository.profileTitle')}
        extra={
          <Button
            size="small"
            icon={<RobotOutlined />}
            loading={generating}
            onClick={() => void startGenerate()}
          >
            {t('repository.profileRegenerate')}
          </Button>
        }
      >
        <Typography.Text
          type="secondary"
          style={{ fontSize: 12, display: 'block', marginBottom: 12 }}
        >
          {t('repository.generated', {
            model: summary?.model ?? '-',
            time: formatRelativeTime(summary?.createdAt ?? ''),
            tokens: summary?.tokensUsed ?? 0
          })}
        </Typography.Text>

        {sections.map((s) => (
          <div key={s.title} style={{ marginBottom: 16 }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: s.color,
                  marginRight: 8
                }}
              />
              {s.title}
            </Typography.Title>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
              {s.content}
            </Typography.Paragraph>
          </div>
        ))}

        <div style={{ marginBottom: 16 }}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#13c2c2',
                marginRight: 8
              }}
            />
            {t('repository.profileWhen')}
          </Typography.Title>
          <Typography.Text strong style={{ color: '#52c41a' }}>
            {t('repository.profileSuitable')}
          </Typography.Text>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>
            {profile.suitableScenarios}
          </Typography.Paragraph>
          <Typography.Text strong style={{ color: '#ff4d4f' }}>
            {t('repository.profileUnsuitable')}
          </Typography.Text>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
            {profile.unsuitableScenarios}
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#722ed1',
                marginRight: 8
              }}
            />
            {t('repository.profileEffect')}
          </Typography.Title>
          <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
            {profile.effect}
          </Typography.Paragraph>
          <Space align="center">
            <Typography.Text strong>{t('repository.profileLearningValue')}</Typography.Text>
            <Rate disabled value={profile.learningScore} />
            <Typography.Text type="secondary">({profile.learningScore}/5)</Typography.Text>
          </Space>
          {profile.learningReason && (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              {profile.learningReason}
            </Typography.Paragraph>
          )}
        </div>
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
  const navigate = useNavigate()
  const readmeSectionLayout = useSettingsStore((s) => s.readmeSectionLayout)
  const setReadmeSectionLayout = useSettingsStore((s) => s.setReadmeSectionLayout)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<ReadmeView>('en')
  const [analysis, setAnalysis] = useState<ReadmeAnalysisInfo | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [translating, setTranslating] = useState(false)

  // 有中文版（真实或 AI 翻译）时默认展示中文，否则展示原始 README
  const hasZhContent = hasChineseReadme(project)
  useEffect(() => {
    setView(hasZhContent ? 'zh' : 'en')
  }, [hasZhContent])

  // 当前视图内容：中文视图取 真实中文 > AI 翻译；原始视图取 英文 > 主 README
  const content =
    view === 'zh'
      ? (project.readmeZh ?? project.readmeZhAi)
      : (project.readmeEn ?? project.readmeCache ?? project.readmeZh)

  // 按 Markdown 标题分块：每个标题章节一个 Tab；无标题时回退整篇 README
  const readmeSections = useMemo(
    () => (content ? splitReadmeSections(content, t('repository.readmeOverview')) : []),
    [content, t]
  )
  const [activeSection, setActiveSection] = useState<string>()
  useEffect(() => {
    setActiveSection(undefined)
  }, [content])
  const sectionItems = readmeSections.map((s) => ({
    key: s.key,
    label: s.title || t('repository.readme'),
    children: <MarkdownViewer content={s.content} owner={project.owner} repo={project.repo} />
  }))
  const currentSection = sectionItems.some((item) => item.key === activeSection)
    ? activeSection
    : sectionItems[0]?.key

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
    if (translating) return
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
        {/* AI 翻译：无中文版 + 有英文源时提供（专注中文） */}
        {!hasZhContent && hasEnglishReadme(project) && (
          <Tooltip
            title={
              translating ? t('repository.readmeTranslating') : t('repository.readmeTranslateTip')
            }
          >
            <Button
              size="small"
              icon={<TranslationOutlined />}
              loading={translating}
              disabled={translating}
              onClick={() => void startTranslate()}
            >
              {translating
                ? t('repository.readmeTranslating')
                : project.readmeZhAi
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
        <Button
          size="small"
          icon={<ScheduleOutlined />}
          onClick={() => navigate('/ai-center/schedule')}
        >
          {t('repository.scheduleReadme')}
        </Button>
        <Tooltip title={t('repository.readmeTabsTip')}>
          <Dropdown
            menu={{
              selectedKeys: [readmeSectionLayout],
              items: [
                {
                  key: 'single',
                  icon: <MenuOutlined />,
                  label: t('repository.readmeTabsSingle')
                },
                {
                  key: 'wrap',
                  icon: <AppstoreOutlined />,
                  label: t('repository.readmeTabsWrap')
                }
              ],
              onClick: ({ key }) => setReadmeSectionLayout(key as ReadmeSectionLayout)
            }}
          >
            <Button size="small">
              {readmeSectionLayout === 'single' ? <MenuOutlined /> : <AppstoreOutlined />}
              {readmeSectionLayout === 'single'
                ? t('repository.readmeTabsSingle')
                : t('repository.readmeTabsWrap')}
            </Button>
          </Dropdown>
        </Tooltip>
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
          {sectionItems.length > 1 ? (
            <Tabs
              size="small"
              className={`readme-section-tabs${readmeSectionLayout === 'wrap' ? ' readme-tabs-wrap' : ''}`}
              activeKey={currentSection}
              onChange={setActiveSection}
              items={sectionItems}
              tabBarStyle={{ marginBottom: 12 }}
            />
          ) : (
            <MarkdownViewer content={content} owner={project.owner} repo={project.repo} />
          )}
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
                  compactImages
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

/** 历史版本记录：每版本表头「分析」按钮，本地规则优先生成文件说明，AI 兜底补全 SHA-256 / 平台说明 */
function VersionsTab({ project }: { project: ProjectWithTags }): React.JSX.Element {
  const { t } = useTranslation()
  // 类型过滤暂时注释：恢复时取消下面两行
  // const releaseFileTypeFilter = useSettingsStore((s) => s.releaseFileTypeFilter)
  // const setReleaseFileTypeFilter = useSettingsStore((s) => s.setReleaseFileTypeFilter)
  const [analyses, setAnalyses] = useState<ReleaseAnalysisInfo[] | null>(null)
  const [rawReleases, setRawReleases] = useState<ReleaseInfo[]>([])
  // const [fileTypes, setFileTypes] = useState<ReleaseFileTypeInfo[]>([])
  const [analyzingVersion, setAnalyzingVersion] = useState<string | null>(null)

  const load = useCallback((): void => {
    // AI 分析结果 + 原始发布记录（类型过滤暂注释）
    Promise.all([window.api.listReleaseAnalyses(project.id), window.api.getReleases(project.id)])
      .then(([a, r]) => {
        setAnalyses(a)
        setRawReleases(r)
      })
      .catch(() => {
        setAnalyses([])
      })
  }, [project.id])

  useEffect(() => {
    load()
  }, [load])

  // 类型过滤暂注释：恢复时取消下面的过滤键清理 effect
  // useEffect(() => {
  //   if (fileTypes.length === 0) return
  //   const validKeys = releaseFileTypeFilter.filter((key) =>
  //     fileTypes.some((ft) => ft.label === key)
  //   )
  //   if (validKeys.length !== releaseFileTypeFilter.length) {
  //     setReleaseFileTypeFilter(validKeys)
  //   }
  // }, [fileTypes, releaseFileTypeFilter, setReleaseFileTypeFilter])

  /** 只分析指定版本（结果覆盖写入） */
  const analyzeOne = async (version: string, alreadyAnalyzed: boolean): Promise<void> => {
    if (alreadyAnalyzed) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: t('repository.reanalyzeConfirmTitle'),
          content: t('repository.reanalyzeConfirmContent'),
          okText: t('repository.reanalyzeConfirmOk'),
          cancelText: t('common.cancel'),
          onOk: () => resolve(true),
          onCancel: () => resolve(false)
        })
      })
      if (!confirmed) return
    }
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

  // 类型过滤暂时注释：恢复时取消下面的 fileTypeKey
  // const fileTypeKey = (file: {
  //   name: string
  //   note?: string | null
  //   platform?: string | null
  //   kind?: string | null
  // }): string => {
  //   return releaseFileFilterLabel(file)
  // }

  /** 版本卡内的文件列表：已分析用结构化结果，未分析用文件名现场分类 */
  const rowFiles = (row: {
    analysis: ReleaseAnalysisInfo | null
    raw: ReleaseInfo | null
  }): ReleaseFileInfo[] => {
    if (row.analysis) return row.analysis.files
    return (row.raw?.assets ?? []).map((a) => {
      const type = classifyReleaseFile(a.name, null)
      return {
        name: a.name,
        sha256: a.sha256,
        url: a.url,
        note: '',
        platform: type.platform,
        arch: type.arch,
        kind: type.kind
      }
    })
  }

  const visibleFiles = (row: {
    analysis: ReleaseAnalysisInfo | null
    raw: ReleaseInfo | null
  }): ReleaseFileInfo[] => {
    return rowFiles(row)
  }

  // 类型过滤暂时注释：恢复时取消下面的下拉菜单数据与可见版本过滤
  // const typeMenuItems = [
  //   ...fileTypes.map((ft) => ({
  //     key: ft.label,
  //     label: ft.label
  //   })),
  //   ...(fileTypes.length > 0 ? [{ type: 'divider' as const }] : []),
  //   { key: '__clear__', label: t('repository.releaseTypeFilterClear') }
  // ]
  // const visibleVersionRows = versionRows.filter(
  //   (row) => releaseFileTypeFilter.length === 0 || visibleFiles(row).length > 0
  // )

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
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              onClick={() => void copySha(sha)}
            />
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
        versionRows.map((row) => {
          const files = visibleFiles(row)
          return row.analysis ? (
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
                    onClick={() => void analyzeOne(row.version, true)}
                  >
                    {t('repository.analyze')}
                  </Button>
                </Space>
              }
            >
              {row.analysis.descriptionZh || row.analysis.description ? (
                <div>
                  {/* 发布说明为 AI 中文翻译版（原版为其他语言）时标记 */}
                  {row.analysis.descriptionZh &&
                    row.analysis.description !== row.analysis.descriptionZh && (
                      <Tag color="purple" style={{ marginBottom: 4 }}>
                        {t('repository.releaseAiTranslated')}
                      </Tag>
                    )}
                  <div className="markdown-body" style={{ marginBottom: 12 }}>
                    <MarkdownViewer
                      content={(row.analysis.descriptionZh ?? row.analysis.description ?? '').slice(
                        0,
                        4000
                      )}
                      owner={project.owner}
                      repo={project.repo}
                      compactImages
                    />
                  </div>
                </div>
              ) : null}
              <Table<ReleaseFileInfo>
                size="small"
                rowKey="name"
                pagination={false}
                dataSource={files}
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
                  onClick={() => void analyzeOne(row.version, false)}
                >
                  {t('repository.analyze')}
                </Button>
              }
            >
              <Table<ReleaseFileInfo>
                size="small"
                rowKey="name"
                pagination={false}
                dataSource={files}
                columns={fileColumns}
              />
            </Card>
          )
        })
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
