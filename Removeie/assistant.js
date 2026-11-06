(function () {
  'use strict';
  if (!/(^|\.)tiktok\.com$/i.test(location.hostname) || window.__removeie) return;
  window.__removeie = true;

  const state = { kind: 'repost', items: new Map(), selected: new Set(), stopped: false, running: false };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = el => !!el && el.getClientRects().length > 0;
  const findVisible = selector => [...document.querySelectorAll(selector)].find(visible);
  const videoId = href => { try { return new URL(href, location.href).pathname.match(/\/(?:video|photo)\/(\d+)/)?.[1] || null; } catch (_) { return null; } };
  const label = el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '').trim().toLowerCase();

  const panel = document.createElement('section');
  panel.id = 'removeie-panel';
  panel.dir = 'rtl';
  panel.style.cssText = 'position:fixed;z-index:2147483647;bottom:8px;left:3%;width:94%;max-height:58vh;overflow:auto;background:#fff;color:#111;border:2px solid #111;border-radius:14px;padding:10px;box-sizing:border-box;font:14px -apple-system,sans-serif;box-shadow:0 2px 14px #0006';
  panel.innerHTML = '<b>Removeie — تجربة أولية</b> <button id="rm-toggle">تصغير</button><div id="rm-body"><p>سجّل دخولك، وافتح بروفايلك ثم تبويب الريبوستات أو اللايكات. اختار النوع المطابق واضغط فحص. مرّر القائمة لو عايز تضيف فيديوهات أخرى ثم افحص تاني.</p><select id="rm-kind"><option value="repost">الريبوستات</option><option value="like">اللايكات</option></select> <button id="rm-scan">فحص الظاهر</button> <button id="rm-all">تحديد الكل</button> <button id="rm-none">إلغاء التحديد</button><p id="rm-status">العدد هنا للفيديوهات التي تم العثور عليها فقط، وليس بالضرورة الإجمالي.</p><div id="rm-list" style="max-height:19vh;overflow:auto"></div><p><button id="rm-remove">إزالة المحدد</button> <button id="rm-stop">إيقاف</button></p><small>النسخة تجريبية: قد لا يعمل تسجيل الدخول أو الفحص أو الحذف. اختبر عنصرًا واحدًا أولًا.</small></div>';
  document.documentElement.appendChild(panel);
  const get = id => panel.querySelector('#rm-' + id);
  const status = message => { get('status').textContent = message; };
  const counts = () => `تم العثور على ${state.items.size}، المحدد ${state.selected.size}. العدد قد يكون غير مكتمل.`;

  function render() {
    const list = get('list');
    list.replaceChildren();
    for (const [id, item] of state.items) {
      const row = document.createElement('label');
      row.style.cssText = 'display:block;padding:4px;border-bottom:1px solid #ddd;overflow-wrap:anywhere';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = state.selected.has(id);
      check.addEventListener('change', () => { check.checked ? state.selected.add(id) : state.selected.delete(id); status(counts()); });
      row.append(check, document.createTextNode(' ' + item.title + ' (' + id + ')'));
      list.append(row);
    }
    status(counts());
  }

  get('toggle').onclick = () => { const body = get('body'); const hidden = body.style.display === 'none'; body.style.display = hidden ? '' : 'none'; get('toggle').textContent = hidden ? 'تصغير' : 'فتح'; };
  get('kind').onchange = event => { state.kind = event.target.value; state.items.clear(); state.selected.clear(); render(); };
  get('scan').onclick = () => {
    if (state.running) return;
    if (!/^\/@[^/]+\/?$/.test(location.pathname)) { status('افتح صفحة بروفايلك في TikTok أولًا، ثم افتح التبويب المطلوب.'); return; }
    const grid = findVisible('[data-e2e="user-post-item-list"]') || document;
    let found = 0;
    for (const anchor of grid.querySelectorAll('a[href*="/video/"],a[href*="/photo/"]')) {
      if (panel.contains(anchor) || !visible(anchor)) continue;
      const id = videoId(anchor.href);
      if (!id) continue;
      const title = anchor.querySelector('img')?.alt || anchor.innerText?.trim() || 'فيديو';
      state.items.set(id, { title: title.slice(0, 100), href: anchor.href });
      found++;
    }
    render();
    if (!found) status('لم أعثر على فيديوهات ظاهرة. تأكد من فتح البروفايل والتبويب الصحيح ثم جرّب تاني.');
  };
  get('all').onclick = () => { state.selected = new Set(state.items.keys()); render(); };
  get('none').onclick = () => { state.selected.clear(); render(); };
  get('stop').onclick = () => { state.stopped = true; status('سيتم التوقف بعد المحاولة الحالية.'); };

  function activeDialog() {
    return findVisible('[data-e2e="browse-video"]') || findVisible('[role="dialog"]');
  }
  function controls(root) {
    return [...root.querySelectorAll('button,[role="button"],[data-e2e]')].filter(el => visible(el) && !panel.contains(el));
  }
  function matching(root, pattern) {
    return controls(root).find(el => pattern.test(label(el)) && ![...el.children].some(child => pattern.test(label(child))));
  }
  async function waitFor(test, ms = 5000) {
    const end = Date.now() + ms;
    while (Date.now() < end && !state.stopped) { const result = test(); if (result) return result; await sleep(200); }
    return null;
  }
  async function removeOne(id) {
    const anchor = [...document.querySelectorAll('a[href*="/video/"],a[href*="/photo/"]')].find(a => !panel.contains(a) && videoId(a.href) === id && visible(a));
    if (!anchor) return 'الفيديو لم يعد ظاهرًا في القائمة';
    anchor.click();
    const dialog = await waitFor(activeDialog);
    if (!dialog) return 'لم تفتح نافذة الفيديو';
    // Never act unless the open view identifies the exact requested video.
    const exact = videoId(location.href) === id || [...dialog.querySelectorAll('a[href]')].some(a => videoId(a.href) === id);
    if (!exact) return 'تعذر التأكد من هوية الفيديو المفتوح';
    let target;
    if (state.kind === 'like') {
      target = matching(dialog, /^(unlike|remove like|إلغاء الإعجاب|إزالة الإعجاب)$/i);
    } else {
      target = matching(dialog, /^(remove repost|undo repost|إزالة إعادة النشر|إلغاء إعادة النشر)$/i);
      if (!target) {
        const share = matching(dialog, /^(share|مشاركة)$/i) || dialog.querySelector('[data-e2e="share-icon"], [data-e2e="browse-share"]');
        if (visible(share)) { share.click(); await sleep(500); }
        target = matching(document, /^(remove repost|undo repost|إزالة إعادة النشر|إلغاء إعادة النشر)$/i);
      }
    }
    if (!target) return 'لم أجد زر إزالة واضحًا؛ لم يتم الضغط';
    target.click();
    await sleep(1200);
    // A click is not proof of a server-side change. Stop for manual verification.
    return 'تم الضغط؛ راجع TikTok للتأكد من النتيجة';
  }
  get('remove').onclick = async () => {
    if (state.running || !state.selected.size) { if (!state.selected.size) status('حدد فيديو واحدًا على الأقل.'); return; }
    if (!confirm(`تجربة إزالة أول فيديو من أصل ${state.selected.size} محدد؟ راجع النتيجة داخل TikTok قبل الاستمرار.`)) return;
    state.running = true; state.stopped = false;
    const id = state.selected.values().next().value;
    try { status(await removeOne(id)); } catch (_) { status('حصل خطأ؛ لم أتمكن من التحقق من نتيجة المحاولة.'); }
    state.running = false;
  };
})();
