const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanDocHtml, cleanHref } = require('../docHtml');

const KEY = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
// Shaped like Google Docs' "Download as HTML": styles in classes, links
// wrapped in google.com/url, headings with ids.
const EXPORT = `<html><head><meta content="text/html; charset=UTF-8" http-equiv="content-type">
<style type="text/css">@import url('https://themes.googleusercontent.com/fonts/css?kit=x');
ol.lst-kix_a-0{list-style-type:none}.lst-kix_a-0>li:before{content:"\\0025cf  "}
.c1{color:#000000;font-weight:400;text-decoration:none;vertical-align:baseline;font-size:11pt;font-family:"Arial";font-style:normal}
.c2{font-weight:700}.c3{font-style:italic}.c4{text-align:center}.c5{font-size:18pt}
.c6{color:#1155cc;text-decoration:underline}.c7{margin-left:36pt;padding-left:0pt}
.c8{background-color:#ffff00}.c9{position:absolute;behavior:url(x.htc)}
h1{padding-top:20pt;color:#000000;font-size:20pt;padding-bottom:6pt;font-family:"Arial";line-height:1.15;page-break-after:avoid;text-align:left}
p{margin:0;color:#000000;font-size:11pt;font-family:"Arial"}
</style></head><body class="c10 doc-content">
<p class="c4"><span class="c1 c5">Dziennik Elary</span></p>
<p class="c0"><a class="c6" href="#h.abc123">Rozdział pierwszy</a> · <a class="c6" href="https://www.google.com/url?q=https://docs.google.com/document/d/${KEY}/edit%23heading%3Dh.def456&amp;sa=D&amp;source=editors&amp;ust=1">Rozdział drugi</a></p>
<h1 class="c0" id="h.abc123"><span class="c1">Rozdział pierwszy</span></h1>
<p><span class="c1">To był </span><span class="c2">mroczny</span><span class="c1"> i </span><span class="c3">zimny</span><span class="c1 c8 c9"> dzień</span><span>, a &lt;script&gt; to tylko słowo &amp; nic więcej.</span></p>
<p><span>Zobacz </span><a class="c6" href="https://www.google.com/url?q=https://example.com/map?a%3D1%26b%3D2&amp;sa=D">mapę</a><a href="javascript:alert(1)">zło</a></p>
<ul class="c7 lst-kix_a-0 start"><li class="c7 li-bullet-0"><span>Miecz</span></li><li class="c7"><span>Tarcza</span></li></ul>
<table><tr><td colspan="2" onclick="x()"><p><span>Komórka</span></p></td></tr></table>
<script>alert(1)</script><img src="https://lh3.googleusercontent.com/x.png" onerror="alert(1)">
<h1 class="c0" id="h.def456"><span class="c1">Rozdział drugi</span></h1>
<p><span></span></p>
</body></html>`;

test('a Google export keeps its formatting, headings and links, and nothing unsafe', () => {
  const html = cleanDocHtml(EXPORT, { docKey: KEY });
  // Size, alignment, bold, italic, highlight.
  assert.match(html, /<p style="[^"]*text-align:center[^"]*"><span style="[^"]*font-size:calc\(var\(--gd-pt\) \* 18\)[^"]*">Dziennik Elary<\/span><\/p>/);
  assert.match(html, /<span style="font-weight:700">mroczny<\/span>/);
  assert.match(html, /<span style="font-style:italic">zimny<\/span>/);
  assert.match(html, /background-color:#ffff00/);
  // Plain text carries no default noise (weight 400, black, baseline).
  assert.doesNotMatch(html, /font-weight:400|color:#000000|vertical-align:baseline/);
  // Headings keep their ids; links to them (plain #h.… and full doc links with #heading=) lead there.
  assert.match(html, /<h1 id="gd-h.abc123" style="[^"]*font-size:calc\(var\(--gd-pt\) \* 20\)/);
  assert.match(html, /<a href="#gd-h.abc123" style="[^"]*">Rozdział pierwszy<\/a>/);
  assert.match(html, /<a href="#gd-h.def456" style="[^"]*">Rozdział drugi<\/a>/);
  assert.match(html, /<h1 id="gd-h.def456"/);
  // Outside links lose Google's redirect and open in a new tab.
  assert.match(html, /<a href="https:\/\/example.com\/map\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer nofollow"[^>]*>mapę<\/a>/);
  // Lists and tables stay; Google's own list indent doesn't.
  assert.match(html, /<ul style="[^"]*"><li>Miecz<\/li><li>Tarcza<\/li><\/ul>|<ul[^>]*><li[^>]*><span>Miecz<\/span><\/li>/);
  assert.doesNotMatch(html, /<li style="[^"]*margin-left/);
  assert.match(html, /<td colspan="2">/);
  // Nothing that runs or loads.
  assert.doesNotMatch(html, /<script|javascript:|onerror|onclick|<img|position:|behavior|@import|font-family/i);
  assert.match(html, /a &lt;script&gt; to tylko słowo &amp; nic więcej/, 'text that looks like a tag stays text');
  assert.match(html, /<a>zło<\/a>/, 'a javascript: link loses its target');
});

test('a published page: only #contents, and a doc with no text gives nothing', () => {
  const page = '<html><body><div id="header">Published using Google Docs</div><div id="contents"><style>.c1{font-weight:700}</style><p><span class="c1">Listy</span></p></div><div id="footer">Report abuse</div></body></html>';
  assert.equal(cleanDocHtml(page, { docKey: 'pub:2PACX-x' }), '<p><span style="font-weight:700">Listy</span></p>');
  assert.equal(cleanDocHtml('<html><body><p><span></span></p></body></html>'), '');
});

test('links to another doc stay outside links; unknown schemes are dropped', () => {
  assert.deepEqual(cleanHref('https://docs.google.com/document/d/OTHER/edit#heading=h.x', KEY), { href: 'https://docs.google.com/document/d/OTHER/edit#heading=h.x', internal: false });
  assert.deepEqual(cleanHref('#bookmark=id.q1', KEY), { href: '#gd-id.q1', internal: true });
  assert.equal(cleanHref('data:text/html,hi', KEY), null);
  assert.deepEqual(cleanHref('mailto:dm@example.com', KEY), { href: 'mailto:dm@example.com', internal: false });
});
