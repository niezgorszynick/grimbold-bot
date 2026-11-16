const test = require('node:test');
const assert = require('node:assert/strict');
const { toDiscordMarkdown } = require('../public/discord-editor');

// Just enough of the DOM: what a contenteditable box holds.
const t = text => ({ nodeType: 3, nodeValue: text });
const e = (tag, children = [], { className = '', style = '' } = {}) => ({
  nodeType: 1, nodeName: tag.toUpperCase(), className, childNodes: children,
  getAttribute: name => (name === 'style' ? style : null)
});
const md = (...children) => toDiscordMarkdown(e('div', children));

test('formatting becomes Discord Markdown', () => {
  assert.equal(md(t('Hello '), e('b', [t('brave')]), t(' world')), 'Hello **brave** world');
  assert.equal(md(e('i', [t('softly')])), '*softly*');
  assert.equal(md(e('u', [t('under')]), t(' '), e('strike', [t('gone')])), '__under__ ~~gone~~');
  assert.equal(md(e('span', [t('secret')], { className: 'dc-spoiler' })), '||secret||');
  assert.equal(md(e('span', [t('1d20+5')], { className: 'dc-code' })), '`1d20+5`');
  assert.equal(md(e('span', [t('heavy')], { style: 'font-weight: bold;' })), '**heavy**', 'bold written as a style');
  assert.equal(md(t('typed **markdown** stays')), 'typed **markdown** stays');
});

test('nested and adjacent formats open and close cleanly', () => {
  assert.equal(md(e('b', [t('bold '), e('i', [t('both')])]), t(' plain')), '**bold *both*** plain');
  assert.equal(md(e('b', [t('one')]), e('b', [t('two')])), '**onetwo**', 'neighbours merge');
  assert.equal(md(t('x'), e('b', [t(' padded ')]), t('y')), 'x **padded** y', 'spaces move outside the markers');
  assert.equal(md(e('b', [t('a')]), t(' '), e('b', [t('b')])), '**a b**');
});

test('lines, empty lines and quotes', () => {
  // Chrome: the first line as text, the next ones as divs, an empty one as <div><br></div>.
  assert.equal(md(t('first'), e('div', [e('br')]), e('div', [t('third')])), 'first\n\nthird');
  assert.equal(md(e('div', [t('a')]), e('div', [t('b')])), 'a\nb');
  assert.equal(md(t('a'), e('br'), t('b'), e('br')), 'a\nb', 'a trailing break is dropped');
  assert.equal(md(e('blockquote', [t('He said'), e('br'), t('this')]), e('div', [t('after')])), '> He said\n> this\nafter');
  assert.equal(md(t('  ')), '', 'only spaces: nothing to send');
});
