import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardCheck, Clock3, ImageOff, ShieldCheck } from 'lucide-react';
import { api, buildQuery } from '@/api/client';
import type { Pagination, TaskSummary } from '@/api/types';
import {
  Button,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  Pagination as PaginationControl,
  TaskStatusBadge,
} from '@/components/ui';
import { fromNow } from '@/lib/format';
import { taskImageUrl } from '@/lib/media';

export function Review() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['review-queue', page],
    queryFn: () => api.get<{ items: TaskSummary[]; pagination: Pagination }>(`/tasks${buildQuery({ status: 'PENDING_REVIEW', page, pageSize: 12 })}`),
    refetchInterval: 15_000,
  });
  const total = query.data?.pagination.total ?? 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="REVIEW GATE · 人工闸门"
        title={<>审核队列里，<br />有 <span className="display-num">{total}</span> 份待判断的素材。</>}
        description="审核通过前不调用任何外部 API。通过后任务进入生成队列，内容全部进入公共池，提交者不会自动获得成品。"
        actions={<div className="gate-badge"><ShieldCheck size={16} /><span>人工审核是额度与合规的唯一闸门</span></div>}
      />

      {query.isLoading ? <LoadingBlock label="正在读取待审任务…" /> : query.isError ? <ErrorBlock message="审核队列加载失败" retry={() => query.refetch()} /> : !query.data?.items.length ? (
        <EmptyState
          icon={<ClipboardCheck size={24} />}
          title="队列已清空"
          description="所有提交上来的素材都已经处理。新任务提交后会出现在这里。"
          action={<Link to="/tasks" className="btn btn--primary btn--md">查看全部任务</Link>}
        />
      ) : (
        <>
          <div className="review-list">
            {query.data.items.map((task) => (
              <article className="review-card" key={task.id}>
                <div className="review-card__image">
                  {task.coverImageId ? <img src={taskImageUrl(task.coverImageId)} alt={task.sourceTitle} loading="lazy" /> : <div className="image-fallback"><ImageOff size={20} /></div>}
                  <span>{task.imageCount} 张原图</span>
                </div>
                <div className="review-card__body">
                  <div className="review-card__top">
                    <span className="mono-label">{task.taskNo}</span>
                    <span className="review-card__wait"><Clock3 size={13} /> {fromNow(task.createdAt)}提交</span>
                    <TaskStatusBadge status={task.status} />
                  </div>
                  <h2>{task.sourceTitle}</h2>
                  <p className="review-card__excerpt">{task.sourceBody.slice(0, 118)}…</p>
                  <div className="review-card__points">
                    {task.sellingPoints.slice(0, 4).map((point) => <span key={point}>{point}</span>)}
                    {task.sellingPoints.length > 4 ? <span>+{task.sellingPoints.length - 4}</span> : null}
                  </div>
                  <div className="review-card__tags">
                    {task.tags.slice(0, 5).map((tag) => <span key={tag}>#{tag}</span>)}
                  </div>
                  <div className="review-card__foot">
                    <span>提交人 <strong>{task.submitter.displayName}</strong> · 计划生成 <strong>{task.generationCount}</strong> 组</span>
                    <Button variant="primary" onClick={() => navigate(`/tasks/${task.id}`)}>
                      查看材料并审核 <ArrowRight size={15} />
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <PaginationControl page={query.data.pagination.page} totalPages={query.data.pagination.totalPages} total={query.data.pagination.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
