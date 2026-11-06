const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync('Removeie/assistant.js', 'utf8');
function page(url, html = '') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  dom.window.Element.prototype.getClientRects = function () { return this.hasAttribute('data-test-hidden') ? [] : [1]; };
  dom.window.scrollTo = () => {};
  dom.window.eval(script);
  return dom.window;
}
test('does not run outside TikTok', () => {
  assert.equal(page('https://example.com/').removeie, undefined);
});
test('reads the authenticated account from app context', () => {
  const data = JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.app-context': { user: { uniqueId: 'my.account' } } } });
  const win = page('https://www.tiktok.com/', `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${data}</script>`);
  assert.equal(win.removeie.account(), 'my.account');
});
test('does not mistake a profile feed for the likes tab', () => {
  const win = page('https://www.tiktok.com/@me', '<div data-e2e="user-post-item-list"><a href="/@me/video/123">post</a></div>');
  assert.equal(win.removeie.collect('like').ok, false);
});
test('recognizes login and verification pages without reporting zero videos', () => {
  assert.equal(page('https://www.tiktok.com/login').removeie.pageState(), 'login');
  assert.equal(page('https://www.tiktok.com/@me', '<div id="captcha-container"></div>').removeie.pageState(), 'verification');
});
test('collects unique videos only from a confirmed active tab', () => {
  const html = '<button data-e2e="liked-tab" aria-selected="true"></button><div data-e2e="user-post-item-list"><a href="/@a/video/123"><img alt="A"></a><a href="/@a/video/123">duplicate</a><a href="https://example.com/@b/video/456">external</a></div>';
  const result = page('https://www.tiktok.com/@me', html).removeie.collect('like');
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, '123');
});
test('diagnostics exclude account and video URLs', () => {
  const html = '<button data-e2e="liked-tab" aria-selected="true"></button><div data-e2e="user-post-item-list"><a href="/@privateperson/video/123">private title</a></div>';
  const value = JSON.stringify(page('https://www.tiktok.com/@privateperson', html).removeie.diagnostic('like'));
  assert.doesNotMatch(value, /privateperson|private title|video\/123/);
  assert.match(value, /liked-tab/);
});
test('can attempt a hidden repost tab without claiming success until selection is confirmed', () => {
  const html = '<div role="tablist"><button role="tab" data-e2e="post-tab" aria-selected="true"></button><button role="tab" data-e2e="repost-tab" aria-selected="false" data-test-hidden></button></div><div data-e2e="user-post-item-list"><a href="/@a/video/123">post</a></div>';
  const win = page('https://www.tiktok.com/@me', html);
  const repost = win.document.querySelector('[data-e2e="repost-tab"]');
  repost.addEventListener('click', () => repost.setAttribute('aria-selected', 'true'));
  assert.equal(win.removeie.openTab('repost').ok, true);
  assert.equal(win.removeie.collect('repost').ok, false);
  win.document.querySelector('[data-e2e="post-tab"]').setAttribute('aria-selected', 'false');
  assert.equal(win.removeie.collect('repost').items[0].id, '123');
});
test('does not click an explicitly disabled tab', () => {
  const win = page('https://www.tiktok.com/@me', '<button data-e2e="repost-tab" aria-disabled="true" data-test-hidden></button>');
  assert.equal(win.removeie.openTab('repost').ok, false);
});
test('finds a profile grid when the old TikTok selector is absent', () => {
  const html = '<main><div><div role="tablist"><button id="liked" role="tab" data-e2e="liked-tab" aria-selected="true"></button></div><div style="display:grid"><div><a href="/@a/video/123"><img alt="one"></a></div><div><a href="/@b/video/456"><img alt="two"></a></div></div></div><aside><div style="display:grid"><div><a href="/@other/video/999">unrelated</a></div><div><a href="/@other/video/998">unrelated</a></div></div></aside></main>';
  const result = page('https://www.tiktok.com/@me', html).removeie.collect('like');
  assert.equal(result.ok, true);
  assert.equal(result.source, 'profile-grid');
  assert.deepEqual(Array.from(result.items, item => item.id), ['123', '456']);
});
function repostWindow() {
  const data = JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.app-context': { user: { uniqueId: 'me', secUid: 'private-id' } } } });
  return page('https://www.tiktok.com/@me', `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${data}</script>`);
}
test('reads reposts through the current session and preserves pagination', async () => {
  const win = repostWindow();
  let request;
  win.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ status_code: 0, hasMore: true, cursor: '1234', itemList: [{ id: '123', desc: 'hello', author: { uniqueId: 'creator' }, video: { cover: 'https://example.com/cover' } }] }) };
  };
  const result = await win.removeie.repostPage('0');
  assert.equal(request.options.credentials, 'same-origin');
  assert.match(request.url, /^\/api\/repost\/item_list\//);
  assert.equal(result.items[0].url, 'https://www.tiktok.com/@creator/video/123');
  assert.equal(result.hasMore, true);
  assert.equal(result.cursor, '1234');
  assert.doesNotMatch(JSON.stringify(result), /private-id/);
});
test('never interprets rejected, incomplete, or repeated pages as success', async () => {
  const win = repostWindow();
  win.fetch = async () => ({ ok: true, json: async () => ({ status_code: 0 }) });
  assert.equal((await win.removeie.repostPage('0')).reason, 'invalid-data');
  win.fetch = async () => ({ ok: true, json: async () => ({ status_code: 0, hasMore: true, cursor: '0', itemList: [] }) });
  assert.equal((await win.removeie.repostPage('0')).reason, 'invalid-next-cursor');
  win.fetch = async () => ({ ok: false, status: 403 });
  assert.equal((await win.removeie.repostPage('0')).reason, 'http-error');
});
test('requires the profile to match the logged-in account before requesting reposts', async () => {
  const win = repostWindow();
  win.history.replaceState({}, '', '/@someoneelse');
  win.fetch = () => { throw new Error('must not be called'); };
  assert.equal((await win.removeie.repostPage('0')).reason, 'account-context');
});
test('uses a matching profile identifier when the session name comes from navigation', async () => {
  const data = JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.user-detail': { userInfo: { user: { uniqueId: 'me', secUid: 'profile-private-id' } } } } });
  const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${data}</script><a data-e2e="nav-profile" href="/@me">Profile</a>`;
  const win = page('https://www.tiktok.com/@me', html);
  let called = false;
  win.fetch = async url => { called = url.includes('secUid=profile-private-id'); return { ok: true, json: async () => ({ status_code: 0, hasMore: false, itemList: [] }) }; };
  const result = await win.removeie.repostPage('0');
  assert.equal(called, true);
  assert.equal(result.ok, true);
});
test('rejects profile identifiers when the logged-in or profile account does not match', async () => {
  const data = JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.user-detail': { userInfo: { user: { uniqueId: 'someoneelse', secUid: 'profile-private-id' } } } } });
  const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${data}</script><a data-e2e="nav-profile" href="/@me">Profile</a>`;
  const win = page('https://www.tiktok.com/@me', html);
  win.fetch = () => { throw new Error('must not be called'); };
  const result = await win.removeie.repostPage('0');
  assert.equal(result.reason, 'account-context');
  assert.equal(JSON.parse(result.context).profileMatchesPage, false);
  assert.doesNotMatch(JSON.stringify(result), /someoneelse|profile-private-id/);
});
test('never uses the profile identifier without independently identifying the session', async () => {
  const data = JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.user-detail': { userInfo: { user: { uniqueId: 'me', secUid: 'profile-private-id' } } } } });
  const win = page('https://www.tiktok.com/@me', `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${data}</script>`);
  const result = await win.removeie.repostPage('0');
  assert.equal(result.reason, 'account-context');
  assert.equal(JSON.parse(result.context).session, false);
});
test('reads the live TikTok data object when the hydration script is absent', async () => {
  const win = page('https://www.tiktok.com/@me');
  win.__$UNIVERSAL_DATA$__ = { __DEFAULT_SCOPE__: { 'webapp.app-context': { user: { uniqueId: 'me', secUid: 'local-only' } } } };
  let requested = false;
  win.fetch = async () => { requested = true; return { ok: true, json: async () => ({ status_code: 0, hasMore: false, itemList: [] }) }; };
  assert.equal((await win.removeie.repostPage('0')).ok, true);
  assert.equal(requested, true);
});
test('rejects video IDs that JavaScript cannot represent precisely', async () => {
  const win = repostWindow();
  win.fetch = async () => ({ ok: true, json: async () => ({ status_code: 0, hasMore: false, itemList: [{ id: 987654321987654321, author: { uniqueId: 'creator' } }] }) });
  assert.equal((await win.removeie.repostPage('0')).reason, 'invalid-item');
});
