import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, KeyRound, PlugZap, RefreshCw, ServerCog, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/api/client';
import type { ProviderSummary } from '@/api/types';
import { Badge, Button, ErrorBlock, Field, Input, LoadingBlock, PageHeader, Panel, SectionHeader, Select, Toggle } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

export function Settings() {
  const query = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.get<{ items: ProviderSummary[] }>('/admin/providers'),
  });

  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="PROVIDER SETTINGS · 外部 API"
        title="接入生成的大脑与画笔。"
        description="支持 OpenAI-compatible 的文案与图生图接口。密钥使用 AES-256-GCM 加密后落库，接口只返回掩码，任何代理或普通用户都无法访问本页。"
        actions={<span className="api-security"><ShieldCheck size={15} /> 仅管理员</span>}
      />
      <div className="notice notice--amber">
        <AlertTriangle size={17} />
        <div><strong>演示生成器不是真实 AI。</strong>默认配置使用本地变体适配器以便验收流程。接入真实生图/文案 API 后，请在上方切换 Provider 并填写密钥；系统会走同一套超时、重试、质量与相似度卡口。</div>
      </div>

      {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorBlock message="API 配置加载失败" retry={() => query.refetch()} /> : (
        <div className="provider-grid">
          {query.data?.items.map((provider) => <ProviderCard key={`${provider.kind}-${provider.updatedAt}`} summary={provider} />)}
        </div>
      )}

      <Panel className="api-notes">
        <SectionHeader title="接口契约" hint="生产环境接入前请核对路径与返回格式" />
        <div className="contract-grid">
          <div>
            <span className="eyebrow">TEXT</span>
            <h3>POST <code>/chat/completions</code></h3>
            <p>Base URL 填写到 <code>/v1</code> 为止。返回 chat completions JSON；系统会解析 JSON 文案并校验三段式、标题与卖点完整性。</p>
          </div>
          <div>
            <span className="eyebrow">IMAGE</span>
            <h3>POST <code>/images/edits</code></h3>
            <p>使用 multipart 上传原图与提示词。图片需返回 <code>data[0].b64_json</code> 或可下载的 <code>url</code>；系统会强制裁切为 3:4 并做质量/相似度校验。</p>
          </div>
          <div>
            <span className="eyebrow">LIMITS</span>
            <h3>超时与重试</h3>
            <p>文案 60s、图片 120s 超时；429/5xx/网络错误最多重试 3 次，退避带抖动。最终失败会记录在任务日志并由队列级重试接管。</p>
          </div>
        </div>
        <div className="inline-note"><AlertTriangle size={14} /> 真实 API 会产生费用。审核通过后才会入队；建议先在测试环境用 10 组跑通。</div>
      </Panel>
    </div>
  );
}

function ProviderCard({ summary }: { summary: ProviderSummary }) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<'mock' | 'openai'>(summary.provider);
  const [baseUrl, setBaseUrl] = useState(summary.baseUrl ?? '');
  const [model, setModel] = useState(summary.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [temperature, setTemperature] = useState(String(summary.options?.temperature ?? 0.92));
  const [maxTokens, setMaxTokens] = useState(String(summary.options?.maxTokens ?? 2200));
  const [jsonMode, setJsonMode] = useState(summary.options?.jsonMode !== false);
  const [size, setSize] = useState(String(summary.options?.size ?? '1024x1536'));
  const [quality, setQuality] = useState(String(summary.options?.quality ?? 'high'));
  const [sendNegativePrompt, setSendNegativePrompt] = useState(summary.options?.sendNegativePrompt === true);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => api.put(`/admin/providers/${summary.kind}`, {
      provider,
      baseUrl: baseUrl || null,
      model: model || null,
      apiKey: apiKey || undefined,
      clearApiKey: clearKey || undefined,
      options: summary.kind === 'TEXT'
        ? { temperature: Number(temperature) || 0.92, maxTokens: Number(maxTokens) || 2200, jsonMode }
        : { size, quality, sendNegativePrompt },
    }),
    onSuccess: async () => {
      setError(null);
      setApiKey('');
      setClearKey(false);
      toast.success(`${summary.kind === 'TEXT' ? '文案' : '图片'} API 配置已保存`);
      await queryClient.invalidateQueries({ queryKey: ['providers'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : '保存失败'),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`/admin/providers/${summary.kind}/test`),
    onSuccess: (data) => {
      setTestResult(data.message);
      toast.success(data.message);
    },
    onError: (err) => {
      setTestResult(null);
      toast.error(err instanceof ApiError ? err.message : '连接测试失败');
    },
  });

  useEffect(() => {
    setTestResult(null);
  }, [provider]);

  return (
    <Panel className="provider-card">
      <div className="provider-card__head">
        <div>
          <div className="provider-card__title">
            <span className="provider-icon">{summary.kind === 'TEXT' ? <RefreshCw size={18} /> : <ServerCog size={18} />}</span>
            <div>
              <h2>{summary.kind === 'TEXT' ? '文案大模型' : '图生图模型'}</h2>
              <p>{summary.kind === 'TEXT' ? '生成标题、三段式正文与标签' : '基于原图生成 3:4 变体，保持餐盘主体'}</p>
            </div>
          </div>
        </div>
        <Badge tone={provider === 'mock' ? 'amber' : 'green'} dot>{provider === 'mock' ? '演示适配器' : '外部 API'}</Badge>
      </div>

      <div className="form-stack">
        <Field label="Provider" required>
          <Select value={provider} onChange={(event) => setProvider(event.target.value as 'mock' | 'openai')}>
            <option value="mock">演示生成器（本地变体，不调用外部 API）</option>
            <option value="openai">OpenAI-compatible</option>
          </Select>
        </Field>

        {provider === 'openai' ? (
          <>
            <Field label="Base URL" required hint={summary.kind === 'TEXT' ? '例：https://api.openai.com/v1' : '例：https://api.openai.com/v1'}>
              <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" />
            </Field>
            <Field label="模型名" required>
              <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder={summary.kind === 'TEXT' ? 'gpt-4.1-mini / deepseek-chat' : 'gpt-image-1 / 兼容图像模型'} />
            </Field>
            <Field label="API 密钥" required={!summary.hasApiKey} hint={summary.hasApiKey ? `已保存：${summary.keyMask}。留空表示不修改。` : '密钥不会回传给前端，只展示掩码'}>
              <div className="input-with-action">
                <Input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={summary.hasApiKey ? '••••••••（留空保持原值）' : 'sk-…'} autoComplete="off" />
                <button type="button" className="input-action" aria-label={showKey ? '隐藏密钥' : '显示密钥'} onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </div>
            </Field>
            {summary.hasApiKey ? (
              <label className="checkbox-line checkbox-line--plain">
                <input type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} />
                <span className="checkbox-box"><CheckCircle2 size={13} /></span>
                <span>清除已保存的密钥</span>
              </label>
            ) : null}
          </>
        ) : (
          <div className="mock-provider-note"><PlugZap size={16} /><div><strong>本地演示适配器</strong><p>{summary.kind === 'TEXT' ? '使用内置的叙事结构、卖点重排与标签组合生成变体，不调用外部模型。' : '使用 Sharp 旋转、裁切、翻面、调色与颗粒模拟变体，保留原图餐盘主体。'}</p></div></div>
        )}

        {summary.kind === 'TEXT' ? (
          <div className="form-grid">
            <Field label="Temperature"><Input value={temperature} onChange={(event) => setTemperature(event.target.value)} /></Field>
            <Field label="Max Tokens"><Input value={maxTokens} onChange={(event) => setMaxTokens(event.target.value)} /></Field>
            <div className="switch-line switch-line--span">
              <div><strong>JSON Mode</strong><span>要求模型返回 JSON 对象；若供应商不支持可关闭</span></div>
              <Toggle checked={jsonMode} onChange={setJsonMode} label="JSON 模式" />
            </div>
          </div>
        ) : (
          <div className="form-grid">
            <Field label="输出尺寸" hint="建议 1024x1536（3:4）"><Input value={size} onChange={(event) => setSize(event.target.value)} /></Field>
            <Field label="质量"><Select value={quality} onChange={(event) => setQuality(event.target.value)}><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></Select></Field>
            <div className="switch-line switch-line--span">
              <div><strong>发送 negative_prompt 字段</strong><span>OpenAI 官方接口不支持该字段；兼容供应商支持时可开启</span></div>
              <Toggle checked={sendNegativePrompt} onChange={setSendNegativePrompt} label="发送负面提示词字段" />
            </div>
          </div>
        )}

        <div className="provider-card__meta">
          <span>最近更新 {formatDateTime(summary.updatedAt)}</span>
          <span><KeyRound size={13} /> 密钥加密存储</span>
        </div>
        {testResult ? <div className="test-result"><CheckCircle2 size={14} /> {testResult}</div> : null}
        {error ? <div className="form-error">{error}</div> : null}
        <div className="provider-card__actions">
          <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}><PlugZap size={15} /> 测试连接</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => {
            setError(null);
            if (provider === 'openai' && (!baseUrl.trim() || !model.trim())) return setError('外部 API 必须填写 Base URL 与模型名');
            save.mutate();
          }}>保存配置</Button>
        </div>
      </div>
    </Panel>
  );
}
