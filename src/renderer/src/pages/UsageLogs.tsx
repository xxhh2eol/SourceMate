import { useCallback, useEffect, useState } from 'react'
import { Button, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { AiUsageLogInfo } from '@shared/types'
import { cleanErrorMessage } from '../utils/error'

const PAGE_SIZE = 20

/** AI 请求明细：单次请求记录列表（默认按开始时间倒序 + 分页），从模型统计页点击模型进入 */
export default function UsageLogs(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // 路由参数 model 为 URL 编码后的模型名（可空 = 全部）
  const rawModel = useParams().model
  const model = rawModel ? decodeURIComponent(rawModel) : null

  const [rows, setRows] = useState<AiUsageLogInfo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const load = useCallback(
    (p: number): void => {
      setLoading(true)
      window.api
        .getAiUsageLogs(model, p, PAGE_SIZE)
        .then((r) => {
          setRows(r.rows)
          setTotal(r.total)
        })
        .catch((err) => {
          message.warning(cleanErrorMessage(err))
        })
        .finally(() => setLoading(false))
    },
    [model]
  )

  useEffect(() => {
    load(page)
  }, [load, page])

  const funcName = (key: string): string => {
    const label = t(`usage.func.${key}`)
    return label === `usage.func.${key}` ? key : label
  }

  const columns: ColumnsType<AiUsageLogInfo> = [
    {
      title: t('usageLogs.colTime'),
      dataIndex: 'startedAt',
      width: 180,
      render: (v: string) => (
        <Typography.Text style={{ fontSize: 12 }}>
          {new Date(v).toLocaleString()}
        </Typography.Text>
      )
    },
    {
      title: t('usageLogs.colModel'),
      dataIndex: 'model',
      width: 180,
      render: (m: string) => <Typography.Text code style={{ fontSize: 12 }}>{m}</Typography.Text>
    },
    {
      title: t('usageLogs.colFunction'),
      dataIndex: 'functionName',
      width: 140,
      render: (f: string) => <Tag>{funcName(f)}</Tag>
    },
    {
      title: t('usageLogs.colTokens'),
      dataIndex: 'tokensUsed',
      width: 110,
      sorter: (a, b) => a.tokensUsed - b.tokensUsed,
      render: (v: number) => <Typography.Text>{v.toLocaleString()}</Typography.Text>
    },
    {
      title: t('usageLogs.colDuration'),
      dataIndex: 'durationMs',
      width: 110,
      sorter: (a, b) => a.durationMs - b.durationMs,
      render: (v: number) => (
        <Typography.Text style={{ fontSize: 12 }}>
          {v >= 60_000 ? `${(v / 60_000).toFixed(1)} min` : `${Math.round(v / 1000)} s`}
        </Typography.Text>
      )
    },
    {
      title: t('usageLogs.colStatus'),
      dataIndex: 'error',
      render: (err: string | null) =>
        err ? (
          <Tooltip title={err}>
            <Typography.Text type="danger" style={{ fontSize: 12 }}>
              {t('usageLogs.failed')}
            </Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="success" style={{ fontSize: 12 }}>
            {t('usageLogs.success')}
          </Typography.Text>
        )
    }
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }} align="center">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/settings/usage')}>
          {t('usageLogs.back')}
        </Button>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t('usageLogs.title')}
        </Typography.Title>
        {model && <Tag color="blue">{model}</Tag>}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('usageLogs.total', { count: total })}
        </Typography.Text>
      </Space>

      <Table<AiUsageLogInfo>
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          showTotal: (n) => t('usageLogs.total', { count: n }),
          onChange: (p) => setPage(p)
        }}
      />
    </div>
  )
}
