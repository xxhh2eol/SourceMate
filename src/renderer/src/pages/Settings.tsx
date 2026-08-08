import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  ColorPicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message
} from 'antd'
import type { TableProps } from 'antd'
import {
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  RobotOutlined,
  HistoryOutlined,
  PlusOutlined,
  StarOutlined,
  UserOutlined
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ModelProfileView } from '../../../preload'
import type {
  GithubAccountView,
  GithubTokenStatus,
  StarredImportProgress
} from '../../../shared/types'
import UsageStats from './UsageStats'
import FontPicker from '../components/FontPicker'
import ResizableTable from '../components/ResizableTable'
import { useProjectStore } from '../stores/projectStore'
import {
  PRESET_COLORS,
  useSettingsStore,
  // 语言切换已隐藏（专注中文），恢复时取消注释
  // type AppLanguage,
  type ThemeMode
} from '../stores/settingsStore'
// import { SUPPORTED_LANGUAGES } from '../i18n' // 语言切换已隐藏（专注中文）
import { cleanErrorMessage } from '../utils/error'

const MENU = [
  { key: 'general', label: 'general' },
  { key: 'model', label: 'model' },
  { key: 'usage', label: 'usage' },
  { key: 'credentials', label: 'credentials' },
  { key: 'network', label: 'network' },
  { key: 'data', label: 'data' }
]

interface ModelFormValues {
  baseUrl: string
  apiKey: string
  model: string
  alias: string
  remark: string
}

/** 设置页（设计文档 §8）：General（主题/语言/颜色）/ Model / Credentials / Network / Data */
export default function Settings(): React.JSX.Element {
  const { tab = 'general' } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const themeMode = useSettingsStore((s) => s.themeMode)
  const setThemeMode = useSettingsStore((s) => s.setThemeMode)

  return (
    <Layout style={{ height: '100%' }}>
      <Layout.Sider
        theme="light"
        width={220}
        style={{ borderRight: '1px solid rgba(0, 0, 0, 0.06)', overflow: 'auto' }}
      >
        <Menu
          mode="inline"
          selectedKeys={[tab]}
          onClick={({ key }) => navigate(`/settings/${key}`)}
          items={MENU.map((m) => ({ key: m.key, label: t(`settings.${m.label}`) }))}
        />
      </Layout.Sider>
      <Layout.Content style={{ minWidth: 0, overflow: 'auto' }}>
        <div className="page-container">
          {/* 直接展示各设置模块内容，不显示「设置 / 应用设置」标题 */}
          {tab === 'general' && <GeneralPanel themeMode={themeMode} setThemeMode={setThemeMode} />}
          {tab === 'model' && <ModelPanel />}
          {tab === 'usage' && <UsageStats />}
          {tab === 'credentials' && <CredentialsPanel />}
          {tab === 'network' && <NetworkPanel />}
          {tab === 'data' && <DataPanel />}
        </div>
      </Layout.Content>
    </Layout>
  )
}

/** General：语言 / 主题模式 / 主题颜色（即时生效） */
function GeneralPanel({
  themeMode,
  setThemeMode
}: {
  themeMode: ThemeMode
  setThemeMode: (m: ThemeMode) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  // 语言切换已隐藏（专注中文），恢复时取消注释
  // const language = useSettingsStore((s) => s.language)
  // const setLanguage = useSettingsStore((s) => s.setLanguage)
  const primaryColor = useSettingsStore((s) => s.primaryColor)
  const setPrimaryColor = useSettingsStore((s) => s.setPrimaryColor)
  const uiFontFamily = useSettingsStore((s) => s.uiFontFamily)
  const setUiFontFamily = useSettingsStore((s) => s.setUiFontFamily)
  const markdownFontFamily = useSettingsStore((s) => s.markdownFontFamily)
  const setMarkdownFontFamily = useSettingsStore((s) => s.setMarkdownFontFamily)

  return (
    <Card title={t('settings.general')} style={{ maxWidth: 560 }}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* 语言切换已隐藏（专注中文），恢复时取消注释
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ width: 80 }}>{t('settings.language')}</span>
          <Select<AppLanguage>
            style={{ width: 200 }}
            value={language}
            onChange={setLanguage}
            options={SUPPORTED_LANGUAGES.map((l) => ({ value: l.value, label: l.label }))}
          />
        </div>
        */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ width: 80 }}>{t('settings.themeMode')}</span>
          <Radio.Group
            value={themeMode}
            onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
            optionType="button"
            options={[
              { label: t('settings.themeLight'), value: 'light' },
              { label: t('settings.themeDark'), value: 'dark' },
              { label: t('settings.themeSystem'), value: 'system' }
            ]}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ width: 80 }}>{t('settings.primaryColor')}</span>
          <Space size={8} wrap>
            {PRESET_COLORS.map((color) => (
              <span
                key={color}
                onClick={() => setPrimaryColor(color)}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: color,
                  cursor: 'pointer',
                  border: primaryColor === color ? '2px solid #000' : '2px solid transparent',
                  boxShadow: primaryColor === color ? '0 0 0 2px #fff inset' : 'none'
                }}
              />
            ))}
            <ColorPicker
              value={primaryColor}
              onChange={(c) => setPrimaryColor(c.toHexString())}
              showText
            />
          </Space>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ width: 100 }}>{t('settings.uiFont')}</span>
          <FontPicker value={uiFontFamily} onChange={setUiFontFamily} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ width: 100 }}>{t('settings.markdownFont')}</span>
          <FontPicker value={markdownFontFamily} onChange={setMarkdownFontFamily} />
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('settings.fontTip')}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('settings.generalTip')}
        </Typography.Text>
      </Space>
    </Card>
  )
}

/** 模型配置（M5+）：左侧新增/编辑表单 + 右侧已配置模型卡片瀑布流（开关/删除/设默认） */
/** 模型配置（M5+）：全卡片瀑布流 —— 首卡「添加」大加号，配置卡片展示别名/模型/备注（开关/默认/编辑/删除） */
function ModelPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const [form] = Form.useForm<ModelFormValues>()
  const [models, setModels] = useState<ModelProfileView[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  // AI 分析并发数（settings ai.concurrency，队列每轮读取即时生效）
  const [concurrency, setConcurrency] = useState(3)

  const loadModels = useCallback(async (): Promise<void> => {
    setModels(await window.api.listModels())
  }, [])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  useEffect(() => {
    void window.api.getSetting<number>('ai.concurrency', 3).then((v) => setConcurrency(Number(v) || 3))
  }, [])

  const openAdd = (): void => {
    form.resetFields()
    setEditingId(null)
    setModalOpen(true)
  }

  const openEdit = (m: ModelProfileView): void => {
    form.setFieldsValue({
      baseUrl: m.baseUrl,
      model: m.model,
      alias: m.alias,
      remark: m.remark,
      apiKey: ''
    })
    setEditingId(m.id)
    setModalOpen(true)
  }

  const test = async (): Promise<void> => {
    const values = await form.validateFields()
    setTesting(true)
    try {
      const r = await window.api.testAi({
        provider: 'custom',
        baseUrl: values.baseUrl,
        apiKey: values.apiKey,
        model: values.model
      })
      if (r.ok) message.success(r.message)
      else message.error(r.message)
    } finally {
      setTesting(false)
    }
  }

  const save = async (): Promise<void> => {
    let values: ModelFormValues
    try {
      values = await form.validateFields()
    } catch {
      return // 校验失败，antd 已提示
    }
    setSaving(true)
    try {
      const list = await window.api.saveModel({
        id: editingId ?? undefined,
        provider: 'custom',
        baseUrl: values.baseUrl,
        apiKey: values.apiKey,
        model: values.model,
        alias: values.alias,
        remark: values.remark
      })
      setModels(list)
      setModalOpen(false)
      message.success(t('settings.modelSaved'))
    } catch (err) {
      message.error(cleanErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    setModels(await window.api.deleteModel(id))
    message.success(t('settings.modelDeleted'))
  }

  const toggle = async (id: string, enabled: boolean): Promise<void> => {
    setModels(await window.api.toggleModel(id, enabled))
  }

  const setDefault = async (id: string): Promise<void> => {
    setModels(await window.api.setDefaultModel(id))
  }

  return (
    <>
      {/* AI 分析并发数（批量分析同时进行的项目数，过大易触发 API 限流） */}
      <Card size="small" style={{ marginBottom: 16, maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ width: 100 }}>{t('settings.concurrency')}</span>
          <InputNumber
            min={1}
            max={10}
            value={concurrency}
            onChange={(v) => {
              const n = Math.min(10, Math.max(1, v ?? 3))
              setConcurrency(n)
              void window.api.setSetting('ai.concurrency', n)
            }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('settings.concurrencyTip')}
          </Typography.Text>
        </div>
      </Card>
      {/* CSS Grid 等宽自适应（替代 Masonry，避免异步 items 更新时卡片重叠） */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 16
        }}
      >
        {/* 首卡：添加（大加号 → 打开配置弹窗） */}
        <Card
          hoverable
          onClick={openAdd}
          style={{
            borderStyle: 'dashed',
            minHeight: 130,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          styles={{
            body: { display: 'flex', alignItems: 'center', justifyContent: 'center' }
          }}
        >
          <Space direction="vertical" align="center" size={8}>
            <PlusOutlined style={{ fontSize: 32, color: 'rgba(0, 0, 0, 0.35)' }} />
            <Typography.Text type="secondary">{t('settings.modelAdd')}</Typography.Text>
          </Space>
        </Card>
        {models.map((m) => (
          <ModelCard
            key={m.id}
            model={m}
            onEdit={() => openEdit(m)}
            onToggle={(v) => void toggle(m.id, v)}
            onDelete={() => void remove(m.id)}
            onSetDefault={() => void setDefault(m.id)}
          />
        ))}
      </div>

      {/* 添加/编辑弹窗：接口地址 / API Key / 模型名称 / 别名 / 个人备注 */}
      <Modal
        title={editingId ? t('settings.modelEdit') : t('settings.modelNew')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        width={480}
      >
        <Form<ModelFormValues> form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="baseUrl"
            label={t('settings.baseUrl')}
            rules={[{ required: true, message: t('settings.requireUrl') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label={t('settings.apiKey')}
            rules={editingId ? [] : [{ required: true, message: t('settings.requireApiKey') }]}
            extra={editingId ? t('settings.apiKeyKeepTip') : undefined}
          >
            <Input.Password placeholder="sk-..." autoComplete="off" />
          </Form.Item>
          <Form.Item name="model" label={t('settings.modelName')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="alias" label={t('settings.modelAlias')}>
            <Input placeholder={t('settings.modelAliasPlaceholder')} maxLength={30} />
          </Form.Item>
          <Form.Item name="remark" label={t('settings.modelRemark')}>
            <Input.TextArea
              placeholder={t('settings.modelRemarkPlaceholder')}
              rows={2}
              maxLength={200}
              showCount
            />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={t('settings.apiKeyTip')}
          />
          <Space>
            <Button onClick={() => void test()} loading={testing}>
              {t('settings.testConnection')}
            </Button>
            <Button type="primary" onClick={() => void save()} loading={saving}>
              {t('common.save')}
            </Button>
          </Space>
        </Form>
      </Modal>
    </>
  )
}

/** hex 颜色转 rgba（主题色光圈用） */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** 已配置模型卡片（官方示例样式）：Meta 头像/别名/描述 + 底部操作（启用 / 默认 / 编辑 / 删除） */
function ModelCard({
  model,
  onEdit,
  onToggle,
  onDelete,
  onSetDefault
}: {
  model: ModelProfileView
  onEdit: () => void
  onToggle: (enabled: boolean) => void
  onDelete: () => void
  onSetDefault: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const primaryColor = useSettingsStore((s) => s.primaryColor)
  const title = model.alias || model.model
  const actions: React.ReactNode[] = [
    // 启用 / 禁用
    <Tooltip key="enable" title={t('settings.modelEnabledTip')}>
      <div className="model-action">
        <Switch
          size="small"
          checked={model.enabled}
          onChange={(v) => onToggle(v)}
          onClick={(_checked, e) => e.stopPropagation()}
        />
        <span>{model.enabled ? t('settings.modelEnable') : t('settings.modelDisable')}</span>
      </div>
    </Tooltip>,
    // 设为默认
    <Tooltip key="default" title={t('settings.modelSetDefault')}>
      <div className="model-action">
        <Switch
          size="small"
          checked={model.isDefault}
          disabled={model.isDefault}
          onChange={(v) => {
            if (v) onSetDefault()
          }}
          onClick={(_checked, e) => e.stopPropagation()}
        />
        <span>{t('settings.modelDefault')}</span>
      </div>
    </Tooltip>,
    // 编辑
    <Tooltip key="edit" title={t('settings.modelEdit')}>
      <div className="model-action">
        <EditOutlined
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
        />
        <span>{t('settings.modelEditTip')}</span>
      </div>
    </Tooltip>,
    // 删除
    <Tooltip key="delete" title={t('common.delete')}>
      <div className="model-action">
        <DeleteOutlined
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        />
        <span>{t('common.delete')}</span>
      </div>
    </Tooltip>
  ]
  return (
    <Card
      size="small"
      hoverable
      onClick={onEdit}
      actions={actions}
      style={{
        minWidth: 280,
        // 默认模型：主题色光圈（跟随设置里的主题颜色）
        ...(model.isDefault
          ? {
              borderColor: primaryColor,
              boxShadow: `0 0 0 1.5px ${hexToRgba(primaryColor, 0.45)}, 0 0 16px ${hexToRgba(primaryColor, 0.35)}`
            }
          : {})
      }}
    >
      <Card.Meta
        avatar={
          <Avatar
            icon={<RobotOutlined />}
            style={{
              background: model.isDefault ? primaryColor : hexToRgba(primaryColor, 0.15),
              color: model.isDefault ? '#fff' : primaryColor
            }}
          />
        }
        title={
          <Space size={6}>
            <Typography.Text strong style={{ fontSize: 13 }}>
              {title}
            </Typography.Text>
            {model.isDefault && (
              <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 0 }}>
                {t('settings.modelDefault')}
              </Tag>
            )}
            {!model.enabled && (
              <Tag style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 0 }}>
                {t('settings.modelDisabled')}
              </Tag>
            )}
          </Space>
        }
        description={
          <>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {model.model} ·{' '}
              {model.hasKey ? t('settings.modelKeyConfigured') : t('settings.modelKeyMissing')}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              {model.baseUrl}
            </Typography.Text>
            {model.remark && (
              <Typography.Paragraph
                type="secondary"
                ellipsis={{ rows: 2 }}
                style={{ fontSize: 12, margin: '4px 0 0' }}
              >
                {model.remark}
              </Typography.Paragraph>
            )}
          </>
        }
      />
    </Card>
  )
}

/** GitHub 账号管理（M6 多 token）：账号表格（头像/状态/添加时间）+ 添加/编辑/删除 + 勾选账号拉取 Star */
function CredentialsPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const [accounts, setAccounts] = useState<GithubAccountView[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<GithubAccountView | null>(null)
  const [alias, setAlias] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<StarredImportProgress | null>(null)

  const formatTime = (iso: string): string => new Date(iso).toLocaleString()

  const statusMeta = (s: GithubTokenStatus): { color: string; label: string } => {
    switch (s) {
      case 'ok':
        return { color: 'success', label: t('settings.statusOk') }
      case 'expired':
        return { color: 'error', label: t('settings.statusExpired') }
      case 'invalid':
        return { color: 'default', label: t('settings.statusInvalid') }
      case 'permission':
        return { color: 'warning', label: t('settings.statusPermission') }
      default:
        return { color: 'default', label: t('settings.statusUnknown') }
    }
  }

  const loadAccounts = useCallback(async (): Promise<void> => {
    const list = await window.api.listAccounts()
    setAccounts(list)
    setSelectedIds((ids) => ids.filter((id) => list.some((a) => a.id === id)))
  }, [])

  // 打开页面：加载账号（含旧单 token 惰性迁移）→ 后台批量验证状态并补齐账号信息
  useEffect(() => {
    void (async () => {
      await loadAccounts()
      setAccounts(await window.api.verifyAccounts())
    })()
  }, [loadAccounts])

  const openAdd = (): void => {
    setEditing(null)
    setAlias('')
    setToken('')
    setModalOpen(true)
  }

  const openEdit = (a: GithubAccountView): void => {
    setEditing(a)
    setAlias(a.alias)
    setToken('')
    setModalOpen(true)
  }

  const saveAccount = async (): Promise<void> => {
    if (!editing && !token.trim()) {
      message.warning(t('settings.requireToken'))
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const updated = await window.api.updateAccount({
          id: editing.id,
          alias,
          token: token.trim() || undefined
        })
        if (updated) setAccounts((list) => list.map((a) => (a.id === updated.id ? updated : a)))
        message.success(t('settings.accountUpdated'))
      } else {
        const created = await window.api.addAccount({ alias, token: token.trim() })
        setAccounts((list) => [...list, created])
        // 新账号默认勾选，方便直接拉取
        setSelectedIds((ids) => [...ids, created.id])
        message.success(t('settings.accountAdded', { login: created.login }))
      }
      setModalOpen(false)
    } catch (err) {
      message.error(cleanErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const removeAccount = async (id: number): Promise<void> => {
    await window.api.deleteAccount(id)
    setAccounts((list) => list.filter((a) => a.id !== id))
    setSelectedIds((ids) => ids.filter((x) => x !== id))
    message.success(t('settings.accountDeleted'))
  }

  /** 拉取所选账号 star 项目：逐账号两步（拉取中 → 处理中），订阅进度事件实时展示 */
  const importStarred = async (): Promise<void> => {
    setImporting(true)
    setProgress(null)
    const unsubscribe = window.api.onStarredImportProgress(setProgress)
    try {
      const r = await window.api.importStarred(selectedIds)
      const total = r.accounts.reduce((s, a) => s + a.total, 0)
      const added = r.accounts.reduce((s, a) => s + a.added, 0)
      const duplicates = r.accounts.reduce((s, a) => s + a.duplicates, 0)
      const failed = r.accounts.reduce((s, a) => s + a.readmeFailed, 0)
      if (total === 0) {
        message.info(t('settings.starredEmpty'))
      } else {
        message.success(t('settings.starredDone', { added, duplicates, failed }))
      }
      await useProjectStore.getState().load()
    } catch (err) {
      message.error(cleanErrorMessage(err))
    } finally {
      unsubscribe()
      setImporting(false)
      // 清空进度区：完成/失败后不再残留「拉取中/处理中」展示
      setProgress(null)
    }
  }

  const columns: NonNullable<TableProps<GithubAccountView>['columns']> = [
    {
      title: t('settings.colAccount'),
      key: 'account',
      width: 300,
      render: (_, a) => (
        <Space size={8}>
          <Avatar size={32} src={a.avatarUrl ?? undefined} icon={<UserOutlined />} />
          <div>
            <div>{a.alias}</div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              @{a.login || '…'}
            </Typography.Text>
          </div>
        </Space>
      )
    },
    {
      title: t('settings.colStatus'),
      key: 'status',
      width: 150,
      render: (_, a) => <Tag color={statusMeta(a.tokenStatus).color}>{statusMeta(a.tokenStatus).label}</Tag>
    },
    {
      title: t('settings.colAddedAt'),
      dataIndex: 'createdAt',
      key: 'addedAt',
      width: 190,
      render: (v: string) => formatTime(v)
    },
    {
      title: t('settings.colActions'),
      key: 'actions',
      width: 96,
      render: (_, a) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(a)} />
          <Popconfirm
            title={t('settings.accountDeleteConfirm')}
            okText={t('common.ok')}
            cancelText={t('common.cancel')}
            onConfirm={() => void removeAccount(a.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    // 账号表格需要横向空间,不设最大宽度,随窗口自适应
    <Card title={t('settings.credentials')}>
      <Alert
        type={accounts.length ? 'info' : 'warning'}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          accounts.length
            ? t('settings.credConfigured', { count: accounts.length })
            : t('settings.credNotConfigured')
        }
      />
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
          {t('settings.accountAdd')}
        </Button>
      </Space>
      <ResizableTable<GithubAccountView>
        dataSource={accounts}
        rowKey="id"
        columns={columns}
        pagination={false}
        size="small"
        locale={{ emptyText: t('settings.accountEmpty') }}
      />
      <Divider style={{ margin: '16px 0 12px' }} />
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('settings.starredImportTip')}
        </Typography.Text>
        <Checkbox.Group
          value={selectedIds}
          onChange={(v) => setSelectedIds(v as number[])}
          options={accounts.map((a) => ({
            label: `${a.alias}（@${a.login || '…'}）`,
            value: a.id
          }))}
        />
        <Space size={8}>
          {/* 未配置/未勾选账号：按钮置灰 + 悬停提示（antd 禁用按钮不响应事件，需 span 包裹才能显示 Tooltip） */}
          <Tooltip
            title={
              accounts.length === 0
                ? t('settings.starredImportNoToken')
                : selectedIds.length === 0
                  ? t('settings.starredSelectAccount')
                  : undefined
            }
          >
            <span>
              <Button
                icon={<StarOutlined />}
                disabled={accounts.length === 0 || selectedIds.length === 0 || importing}
                loading={importing}
                onClick={() => void importStarred()}
              >
                {t('settings.starredImport')}
              </Button>
            </span>
          </Tooltip>
        </Space>
        {progress?.phase === 'listing' && (
          <Space size={8}>
            <Spin size="small" />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('settings.starredListing', {
                account: progress.account,
                fetched: progress.fetched,
                added: progress.added,
                duplicates: progress.duplicates
              })}
            </Typography.Text>
          </Space>
        )}
        {progress?.phase === 'readme' && (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Progress
              percent={progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}
              size="small"
              status={progress.failed > 0 && progress.done === progress.total ? 'exception' : 'active'}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('settings.starredProcessing', {
                account: progress.account,
                done: progress.done,
                total: progress.total,
                failed: progress.failed
              })}
            </Typography.Text>
          </Space>
        )}
      </Space>
      <Typography.Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
        {t('settings.tokenTip')}
      </Typography.Paragraph>
      <Modal
        title={editing ? t('settings.accountEdit') : t('settings.accountAdd')}
        open={modalOpen}
        onOk={() => void saveAccount()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        okText={t('common.save')}
        cancelText={t('common.cancel')}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 8 }}>
          <div>
            <Typography.Text>{t('settings.accountAlias')}</Typography.Text>
            <Input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder={t('settings.accountAliasPlaceholder')}
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <Typography.Text>{t('settings.accountToken')}</Typography.Text>
            <Input.Password
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={editing ? t('settings.accountTokenKeepTip') : t('settings.tokenPlaceholder')}
              autoComplete="off"
              style={{ marginTop: 4 }}
            />
          </div>
        </Space>
      </Modal>
    </Card>
  )
}

/** 网络代理（设计文档 §5.3）：HTTP / SOCKS5，双目标连通测试 */
function NetworkPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const [proxy, setProxy] = useState<{
    enabled: boolean
    protocol: 'http' | 'socks5'
    host: string
    port: number
  }>({ enabled: false, protocol: 'http', host: '', port: 0 })
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{
    name: string
    level: 'success' | 'warning' | 'error'
    message: string
  } | null>(null)

  useEffect(() => {
    window.api.getProxy().then(setProxy)
  }, [])

  /** 表单校验：启用代理时必须填写地址和端口（测试/保存前统一拦截） */
  const validate = (): string | null => {
    if (!proxy.enabled) return null
    if (!proxy.host.trim()) return t('settings.proxyHostRequired')
    if (!proxy.port) return t('settings.proxyPortRequired')
    return null
  }

  const save = async (): Promise<void> => {
    const invalid = validate()
    if (invalid) {
      message.warning(invalid)
      return
    }
    setSaving(true)
    try {
      const r = await window.api.saveProxy({ ...proxy, host: proxy.host.trim() })
      if (r.ok) message.success(t('settings.proxySaved'))
      else message.error(r.error ?? t('common.failed'))
    } catch (err) {
      message.error(cleanErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const test = async (): Promise<void> => {
    const invalid = validate()
    if (invalid) {
      message.warning(invalid)
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      // 只测 GitHub 连通性（AI 连通性在模型配置页单独测试）
      const github = await window.api.testConnection({
        ...proxy,
        host: proxy.host.trim()
      })
      setTestResult({ name: t('settings.testGithubApi'), ...github })
    } catch (err) {
      message.error(cleanErrorMessage(err))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card title={t('settings.networkTitle')} style={{ maxWidth: 560 }}>
      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 80 }}>{t('settings.enableProxy')}</span>
          <Switch checked={proxy.enabled} onChange={(enabled) => setProxy({ ...proxy, enabled })} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {proxy.enabled && proxy.host && proxy.port
              ? `${proxy.protocol}://${proxy.host}:${proxy.port}`
              : t('common.none')}
          </Typography.Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 80 }}>{t('settings.protocol')}</span>
          <Select
            style={{ width: 120 }}
            value={proxy.protocol}
            disabled={!proxy.enabled}
            onChange={(protocol) =>
              setProxy({ ...proxy, protocol: protocol as 'http' | 'socks5' })
            }
            options={[
              { value: 'http', label: t('settings.proxyHttp') },
              { value: 'socks5', label: t('settings.proxySocks5') }
            ]}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 80 }}>{t('settings.host')}</span>
          <Input
            style={{ width: 200 }}
            placeholder={t('settings.proxyHostPlaceholder')}
            disabled={!proxy.enabled}
            value={proxy.host}
            onChange={(e) => setProxy({ ...proxy, host: e.target.value })}
          />
          <span>{t('settings.port')}</span>
          <InputNumber
            style={{ width: 100 }}
            placeholder={t('settings.proxyPortPlaceholder')}
            disabled={!proxy.enabled}
            value={proxy.port || undefined}
            min={1}
            max={65535}
            onChange={(port) => setProxy({ ...proxy, port: port ?? 0 })}
          />
        </div>
        <Space>
          <Button type="primary" onClick={() => void save()} loading={saving}>
            {t('settings.saveAndApply')}
          </Button>
          <Button onClick={() => void test()} loading={testing}>
            {t('settings.networkTest')}
          </Button>
        </Space>
        {testResult && (
          <Alert
            type={testResult.level}
            showIcon
            message={`${testResult.name}: ${testResult.message}`}
          />
        )}
      </Space>
    </Card>
  )
}

/** 数据管理（设计文档 §5.4）：备份 / 恢复（JSON 导入导出已移除，统一走 SQLite 备份） */
function DataPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<string | null>(null)

  /** 打开自动备份目录（系统文件管理器） */
  const openBackups = async (): Promise<void> => {
    const r = await window.api.openBackupsDir()
    if (!r.ok) message.error(r.error ?? t('common.failed'))
  }

  const run = async (
    action: string,
    fn: () => Promise<{ ok: boolean; error?: string; message?: string }>
  ): Promise<void> => {
    setBusy(action)
    try {
      const r = await fn()
      if (r.ok) message.success(r.message ?? t('common.ok'))
      else if ('canceled' in r && (r as { canceled?: boolean }).canceled) return
      else message.error(r.error ?? t('common.failed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title={t('settings.dataTitle')} style={{ maxWidth: 560 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          <span>
            {t('settings.autoBackupTip')}
            {/* 点击「用户数据目录」/「打开路径」在系统文件管理器中打开备份目录 */}
            <Typography.Link onClick={() => void openBackups()}>
              {t('settings.userDataDir')}
            </Typography.Link>
            {t('settings.autoBackupTipTail')}
            <Button
              type="link"
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={() => void openBackups()}
            >
              {t('settings.openBackupsDir')}
            </Button>
          </span>
        }
      />
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        <Button
          icon={<DatabaseOutlined />}
          loading={busy === 'backup'}
          onClick={() => void run('backup', window.api.backupData)}
        >
          {t('settings.backup')}
        </Button>
        <Button
          icon={<HistoryOutlined />}
          loading={busy === 'restore'}
          onClick={() => void run('restore', window.api.restoreData)}
        >
          {t('settings.restore')}
        </Button>
      </Space>
    </Card>
  )
}
