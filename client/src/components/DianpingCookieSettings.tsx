import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cookie, Link2, ShieldCheck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/api/client';
import { Badge, Button, ErrorBlock, Field, Input, LoadingBlock, Panel, Textarea } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import './DianpingCookieSettings.css';

interface CookieSummary {
  configured: boolean;
  cookieCount: number;
  usableCookieCount: number;
  expiresAt: string | null;
  updatedAt: string | null;
  lastCheckedAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckMessage: string | null;
}

const endpoint = '/admin/dianping-cookie';
const queryKey = ['admin-dianping-cookie'];
const maxBytes = 512 * 1024;
const errorMessage = (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback;

function validateJson(text: string) {
  if (new Blob([text]).size > maxBytes) throw new Error('JSON 文件不能超过 512 KB');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('JSON 格式不正确，请重新导出 Cookie JSON'); }
  const cookies = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && 'cookies' in parsed ? parsed.cookies : null;
  if (!Array.isArray(cookies) || !cookies.length) throw new Error('请提供非空 Cookie 数组，或包含 cookies 数组的 JSON 对象');
}

export function DianpingCookieSettings() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [cookieJson, setCookieJson] = useState('');
  const [fileName, setFileName] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [reading, setReading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testLink, setTestLink] = useState('');
  const [testFeedback, setTestFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const query = useQuery({ queryKey, queryFn: () => api.get<CookieSummary>(endpoint) });

  function resetImport() {
    setCookieJson('');
    setFileName('');
    setShowPaste(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  const save = useMutation({
    mutationFn: () => api.put<CookieSummary>(endpoint, { cookieJson }),
    onSuccess: (summary) => {
      queryClient.setQueryData(queryKey, summary);
      resetImport();
      setError(null);
      setTestFeedback(null);
      setConfirmClear(false);
      toast.success('Cookie 已保存到数据库，请用笔记链接测试解析');
    },
    onError: (err) => setError(errorMessage(err, 'Cookie 保存失败，请稍后重试')),
  });
  const clear = useMutation({
    mutationFn: () => api.delete<CookieSummary>(endpoint),
    onSuccess: (summary) => {
      queryClient.setQueryData(queryKey, summary);
      resetImport();
      setConfirmClear(false);
      setTestFeedback(null);
      setError(null);
      toast.success('已清除保存的 Cookie');
    },
    onError: (err) => setError(errorMessage(err, 'Cookie 清除失败，请稍后重试')),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: true; title: string; message: string }>(`${endpoint}/test`, { text: testLink.trim() }),
    onSuccess: (result) => setTestFeedback({ ok: true, message: `${result.message}${result.title ? `：${result.title}` : ''}` }),
    onError: (err) => setTestFeedback({ ok: false, message: errorMessage(err, '解析测试失败，请检查链接或更新 Cookie 后重试') }),
    onSettled: () => { void queryClient.invalidateQueries({ queryKey }); },
  });
  const busy = save.isPending || clear.isPending || test.isPending || reading;

  async function selectFile(file: File | undefined) {
    setError(null);
    setCookieJson('');
    setFileName('');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json') || file.size > maxBytes) {
      setError(file.size > maxBytes ? 'JSON 文件不能超过 512 KB' : '请选择 .json 格式的 Cookie 文件');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      validateJson(text);
      setCookieJson(text);
      setFileName(file.name);
      setShowPaste(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '文件读取失败，请重新选择');
      if (fileInput.current) fileInput.current.value = '';
    } finally { setReading(false); }
  }

  function saveCookie() {
    setError(null);
    try { validateJson(cookieJson); } catch (err) {
      setError(err instanceof Error ? err.message : '请先选择或粘贴 Cookie JSON');
      return;
    }
    save.mutate();
  }

  const summary = query.data;
  return (
    <Panel className="provider-card dianping-cookie">
      <div className="provider-card__head">
        <div className="provider-card__title">
          <span className="provider-icon"><Cookie size={18} /></span>
          <div><h2>大众点评 Cookie 维护</h2><p>管理员统一导入，所有用户共享服务端解析能力</p></div>
        </div>
        {summary ? <Badge tone={summary.configured ? 'amber' : 'muted'} dot>{summary.configured ? '已导入' : '未配置'}</Badge> : null}
      </div>
      <p className="dianping-cookie__guide">在浏览器登录大众点评后，导出大众点评站点的 Cookie JSON。支持数组或 <code>{'{ cookies: [...] }'}</code>；过期后重新导入即可替换。普通用户无需录入 Cookie，直接在素材页粘贴笔记链接。</p>
      {query.isLoading ? <LoadingBlock label="正在读取 Cookie 配置…" /> : query.isError ? (
        <ErrorBlock message="Cookie 配置加载失败，请重试" retry={() => query.refetch()} />
      ) : summary ? (
        <div className="form-stack">
          <div className="dianping-cookie__summary">
            <div><span>已保存 Cookie</span><strong>{summary.cookieCount} 条</strong></div>
            <div><span>按有效期可用</span><strong>{summary.usableCookieCount} 条</strong></div>
            <div><span>已知有效期上限</span><strong>{summary.expiresAt ? formatDateTime(summary.expiresAt) : summary.configured ? '期限未知（含会话 Cookie）' : '—'}</strong></div>
            <div><span>最近更新</span><strong>{formatDateTime(summary.updatedAt)}</strong></div>
          </div>
          <div className="inline-note"><ShieldCheck size={14} /> 凭证加密落库，页面仅显示状态；有效期条数不代表已通过实际解析验证。</div>
          {summary.configured && summary.usableCookieCount === 0 ? <div className="form-error" role="status">已保存的 Cookie 均已过期，请重新导出并替换。</div> : null}
          <div className="dianping-cookie__check" role="status">
            <Badge tone={summary.lastCheckOk === null ? 'muted' : summary.lastCheckOk ? 'green' : 'red'}>
              {summary.lastCheckOk === null ? '尚未测试解析' : summary.lastCheckOk ? '上次测试成功' : '上次测试失败'}
            </Badge>
            {summary.lastCheckedAt ? <span>{formatDateTime(summary.lastCheckedAt)}</span> : null}
            {summary.lastCheckMessage ? <p>{summary.lastCheckMessage}</p> : null}
          </div>
          <Field label="导入 Cookie JSON 文件" hint="最大 512 KB。选择后点击保存；文件内容不会回显。">
            <input ref={fileInput} className="input" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { void selectFile(event.target.files?.[0]); }} />
          </Field>
          {reading ? <div role="status">正在读取文件…</div> : fileName ? <div className="inline-note"><Upload size={14} /> 已选择 {fileName}，等待保存替换</div> : null}
          <div>
            <Button variant="quiet" size="sm" disabled={busy} aria-expanded={showPaste} onClick={() => {
              if (!showPaste) resetImport();
              setShowPaste(!showPaste);
            }}>{showPaste ? '收起 JSON 输入' : '改为粘贴 JSON'}</Button>
          </div>
          {showPaste ? <Field label="粘贴 Cookie JSON" hint="仅在本页临时输入，保存成功后清空。">
            <Textarea value={cookieJson} rows={6} disabled={busy} autoComplete="off" spellCheck={false} placeholder="粘贴 Cookie 数组或包含 cookies 数组的 JSON" onChange={(event) => { setCookieJson(event.target.value); setError(null); }} />
          </Field> : null}
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <div className="provider-card__actions">
            <Button variant="quiet" disabled={busy || !summary.configured} onClick={() => { setConfirmClear(true); setError(null); }}>清除已保存 Cookie</Button>
            <Button variant="primary" disabled={busy || !cookieJson.trim()} loading={save.isPending} onClick={saveCookie}><Upload size={15} /> {summary.configured ? '保存并替换 Cookie' : '保存 Cookie 到数据库'}</Button>
          </div>
          {confirmClear ? <div className="dianping-cookie__confirm" role="group" aria-label="确认清除 Cookie">
            <p>清除后，所有用户的解析将不再使用这份 Cookie。确认清除？</p>
            <div className="provider-card__actions">
              <Button size="sm" variant="quiet" disabled={busy} onClick={() => setConfirmClear(false)}>取消</Button>
              <Button size="sm" variant="danger" disabled={busy} loading={clear.isPending} onClick={() => clear.mutate()}>确认清除</Button>
            </div>
          </div> : null}
          <div className="dianping-cookie__test">
            <Field label="测试笔记解析" hint="使用数据库中已保存的 Cookie，粘贴大众点评笔记链接或分享文字。">
              <Input value={testLink} disabled={busy} placeholder="粘贴大众点评笔记链接" onChange={(event) => { setTestLink(event.target.value); setTestFeedback(null); }} />
            </Field>
            <Button variant="secondary" disabled={busy || !summary.configured || !testLink.trim()} loading={test.isPending} onClick={() => { setTestFeedback(null); test.mutate(); }}><Link2 size={15} /> 测试解析</Button>
          </div>
          {testFeedback ? <div className={testFeedback.ok ? 'test-result' : 'form-error'} role="status">{testFeedback.message}</div> : null}
        </div>
      ) : null}
    </Panel>
  );
}
