import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Activity, Search, ShieldCheck } from 'lucide-react';
import { api, buildQuery } from '@/api/client';
import type { Pagination } from '@/api/types';
import {
  Badge,
  Button,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination as PaginationControl,
  Select,
} from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';

interface GenerationLog {
  id: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  event: string;
  message: string;
  meta: Record<string, unknown>;
  createdAt: string;
  taskNo: string;
  taskId: string;
}

interface AuditLog {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
  actorName: string | null;
  actorRole: string | null;
}

export function Logs() {
  const [tab, setTab] = useState<'generation' | 'audit'>('generation');
  const [level, setLevel] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 350);
  const generation = useQuery({
    queryKey: ['logs-generation', { level, search: debouncedSearch, page }],
    queryFn: () => api.get<{ items: GenerationLog[]; pagination: Pagination }>(`/admin/logs/generation${buildQuery({ level, q: debouncedSearch, page, pageSize: 30 })}`),
    enabled: tab === 'generation',
    refetchInterval: 10_000,
  });
  const audit = useQuery({
    queryKey: ['logs-audit', { search: debouncedSearch, page }],
    queryFn: () => api.get<{ items: AuditLog[]; pagination: Pagination }>(`/admin/logs/audit${buildQuery({ q: debouncedSearch, page, pageSize: 30 })}`),
    enabled: tab === 'audit',
    refetchInterval: 15_000,
  });
  const active = tab === 'generation' ? generation : audit;

  return (
    <div className="page">
      <PageHeader
        eyebrow="OBSERVABILITY · 运行留痕"
        title="每一次调用，都有迹可循。"
        description="生成日志包含 API 重试、质量校验、相似度过滤与队列状态；审计日志记录登录、审核、权限与领取动作。敏感 Prompt 与密钥不会进入日志。"
        actions={<span className="pool-live"><span className="pulse-dot" /> 实时刷新</span>}
      />

      <div className="toolbar">
        <div className="tabs">
          <button className={`tab ${tab === 'generation' ? 'is-active' : ''}`} onClick={() => { setTab('generation'); setPage(1); }}><Activity size={14} /> 生成日志</button>
          <button className={`tab ${tab === 'audit' ? 'is-active' : ''}`} onClick={() => { setTab('audit'); setPage(1); }}><ShieldCheck size={14} /> 审计日志</button>
        </div>
        <div className="toolbar__right">
          {tab === 'generation' ? (
            <Select value={level} onChange={(event) => { setLevel(event.target.value); setPage(1); }} aria-label="日志级别">
              <option value="">全部级别</option><option value="INFO">INFO</option><option value="WARN">WARN</option><option value="ERROR">ERROR</option>
            </Select>
          ) : null}
          <div className="search-box search-box--compact">
            <Search size={15} />
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={tab === 'generation' ? '搜索任务号或日志内容' : '搜索动作、操作人或目标'} />
          </div>
        </div>
      </div>

      {active.isLoading ? <LoadingBlock /> : active.isError ? <ErrorBlock message="日志加载失败" retry={() => active.refetch()} /> : !active.data?.items.length ? (
        <EmptyState icon={<Activity size={22} />} title="暂无日志" description={tab === 'generation' ? '任务进入生成队列后，这里会记录每次 API 调用结果。' : '管理操作与领取行为会自动写入审计日志。'} />
      ) : tab === 'generation' ? (
        <>
          <div className="log-table">
            {(generation.data?.items ?? []).map((log) => (
              <details className={`log-row log-row--${log.level.toLowerCase()}`} key={log.id}>
                <summary>
                  <Badge tone={log.level === 'ERROR' ? 'red' : log.level === 'WARN' ? 'amber' : 'green'}>{log.level}</Badge>
                  <span className="log-row__event">{log.event}</span>
                  <span className="log-row__message">{log.message}</span>
                  <Link to={`/tasks/${log.taskId}`} onClick={(event) => event.stopPropagation()} className="mono-label">{log.taskNo}</Link>
                  <time>{formatDateTime(log.createdAt)}</time>
                </summary>
                <div className="log-row__detail"><pre>{JSON.stringify(log.meta, null, 2)}</pre></div>
              </details>
            ))}
          </div>
          <PaginationControl page={generation.data?.pagination.page ?? 1} totalPages={generation.data?.pagination.totalPages ?? 1} total={generation.data?.pagination.total ?? 0} onChange={setPage} />
        </>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>动作</th><th>操作人</th><th>目标</th><th>IP</th><th>时间</th></tr></thead>
              <tbody>
                {(audit.data?.items ?? []).map((log) => (
                  <tr key={log.id}>
                    <td><span className="mono-label">{log.action}</span></td>
                    <td><div className="cell-stack"><span>{log.actorName ?? '系统'}</span><span className="cell-muted">{log.actorRole ?? '—'}</span></div></td>
                    <td><div className="cell-stack"><span>{log.targetType ?? '—'}</span><span className="cell-muted">{log.targetId ?? ''}</span></div></td>
                    <td className="mono-label">{log.ip ?? '—'}</td>
                    <td className="nowrap">{formatDateTime(log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControl page={audit.data?.pagination.page ?? 1} totalPages={audit.data?.pagination.totalPages ?? 1} total={audit.data?.pagination.total ?? 0} onChange={setPage} />
        </>
      )}
      <div className="inline-note"><ShieldCheck size={14} /> 代理与普通用户只能在各自任务详情中看到与本人任务相关的生成日志，无法访问全站审计日志。</div>
    </div>
  );
}
