// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01-run-20261122).
// Re-authored from scratch in this session from the kit's README + reference
// semantics. Dependency-free ES module: run(input) returns exactly the output
// tree makefun-site's build() returns, byte for byte. No state is kept between
// run() calls: every cache lives in the per-case context object B.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SLUG_MAX = 64;
const INCLUDE_DEPTH = 8;
const RESERVED = ['posts', 'tags', 'page'];

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** HTML escape table. */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/;
function escapeHtml(text) {
  if (!ESC_RE.test(text)) return text;
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    let j = i;
    while (j < n) {
      const c = text.charCodeAt(j);
      if (c === 38 || c === 60 || c === 62 || c === 34 || c === 39) break;
      j++;
    }
    if (j > i) out += text.slice(i, j);
    if (j >= n) break;
    out += ESCAPES[text[j]];
    i = j + 1;
  }
  return out;
}

/** The slug of `text`, cached per case in B.slugCache. */
function slugify(text, B) {
  const hit = B.slugCache.get(text);
  if (hit !== undefined) return hit;
  let plain = text;
  let ascii = true;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) >= 128) { ascii = false; break; }
  if (!ascii) plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (const ch of plain) {
    let keep = null;
    if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
    else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
    if (keep === null) { gap = out.length > 0; continue; }
    if (gap) out += '-';
    gap = false;
    out += keep;
  }
  if (out.length > SLUG_MAX) out = out.slice(0, SLUG_MAX);
  let e = out.length;
  while (e > 0 && out.charCodeAt(e - 1) === 45) e--;
  if (e !== out.length) out = out.slice(0, e);
  if (out === '') out = 'untitled';
  B.slugCache.set(text, out);
  return out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

function longDate(date) {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function wordsOf(text) {
  // Runs of non-whitespace, counted without allocating a match array.
  // ASCII whitespace is checked by code; any non-ASCII char is tested with \s
  // so the count matches /\S+/g exactly.
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    let ws;
    if (c < 128) ws = c === 32 || (c >= 9 && c <= 13);
    else ws = /\s/.test(text[i]);
    if (ws) inWord = false;
    else if (!inWord) { inWord = true; n++; }
  }
  return n;
}

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** /^[A-Za-z][A-Za-z0-9+.-]*:/ — a link target with a scheme. */
function hasScheme(t) {
  const c0 = t.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let i = 1; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 58) return true;
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)) return false;
  }
  return false;
}

// ---------------------------------------------------------------- front matter

const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A string value: "..." with \" and \\ its only escapes, or bare. */
function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      let ok = raw.length === 10 && raw.charCodeAt(4) === 45 && raw.charCodeAt(7) === 45;
      let y = 0, mo = 0, d = 0;
      if (ok) {
        for (let i = 0; i < 10; i++) {
          if (i === 4 || i === 7) continue;
          const c = raw.charCodeAt(i);
          if (c < 48 || c > 57) { ok = false; break; }
        }
        if (ok) {
          y = Number(raw.slice(0, 4)); mo = Number(raw.slice(5, 7)); d = Number(raw.slice(8, 10));
          if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) ok = false;
        }
      }
      if (!ok) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const parts = inner.split(',');
      const tags = new Array(parts.length);
      for (let i = 0; i < parts.length; i++) {
        const t = parts[i].trim();
        if (t === '') return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        for (let j = 0; j < t.length; j++) {
          const c = t.charCodeAt(j);
          if (c === 34 || c === 91 || c === 93) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
        tags[i] = t;
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      if (raw.length === 0) return { error: 'key "layout": not a template name' };
      for (let i = 0; i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        const ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45;
        if (!ok) return { error: 'key "layout": not a template name' };
      }
      return { value: raw };
    }
    case 'slug': {
      let ok = raw.length >= 1 && raw.length <= 64;
      if (ok) {
        for (let i = 0; i < raw.length; i++) {
          const c = raw.charCodeAt(i);
          const okC = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45;
          if (!okC) { ok = false; break; }
        }
        if (ok) {
          // /^[a-z0-9]+(?:-[a-z0-9]+)*$/ : no leading/trailing '-', no '--'
          if (raw.charCodeAt(0) === 45 || raw.charCodeAt(raw.length - 1) === 45) ok = false;
          else for (let i = 1; i < raw.length; i++) if (raw.charCodeAt(i) === 45 && raw.charCodeAt(i - 1) === 45) { ok = false; break; }
        }
      }
      return ok ? { value: raw } : { error: 'key "slug": not a slug' };
    }
    default:
      return { error: `unknown key "${key}"` };
  }
}

function parseFrontMatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (isBlankLine(line) || line.charCodeAt(0) === 35) continue;
    // /^([a-z_]+):(?: (.*))?$/
    let k = 0;
    while (k < line.length) {
      const c = line.charCodeAt(k);
      if ((c >= 97 && c <= 122) || c === 95) k++;
      else break;
    }
    if (k === 0 || k >= line.length || line.charCodeAt(k) !== 58) return { error: `line ${i + 1} is not "key: value"` };
    const key = line.slice(0, k);
    let raw;
    if (k + 1 === line.length) raw = '';
    else if (line.charCodeAt(k + 1) === 32) raw = line.slice(k + 2);
    else return { error: `line ${i + 1} is not "key: value"` };
    let e = raw.length;
    while (e > 0) {
      const c = raw.charCodeAt(e - 1);
      if (c === 32 || c === 9) e--;
      else break;
    }
    if (e !== raw.length) raw = raw.slice(0, e);
    if (!FM_KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: lines.slice(close + 1).join('\n') };
}

// ---------------------------------------------------------------- Markdown

function trimLine(line) {
  let a = 0, b = line.length;
  while (a < b) {
    const c = line.charCodeAt(a);
    if (c === 32 || c === 9) a++;
    else break;
  }
  while (b > a) {
    const c = line.charCodeAt(b - 1);
    if (c === 32 || c === 9) b--;
    else break;
  }
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

function isLangChar(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45;
}

/** /^```([A-Za-z0-9_+-]*)[ \t]*$/ — returns the language, or null. */
function fenceOpen(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return null;
  let i = 3;
  while (i < line.length && isLangChar(line.charCodeAt(i))) i++;
  const langEnd = i;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return null;
    i++;
  }
  return line.slice(3, langEnd);
}

function fenceClose(line) {
  if (line.charCodeAt(0) !== 96 || line.charCodeAt(1) !== 96 || line.charCodeAt(2) !== 96) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Heading depth/text, or null. */
function headingOf(line) {
  let n = 0;
  while (n < 6 && line.charCodeAt(n) === 35) n++;
  if (n === 0) return null;
  if (n >= line.length) return null;
  const c = line.charCodeAt(n);
  if (c !== 32 && c !== 9) return null;
  const text = trimLine(line.slice(n + 1));
  if (text === '') return null;
  return { depth: n, text };
}

function isHr(line) {
  const dash = line.charCodeAt(0) === 45 && line.charCodeAt(1) === 45 && line.charCodeAt(2) === 45;
  const star = line.charCodeAt(0) === 42 && line.charCodeAt(1) === 42 && line.charCodeAt(2) === 42;
  if (!dash && !star) return false;
  for (let i = 3; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function endsParagraph(line) {
  if (line.length === 0) return true;
  const c = line.charCodeAt(0);
  if (c === 32 || c === 9) return isBlankLine(line);
  if (c === 96) return fenceOpen(line) !== null;
  if (c === 35) return headingOf(line) !== null;
  if (c === 45 || c === 42) return isHr(line);
  return false;
}

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (c !== '*') continue;
    if (s[j + 1] === '*') { j++; continue; }
    return j;
  }
  return -1;
}

function inline(s, env) {
  const special = /[\\`*[]/g;
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    // Fast plain run: one scan to the next \ ` * [
    special.lastIndex = i;
    const m = special.exec(s);
    const j = m === null ? n : m.index;
    if (j > i) { out += escapeHtml(s.slice(i, j)); i = j; }
    if (i >= n) break;
    const c = s[i];
    if (c === '\\' && i + 1 < n && ESCAPABLE.has(s[i + 1])) {
      out += escapeHtml(s[i + 1]);
      i += 2;
      continue;
    }
    if (c === '`') {
      const m = s.indexOf('`', i + 1);
      if (m > i + 1) { out += `<code>${escapeHtml(s.slice(i + 1, m))}</code>`; i = m + 1; }
      else { out += '`'; i++; }
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const m = findUnescaped(s, '**', i + 2);
        if (m > i + 2) { out += `<strong>${inline(s.slice(i + 2, m), env)}</strong>`; i = m + 2; }
        else { out += '**'; i += 2; }
        continue;
      }
      const m = findSingleStar(s, i + 1);
      if (m > i + 1) { out += `<em>${inline(s.slice(i + 1, m), env)}</em>`; i = m + 1; }
      else { out += '*'; i++; }
      continue;
    }
    if (c === '[') {
      const kk = findUnescaped(s, ']', i + 1);
      const m = kk !== -1 && s[kk + 1] === '(' ? s.indexOf(')', kk + 2) : -1;
      const target = m === -1 ? '' : s.slice(kk + 2, m);
      if (target !== '' && !/\s/.test(target)) {
        out += `<a href="${escapeHtml(env.link(target))}">${inline(s.slice(i + 1, kk), env)}</a>`;
        i = m + 1;
        continue;
      }
      out += '[';
      i++;
      continue;
    }
    out += escapeHtml(c);
    i++;
  }
  return out;
}

function renderMarkdown(src, env, B) {
  const lines = src.split('\n');
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const L = lines.length;
  while (i < L) {
    const line = lines[i];
    if (line.length === 0) { i++; continue; }
    const c0 = line.charCodeAt(0);
    // Dispatch on the first character: a block can only start one way.
    if (c0 === 32 || c0 === 9) {
      if (isBlankLine(line)) { i++; continue; }
      // otherwise a paragraph line (indented lines are not code)
    } else if (c0 === 96) {
      const lang = fenceOpen(line);
      if (lang === null) {
        // not a fence: a paragraph line
      } else {
        const body = [];
        i++;
        while (i < L && !fenceClose(lines[i])) body.push(lines[i++]);
        i++;
        const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
        let inner = '';
        for (const bl of body) inner += `${escapeHtml(bl)}\n`;
        blocks.push(`<pre><code${cls}>${inner}</code></pre>`);
        continue;
      }
    } else if (c0 === 35) {
      const heading = headingOf(line);
      if (heading === null) {
        // not a heading: a paragraph line
      } else {
        const id = uniqueSlug(slugify(heading.text, B), ids);
        const html = inline(heading.text, env);
        blocks.push(`<h${heading.depth} id="${id}">${html}</h${heading.depth}>`);
        if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html });
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      if (isHr(line)) { blocks.push('<hr>'); i++; continue; }
      if (line.charCodeAt(1) !== 32) {
        // not a bullet: a paragraph line
      } else {
        const items = [];
        while (i < L) {
          const l = lines[i];
          if ((l.charCodeAt(0) === 45 || l.charCodeAt(0) === 42) && l.charCodeAt(1) === 32) {
            items.push([trimLine(l.slice(2))]);
            i++;
            continue;
          }
          let sp = 0;
          while (sp < l.length && l.charCodeAt(sp) === 32) sp++;
          if (sp >= 2 && sp < l.length && !/\s/.test(l[sp])) {
            items[items.length - 1].push(trimLine(l));
            i++;
            continue;
          }
          break;
        }
        let inner = '';
        for (const parts of items) inner += `<li>${inline(parts.join('\n'), env)}</li>\n`;
        blocks.push(`<ul>\n${inner}</ul>`);
        continue;
      }
    } else if (c0 === 62) {
      const body = [];
      while (i < L && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        body.push(l.length > 1 && l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1));
      }
      const kept = [];
      for (const bl of body) {
        const t = trimLine(bl);
        if (t !== '') kept.push(t);
      }
      blocks.push(kept.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(kept.join('\n'), env)}</p>\n</blockquote>`);
      continue;
    } else if (c0 >= 48 && c0 <= 57) {
      let d = 0;
      while (d < 9 && d < line.length && line.charCodeAt(d) >= 48 && line.charCodeAt(d) <= 57) d++;
      if (d >= 1 && d < line.length && line.charCodeAt(d) === 46 && line.charCodeAt(d + 1) === 32) {
        const startNum = Number(line.slice(0, d));
        const items = [];
        while (i < L) {
          const l = lines[i];
          let dd = 0;
          while (dd < 9 && dd < l.length && l.charCodeAt(dd) >= 48 && l.charCodeAt(dd) <= 57) dd++;
          if (dd >= 1 && dd < l.length && l.charCodeAt(dd) === 46 && l.charCodeAt(dd + 1) === 32) {
            items.push([trimLine(l.slice(dd + 2))]);
            i++;
            continue;
          }
          let sp = 0;
          while (sp < l.length && l.charCodeAt(sp) === 32) sp++;
          if (sp >= 2 && sp < l.length && !/\s/.test(l[sp])) {
            items[items.length - 1].push(trimLine(l));
            i++;
            continue;
          }
          break;
        }
        const open = startNum !== 1 ? `<ol start="${startNum}">` : '<ol>';
        let inner = '';
        for (const parts of items) inner += `<li>${inline(parts.join('\n'), env)}</li>\n`;
        blocks.push(`${open}\n${inner}</ol>`);
        continue;
      }
      // not an ordered list: a paragraph line
    }
    const body = [trimLine(line)];
    i++;
    while (i < L && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>`);
  }
  return { html: blocks.map((b) => `${b}\n`).join(''), toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- Templates

class TemplateError extends Error {}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function isSpacesTabs(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = isSpacesTabs(src.slice(lineStart, open)) && isSpacesTabs(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** A value as text. */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** First-name lookup in the prototype-chain scope: nearest frame holding it. */
function lookup(scope, path) {
  if (!((path[0]) in scope)) return undefined;
  let v = scope[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

/** Tree-walking interpreter (fallback if a template cannot be compiled). */
function renderInterp(nodes, scope, depth, B) {
  let out = '';
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        out += n.text;
        break;
      case 'var':
        out += escapeHtml(textOf(lookup(scope, n.path)));
        break;
      case 'raw':
        out += textOf(lookup(scope, n.path));
        break;
      case 'if': {
        const branch = truthy(lookup(scope, n.path)) !== n.not ? n.then : n.else;
        if (branch !== null) out += renderInterp(branch, scope, depth, B);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (!Array.isArray(xs)) break;
        for (let k = 0; k < xs.length; k++) {
          const s2 = Object.create(scope);
          s2[n.name] = xs[k];
          s2.loop = { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length };
          out += renderInterp(n.body, s2, depth, B);
        }
        break;
      }
      case 'include': {
        const t = B.templates.get(n.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) out += renderInterp(t, scope, depth + 1, B);
        break;
      }
    }
  }
  return out;
}

// ---- code generation: compile a template's node tree to a plain function ----

function lookupCode(path, sv, ctr, out) {
  const t = `_t${ctr.n++}`;
  // First segment: a plain property read walks the prototype-chain scope
  // exactly like the reference's nearest-scope search (the chain ends at a
  // null-prototype root, so a missing name reads undefined).
  out.push(`let ${t}=${sv}.${path[0]};`);
  for (let k = 1; k < path.length; k++) {
    out.push(`if(${t}!==null&&typeof ${t}==='object'&&Object.hasOwn(${t},'${path[k]}'))${t}=${t}.${path[k]};else ${t}=undefined;`);
  }
  return t;
}

function genNodes(nodes, sv, ctr, out) {
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        out.push(`O.push(${JSON.stringify(n.text)});`);
        break;
      case 'var': {
        const t = lookupCode(n.path, sv, ctr, out);
        out.push(`O.push(H.esc(typeof ${t}==='string'?${t}:H.txt(${t})));`);
        break;
      }
      case 'raw': {
        const t = lookupCode(n.path, sv, ctr, out);
        out.push(`O.push(typeof ${t}==='string'?${t}:H.txt(${t}));`);
        break;
      }
      case 'if': {
        const t = lookupCode(n.path, sv, ctr, out);
        out.push(`if(H.tru(${t})!==${n.not}){`);
        genNodes(n.then, sv, ctr, out);
        out.push('}');
        if (n.else !== null) {
          out.push('else{');
          genNodes(n.else, sv, ctr, out);
          out.push('}');
        }
        break;
      }
      case 'for': {
        const t = lookupCode(n.path, sv, ctr, out);
        const xs = `_x${ctr.n++}`;
        const k = `_k${ctr.n++}`;
        const s2 = `_s${ctr.n++}`;
        out.push(`{const ${xs}=${t};if(Array.isArray(${xs})){for(let ${k}=0;${k}<${xs}.length;${k}++){const ${s2}=Object.create(${sv});${s2}.${n.name}=${xs}[${k}];${s2}.loop={index:${k}+1,first:${k}===0,last:${k}===${xs}.length-1,length:${xs}.length};`);
        genNodes(n.body, s2, ctr, out);
        out.push('}}}');
        break;
      }
      case 'include':
        out.push(`O.push(H.inc(${JSON.stringify(n.name)},${sv},D,C));`);
        break;
    }
  }
}

function compileTemplate(nodes) {
  const ctr = { n: 0 };
  const out = [];
  genNodes(nodes, 'S', ctr, out);
  const src = `let O=[];\n${out.join('\n')}\nreturn O.join('');`;
  return new Function('S', 'D', 'C', 'H', src);
}

/** First names a template reads, transitively through includes (cycle-safe). */
function collectRefs(name, B, seen, acc) {
  if (seen.has(name)) return;
  seen.add(name);
  const nodes = B.templates.get(name);
  if (nodes === undefined) return;
  const walk = (ns) => {
    for (const n of ns) {
      if (n.kind === 'var' || n.kind === 'raw' || n.kind === 'if' || n.kind === 'for') acc.add(n.path[0]);
      if (n.kind === 'for') walk(n.body);
      if (n.kind === 'if') { walk(n.then); if (n.else !== null) walk(n.else); }
      if (n.kind === 'include') collectRefs(n.name, B, seen, acc);
    }
  };
  walk(nodes);
}

/** Longest include chain (edges) from a template; Infinity when it cycles. */
function chainLen(name, B, stack, memo) {
  if (memo.has(name)) return memo.get(name);
  if (stack.has(name)) return Infinity;
  stack.add(name);
  const nodes = B.templates.get(name);
  let best = 0;
  if (nodes !== undefined) {
    const walk = (ns) => {
      for (const n of ns) {
        if (n.kind === 'for') walk(n.body);
        else if (n.kind === 'if') { walk(n.then); if (n.else !== null) walk(n.else); }
        else if (n.kind === 'include' && B.templates.has(n.name)) {
          const l = chainLen(n.name, B, stack, memo);
          if (l === Infinity) best = Infinity;
          else if (best !== Infinity && l + 1 > best) best = l + 1;
        }
      }
    };
    walk(nodes);
  }
  stack.delete(name);
  memo.set(name, best);
  return best;
}

// ---------------------------------------------------------------- the build

function cardOf(s, B) {
  return {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  };
}

const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });

/** One site's output tree: path -> text. */
export function run(input) {
  const B = {
    input,
    base: input.site.base_url.replace(/\/+$/, ''),
    slugCache: new Map(),
    templates: new Map(),
    compiled: new Map(),
    cacheInfo: new Map(),
    report: [],
    sources: [],
    statics: [],
    bySource: new Map(),
    broken: new Set(),
    posts: [],
    tags: [],
    cards: new Map(),
    output: {},
  };

  // Templates, parsed in code-unit order of name; one that does not parse is
  // reported and left out.
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      B.templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      B.report.push(err.message);
    }
  }
  // Compile each parsed template; fall back to the interpreter if needed.
  for (const [name, nodes] of B.templates) {
    try {
      B.compiled.set(name, compileTemplate(nodes));
    } catch {
      B.compiled.set(name, (scope, depth) => renderInterp(nodes, scope, depth, B));
    }
  }
  // Per-template include analysis for the loop-independent include cache.
  {
    const memo = new Map();
    for (const name of B.templates.keys()) {
      const refs = new Set();
      collectRefs(name, B, new Set(), refs);
      const len = chainLen(name, B, new Set(), memo);
      let refsOk = true;
      for (const r of refs) if (r !== 'site' && r !== 'tags' && r !== 'recent') { refsOk = false; break; }
      B.cacheInfo.set(name, { refsOk, len });
    }
  }

  // 1. Sources, in code-unit order of path; .md is a source, the rest static.
  {
    const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
    for (const f of files) {
      if (f.path.endsWith('.md')) B.sources.push({ path: f.path, text: f.content.replace(/\r\n?/g, '\n') });
      else B.statics.push({ path: f.path, content: f.content });
    }
  }

  // 2. Front matter, in order: refused, own directory, post without date,
  // layout missing, draft.
  {
    const kept = [];
    for (const s of B.sources) {
      const fm = parseFrontMatter(s.text);
      if ('error' in fm) {
        B.report.push(`refused ${s.path}: ${fm.error}`);
        continue;
      }
      s.data = fm.data;
      s.body = fm.body;
      s.post = s.path.startsWith('posts/');
      const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
      if (own !== undefined) {
        B.report.push(`refused ${s.path}: ${own}/ is the generator's own`);
        continue;
      }
      if (s.post && !Object.hasOwn(s.data, 'date')) {
        B.report.push(`refused ${s.path}: a post needs a date`);
        continue;
      }
      const layout = s.data.layout ?? (s.post ? 'post' : 'page');
      if (!B.templates.has(layout)) {
        B.report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
        continue;
      }
      s.layout = layout;
      if (s.data.draft === true) {
        B.report.push(`draft ${s.path}`);
        continue;
      }
      kept.push(s);
    }
    B.sources = kept;
  }

  // 3. Permalinks: slug unique in its directory, in source order.
  {
    const taken = new Map();
    const takenIn = (dir) => {
      if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : []));
      return taken.get(dir);
    };
    for (const s of B.sources) {
      const dir = s.post ? 'posts' : dirOf(s.path);
      const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title, B), takenIn(dir));
      s.slug = slug;
      s.outDir = dir === '' ? slug : `${dir}/${slug}`;
      s.url = `${B.base}/${s.outDir}/`;
      B.bySource.set(s.path, s);
    }
  }

  // 4. Markdown, links resolved to pages and static files.
  {
    const staticPaths = new Set(B.statics.map((f) => f.path));
    for (const s of B.sources) {
      const dir = dirOf(s.path);
      const env = {
        link: (target) => {
          if (hasScheme(target) || target.startsWith('/') || target.startsWith('#')) return target;
          const hash = target.indexOf('#');
          const rel = hash === -1 ? target : target.slice(0, hash);
          const frag = hash === -1 ? '' : target.slice(hash);
          const path = rel === '' ? null : resolvePath(dir, rel);
          if (path !== null && B.bySource.has(path)) return `${B.bySource.get(path).url}${frag}`;
          if (path !== null && staticPaths.has(path)) return `${B.base}/${path}${frag}`;
          B.broken.add(`broken-link ${s.path} -> ${target}`);
          return target;
        },
      };
      const md = renderMarkdown(s.body, env, B);
      s.html = md.html;
      s.toc = md.toc;
      s.excerpt = md.excerpt;
    }
  }

  // 5. Collections: posts newest first, equal dates by slug.
  {
    const posts = B.sources.filter((s) => s.post);
    posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
    B.posts = posts;
    posts.forEach((p, k) => {
      p.newer = k === 0 ? null : posts[k - 1];
      p.older = k === posts.length - 1 ? null : posts[k + 1];
    });
  }

  // 6. Tags, grouped by slug, named as first met in collection order.
  {
    const bySlug = new Map();
    const ownTags = (s) => {
      const seen = new Set();
      const out = [];
      for (const name of s.data.tags ?? []) {
        const sg = slugify(name, B);
        if (!seen.has(sg)) { seen.add(sg); out.push(name); }
      }
      return out;
    };
    for (const p of B.posts) {
      p.tagRefs = [];
      for (const name of ownTags(p)) {
        const slug = slugify(name, B);
        if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, url: `${B.base}/tags/${slug}/`, posts: [] });
        const tag = bySlug.get(slug);
        tag.posts.push(p);
        p.tagRefs.push(tag);
      }
    }
    for (const s of B.sources) {
      if (!s.post) s.tagRefs = ownTags(s).map((name) => bySlug.get(slugify(name, B)) ?? { name, slug: slugify(name, B), url: '', posts: [] });
    }
    B.tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));
  }

  // 7. Layouts.
  {
    B.cards = new Map(B.posts.map((p) => [p, cardOf(p, B)]));
    const site = { title: input.site.title, base_url: B.base };
    const allTags = B.tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
    const recent = B.posts.slice(0, input.site.recent).map((p) => B.cards.get(p));
    const incCache = new Map();
    const H = {
      esc: escapeHtml,
      txt: textOf,
      tru: truthy,
      inc: (name, scope, depth, cache) => {
        const fn = B.compiled.get(name);
        if (fn === undefined || depth >= INCLUDE_DEPTH) return '';
        const info = B.cacheInfo.get(name);
        if (info !== undefined && info.refsOk && info.len !== Infinity && depth + 1 + info.len <= INCLUDE_DEPTH) {
          const hit = cache.get(name);
          if (hit !== undefined) return hit;
          const s = fn(scope, depth + 1, cache, H);
          cache.set(name, s);
          return s;
        }
        return fn(scope, depth + 1, cache, H);
      },
    };
    const render = (name, vars) => {
      const fn = B.compiled.get(name);
      if (fn === undefined) return null;
      const root = Object.create(null);
      root.site = site;
      root.tags = allTags;
      root.recent = recent;
      for (const k of Object.keys(vars)) root[k] = vars[k];
      return fn(root, 0, incCache, H);
    };
    const pageOf = (s) => {
      const card = s.post ? B.cards.get(s) : cardOf(s, B);
      return {
        ...card,
        slug: s.slug,
        content: s.html,
        toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
        newer: linkOf(s.newer ?? null),
        older: linkOf(s.older ?? null),
        is_post: s.post,
      };
    };
    for (const s of B.sources) B.output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
    const per = input.site.per_page;
    const pages = Math.max(1, Math.ceil(B.posts.length / per));
    const indexUrl = (k) => (k === 1 ? `${B.base}/` : `${B.base}/page/${k}/`);
    for (let k = 1; k <= pages; k++) {
      const html = render('index', {
        posts: B.posts.slice((k - 1) * per, k * per).map((p) => B.cards.get(p)),
        pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
      });
      if (html !== null) B.output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
    }
    for (const t of B.tags) {
      const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => B.cards.get(p)) } });
      if (html !== null) B.output[`tags/${t.slug}/index.html`] = html;
    }
    const tagsHtml = render('tags', {});
    if (tagsHtml !== null) B.output['tags/index.html'] = tagsHtml;
    for (const f of B.statics) {
      if (Object.hasOwn(B.output, f.path)) B.report.push(`shadowed ${f.path}: a built page has its path`);
      else B.output[f.path] = f.content;
    }
  }

  // 8. The report.
  {
    const lines = [...B.report, ...B.broken].sort(byCodeUnits);
    const pages = B.sources.filter((s) => !s.post).length;
    lines.push(`built ${pages} pages, ${B.posts.length} posts, ${B.tags.length} tags and ${B.statics.length} static files`);
    B.output['build-report.txt'] = `${lines.join('\n')}\n`;
  }

  return B.output;
}
