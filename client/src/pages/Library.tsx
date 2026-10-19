import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, BookOpen, Download, FolderLock, ImageOff, Search } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api, buildQuery, downloadFile } from '@/api/client';
import type { LibraryItem, Pagination } from '@/api/types';
import {
  Button,
  EmptyState,
  ErrorBlock,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination as PaginationControl,
} from '@/components/ui';
import { formatDateTime, fromNow } from '@/lib/format';
import { groupImageUrl } from '@/lib/media';
import { useDebouncedValue } from '@/lib/hooks';

export function Library() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [viewing, setViewing] = useState<LibraryItem | null>(null);
  const debouncedSearch = useDebouncedValue(search, 350);
  const query = useQuery({
    queryKey: ['library', { search: debouncedSearch, page }],
    queryFn: () => api.get<{ items: LibraryItem[]; pagination: Pagination }>(
      `/library${buildQuery({ q: debouncedSearch, page, pageSize: 18 })}`,
    ),
  });

  async function download(item: LibraryItem) {
    setDownloading(item.id);
    try {
      await downloadFile(`/content/${item.id}/download`, `${item.groupCode}_Group.zip`);
      toast.success('ZIP 已开始下载');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '下载失败');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="MY COLLECTION · 独占内容"
        title={<>领到的，才是你的。</>}
        description="这里只展示你已领取的内容。每组包含独立文件夹、变体图片和文案 txt，可随时重新下载。"
        actions={<span className="pool-live"><span className="pulse-dot" /> 已领取 {query.data?.pagination.total ?? 0} 组</span>}
      />

      <div className="toolbar">
        <div className="search-box">
          <Search size={15} />
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索已领取内容" aria-label="搜索已领取内容" />
        </div>
        <span className="toolbar__note">仅你可见 · 其他用户无法查看或下载</span>
      </div>

      {query.isLoading ? <LoadingBlock label="正在打开你的收藏…" /> : query.isError ? (
        <ErrorBlock message="已领取内容加载失败" retry={() => query.refetch()} />
      ) : !query.data?.items.length ? (
        <EmptyState
          icon={<FolderLock size={22} />}
          title={search ? '没有匹配的内容' : '还没有领取过内容'}
          description={search ? '换一个关键词试试。' : '去公共内容池挑一组，先到先得。领取后即可下载完整 ZIP。'}
          action={<Link className="btn btn--primary btn--md" to="/pool">去内容池看看 <ArrowUpRight size={15} /></Link>}
        />
      ) : (
        <>
          <div className="library-grid">
            {query.data.items.map((item) => (
              <article className="library-card" key={item.id}>
                <div className="library-card__cover">
                  {item.coverImageId ? <img src={groupImageUrl(item.coverImageId)} alt={item.title} loading="lazy" /> : <div className="image-fallback"><ImageOff size={20} /></div>}
                  <span className="library-card__stamp">已领取</span>
                </div>
                <div className="library-card__body">
                  <div className="pool-card__meta">
                    <span className="mono-label">{item.groupCode}</span>
                    <span>{fromNow(item.claimedAt)}领取</span>
                  </div>
                  <h3>{item.title}</h3>
                  <div className="tag-row">{item.tags.slice(0, 4).map((tag) => <span className="tag tag--small" key={tag}>#{tag}</span>)}</div>
                  <p className="library-card__excerpt">{item.body.replace(/\s+/g, ' ').slice(0, 74)}…</p>
                  <div className="library-card__foot">
                    <span>{item.imageCount} 张图 · 独立文案</span>
                    <div className="inline-actions">
                      <Button size="sm" variant="quiet" onClick={() => setViewing(item)}><BookOpen size={14} /> 看文案</Button>
                      <Button size="sm" variant="primary" loading={downloading === item.id} onClick={() => download(item)}><Download size={14} /> ZIP</Button>
                    </div>
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

      <Modal open={Boolean(viewing)} title={viewing?.title ?? '文案'} description={viewing ? `${viewing.groupCode} · 领取于 ${formatDateTime(viewing.claimedAt)}` : undefined} onClose={() => setViewing(null)} width="720px">
        {viewing ? (
          <div className="copy-modal">
            <div className="tag-row">{viewing.tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}</div>
            <div className="copy-modal__body">{viewing.body.split('\n\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
            <div className="copy-modal__foot">
              <span>下载 ZIP 可获取图片与 UTF-8 文案 txt</span>
              <Button size="sm" variant="primary" loading={downloading === viewing.id} onClick={() => download(viewing)}><Download size={14} /> 下载 ZIP</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
