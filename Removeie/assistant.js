(function () {
  'use strict';
  if (!/(^|\.)tiktok\.com$/i.test(location.hostname)) return;
  const usernameFromPath = href => {
    try { const url = new URL(href, location.href); return /(^|\.)tiktok\.com$/i.test(url.hostname) ? url.pathname.match(/^\/@([\w.]+)\/?$/)?.[1] || null : null; } catch (_) { return null; }
  };
  const videoId = href => {
    try { const url = new URL(href, location.href); return /(^|\.)tiktok\.com$/i.test(url.hostname) ? url.pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1] || null : null; } catch (_) { return null; }
  };
  const isVisible = node => !!node && node.getClientRects().length > 0;
  const data = () => { try { return JSON.parse(document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent || '{}'); } catch (_) { return {}; } };
  const account = () => {
    const user = data()?.__DEFAULT_SCOPE__?.['webapp.app-context']?.user;
    const id = user?.uniqueId || user?.unique_id;
    if (typeof id === 'string' && /^[\w.]+$/.test(id)) return id;
    const link = document.querySelector('[data-e2e="nav-profile"] a[href*="/@"], a[data-e2e="nav-profile"][href*="/@"], [data-e2e="profile-icon"] a[href*="/@"]');
    return link ? usernameFromPath(link.href) : null;
  };
  const findTab = (kind, includeHidden = false) => {
    const selectors = kind === 'like' ? ['[data-e2e="liked-tab"]', '[data-e2e="like-tab"]', '[data-e2e="user-liked-tab"]'] : ['[data-e2e="repost-tab"]', '[data-e2e="reposts-tab"]'];
    for (const selector of selectors) {
      const tabs = [...document.querySelectorAll(selector)].filter(el => el.getAttribute('aria-disabled') !== 'true' && !el.disabled);
      const tab = tabs.find(isVisible) || (includeHidden ? tabs[0] : null);
      if (tab) return tab.closest('[role="tab"]') || tab;
    }
    const labels = kind === 'like' ? ['liked', 'likes', 'الإعجابات'] : ['reposts', 'repost', 'إعادة النشر'];
    return [...document.querySelectorAll('[role="tab"]')].find(el => isVisible(el) && labels.includes((el.innerText || '').trim().toLowerCase())) || null;
  };
  const selected = tab => tab && (tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('data-state') === 'active' || tab.getAttribute('data-selected') === 'true');
  const attempted = {};
  // Read only: use the logged-in web session, and never export its identifier.
  async function repostPage(cursor) {
    const user = data()?.__DEFAULT_SCOPE__?.['webapp.app-context']?.user;
    const name = user?.uniqueId || user?.unique_id;
    const secUid = user?.secUid || user?.sec_uid;
    if (!name || !secUid || usernameFromPath(location.href)?.toLowerCase() !== String(name).toLowerCase()) {
      return { ok: false, reason: 'account-context' };
    }
    if (typeof cursor !== 'string' || !/^\d{1,30}$/.test(cursor)) return { ok: false, reason: 'invalid-cursor' };
    const params = new URLSearchParams({ aid: '1988', count: '30', coverFormat: '2', cursor, needPinnedItemIds: 'true', post_item_list_request_type: '0', secUid });
    try {
      const response = await fetch('/api/repost/item_list/?' + params, { method: 'GET', credentials: 'same-origin', headers: { accept: '*/*' } });
      if (!response.ok) return { ok: false, reason: 'http-error', httpStatus: response.status };
      let result;
      try { result = await response.json(); } catch (_) { return { ok: false, reason: 'invalid-json' }; }
      if (!result || result.status_code !== 0) return { ok: false, reason: 'tiktok-rejected', tiktokStatus: Number.isInteger(result?.status_code) ? result.status_code : null };
      if (!Array.isArray(result.itemList) || typeof result.hasMore !== 'boolean') return { ok: false, reason: 'invalid-data' };
      const next = result.cursor == null ? '' : String(result.cursor);
      if (result.hasMore && (!/^\d{1,30}$/.test(next) || next === cursor)) return { ok: false, reason: 'invalid-next-cursor' };
      const items = [];
      for (const item of result.itemList) {
        const id = String(item?.id || '');
        const author = item?.author?.uniqueId;
        if (!/^\d+$/.test(id) || typeof author !== 'string' || !/^[\w.]+$/.test(author)) return { ok: false, reason: 'invalid-item' };
        items.push({ id, url: 'https://www.tiktok.com/@' + author + '/video/' + id, title: String(item.desc || '@' + author).slice(0, 120), image: String(item.video?.cover || '') });
      }
      return { ok: true, items, hasMore: result.hasMore, cursor: next };
    } catch (_) { return { ok: false, reason: 'network-error' }; }
  }
  const confirmedTab = kind => {
    const tab = attempted[kind] || findTab(kind);
    if (!tab || !tab.isConnected || !selected(tab)) return false;
    if (isVisible(tab)) return true;
    // A hidden copy must not be mistaken for the visible, active tab strip.
    const strip = tab.closest('[role="tablist"]');
    if (!strip) return false;
    return ![...strip.querySelectorAll('[role="tab"]')].some(other => other !== tab && isVisible(other) && selected(other));
  };
  const linkSelector = 'a[href*="/video/"],a[href*="/photo/"]';
  const usableLink = el => isVisible(el) && !el.closest('nav,header,footer,aside,[role="navigation"]') && !!videoId(el.href);
  const findGrid = kind => {
    const known = [...document.querySelectorAll('[data-e2e="user-post-item-list"]')].find(isVisible);
    if (known) return { node: known, source: 'known-grid' };
    const tab = attempted[kind] || findTab(kind);
    if (!tab) return null;
    const controlledId = tab.getAttribute('aria-controls');
    const controlled = controlledId ? document.getElementById(controlledId) : null;
    if (controlled && isVisible(controlled)) return { node: controlled, source: 'controlled-panel' };
    const strip = tab.closest('[role="tablist"]');
    if (!strip) return null;
    // Restrict the fallback to a grid of multiple video cards in the nearest
    // profile section containing the selected tab strip; ignore navigation.
    let area = strip.parentElement;
    for (let level = 0; area && area !== document.body && level < 8; level++, area = area.parentElement) {
      const candidates = [...area.querySelectorAll('div,section')].filter(el => {
        if (!isVisible(el) || el.contains(strip) || el.closest('nav,header,footer,aside,[role="navigation"]')) return false;
        const display = getComputedStyle(el).display;
        if (display !== 'grid' && display !== 'flex') return false;
        const cards = [...el.children].filter(child => [...child.querySelectorAll(linkSelector)].some(usableLink) || (child.matches(linkSelector) && usableLink(child)));
        return cards.length >= 2;
      });
      if (candidates.length) {
        candidates.sort((a, b) => [...b.querySelectorAll(linkSelector)].filter(usableLink).length - [...a.querySelectorAll(linkSelector)].filter(usableLink).length);
        return { node: candidates[0], source: 'profile-grid' };
      }
    }
    return null;
  };
  window.removeie = {
    account,
    repostPage,
    pageState() {
      const path = location.pathname.toLowerCase();
      if (path.includes('login')) return 'login';
      if (path.includes('verify') || document.querySelector('[id*="captcha"], [class*="captcha"]')) return 'verification';
      if (/^\/@[^/]+\/?$/.test(path)) return 'profile';
      return 'other';
    },
    diagnostic(kind) {
      const tab = attempted[kind] || findTab(kind, true);
      const strip = tab?.closest('[role="tablist"]');
      const style = tab ? getComputedStyle(tab) : null;
      const display = style?.display;
      const visibility = style?.visibility;
      const names = ['liked-tab', 'like-tab', 'user-liked-tab', 'repost-tab', 'reposts-tab', 'user-post-tab', 'video-tab', 'favorites-tab', 'favorite-tab', 'post-tab'];
      const tabs = [...document.querySelectorAll('[role="tab"], [data-e2e$="-tab"]')].slice(0, 30).map(el => {
        const type = el.getAttribute('data-e2e') || '';
        const state = el.getAttribute('aria-selected') || el.getAttribute('data-selected') || el.getAttribute('data-state') || '';
        return { type: names.includes(type) ? type : 'other', role: el.getAttribute('role') === 'tab' ? 'tab' : '', selected: ['true', 'false', 'active', 'inactive'].includes(state) ? state : '', visible: isVisible(el) };
      });
      return {
        version: 1,
        kind,
        page: this.pageState(),
        ready: document.readyState,
        tabFound: !!tab,
        tabSelected: !!selected(tab),
        selectionConfirmed: !!confirmedTab(kind),
        tabInStrip: !!strip,
        otherVisibleSelected: strip ? [...strip.querySelectorAll('[role="tab"]')].filter(el => el !== tab && isVisible(el) && selected(el)).length : 0,
        tabDisplay: ['none', 'block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-block'].includes(display) ? display : 'other',
        tabVisibility: ['visible', 'hidden', 'collapse'].includes(visibility) ? visibility : 'other',
        gridCount: document.querySelectorAll('[data-e2e="user-post-item-list"]').length,
        gridMethod: findGrid(kind)?.source || 'none',
        itemCount: document.querySelectorAll('[data-e2e="user-post-item"]').length,
        videoLinkCount: document.querySelectorAll('a[href*="/video/"],a[href*="/photo/"]').length,
        tabs
      };
    },
    openTab(kind) { const tab = findTab(kind, true); if (!tab) return { ok: false, reason: 'tab-not-found' }; attempted[kind] = tab; tab.click(); return { ok: true }; },
    collect(kind) {
      if (!confirmedTab(kind)) return { ok: false, reason: 'tab-not-confirmed', items: [] };
      const grid = findGrid(kind);
      if (!grid) return { ok: false, reason: 'grid-not-found', items: [] };
      const seen = new Set(); const items = [];
      for (const anchor of grid.node.querySelectorAll(linkSelector)) {
        if (!usableLink(anchor)) continue;
        const id = videoId(anchor.href); if (!id || seen.has(id)) continue; seen.add(id);
        const img = anchor.querySelector('img');
        items.push({ id, url: anchor.href, title: (img?.alt || anchor.innerText || 'TikTok video').trim().slice(0, 120), image: img?.currentSrc || img?.src || '' });
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      return { ok: true, items, source: grid.source };
    }
  };
})();
