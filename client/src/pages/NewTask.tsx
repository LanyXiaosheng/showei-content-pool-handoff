import { ChangeEvent, DragEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  CheckCircle2,
  ImagePlus,
  Info,
  Loader2,
  Link2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, api } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Field, Input, PageHeader, Textarea } from '@/components/ui';
import { formatBytes } from '@/api/client';

interface PickedImage {
  file: File;
  url: string;
}

interface DianpingImport {
  title: string;
  body: string;
  tags: string[];
  coverBase64: string;
  coverMimeType: string;
  sourceUrl: string;
}

const DEMO_COPY = {
  title: '黑椒厚切牛肉宽面｜藏在老街区的炭火小馆',
  body: '最近挖到一家藏在老街区里的炭火小馆。厚切牛肉大火快煎，边缘微焦，咬开还有肉汁；宽面裹满黑椒酱汁，挂汁又筋道。番茄和菠菜是意外惊喜，酸香把油脂感压得刚刚好。蘑菇吸满肉香，人均一百出头，分量实在。晚上七点后容易排队，建议错峰。',
  sellingPoints: [
    '厚切牛肉大火快煎，外焦里嫩还有肉汁',
    '宽面裹满黑椒酱汁，挂汁又筋道',
    '番茄与菠菜配菜清爽解腻',
    '蘑菇吸满肉香，口感弹嫩',
    '人均一百出头，分量实在性价比高',
  ],
  tags: ['美食探店', '炭火料理', '宝藏小店', '城市美食', '周末去哪儿吃'],
};

const tagSuggestions = ['美食探店', '宝藏小店', '城市美食', '周末去哪儿吃', '真实测评', '秋日贴秋膘', '一人食', '朋友聚餐', '碳水快乐', '小众餐厅'];

export function NewTask() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<PickedImage[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sellingPoints, setSellingPoints] = useState<string[]>(['']);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [generationCount, setGenerationCount] = useState(10);
  const [compliance, setCompliance] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [shareText, setShareText] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const imagesRef = useRef<PickedImage[]>([]);

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url));
    };
  }, []);

  function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    const errors: string[] = [];
    const next: PickedImage[] = [];
    for (const file of incoming) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        errors.push(`${file.name}：仅支持 JPG / PNG / WebP`);
        continue;
      }
      if (file.size > 12 * 1024 * 1024) {
        errors.push(`${file.name}：超过 12MB`);
        continue;
      }
      if (images.length + next.length >= 6) {
        errors.push('最多上传 6 张原图');
        break;
      }
      next.push({ file, url: URL.createObjectURL(file) });
    }
    if (errors.length) toast.error(errors[0]);
    if (next.length) setImages((current) => [...current, ...next]);
  }

  function removeImage(index: number) {
    setImages((current) => {
      const target = current[index];
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((_, i) => i !== index);
    });
  }

  function onFileInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = '';
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
  }

  function addTag(raw: string) {
    const values = raw.split(/[,，\n]/).map((value) => value.replace(/^#/, '').trim()).filter(Boolean);
    if (!values.length) return;
    setTags((current) => [...new Set([...current, ...values])].slice(0, 12));
    setTagInput('');
  }

  function loadDemo() {
    setDemoLoading(true);
    fetch('/api/public/hero-image')
      .then((response) => {
        if (!response.ok) throw new Error('示例图片加载失败');
        return response.blob();
      })
      .then((blob) => {
        const file = new File([blob], 'demo-dish.jpg', { type: 'image/jpeg' });
        images.forEach((image) => URL.revokeObjectURL(image.url));
        setImages([{ file, url: URL.createObjectURL(file) }]);
        setTitle(DEMO_COPY.title);
        setBody(DEMO_COPY.body);
        setSellingPoints(DEMO_COPY.sellingPoints);
        setTags(DEMO_COPY.tags);
        setGenerationCount(10);
        toast.success('已载入一组演示素材');
      })
      .catch(() => toast.error('演示素材加载失败，请手动上传图片'))
      .finally(() => setDemoLoading(false));
  }

  async function importFromDianping() {
    if (!shareText.trim()) {
      toast.error('请先粘贴大众点评分享链接');
      return;
    }
    if ((title || body || images.length) && !window.confirm('解析结果会替换当前标题、正文和原图。继续吗？')) return;
    setImportLoading(true);
    try {
      const parsed = await api.post<DianpingImport>('/imports/dianping', { text: shareText });
      const bytes = Uint8Array.from(atob(parsed.coverBase64), (char) => char.charCodeAt(0));
      const extension = parsed.coverMimeType === 'image/png' ? 'png' : parsed.coverMimeType === 'image/webp' ? 'webp' : 'jpg';
      const file = new File([bytes], `dianping-first-image.${extension}`, { type: parsed.coverMimeType });
      const preview = URL.createObjectURL(file);
      setImages((current) => {
        current.forEach((image) => URL.revokeObjectURL(image.url));
        return [{ file, url: preview }];
      });
      setTitle(parsed.title);
      setBody(parsed.body);
      setSellingPoints(['']);
      setTags(parsed.tags);
      setCompliance(false);
      setError(null);
      toast.success(`已填入标题、首图${parsed.body ? '和正文' : ''}，识别到 ${parsed.tags.length} 个话题标签`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : '大众点评导入失败，请稍后重试');
    } finally {
      setImportLoading(false);
    }
  }

  function validate(): string | null {
    if (!images.length) return '请至少上传 1 张原始菜品图';
    if (title.trim().length < 3) return '请填写至少 3 个字的原始标题';
    const cleanPoints = sellingPoints.map((point) => point.trim()).filter(Boolean);
    if (!cleanPoints.length) return '请至少填写 1 个卖点';
    if (generationCount < 10 || generationCount > 100) return '生成组数必须在 10 到 100 之间';
    if (!compliance) return '请先确认素材合规与平台分发风险提示';
    return null;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const issue = validate();
    if (issue) {
      setError(issue);
      document.querySelector('.form-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('generationCount', String(generationCount));
      form.append('sourceTitle', title.trim());
      form.append('sourceBody', body.trim());
      form.append('sellingPoints', JSON.stringify(sellingPoints.map((point) => point.trim()).filter(Boolean)));
      form.append('tags', JSON.stringify(tags));
      images.forEach(({ file }) => form.append('images', file, file.name));
      const result = await api.post<{ id: string; taskNo: string }>('/tasks', form);
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('任务已提交，等待管理员审核');
      navigate(`/tasks/${result.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败，请稍后再试');
    } finally {
      setSubmitting(false);
    }
  }

  const pointsCount = sellingPoints.filter((point) => point.trim()).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="NEW MATERIAL · 素材提交"
        title="把这一桌，交给系统慢慢拆。"
        description="上传原图与原始种草文案。任务不会立即消耗 API — 管理员审核通过后，才会批量生成并进入公共内容池。"
        actions={<Button variant="quiet" loading={demoLoading} onClick={loadDemo}><Sparkles size={15} /> 载入演示素材</Button>}
      />

      <form className="create-layout" onSubmit={onSubmit}>
        <div className="create-main">
          <section className="form-section import-section">
            <div className="form-section__head">
              <span className="section-index">↗</span>
              <div><h2>从大众点评导入</h2><p>粘贴公开笔记链接，自动填入标题、首图，以及页面提供的正文和话题标签；导入后仍可编辑。</p></div>
            </div>
            <div className="import-row">
              <Input value={shareText} onChange={(event) => setShareText(event.target.value)} maxLength={2000} placeholder="粘贴 dpurl.cn 或 m.dianping.com 分享链接" aria-label="大众点评分享链接" />
              <Button type="button" variant="primary" loading={importLoading} onClick={importFromDianping}><Link2 size={15} /> 解析并填入</Button>
            </div>
            <p className="import-note">解析只会填表，不会自动提交任务；Cookie 仅由服务端管理。</p>
          </section>
          <section className="form-section">
            <div className="form-section__head">
              <span className="section-index">01</span>
              <div><h2>原始素材图</h2><p>餐盘主体要清晰完整，建议 1–3 张。单张不超过 12MB。</p></div>
              <span className="form-section__aside">{images.length} / 6</span>
            </div>
            <div
              className={`dropzone ${dragging ? 'is-dragging' : ''} ${images.length ? 'has-images' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInput.current?.click(); }}
            >
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={onFileInput} />
              {images.length ? (
                <div className="dropzone__grid" onClick={(event) => event.stopPropagation()}>
                  {images.map((image, index) => (
                    <figure className="upload-thumb" key={image.url}>
                      <img src={image.url} alt={`原图 ${index + 1}`} />
                      <figcaption>
                        <span>{index === 0 ? '主图' : `原图 ${index + 1}`}</span>
                        <span>{formatBytes(image.file.size)}</span>
                      </figcaption>
                      <button type="button" aria-label="移除图片" onClick={() => removeImage(index)}><X size={14} /></button>
                    </figure>
                  ))}
                  {images.length < 6 ? (
                    <button type="button" className="upload-add" onClick={() => fileInput.current?.click()}>
                      <ImagePlus size={22} /><span>继续添加</span>
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="dropzone__empty">
                  <span className="dropzone__icon"><Camera size={26} /></span>
                  <strong>拖入菜品实拍图，或点击选择</strong>
                  <p>支持 JPG / PNG / WebP · 最多 6 张 · 每张 ≤ 12MB</p>
                  <span className="dropzone__hint"><Upload size={13} /> 图片会自动抹除 EXIF 并生成缩略图</span>
                </div>
              )}
            </div>
          </section>

          <section className="form-section">
            <div className="form-section__head">
              <span className="section-index">02</span>
              <div><h2>原始种草文案</h2><p>保留真实卖点即可，变体由内置 Prompt 完成，你无需撰写提示词。</p></div>
            </div>
            <div className="form-stack">
              <Field label="原始标题" required hint={`${title.length} / 200`}>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="例如：黑椒厚切牛肉宽面｜藏在老街区的炭火小馆" />
              </Field>
              <Field label="原始正文（可选）" hint={`${body.length} / 8000 字`}>
                <Textarea rows={6} value={body} onChange={(event) => setBody(event.target.value)} maxLength={8000} placeholder="粘贴你已有的种草正文，无需自己改写…" />
              </Field>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section__head">
              <span className="section-index">03</span>
              <div><h2>卖点与标签</h2><p>每组变体都会保留这里列出的全部卖点。顺序会被系统重新编排。</p></div>
              <span className="form-section__aside">{pointsCount} 个卖点</span>
            </div>
            <div className="form-stack">
              <div className="field">
                <span className="field__label">菜品卖点 <span className="field__required">至少 1 项</span></span>
                <div className="point-editor">
                  {sellingPoints.map((point, index) => (
                    <div className="point-row" key={index}>
                      <span className="point-index">{String(index + 1).padStart(2, '0')}</span>
                      <Input
                        value={point}
                        onChange={(event) => setSellingPoints((current) => current.map((item, i) => i === index ? event.target.value : item))}
                        placeholder={index === 0 ? '例如：厚切牛肉大火快煎，外焦里嫩还有肉汁' : '继续补充一个具体卖点'}
                        maxLength={120}
                      />
                      <button type="button" className="point-remove" aria-label="删除卖点" disabled={sellingPoints.length === 1} onClick={() => setSellingPoints((current) => current.filter((_, i) => i !== index))}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  {sellingPoints.length < 8 ? (
                    <Button type="button" size="sm" variant="quiet" onClick={() => setSellingPoints((current) => [...current, ''])}>
                      <Plus size={14} /> 添加卖点
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="field">
                <span className="field__label">话题标签 <span className="field__optional">可选</span></span>
                <div className="tag-editor">
                  <div className="tag-editor__chips">
                    {tags.map((tag) => (
                      <span className="tag tag--removable" key={tag}>
                        #{tag}
                        <button type="button" aria-label={`移除 ${tag}`} onClick={() => setTags((current) => current.filter((item) => item !== tag))}><X size={12} /></button>
                      </span>
                    ))}
                    <input
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
                          event.preventDefault();
                          addTag(tagInput);
                        }
                        if (event.key === 'Backspace' && !tagInput && tags.length) {
                          setTags((current) => current.slice(0, -1));
                        }
                      }}
                      onBlur={() => addTag(tagInput)}
                      placeholder={tags.length ? '继续添加…' : '输入标签后按 Enter'}
                      maxLength={40}
                    />
                  </div>
                  <div className="tag-suggestions">
                    {tagSuggestions.filter((tag) => !tags.includes(tag)).slice(0, 7).map((tag) => (
                      <button type="button" key={tag} onClick={() => addTag(tag)}><Plus size={11} /> {tag}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section__head">
              <span className="section-index">04</span>
              <div><h2>生成组数</h2><p>每组包含一套变体图片与独立文案，全部进入公共池。</p></div>
            </div>
            <div className="count-picker">
              <div className="count-picker__number">
                <Input
                  type="number"
                  min={10}
                  max={100}
                  value={generationCount}
                  onChange={(event) => setGenerationCount(Math.max(10, Math.min(100, Number(event.target.value) || 10)))}
                />
                <span>组</span>
              </div>
              <input
                className="range"
                type="range"
                min={10}
                max={100}
                step={1}
                value={generationCount}
                onChange={(event) => setGenerationCount(Number(event.target.value))}
                aria-label="生成组数"
              />
              <div className="count-presets">
                {[10, 20, 30, 50, 100].map((value) => (
                  <button type="button" key={value} className={generationCount === value ? 'is-active' : ''} onClick={() => setGenerationCount(value)}>{value} 组</button>
                ))}
              </div>
              <p className="count-hint"><Info size={14} /> 生成组数越多，审核通过后消耗的外部 API 额度越高。系统会在生成前再次确认 Prompt 与 API 配置可用。</p>
            </div>
          </section>

          <section className="form-section form-section--submit">
            <label className="checkbox-line">
              <input type="checkbox" checked={compliance} onChange={(event) => setCompliance(event.target.checked)} />
              <span className="checkbox-box"><CheckCircle2 size={13} /></span>
              <span>我确认素材为本人有权使用的实拍图，并知悉：平台风控会检测同源批量素材，本系统仅做素材变体，不保证大众点评 / 小红书审核通过，分发合规责任由本人承担。</span>
            </label>
            {error ? <div className="form-error">{error}</div> : null}
            <div className="submit-row">
              <Button type="submit" size="lg" variant="primary" loading={submitting}>
                {submitting ? '正在上传素材…' : '提交任务，等待审核'}
              </Button>
              <span>提交后不会立即调用 API</span>
            </div>
          </section>
        </div>

        <aside className="create-aside">
          <div className="aside-card">
            <span className="eyebrow">BEFORE YOU SUBMIT</span>
            <h3>审核通过后，系统会做什么？</h3>
            <ol className="timeline-mini">
              <li><span>01</span><p>抓取原图与文案，随机组合倾斜角度、景别、配菜重排与光影。</p></li>
              <li><span>02</span><p>逐组调用图生图与文案 API，强制 3:4 输出，并做相似度/质量卡口。</p></li>
              <li><span>03</span><p>全部内容进入公共池，任何用户（包括提交者）都只能自行领取一组。</p></li>
            </ol>
          </div>
          <div className="aside-card aside-card--rules">
            <span className="eyebrow">HARD RULES</span>
            <h3>素材与权限边界</h3>
            <ul className="rule-list">
              <li><CheckCircle2 size={14} /> 一组内容只允许被一个用户领取</li>
              <li><CheckCircle2 size={14} /> 提交者不会自动获得成品</li>
              <li><CheckCircle2 size={14} /> 代理只能邀请普通用户</li>
              <li><CheckCircle2 size={14} /> Prompt 与 API 密钥仅管理员可见</li>
              <li><CheckCircle2 size={14} /> 普通用户之间没有邀请能力</li>
            </ul>
          </div>
          <div className="aside-card aside-card--quote">
            <p>“不是把同一张图换个滤镜，<br />而是让每一组都像一个真实食客拍的。”</p>
            <span>— 拾味 · 内容准则 01</span>
          </div>
          {user?.role === 'AGENT' ? (
            <div className="aside-card aside-card--muted">
              <span className="eyebrow">AGENT NOTE</span>
              <p>你提交的任务同样属于公共池，不会因为你是代理而优先分配。</p>
            </div>
          ) : null}
        </aside>
      </form>
    </div>
  );
}
