#!/usr/bin/env node
/**
 * shelf 聚合器：把多个文集仓里的「已发布」文章汇总成一页书架 + 合并 RSS。
 *
 *   node scripts/build-shelf.mjs           # 生成 README.md / feed.xml / feeds/*.xml / shelf.json
 *   node scripts/build-shelf.mjs --check   # 只校验，不写文件（CI 用；有错则退出码 1）
 *
 * 零依赖。只解析 frontmatter 的 YAML 子集（标量、行内数组、true/false），
 * 因为规范本来就不允许复杂 YAML —— 复杂结构在 md 文章里只会变成负担。
 */
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const CHECK_ONLY = process.argv.includes('--check');
const BEGIN = '<!-- BEGIN:SHELF -->';
const END = '<!-- END:SHELF -->';

/* ---------- frontmatter ---------- */

function unquote(s) {
  if (s.length >= 2 && ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (val === '') { data[key] = ''; continue; }
    if (/^\[.*\]$/.test(val)) {
      data[key] = val.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
    } else if (val === 'true' || val === 'false') {
      data[key] = val === 'true';
    } else {
      data[key] = unquote(val);
    }
  }
  return { data, body: raw.slice(m[0].length) };
}

/* ---------- 数据源 ---------- */

async function resolveSource(src) {
  const local = src.path ? path.resolve(ROOT, src.path) : null;
  if (local && existsSync(path.join(local, 'posts'))) return { ...src, dir: local, mode: 'local' };

  if (!src.repo) throw new Error(`源 ${src.id} 既没有可用的 path，也没有 repo`);
  const dir = path.join(CACHE, src.id);
  const branch = src.branch ?? 'main';
  if (existsSync(path.join(dir, '.git'))) {
    execFileSync('git', ['-C', dir, 'fetch', '--depth', '1', 'origin', branch], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'reset', '--hard', `origin/${branch}`], { stdio: 'ignore' });
  } else {
    await mkdir(CACHE, { recursive: true });
    execFileSync('git', ['clone', '--depth', '1', '--branch', branch, '--', src.repo, dir], { stdio: 'ignore' });
  }
  return { ...src, dir, mode: 'clone' };
}

async function collectPosts(src) {
  const dir = path.join(src.dir, 'posts');
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const out = [];
  for (const file of files) {
    const rel = `posts/${file}`;
    const raw = await readFile(path.join(dir, file), 'utf8');
    const { data, body } = parseFrontmatter(raw);
    const errs = [];
    for (const k of ['title', 'slug', 'date', 'status', 'summary']) {
      if (!data[k]) errs.push(`${src.id}/${rel}: 缺少 frontmatter 字段 ${k}`);
    }
    if (data.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug)) {
      errs.push(`${src.id}/${rel}: slug 只允许小写字母/数字/连字符`);
    }
    if (data.status && !['draft', 'published', 'retired'].includes(data.status)) {
      errs.push(`${src.id}/${rel}: status 只能是 draft / published / retired`);
    }
    if (data.date && Number.isNaN(Date.parse(data.date))) errs.push(`${src.id}/${rel}: date 无法解析`);
    const excerpt = data.summary || body.replace(/^#.*$/gm, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    out.push({ source: src, rel, body, excerpt, ...data, _errs: errs });
  }
  return out;
}

/* ---------- 生成 ---------- */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

function postUrl(post, site) {
  const slug = post.slug;
  if (site.baseUrl) return `${site.baseUrl.replace(/\/$/, '')}/${post.source.id}/${slug}/`;
  return `https://github.com/${post.source.repo}/blob/${post.source.branch ?? 'main'}/${post.rel}`;
}

function renderShelf(posts, site) {
  if (posts.length === 0) return '_还没有文章。_';
  const bySource = new Map();
  for (const p of posts) {
    if (!bySource.has(p.source.id)) bySource.set(p.source.id, []);
    bySource.get(p.source.id).push(p);
  }
  const lines = [];
  const newer = posts.filter((p) => p.date).sort((a, b) => (a.date < b.date ? 1 : -1));
  lines.push(`**共 ${posts.length} 篇 · 更新至 ${newer[0] ? ymd(newer[0].date) : '—'}**`, '');
  lines.push('### 最近更新', '');
  for (const p of newer.slice(0, 5)) {
    lines.push(`- \`${ymd(p.date)}\` [${p.title}](${postUrl(p, site)}) — ${p.excerpt}`);
  }
  lines.push('', '### 按文集', '');
  for (const [id, list] of bySource) {
    const src = list[0].source;
    lines.push(`#### ${src.name}（${list.length} 篇）`, '');
    for (const p of list.sort((a, b) => (a.date < b.date ? 1 : -1))) {
      lines.push(`- \`${ymd(p.date)}\` [${p.title}](${postUrl(p, site)}) — ${p.excerpt}`);
    }
    lines.push('', `<sub>仓库：[\`${src.repo}\`](https://github.com/${src.repo})</sub>`, '');
  }
  return lines.join('\n');
}

function renderFeed(posts, site, { title, selfUrl }) {
  const items = posts
    .filter((p) => p.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 50)
    .map(
      (p) => `    <item>
      <title>${xml(p.title)}</title>
      <link>${xml(postUrl(p, site))}</link>
      <guid isPermaLink="true">${xml(postUrl(p, site))}</guid>
      <pubDate>${new Date(p.date).toUTCString()}</pubDate>
      <category>${xml(p.source.name)}</category>
      <description>${xml(p.excerpt)}</description>
    </item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${xml(title)}</title>
    <link>${xml(site.baseUrl || (site.repo ? `https://github.com/${site.repo}` : ''))}</link>
    <description>${xml(site.subtitle ?? '')}</description>
    <language>${xml(site.language ?? 'zh-CN')}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
}

/* ---------- main ---------- */

const config = JSON.parse(await readFile(path.join(ROOT, 'sources.json'), 'utf8'));
const site = { ...config.site };
const sources = [];
for (const s of config.sources) sources.push(await resolveSource(s));

const all = [];
const errors = [];
for (const src of sources) {
  const posts = await collectPosts(src);
  for (const p of posts) errors.push(...p._errs);
  console.log(`${src.name.padEnd(10)} ${String(posts.length).padStart(3)} 篇  (${src.mode})`);
  all.push(...posts.filter((p) => p.status === 'published'));
}

const slugs = new Map();
for (const p of all) {
  const key = `${p.source.id}/${p.slug}`;
  if (slugs.has(key)) errors.push(`slug 重复：${key}`);
  slugs.set(key, p);
}

if (errors.length) {
  console.error('\n发现问题：');
  for (const e of errors) console.error('  ✗ ' + e);
  if (CHECK_ONLY) process.exit(1);
}

if (CHECK_ONLY) {
  console.log(`\n✓ 校验通过，${all.length} 篇已发布文章`);
  process.exit(0);
}

const shelfMd = renderShelf(all, site);
const readmePath = path.join(ROOT, 'README.md');
let readme = existsSync(readmePath) ? await readFile(readmePath, 'utf8') : `# ${site.title}\n\n${BEGIN}\n${END}\n`;
if (!readme.includes(BEGIN) || !readme.includes(END)) {
  throw new Error(`README.md 里找不到 ${BEGIN} / ${END} 标记，无法安全替换目录`);
}
readme = readme.replace(
  new RegExp(`${BEGIN}[\\s\\S]*?${END}`),
  `${BEGIN}\n${shelfMd}\n${END}`,
);
await writeFile(readmePath, readme);

await writeFile(path.join(ROOT, 'feed.xml'), renderFeed(all, site, { title: site.title }));
await mkdir(path.join(ROOT, 'feeds'), { recursive: true });
for (const src of sources) {
  const list = all.filter((p) => p.source.id === src.id);
  await writeFile(
    path.join(ROOT, 'feeds', `${src.id}.xml`),
    renderFeed(list, site, { title: `${site.title} · ${src.name}` }),
  );
}
await writeFile(
  path.join(ROOT, 'shelf.json'),
  JSON.stringify({ site, generatedAt: new Date().toISOString(), posts: all.map((p) => ({
    source: p.source.id, sourceName: p.source.name, title: p.title, slug: p.slug,
    date: ymd(p.date), summary: p.excerpt, tags: p.tags ?? [], url: postUrl(p, site),
    path: p.rel, repo: p.source.repo,
  })) }, null, 2) + '\n',
);

const stale = all.filter((p) => p.status === 'retired').length;
console.log(`\n✓ 已生成 README.md / feed.xml / feeds/*.xml / shelf.json（${all.length} 篇已发布${stale ? `，${stale} 篇已下架` : ''}）`);
if (errors.length) console.log(`  但有 ${errors.length} 条警告，见上。`);
