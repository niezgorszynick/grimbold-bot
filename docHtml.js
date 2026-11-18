// docHtml.js — A Google Doc's HTML (its "Download as HTML" export, or a
// published-to-web page) made safe to show in the panel, keeping how it
// looks: bold, italic, underline, strikethrough, text size, colour and
// highlight, alignment, indents and spacing, headings, lists, tables, and
// links, including links to the doc's own headings and bookmarks.
//
// Google styles text with classes (.c3{font-weight:700}); these become
// inline styles, filtered to a short list of properties. Every tag and
// attribute not listed here is dropped (scripts, styles and comments with
// their content). Sizes in pt become calc(var(--gd-pt) * n), so nested text
// doesn't grow and the copy's CSS sets what one point is.

'use strict';

const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'blockquote', 'div']);
const ALLOWED = new Set([...BLOCK, 'span', 'a', 'ul', 'ol', 'br', 'hr', 'table', 'thead', 'tbody', 'tr', 'b', 'strong', 'i', 'em', 'u', 's', 'sup', 'sub', 'code', 'pre']);
const VOID = new Set(['br', 'hr']);
// Dropped together with everything inside them.
const DROP_WITH_CONTENT = new Set(['script', 'style', 'head', 'title', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'textarea', 'select', 'button']);

// Properties kept on any element, and on block elements only.
const INLINE_PROPS = new Set(['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'font-size', 'color', 'background-color', 'vertical-align', 'font-variant', 'letter-spacing']);
const BLOCK_PROPS = new Set(['text-align', 'line-height', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding-top', 'padding-bottom', 'text-indent', 'border-left', 'border-bottom', 'border-top']);
const LENGTH_PROPS = new Set(['font-size', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right', 'padding-top', 'padding-bottom', 'text-indent', 'letter-spacing']);

const decode = text => String(text)
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, '\u00a0').replace(/&amp;/g, '&');
const escapeAttr = text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A length as the copy shows it: pt (Google's unit) as calc(var(--gd-pt) * n),
// px as is; negative indents allowed (hanging indents), sizes capped.
function cleanLength(prop, value) {
  const match = String(value).trim().match(/^(-?\d*\.?\d+)(pt|px|em)?$/i);
  if (!match) return null;
  let number = Number(match[1]);
  const unit = (match[2] || (number === 0 ? 'pt' : '')).toLowerCase();
  if (!unit) return null;
  if (prop === 'font-size') {
    if (number <= 0) return null;
    const pt = unit === 'px' ? number * 0.75 : unit === 'em' ? number * 11 : number;
    return `calc(var(--gd-pt) * ${Math.min(Math.max(pt, 5), 72)})`;
  }
  if (unit === 'em') return `${Math.max(Math.min(number, 20), -20)}em`;
  if (unit === 'px') number *= 0.75;
  number = Math.max(Math.min(number, 400), -200);
  return number === 0 ? '0' : `calc(var(--gd-pt) * ${Math.round(number * 100) / 100})`;
}

const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;

function cleanDeclaration(prop, value, isBlock) {
  prop = prop.trim().toLowerCase();
  value = String(value).trim().replace(/\s*!important$/i, '');
  if (!INLINE_PROPS.has(prop) && !(isBlock && BLOCK_PROPS.has(prop))) return null;
  if (/[<>"\\;{}]|url\s*\(|expression|javascript:/i.test(value)) return null;
  if (LENGTH_PROPS.has(prop)) return cleanLength(prop, value);
  switch (prop) {
    case 'font-weight': return /^(normal|bold|[1-9]00)$/i.test(value) ? value : null;
    case 'font-style': return /^(normal|italic|oblique)$/i.test(value) ? value : null;
    case 'font-variant': return /^(normal|small-caps)$/i.test(value) ? value : null;
    case 'text-decoration': case 'text-decoration-line': return /^(none|underline|line-through|overline)( (underline|line-through|overline))*$/i.test(value) ? value : null;
    case 'vertical-align': return /^(baseline|super|sub)$/i.test(value) ? value : null;
    case 'text-align': return /^(left|right|center|justify|start|end)$/i.test(value) ? value : null;
    case 'line-height': return /^(normal|\d*\.?\d+)$/.test(value) && (value === 'normal' || Number(value) <= 4) ? value : null;
    case 'color': case 'background-color': return COLOR.test(value) || /^(transparent|inherit)$/i.test(value) ? value : null;
    case 'border-left': case 'border-bottom': case 'border-top': {
      const parts = value.split(/\s+/);
      const [width, style, color] = parts;
      const w = cleanLength('margin-top', width);
      return parts.length === 3 && w && /^(solid|dotted|dashed|double|none)$/i.test(style) && COLOR.test(color) ? `${w} ${style} ${color}` : null;
    }
    default: return null;
  }
}

function parseDeclarations(text) {
  return String(text || '').split(';').map(part => {
    const index = part.indexOf(':');
    return index > 0 ? [part.slice(0, index), part.slice(index + 1)] : null;
  }).filter(Boolean);
}

// Simple rules in the doc's <style>: .c3{…}, p{…}, h1{…}, .title{…}.
function parseStyleRules(html) {
  const classes = new Map();
  const tags = new Map();
  for (const [, css] of String(html).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      for (const selector of selectors.split(',').map(entry => entry.trim())) {
        let match = selector.match(/^\.([\w-]+)$/);
        if (match) { classes.set(match[1], [...(classes.get(match[1]) || []), ...parseDeclarations(body)]); continue; }
        match = selector.match(/^(p|h[1-6]|li|td|th|table)$/i);
        if (match) tags.set(match[1].toLowerCase(), [...(tags.get(match[1].toLowerCase()) || []), ...parseDeclarations(body)]);
      }
    }
  }
  return { classes, tags };
}

function attributes(source) {
  const attrs = {};
  for (const [, name, , double, single, bare] of String(source).matchAll(/([^\s=/"'<>]+)(\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[name.toLowerCase()] = decode(double ?? single ?? bare ?? '');
  }
  return attrs;
}

const anchorId = id => `gd-${String(id).replace(/[^\w.:-]/g, '')}`;

// A link's target: external (http, https, mailto), or one of the doc's own
// headings and bookmarks (#h.…, #id.…, or a link to this doc with #heading=).
function cleanHref(href, docKey) {
  let url = String(href || '').trim();
  const wrapped = url.match(/^https?:\/\/(www\.)?google\.com\/url\?(.*)$/i);
  if (wrapped) {
    const q = new URLSearchParams(wrapped[2]).get('q');
    if (q) url = q;
  }
  if (url.startsWith('#')) {
    const id = url.slice(1).replace(/^(heading|bookmark)=/, '');
    return id ? { href: `#${anchorId(id)}`, internal: true } : null;
  }
  const own = url.match(/^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/(e\/)?([\w-]+)\/[^#]*#(heading|bookmark)=([\w.:-]+)/i);
  if (own && docKey && (own[1] ? `pub:${own[2]}` : own[2]) === docKey) return { href: `#${anchorId(own[4])}`, internal: true };
  if (/^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(url)) return { href: url, internal: false };
  return null;
}

// The part of the page that is the doc: a published page's #contents, else <body>.
function docBody(html) {
  const source = String(html);
  const contents = source.search(/<div[^>]+id="contents"/i);
  if (contents >= 0) {
    const start = source.indexOf('>', contents) + 1;
    const footer = source.slice(start).search(/<div[^>]+id="footer"|<\/body>/i);
    return footer >= 0 ? source.slice(start, start + footer) : source.slice(start);
  }
  const body = source.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return body ? body[1] : source;
}

// → safe HTML for .chronicle-rich, or '' when there is no text in it.
function cleanDocHtml(html, { docKey = null } = {}) {
  const { classes, tags } = parseStyleRules(html);
  const body = docBody(html).replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  const stack = [];
  let dropping = null;
  let dropDepth = 0;

  for (const [token, closing, rawName, rest] of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>|[^<]+|</g)) {
    if (!rawName) {
      if (dropping) continue;
      // Text: re-escaped so nothing in it can become markup.
      out.push(token === '<' ? '&lt;' : token.replace(/&(?![a-z]+;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;').replace(/>/g, '&gt;'));
      continue;
    }
    const name = rawName.toLowerCase();
    if (dropping) {
      if (name === dropping) dropDepth += closing ? -1 : (rest.trim().endsWith('/') ? 0 : 1);
      if (dropDepth <= 0) dropping = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !rest.trim().endsWith('/')) { dropping = name; dropDepth = 1; }
      continue;
    }
    if (!ALLOWED.has(name)) continue;
    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at < 0) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    const attrs = attributes(rest);
    const isBlock = BLOCK.has(name);
    const declarations = [
      ...(tags.get(name) || []),
      ...String(attrs.class || '').split(/\s+/).filter(Boolean).flatMap(cls => classes.get(cls) || []),
      ...parseDeclarations(attrs.style)
    ];
    const style = new Map();
    for (const [prop, value] of declarations) {
      const clean = cleanDeclaration(prop, value, isBlock);
      if (clean !== null) style.set(prop.trim().toLowerCase(), clean);
    }
    // Google writes plain text as font-weight:400, font-style:normal… on every span: drop the defaults.
    if (style.get('font-weight') === '400' || style.get('font-weight') === 'normal') style.delete('font-weight');
    if (style.get('font-style') === 'normal') style.delete('font-style');
    if (style.get('vertical-align') === 'baseline') style.delete('vertical-align');
    if (/^(#000|#000000|rgb\(0,\s*0,\s*0\))$/i.test(style.get('color') || '')) style.delete('color');
    if (/^(#fff|#ffffff|transparent)$/i.test(style.get('background-color') || '')) style.delete('background-color');
    if (style.get('text-decoration') === 'none') style.delete('text-decoration');
    // Lists are indented by the page already; Google's own indent would double it.
    if (name === 'li') { style.delete('margin-left'); style.delete('text-indent'); }

    const parts = [name];
    if (attrs.id && /^[\w.:-]{1,100}$/.test(attrs.id)) parts.push(`id="${escapeAttr(anchorId(attrs.id))}"`);
    if (name === 'a') {
      const link = attrs.href ? cleanHref(attrs.href, docKey) : null;
      if (link) {
        parts.push(`href="${escapeAttr(link.href)}"`);
        if (!link.internal) parts.push('target="_blank" rel="noopener noreferrer nofollow"');
      }
    }
    if ((name === 'td' || name === 'th')) {
      for (const span of ['colspan', 'rowspan']) if (/^\d{1,2}$/.test(attrs[span] || '')) parts.push(`${span}="${attrs[span]}"`);
    }
    if (name === 'ol' && /^\d{1,4}$/.test(attrs.start || '')) parts.push(`start="${attrs.start}"`);
    if (style.size) parts.push(`style="${escapeAttr([...style].map(([prop, value]) => `${prop}:${value}`).join(';'))}"`);
    out.push(`<${parts.join(' ')}>`);
    if (!VOID.has(name)) stack.push(name);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  const result = out.join('').trim();
  // Nothing but empty paragraphs: no copy.
  return result.replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00a0/g, '').trim() ? result : '';
}

module.exports = { cleanDocHtml, cleanHref, anchorId };
