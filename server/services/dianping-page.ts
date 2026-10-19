import { AppError } from '../lib/errors';

type DataObject = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n: string) => {
      const code = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, n: string) =>
      ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[n] ?? '')
    .replace(/\r/g, '').trim();
}

function object(value: unknown): DataObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as DataObject : null;
}

function qwikObjects(payload: unknown): unknown[] {
  const values = object(payload)?.objs;
  if (!Array.isArray(values) || values.length > 30_000) return [];
  const objs: unknown[] = values;
  const cache = new Map<number, unknown>();
  function reference(value: unknown, depth: number): unknown {
    if (typeof value !== 'string' || !/^[\da-z]+[!~_]*$/i.test(value)) return undefined;
    return decode(parseInt(value.replace(/[!~_]+$/, ''), 36), depth + 1);
  }
  function decode(index: number, depth = 0): unknown {
    if (depth > 30 || index < 0 || index >= objs.length) return undefined;
    if (cache.has(index)) return cache.get(index);
    const value = objs[index];
    if (typeof value === 'string') {
      const prefix = value.charCodeAt(0);
      if (prefix === 0x1b || prefix === 0x05) return value.slice(1);
      if (prefix === 0x12) return reference(value.slice(1), depth);
      if (prefix === 0x13) {
        const [id, property] = value.slice(1).split(' ');
        return object(reference(id, depth))?.[property];
      }
      return prefix < 0x20 ? undefined : value;
    }
    if (Array.isArray(value)) {
      const result: unknown[] = []; cache.set(index, result);
      result.push(...value.map((entry) => reference(entry, depth))); return result;
    }
    if (object(value)) {
      const result: DataObject = Object.create(null); cache.set(index, result);
      for (const [key, entry] of Object.entries(value as DataObject)) {
        if (!['__proto__', 'constructor', 'prototype'].includes(key)) result[key] = reference(entry, depth);
      }
      return result;
    }
    return value;
  }
  return objs.map((_entry, index) => decode(index));
}

function readJsonScripts(html: string): unknown[] {
  const results: unknown[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/(?:application\/(?:ld\+)?json|qwik\/json|__NEXT_DATA__)/i.test(match[1])) continue;
    try {
      const data: unknown = JSON.parse(match[2]);
      if (/qwik\/json/i.test(match[1])) results.push(...qwikObjects(data));
      else results.push(data);
    } catch { /* Non-JSON scripts are never executed. */ }
  }
  return results;
}

function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3];
    }
    const name = attrs.property || attrs.name;
    if (name && attrs.content) tags.set(name.toLowerCase(), text(attrs.content));
  }
  return tags;
}

function firstString(data: DataObject, names: string[]): string {
  for (const name of names) { const result = text(data[name]); if (result) return result; }
  return '';
}

function imageUrl(value: unknown, depth = 0): string {
  if (depth > 5) return '';
  if (typeof value === 'string') {
    try {
      const url = new URL(value.startsWith('//') ? 'https:' + value : value);
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port
        && ['meituan.net', 'dpfile.com'].some((host) => url.hostname === host || url.hostname.endsWith('.' + host))) return url.toString();
    } catch { /* Not an image URL. */ }
    return '';
  }
  if (Array.isArray(value)) return value.map((item) => imageUrl(item, depth + 1)).find(Boolean) || '';
  const row = object(value);
  if (!row) return '';
  for (const key of ['url', 'src', 'picUrl', 'originalUrl', 'largeUrl', 'largePicUrl', 'image', 'contentUrl']) {
    const found = imageUrl(row[key], depth + 1); if (found) return found;
  }
  return '';
}

interface NoteData { title: string; body: string; coverUrl: string; tags: string[] }

function candidate(data: DataObject): NoteData {
  const title = firstString(data, ['noteTitle', 'feedTitle', 'title', 'headline', 'subject']);
  const body = firstString(data, ['noteContent', 'feedContent', 'articleBody', 'content', 'desc', 'description', 'text']);
  let coverUrl = '';
  for (const name of ['coverUrl', 'cover_url', 'picList', 'imageList', 'images', 'image', 'pictures', 'pics', 'photoList']) {
    coverUrl = imageUrl(data[name]); if (coverUrl) break;
  }
  const rawTags = data.tags ?? data.tagList ?? data.keywords;
  const tags = Array.isArray(rawTags) ? rawTags.map((tag) => typeof tag === 'string' ? tag
    : firstString(object(tag) || {}, ['name', 'title', 'tagName'])).filter(Boolean) : [];
  return { title, body, coverUrl, tags };
}

function findNote(roots: unknown[], expectedId: string): NoteData | null {
  const queue = [...roots]; const seen = new Set<object>();
  let best: NoteData | null = null; let bestScore = 0;
  for (let i = 0; i < queue.length && i < 10_000; i += 1) {
    const current = queue[i];
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) { queue.push(...current.slice(0, 500)); continue; }
    const data = current as DataObject; const note = candidate(data);
    const article = /Article|BlogPosting|SocialMediaPosting/.test(String(data['@type']));
    const identifier = data.noteId ?? data.feedId ?? data.id;
    const exactNote = Boolean(expectedId && String(identifier) === expectedId);
    const noteFields = 'noteTitle' in data || 'feedTitle' in data || 'noteContent' in data;
    const wrongNote = Boolean(expectedId && identifier !== undefined && String(identifier) !== expectedId);
    const score = (note.title ? 2 : 0) + (note.body ? 1 : 0) + (note.coverUrl ? 3 : 0)
      + (article ? 2 : 0) + (exactNote ? 10 : 0);
    if (!wrongNote && (article || exactNote || (!expectedId && noteFields))
      && note.title && note.coverUrl && score > bestScore) {
      best = note; bestScore = score;
    }
    queue.push(...Object.values(data).slice(0, 500));
  }
  return best;
}

export function parseDianpingPage(html: string, sourceUrl = ''): NoteData {
  if (/q:route=["'][^"']*(?:login-redirect|captcha|verify)/i.test(html)
    || /rel=["']canonical["'][^>]*href=["'][^"']*\/login-redirect/i.test(html)
    || /<title[^>]*>\s*(?:安全验证|访问验证|登录大众点评)/i.test(html)) {
    throw new AppError(409, 'DIANPING_COOKIE_EXPIRED', '大众点评登录已失效或需要验证，请联系管理员更新 Cookie');
  }
  const meta = metaTags(html);
  let expectedId = '';
  try { expectedId = sourceUrl ? new URL(sourceUrl).pathname.match(/^\/feeddetail\/(\d+)\/?$/)?.[1] || '' : ''; }
  catch { /* Invalid final URLs cannot identify a note. */ }
  if (sourceUrl && !expectedId) {
    throw new AppError(422, 'DIANPING_NOTE_UNAVAILABLE', '分享链接未打开有效笔记，请重新复制该笔记的分享链接');
  }
  const note = findNote(readJsonScripts(html), expectedId) ?? {
    title: meta.get('og:title') || '', body: meta.get('og:description') || meta.get('description') || '',
    coverUrl: imageUrl(meta.get('og:image')), tags: [],
  };
  note.title = note.title.replace(/\s*[-_|]\s*大众点评.*$/, '').trim();
  if (note.title.length < 3 || note.title.length > 200 || /^大众点评(?:网)?$/.test(note.title)
    || !note.coverUrl || note.body.length > 8000) {
    throw new AppError(422, 'DIANPING_CONTENT_INCOMPLETE', '页面未返回完整笔记，请确认 Cookie 有效和笔记可访问，或手动上传素材');
  }
  const hashtags = [...note.body.matchAll(/[#＃]([^#＃\s，。！？、,;:：（）()]{1,60})/gu)].map((match) => match[1]);
  note.tags = [...new Set([...note.tags, ...hashtags].map((tag) => tag.replace(/^#+/, '').trim())
    .filter((tag) => tag && tag.length <= 120 && !tag.startsWith('@')))].slice(0, 12);
  return note;
}
