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
  const findTab = kind => {
    const selectors = kind === 'like' ? ['[data-e2e="liked-tab"]', '[data-e2e="like-tab"]', '[data-e2e="user-liked-tab"]'] : ['[data-e2e="repost-tab"]', '[data-e2e="reposts-tab"]'];
    for (const selector of selectors) {
      const tab = [...document.querySelectorAll(selector)].find(isVisible);
      if (tab) return tab.closest('[role="tab"]') || tab;
    }
    const labels = kind === 'like' ? ['liked', 'likes', 'الإعجابات'] : ['reposts', 'repost', 'إعادة النشر'];
    return [...document.querySelectorAll('[role="tab"]')].find(el => isVisible(el) && labels.includes((el.innerText || '').trim().toLowerCase())) || null;
  };
  const selected = tab => tab && (tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('data-state') === 'active' || tab.getAttribute('data-selected') === 'true');
  window.removeie = {
    account,
    pageState() {
      const path = location.pathname.toLowerCase();
      if (path.includes('login')) return 'login';
      if (path.includes('verify') || document.querySelector('[id*="captcha"], [class*="captcha"]')) return 'verification';
      if (/^\/@[^/]+\/?$/.test(path)) return 'profile';
      return 'other';
    },
    openTab(kind) { const tab = findTab(kind); if (!tab) return { ok: false, reason: 'tab-not-found' }; tab.click(); return { ok: true }; },
    collect(kind) {
      if (!selected(findTab(kind))) return { ok: false, reason: 'tab-not-confirmed', items: [] };
      const grid = [...document.querySelectorAll('[data-e2e="user-post-item-list"]')].find(isVisible);
      if (!grid) return { ok: false, reason: 'grid-not-found', items: [] };
      const seen = new Set(); const items = [];
      for (const anchor of grid.querySelectorAll('a[href*="/video/"],a[href*="/photo/"]')) {
        const id = videoId(anchor.href); if (!id || seen.has(id)) continue; seen.add(id);
        const img = anchor.querySelector('img');
        items.push({ id, url: anchor.href, title: (img?.alt || anchor.innerText || 'TikTok video').trim().slice(0, 120), image: img?.currentSrc || img?.src || '' });
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      return { ok: true, items };
    }
  };
})();
