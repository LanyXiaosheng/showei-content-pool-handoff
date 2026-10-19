import crypto from 'node:crypto';
import { z } from 'zod';
import { badRequest } from '../lib/errors';
import { normalizeForSimilarity } from './imageProcessing';
import type { CopyPromptContent, CopyVariant, TaskRow } from '../types';

interface CopyContext {
  task: Pick<TaskRow, 'id' | 'task_no' | 'source_title' | 'source_body' | 'selling_points' | 'tags'>;
  prompt: CopyPromptContent;
  groupNo: number;
  attempt: number;
  jobAttempt?: number;
  avoidTitles?: string[];
}

interface Directives {
  structure: string;
  opening: string;
  titleHook: string;
  closing: string;
  scene: string;
  tags: string[];
  seed: number;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text: string): number {
  return parseInt(crypto.createHash('sha256').update(text).digest('hex').slice(0, 8), 16);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pick<T>(items: T[], random: () => number, fallback: T): T {
  if (!items.length) return fallback;
  return items[Math.floor(random() * items.length)] ?? fallback;
}

function cleanText(value: string): string {
  return value.replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim();
}

function dishName(task: CopyContext['task']): string {
  const firstSellingPoint = task.selling_points[0]?.replace(/[，。！？、；：]/g, '') ?? '';
  const fromTitle = cleanText(task.source_title)
    .replace(/^(这家|一家|藏在|人均|周末|打卡|探店)/, '')
    .replace(/[｜|·—\-].*$/, '')
    .replace(/[，。！？、；：“”"'（）()【】]/g, ' ')
    .trim();
  if (fromTitle.length >= 3 && fromTitle.length <= 18) return fromTitle;
  if (firstSellingPoint.length >= 3) return firstSellingPoint.slice(0, 16);
  return '这桌招牌菜';
}

function replacePlaceholders(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}|\{(\w+)\}/g, (_, a, b) => values[a ?? b] ?? '');
}

function buildDirectives(context: CopyContext): Directives {
  const seed = seedFrom(`${context.task.id}:${context.groupNo}:${context.attempt}:${context.jobAttempt ?? 0}`);
  const random = mulberry32(seed);
  const structures = context.prompt.narrativeStructures.length
    ? context.prompt.narrativeStructures
    : ['场景前置', '菜品体验前置', '细节反差前置'];
  const openings = context.prompt.openingLines.length
    ? context.prompt.openingLines
    : ['秋意渐浓，节后错峰觅食，避开长假人流，来贴秋膘。'];
  const hooks = context.prompt.titleHooks.length
    ? context.prompt.titleHooks
    : ['这盘{dish}，我愿意排队40分钟', '被低估的{dish}，吃一次就记住'];
  const scenes = [
    '店藏在旧街区，门头不显眼，推门进去先闻到炭火和酱汁的味道',
    '店里只有七八张桌，灯是暖黄的，桌面擦得干净',
    '菜单写得朴素，墙上还贴着几张手写推荐',
    '后厨的油响和锅铲声隔着半开的门传出来',
    '门口没有排队的人，玻璃上蒙着一层薄薄的水汽',
  ];
  const closings = [
    '这一顿没有踩雷，也没有被营销架着走的感觉。只是下次路过，我大概还会进来。',
    '口味这件事很私人，但至少这一桌，我愿意再带朋友来一次。',
    '店里不催人，坐一会儿也没关系。这种松弛感，比所谓网红打卡更难得。',
    '如果不想排长队，建议像我一样错峰来。把期待放低一点，反而会被细节打动。',
    '吃完走出来，身上还带着一点炭火和酱汁的味道。是会记住的一顿。',
  ];
  const allTags = [...context.task.tags, ...context.prompt.tagLibrary]
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter(Boolean);
  const uniqueTags = [...new Set(allTags)];
  const shuffledTags = shuffle(uniqueTags, random);
  const tagCount = Math.min(7, Math.max(4, Math.min(shuffledTags.length, 5 + (context.groupNo % 3))));
  const tags = shuffledTags.slice(0, tagCount);

  return {
    structure: pick(structures, random, '场景前置'),
    opening: pick(openings, random, '秋意渐浓，节后错峰觅食。'),
    titleHook: pick(hooks, random, '这盘{dish}，吃一次就记住了'),
    closing: pick(closings, random, closings[0]),
    scene: pick(scenes, random, scenes[0]),
    tags,
    seed,
  };
}

function normalizedTitle(value: string): string {
  return value.replace(/[\s#＃｜|]/g, '').toLowerCase();
}

function formatTitle(hook: string, context: CopyContext, directives: Directives): string {
  const name = dishName(context.task);
  const avoid = new Set((context.avoidTitles ?? []).map(normalizedTitle));
  const apply = (candidate: string) =>
    replacePlaceholders(candidate, {
      dish: name,
      sellingPoint: context.task.selling_points[0] ?? name,
      scene: directives.scene,
    })
      .replace(/^[“”"'\s]+|[“”"'\s]+$/g, '')
      .slice(0, 60);

  // 优先从管理员标题钩子池中选择一个本批次尚未使用的标题。
  const hooks = context.prompt.titleHooks.length
    ? context.prompt.titleHooks
    : ['这盘{dish}，吃一次就记住了'];
  for (let offset = 0; offset < hooks.length; offset += 1) {
    const index = (context.groupNo + offset - 1) % hooks.length;
    const candidate = apply(hooks[index]);
    if (candidate && !avoid.has(normalizedTitle(candidate))) return candidate;
  }

  // 钩子数量不足时，用生活化后缀组合出新的标题，仍保持自然语气。
  const tails = [
    '工作日晚餐', '秋日觅食记', '错峰来吃', '藏在老街里', '本地人推荐', '不排队的一餐',
    '一人食也满足', '朋友聚餐首选', '人均百元出头', '饭后散步刚好', '老饕私藏', '周末慢食',
  ];
  for (const hookItem of hooks) {
    for (const tail of tails) {
      const candidate = apply(`${hookItem}｜${tail}`);
      if (!avoid.has(normalizedTitle(candidate))) return candidate;
    }
  }
  return apply(`${hooks[0]}｜第${context.groupNo}次探店`);
}

const sellingPointFrames: Array<(sp: string) => string> = [
  (sp) => `我最有感的是${sp}。`,
  (sp) => `${sp}，这一点没有夸张。`,
  (sp) => `尤其要提${sp}。`,
  (sp) => `${sp}，入口那一下很具体。`,
  (sp) => `至于${sp}，同桌的人都停了筷子。`,
  (sp) => `让我愿意再来一次的，是${sp}。`,
  (sp) => `还有${sp}，属于照片拍不出来的那种好。`,
];

function countChinese(text: string): number {
  return normalizeForSimilarity(text).length;
}

export function buildMockCopy(context: CopyContext): CopyVariant {
  const random = mulberry32(seedFrom(`copy:${context.task.id}:${context.groupNo}:${context.attempt}:${context.jobAttempt ?? 0}`));
  const directives = buildDirectives(context);
  const narrative = directives.structure;

  const fillers = [
    '热气顶上来，边缘还带着一点焦香，筷子一夹就知道分量不轻。',
    '第一口是酱香，嚼两下甜味才慢慢出来，不腻。',
    '配一口热茶，嘴里那股油脂香被压住，刚好。',
    '盘子端上桌时还在响，香气先一步钻进鼻子里。',
  ];
  const filler = pick(fillers, random, fillers[0]);
  const frames = shuffle(sellingPointFrames, random);
  const points = shuffle(context.task.selling_points, random);
  // 使用预先打乱的句式，避免同一段里连续出现相同开头。
  const pointText = points.map((point, index) => frames[index % frames.length](point)).join('');

  let first: string;
  let second: string;
  let third: string;

  if (narrative.includes('反差')) {
    first = `先说结论：这家店的门头真的不显眼。${directives.opening} ${directives.scene}，差点就走过去了。`;
    second = `坐下来才发现，${pointText}${filler}`;
    third = `没有花哨的摆盘，也没有人过来问“拍照好看吗”。${directives.closing}`;
  } else if (narrative.includes('体验')) {
    first = `${directives.opening} ${directives.scene}。我没急着点单，先看了看邻桌的盘子。`;
    second = `${filler}${pointText}`;
    third = `整顿饭吃得不算快，聊天、夹菜、再添一口茶。${directives.closing}`;
  } else {
    first = `${directives.opening} ${directives.scene}。门口的菜单写得朴素，反而让人放心。`;
    second = `菜上桌之后，我先注意到盘子的温度。${pointText}`;
    third = `${filler}${directives.closing}`;
  }

  let body = [first, second, third]
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');

  if (countChinese(body) < 175) {
    const extra = '店里人声不大，能听见后厨锅铲碰在一起的声音，整个人也跟着慢下来。';
    body = `${first}\n\n${second}${extra}\n\n${third}`;
  }

  const title = formatTitle(directives.titleHook, context, directives);
  return { title, body, tags: directives.tags };
}

export function buildProviderUserPrompt(context: CopyContext): { system: string; user: string } {
  const directives = buildDirectives(context);
  const values = {
    sourceTitle: context.task.source_title,
    sourceBody: context.task.source_body,
    sellingPoints: context.task.selling_points.map((item) => `- ${item}`).join('\n'),
    tags: context.task.tags.join('、'),
    titleHooks: context.prompt.titleHooks.join('\n'),
    openingLines: context.prompt.openingLines.join('\n'),
    narrativeStructures: context.prompt.narrativeStructures.join('\n'),
    tagLibrary: context.prompt.tagLibrary.join('、'),
    narrativeStructure: directives.structure,
    opening: directives.opening,
    tagHint: directives.tags.join('、'),
    groupNo: String(context.groupNo),
    avoidTitles: (context.avoidTitles ?? []).length
      ? `【本批次已使用的标题，勿重复】\n${(context.avoidTitles ?? []).map((title) => `- ${title}`).join('\n')}`
      : '',
  };
  const user = `${replacePlaceholders(context.prompt.userTemplate, values)}

【本次变体指令】
- 叙事结构：${directives.structure}
${values.avoidTitles}
- 可选开篇方向：${directives.opening}
- 标签池中优先考虑：${directives.tags.join('、')}
- 输出组号：${context.groupNo}（这是独立变体，不要复用上一组的句式）

【输出格式】只输出一个 JSON 对象，不要 Markdown 代码块：
{"title":"标题，不带#","paragraphs":["第一段","第二段","第三段"],"tags":["话题标签1","话题标签2"]}
要求：正文约200字、严格三段；保留上面列出的全部卖点原文；不要只做同义词替换；标题不得与原文标题相同；标签4-7个，不带#。`;

  return { system: context.prompt.systemPrompt, user };
}

const copyOutputSchema = z.object({
  title: z.string().min(3).max(80),
  paragraphs: z.array(z.string().min(5).max(500)).min(2).max(5).optional(),
  body: z.string().min(40).max(2000).optional(),
  tags: z.array(z.string().min(1).max(40)).min(1).max(10),
}).refine((value) => Boolean(value.body || value.paragraphs?.length), {
  message: '缺少正文',
});

export function parseProviderCopy(raw: string): CopyVariant {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw badRequest('文案模型未返回 JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw badRequest('文案模型 JSON 解析失败');
  }
  const output = copyOutputSchema.parse(parsed);
  const paragraphs = output.paragraphs?.length ? output.paragraphs : output.body!.split(/\n\s*\n/);
  const body = paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean).join('\n\n');
  const tags = [...new Set(output.tags.map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean))];
  return {
    title: output.title.trim().replace(/^#/, ''),
    body,
    tags,
  };
}

export function validateCopyAgainstTask(
  copy: CopyVariant,
  task: Pick<TaskRow, 'selling_points'>,
): { ok: true } | { ok: false; reason: string } {
  const heading = copy.title.trim();
  if (!heading) return { ok: false, reason: '标题为空' };
  const paragraphs = copy.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length !== 3) return { ok: false, reason: `正文必须为三段，实际 ${paragraphs.length} 段` };
  const normalizedBody = normalizeForSimilarity(copy.body);
  const missing = task.selling_points.filter((point) => !normalizedBody.includes(normalizeForSimilarity(point)));
  if (missing.length) return { ok: false, reason: `文案遗漏卖点：${missing.join('、')}` };
  if (normalizedBody.length < 120) return { ok: false, reason: '正文过短' };
  if (copy.tags.length < 4) return { ok: false, reason: '话题标签不足（至少 4 个）' };
  if (copy.tags.length > 7) return { ok: false, reason: '话题标签过多（最多 7 个）' };
  return { ok: true };
}

export function copyTextFile(copy: CopyVariant): string {
  const tags = copy.tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ');
  return `标题：${copy.title}\n\n正文：\n${copy.body}\n\n话题标签：${tags}\n`;
}
