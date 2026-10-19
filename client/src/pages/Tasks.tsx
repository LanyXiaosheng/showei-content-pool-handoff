import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, FileText, Plus, Search } from 'lucide-react';
import { api, buildQuery } from '@/api/client';
import type { Pagination, TaskSummary } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination as PaginationControl,
  Progress,
  TaskStatusBadge,
} from '@/components/ui';
import { TASK_STATUS_LABEL, formatDateTime, percent } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks';

const statusTabs = [
  { value: '', label: '全部' },
  { value: 'PENDING_REVIEW', label: '待审核' },
  { value: 'QUEUED', label: '排队中' },
  { value: 'GENERATING', label: '生成中' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'REJECTED', label: '已驳回' },
  { value: 'FAILED', label: '失败' },
  { value: 'VOID', label: '已作废' },
];

export function Tasks() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search, 350);
  const query = useQuery({
    queryKey: ['tasks', { status, search: debouncedSearch, page }],
    queryFn: () => api.get<{ items: TaskSummary[]; pagination: Pagination }>(
      `/tasks${buildQuery({ status, q: debouncedSearch, page, pageSize: 20 })}`,
    ),
    refetchInterval: (query) => {
      const data = query.state.data as { items?: TaskSummary[] } | undefined;
      return data?.items?.some((task) => ['QUEUED', 'GENERATING'].includes(task.status)) ? 4000 : false;
    },
  });

  const isAdmin = user?.role === 'ADMIN';
  return (
    <div className="page">
      <PageHeader
        eyebrow="TASK LEDGER · 任务台账"
        title={isAdmin ? '全部任务' : '任务记录'}
        description={
          isAdmin
            ? '所有代理与用户的素材提交记录。只有「待审核」任务需要你处理。'
            : user?.role === 'AGENT'
              ? '你与名下用户提交的所有任务。任务需管理员审核通过后才会生成。'
              : '你提交的全部素材任务。审核通过后，生成内容会进入公共池，不会自动发给你。'
        }
        actions={!isAdmin ? <Button variant="primary" onClick={() => navigate('/tasks/new')}><Plus size={16} /> 提交素材</Button> : null}
      />

      <div className="toolbar">
        <div className="tabs tabs--scroll" role="tablist">
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={status === tab.value}
              className={`tab ${status === tab.value ? 'is-active' : ''}`}
              onClick={() => { setStatus(tab.value); setPage(1); }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="search-box">
          <Search size={15} />
          <Input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="搜索任务编号或标题"
            aria-label="搜索任务"
          />
        </div>
      </div>

      {query.isLoading ? <LoadingBlock label="正在读取任务…" /> : query.isError ? (
        <ErrorBlock message="任务列表加载失败" retry={() => query.refetch()} />
      ) : !query.data?.items.length ? (
        <EmptyState
          icon={<FileText size={22} />}
          title="没有符合条件的任务"
          description={status || search ? '换一个状态或关键词试试。' : '提交素材后，任务会出现在这里。'}
          action={!isAdmin ? <Button variant="primary" onClick={() => navigate('/tasks/new')}>提交素材任务</Button> : null}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>任务 / 原始标题</th>
                  <th>提交人</th>
                  <th>状态</th>
                  <th>进度</th>
                  <th>生成组数</th>
                  <th>提交时间</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((task) => (
                  <tr key={task.id} onClick={() => navigate(`/tasks/${task.id}`)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/tasks/${task.id}`); }}>
                    <td>
                      <div className="cell-stack">
                        <span className="mono-label">{task.taskNo}</span>
                        <strong>{task.sourceTitle}</strong>
                        <span className="cell-muted">{task.imageCount} 张原图 · {task.tags.slice(0, 3).map((tag) => `#${tag}`).join(' ')}</span>
                      </div>
                    </td>
                    <td>
                      <div className="cell-stack">
                        <span>{task.submitter.displayName}</span>
                        <span className="cell-muted">{task.submitter.email}</span>
                      </div>
                    </td>
                    <td>
                      <div className="cell-stack">
                        <TaskStatusBadge status={task.status} />
                        {task.status === 'FAILED' && task.failureReason ? <span className="cell-error" title={task.failureReason}>{task.failureReason.slice(0, 26)}…</span> : null}
                        {task.status === 'REJECTED' && task.reviewComment ? <span className="cell-muted">{task.reviewComment.slice(0, 26)}…</span> : null}
                      </div>
                    </td>
                    <td>
                      {task.job ? (
                        <div className="cell-progress">
                          <Progress value={percent(task.job.completedGroups, task.job.totalGroups)} />
                          <span>{task.job.completedGroups} / {task.job.totalGroups}</span>
                        </div>
                      ) : (
                        <span className="cell-muted">{TASK_STATUS_LABEL[task.status]}</span>
                      )}
                    </td>
                    <td className="num-cell">{task.generationCount}</td>
                    <td className="nowrap">{formatDateTime(task.createdAt)}</td>
                    <td><Link to={`/tasks/${task.id}`} className="row-link" aria-label="查看任务"><ArrowUpRight size={16} /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControl
            page={query.data.pagination.page}
            totalPages={query.data.pagination.totalPages}
            total={query.data.pagination.total}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
