import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, ImageOff, LockKeyhole, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, buildQuery } from '@/api/client';
import type { Pagination, PoolItem } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination as PaginationControl,
  Select,
} from '@/components/ui';
import { fromNow } from '@/lib/format';
import { groupImageUrl } from '@/lib/media';
import { useDebouncedValue } from '@/lib/hooks';

export function Pool() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'latest' | 'oldest'>('latest');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PoolItem | null>(null);
  const debouncedSearch = useDebouncedValue(search, 350);
  const query = useQuery({
    queryKey: ['pool', { search: debouncedSearch, sort, page }],
    queryFn: () => api.get<{ items: PoolItem[]; pagination: Pagination; availableCount: number }>(
      `/pool${buildQuery({ q: debouncedSearch, sort, page, pageSize: 18 })}`,
    ),
    refetchInterval: 20_000,
  });

  const claim = useMutation({
    mutationFn: (item: PoolItem) => api.post<{ id: string }>(`/pool/${item.id}/claim`),
    onSuccess: async (_data, item) => {
      toast.success('领取成功，已放入「我的领取」', {
        action: { label: '去下载 ZIP', onClick: () => navigate('/library') },
      });
      setSelected(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pool'] }),
        queryClient.invalidateQueries({ queryKey: ['library'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-content'] }),
      ]);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'CONTENT_TAKEN') {
        toast.error('手慢了，这一组刚刚被其他用户领取');
      } else {
        toast.error(error instanceof ApiError ? error.message : '领取失败');
      }
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ['pool'] });
    },
  });

  const isAdmin = user?.role === 'ADMIN';
  const availableCount = query.data?.availableCount ?? 0;

  return (
    <div className="page pool-page">
      <PageHeader
        eyebrow="COMMON POOL · 公共内容池"
        title={<>还有 <span className="display-num">{availableCount}</span> 组，<br />等人认领。</>}
        description="所有成品对平台用户开放。一组内容仅能被一个用户领取，领取后立即从公共池下架。"
        actions={
          <>
            <span className="pool-live"><span className="pulse-dot" /> 实时池存</span>
            {isAdmin ? <span className="admin-readonly">管理员仅浏览，不可领取</span> : null}
          </>
        }
      />

      <div className="toolbar">
        <div className="search-box">
          <Search size={15} />
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索标题、正文或标签" aria-label="搜索内容池" />
        </div>
        <div className="toolbar__right">
          <Select value={sort} onChange={(event) => { setSort(event.target.value as 'latest' | 'oldest'); setPage(1); }} aria-label="排序">
            <option value="latest">最新入池</option>
            <option value="oldest">最早入池</option>
          </Select>
          <span className="toolbar__note">共 {query.data?.pagination.total ?? 0} 组可领取</span>
        </div>
      </div>

      {query.isLoading ? <LoadingBlock label="正在打开内容池…" /> : query.isError ? (
        <ErrorBlock message="内容池加载失败" retry={() => query.refetch()} />
      ) : !query.data?.items.length ? (
        <EmptyState
          icon={<Sparkles size={22} />}
          title={search ? '没有匹配的内容' : '内容池暂时空了'}
          description={search ? '换一个关键词，或清空搜索看看。' : '新任务审核通过并生成完成后，内容会出现在这里。稍后再来。'}
          action={search ? <Button variant="quiet" onClick={() => setSearch('')}>清空搜索</Button> : null}
        />
      ) : (
        <>
          <div className="pool-grid">
            {query.data.items.map((item, index) => (
              <article className="pool-card" key={item.id} style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}>
                <div className="pool-card__cover">
                  {item.coverImageId ? (
                    <img src={groupImageUrl(item.coverImageId)} alt={item.title} loading="lazy" />
                  ) : <div className="image-fallback"><ImageOff size={20} /></div>}
                  <span className="pool-card__code">{item.groupCode}</span>
                  <span className="pool-card__lock"><LockKeyhole size={12} /> 1 人可得</span>
                </div>
                <div className="pool-card__body">
                  <div className="pool-card__meta">
                    <span>{fromNow(item.createdAt)}入池</span>
                    <span>{item.imageCount} 张变体图</span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.preview}</p>
                  <div className="tag-row">
                    {item.tags.slice(0, 4).map((tag) => <span className="tag tag--small" key={tag}>#{tag}</span>)}
                  </div>
                  <div className="pool-card__foot">
                    <span className="remaining"><i /> 剩余可领取 <strong>1</strong> 组</span>
                    {isAdmin ? (
                      <Button size="sm" variant="quiet" disabled>仅浏览</Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => setSelected(item)}>
                        领取 <ArrowUpRight size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <PaginationControl
            page={query.data.pagination.page}
            totalPages={query.data.pagination.totalPages}
            total={query.data.pagination.total}
            onChange={setPage}
          />
        </>
      )}

      <Modal
        open={Boolean(selected)}
        title="确认领取这一组？"
        description="领取后该内容会立即从公共池下架，其他用户不可再获取。"
        onClose={() => setSelected(null)}
        footer={
          <>
            <Button variant="quiet" onClick={() => setSelected(null)} disabled={claim.isPending}>再看看</Button>
            <Button variant="primary" loading={claim.isPending} onClick={() => selected && claim.mutate(selected)}>
              确认领取
            </Button>
          </>
        }
      >
        {selected ? (
          <div className="claim-preview">
            <img src={groupImageUrl(selected.coverImageId)} alt={selected.title} />
            <div>
              <span className="mono-label">{selected.groupCode}</span>
              <h3>{selected.title}</h3>
              <p>{selected.preview}…</p>
              <div className="tag-row">{selected.tags.slice(0, 5).map((tag) => <span className="tag tag--small" key={tag}>#{tag}</span>)}</div>
              <div className="claim-preview__note"><LockKeyhole size={14} /> 原子锁校验 · 一组只归一人</div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
