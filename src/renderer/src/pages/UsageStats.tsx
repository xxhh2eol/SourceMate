import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Col, Empty, Row, Segmented, Select, Space, Spin, Statistic, Typography } from 'antd'
import { Column, Pie } from '@ant-design/charts'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatCount } from '../utils/format'

type Dimension = 'year' | 'month' | 'day'

interface UsageStatsData {
  series: Array<{ label: string; tokens: number; requests: number; durationMs: number }>
  seriesByModel: Array<{ label: string; model: string; tokens: number }>
  byModel: Array<{ model: string; tokens: number; requests: number; durationMs: number }>
  byFunction: Array<{ functionName: string; tokens: number; requests: number }>
  summary: { tokens: number; requests: number; durationMs: number }
}

/** 模型统计：AI 使用记录按时间 / 模型 / 功能聚合展示（数据来自 ai_usage_logs） */
export default function UsageStats(): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [dimension, setDimension] = useState<Dimension>('day')
  const [model, setModel] = useState<string | null>(null)
  const [data, setData] = useState<UsageStatsData | null>(null)

  const load = useCallback((): void => {
    window.api
      .getAiUsageStats(dimension, model)
      .then(setData)
      .catch(() =>
        setData({
          series: [],
          seriesByModel: [],
          byModel: [],
          byFunction: [],
          summary: { tokens: 0, requests: 0, durationMs: 0 }
        })
      )
  }, [dimension, model])

  useEffect(() => {
    load()
  }, [load])

  // 图表颜色（与设置主题色一致的色板）
  const colors = useMemo(
    () => ['#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#13c2c2', '#eb2f96', '#fadb14', '#2f54eb'],
    []
  )

  // 直方图数据：时间 × 模型 × token，按模型分色（选中模型筛选时只显示该模型）
  const histData = useMemo(() => {
    const rows = data?.seriesByModel ?? []
    return model ? rows.filter((r) => r.model === model) : rows
  }, [data, model])

  const funcName = (key: string): string => {
    const label = t(`usage.func.${key}`)
    return label === `usage.func.${key}` ? key : label
  }

  if (data === null) return <Spin style={{ display: 'block', margin: '80px auto' }} />

  const totalTokens = data.summary.tokens
  const durationText =
    data.summary.durationMs >= 60_000
      ? `${(data.summary.durationMs / 60_000).toFixed(1)} min`
      : `${Math.round(data.summary.durationMs / 1000)} s`

  const modelOptions = [
    { value: 'all', label: t('usage.allModels') },
    ...data.byModel.map((m) => ({ value: m.model, label: m.model }))
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Segmented
          value={dimension}
          onChange={(v) => setDimension(v as Dimension)}
          options={[
            { value: 'year', label: t('usage.dimensionYear') },
            { value: 'month', label: t('usage.dimensionMonth') },
            { value: 'day', label: t('usage.dimensionDay') }
          ]}
        />
        <Select
          style={{ width: 220 }}
          value={model ?? 'all'}
          onChange={(v) => setModel(v === 'all' ? null : v)}
          options={modelOptions}
        />
      </Space>

      {totalTokens === 0 ? (
        <Empty description={t('usage.empty')} style={{ marginTop: 60 }} />
      ) : (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Card size="small">
                <Statistic title={t('usage.summaryTokens')} value={totalTokens} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title={t('usage.summaryRequests')} value={data.summary.requests} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic title={t('usage.summaryDuration')} value={durationText} />
              </Card>
            </Col>
          </Row>

          <Card size="small" title={t('usage.trend')} style={{ marginBottom: 16 }}>
            {histData.length > 0 ? (
              /* 直方图：时间 × token，按模型分色 */
              <Column
                data={histData}
                xField="label"
                yField="tokens"
                colorField="model"
                height={260}
                color={colors}
                // style.maxWidth（G2 5 interval 样式）：限制柱宽上限，早期数据天数少时柱子不会撑满整图
                style={{ maxWidth: 28 }}
                axis={{
                  y: { title: { text: 'Token', style: { fontSize: 12 } }, label: { style: { fontSize: 11 } } },
                  x: { label: { style: { fontSize: 11 } } }
                }}
                legend={{ color: { position: 'bottom', itemLabelFill: 'rgba(0,0,0,0.65)' } }}
                label={false}
              />
            ) : (
              <Typography.Text type="secondary">{t('usage.empty')}</Typography.Text>
            )}
          </Card>

          <Row gutter={[16, 16]}>
            <Col span={12}>
              <Card size="small" title={t('usage.byModel')}>
                {data.byModel.length > 0 ? (
                  <Pie
                    data={data.byModel}
                    angleField="tokens"
                    colorField="model"
                    height={260}
                    radius={0.85}
                    color={colors}
                    legend={{ color: { position: 'bottom', itemLabelFill: 'rgba(0,0,0,0.65)' } }}
                  />
                ) : (
                  <Typography.Text type="secondary">{t('usage.empty')}</Typography.Text>
                )}
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small" title={t('usage.byFunction')}>
                {data.byFunction.length > 0 ? (
                  <Pie
                    data={data.byFunction.map((f) => ({ ...f, label: funcName(f.functionName) }))}
                    angleField="tokens"
                    colorField="label"
                    height={260}
                    radius={0.85}
                    color={colors}
                    legend={{ color: { position: 'bottom', itemLabelFill: 'rgba(0,0,0,0.65)' } }}
                  />
                ) : (
                  <Typography.Text type="secondary">{t('usage.empty')}</Typography.Text>
                )}
              </Card>
            </Col>
          </Row>

          {/* 明细：按模型列出请求数 / token / 耗时；点击模型跳转请求明细页 */}
          <Card size="small" title={t('usage.modelDetail')} style={{ marginTop: 16 }}>
            {data.byModel.map((m) => (
              <div
                key={m.model}
                role="button"
                onClick={() => navigate(`/usage-logs/${encodeURIComponent(m.model)}`)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid rgba(5,5,5,0.06)',
                  cursor: 'pointer'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.03)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Typography.Text strong>{m.model}</Typography.Text>
                <Space size={24}>
                  {/* 请求左对齐，token / 耗时右对齐，避免长度不同上下错开 */}
                  <span style={{ display: 'inline-block', width: 110, textAlign: 'left' }}>
                    {t('usage.detailRequests', { count: formatCount(m.requests) })}
                  </span>
                  <span style={{ display: 'inline-block', width: 140, textAlign: 'right' }}>
                    {t('usage.detailTokens', { count: formatCount(m.tokens) })}
                  </span>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 90,
                      textAlign: 'right',
                      color: 'rgba(0,0,0,0.45)'
                    }}
                  >
                    {m.durationMs >= 60_000
                      ? `${(m.durationMs / 60_000).toFixed(1)} min`
                      : `${Math.round(m.durationMs / 1000)} s`}
                  </span>
                </Space>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}
