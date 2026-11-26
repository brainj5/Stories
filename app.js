(() => {
  'use strict';

  /* 1. Utilities ---------------------------------------------------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
  const now = () => Date.now();
  const DAY = 86400000;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
  /* Parse HTML into a detached document that never runs scripts or loads images.
     (A div made with document.createElement would run onerror="" handlers in chapter text.) */
  const inert = (html) => new DOMParser().parseFromString(String(html ?? ''), 'text/html').body;
  const stripHtml = (h) => inert(h).textContent || '';
  const wordCount = (h) => (stripHtml(h).trim().match(/\S+/g) || []).length;
  const readMin = (w) => Math.max(1, Math.round(w / 230));
  const initials = (n) => (n || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const pl = (n, one) => (n === 1 ? one : one + 's'); // word only, for numbers shown with compact()
  const initial = (t) => ((t || '').match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase(); // first letter or digit, skipping symbols like [
  const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : (many || one + 's')}`;
  const compact = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(n);
  const timeAgo = (ts) => {
    if (!ts) return '';
    const s = Math.floor((now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  function toast(msg, link) {
    const el = document.createElement('div'); el.className = 'toast';
    el.innerHTML = `<span>${esc(msg)}</span>${link ? `<a href="${esc(link.href)}">${esc(link.label)}</a>` : ''}`;
    $('#toasts').appendChild(el); setTimeout(() => el.remove(), link ? 7000 : 3200);
  }

  /* Site theme: 'light' | 'dark' | 'system', saved in this browser. index.html applies it before paint. */
  const THEME_KEY = 'sfb.theme';
  const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];
  const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  const theme = {
    get() { try { const v = localStorage.getItem(THEME_KEY); return THEMES.some(([k]) => k === v) ? v : 'light'; } catch { return 'light'; } },
    apply() {
      const pref = theme.get();
      const dark = pref === 'dark' || (pref === 'system' && !!darkQuery?.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141519' : '#ffffff');
      $$('[data-theme-choice]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === pref)));
    },
    set(pref) { try { localStorage.setItem(THEME_KEY, pref); } catch {} theme.apply(); },
  };
  darkQuery?.addEventListener?.('change', () => { if (theme.get() === 'system') theme.apply(); });
  /** Light / Dark / System buttons. labelId names the element that labels the group. */
  const themeSeg = (labelId) => { const cur = theme.get(); return `<div class="theme-seg" role="group" aria-labelledby="${labelId}">${THEMES.map(([k, label]) => `<button type="button" data-theme-choice="${k}" aria-pressed="${k === cur}">${label}</button>`).join('')}</div>`; };

  const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'H2', 'H3', 'BLOCKQUOTE', 'HR', 'UL', 'OL', 'LI']);
  function sanitize(html) {
    const root = inert(html); const doc = root.ownerDocument;
    const walk = (node) => Array.from(node.childNodes).forEach((c) => {
      if (c.nodeType === 3) return;
      if (c.nodeType !== 1) { c.remove(); return; }
      if (/^(SCRIPT|STYLE|TEMPLATE|IFRAME|OBJECT|EMBED|NOSCRIPT|TITLE|META|LINK)$/.test(c.tagName)) { c.remove(); return; }
      walk(c);
      let tag = c.tagName; if (tag === 'DIV') tag = 'P'; if (/^H[1456]$/.test(tag)) tag = 'H3';
      if (!ALLOWED.has(tag)) { c.replaceWith(...c.childNodes); return; }
      const clean = doc.createElement(tag); clean.append(...c.childNodes); c.replaceWith(clean);
    });
    walk(root);
    Array.from(root.childNodes).forEach((n) => { if (n.nodeType === 3) { if (n.textContent.trim()) { const p = doc.createElement('p'); n.replaceWith(p); p.append(n); } else n.remove(); } });
    return root.innerHTML;
  }

  /** Clean text pasted from Google Docs / Word: keep bold and italics, drop everything else. */
  function cleanPaste(html) {
    const root = inert(html); const doc = root.ownerDocument;
    root.querySelectorAll('b[id^="docs-internal-guid"]').forEach((b) => b.replaceWith(...b.childNodes)); // Google Docs wraps everything in <b>
    root.querySelectorAll('span[style]').forEach((s) => {
      const st = s.getAttribute('style') || ''; let node = doc.createDocumentFragment(); node.append(...s.childNodes);
      if (/font-style:\s*italic/i.test(st)) { const em = doc.createElement('em'); em.append(node); node = em; }
      if (/font-weight:\s*(bold|[6-9]00)/i.test(st)) { const b = doc.createElement('strong'); b.append(node); node = b; }
      s.replaceWith(node);
    });
    return sanitize(root.innerHTML);
  }

  /* 2. Supabase connection + in-memory cache ------------------------------
     Everything is loaded from Supabase at start-up into `db`, so the views can
     read synchronously. Every write goes to Supabase first, then updates `db`.
     Row level security (supabase-schema.sql) decides who may change what. */
  const SUPABASE_URL = 'https://roeibtcsrgegskslvlbd.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_4g7D5_4SCj2GiEgue6fbgg_veUSxtmq';
  const BOOT_HASH = location.hash; // read before Supabase tidies the address bar after an email link
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const FEATURED_KEY = 'sfb.featured';
  /* Payments are paused. Set to true to show gifts and Ink again (gifting.sql and Stripe must be set up). */
  const PAYMENTS_ON = false;
  const noop = () => {};
  let db = null;
  let sessionUid = null;
  /* Reviews, reports, writer notifications, scheduling, cover uploads and maturity ratings need
     supabase-update-nov-2026.sql. Until it's run, those features stay hidden and the rest still works. */
  const features = { sql: false, mod: false };

  /** Await a Supabase query; throw a readable error if it failed. */
  async function must(q) { const { data, error } = await q; if (error) throw new Error(error.message || 'Something went wrong talking to the server.'); return data; }

  /* Supabase returns at most 1,000 rows per request, so read each table in pages. */
  const PAGE = 1000;
  async function fetchAll(table, order) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb.from(table).select('*');
      order.forEach((col) => { q = q.order(col, { ascending: true }); });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      out.push(...(data || []));
      if (!data || data.length < PAGE) return out;
    }
  }
  const TABLES = [
    ['profiles', ['created_at', 'id']], ['novels', ['created_at', 'id']], ['chapters', ['created_at', 'id']],
    ['chapter_comments', ['created_at', 'id']], ['chapter_likes', ['created_at', 'user_id', 'chapter_id']],
    ['subscriptions', ['created_at', 'user_id', 'novel_id']], ['favorites', ['created_at', 'user_id', 'novel_id']],
    ['notifications', ['created_at', 'id']], ['friendships', ['created_at', 'id']], ['reading_progress', ['at', 'user_id', 'novel_id']],
  ];
  async function loadAll() {
    const [res, upcoming, reviews, notices, mod] = await Promise.all([
      Promise.all(TABLES.map(([t, order]) => fetchAll(t, order))),
      sb.rpc('upcoming_releases'),
      fetchAll('reviews', ['created_at', 'id']).catch(() => null),
      sessionUid ? sb.from('notices').select('*').order('created_at', { ascending: false }).limit(300) : Promise.resolve({ data: [] }),
      sessionUid ? sb.rpc('is_mod') : Promise.resolve({ data: false }),
    ]);
    const [users, novels, chapters, chapter_comments, chapter_likes, subscriptions, favorites, notifications, friendships, progress] = res;
    features.sql = !upcoming.error && reviews !== null;
    features.mod = features.sql && mod.data === true;
    const reading_progress = {}, reading_log = {}, reading_pct = {};
    progress.forEach((p) => {
      (reading_progress[p.user_id] ||= {})[p.novel_id] = p.chapter_id;
      if (p.pct != null) (reading_pct[p.user_id] ||= {})[p.novel_id] = p.pct;
      if (!reading_log[p.user_id] || reading_log[p.user_id].at < p.at) reading_log[p.user_id] = { novel_id: p.novel_id, chapter_id: p.chapter_id, at: p.at };
    });
    let featured_daily = null; try { featured_daily = JSON.parse(localStorage.getItem(FEATURED_KEY)); } catch {}
    db = {
      users, chapters, chapter_comments, chapter_likes, subscriptions, favorites, notifications, reading_progress, reading_log, reading_pct, featured_daily,
      novels: novels.map((n) => ({ ...n, genres: n.genres || [], tags: n.tags || [], maturity: n.maturity || 'everyone' })),
      friendships: friendships.map((f) => ({ ...f, from: f.from_id, to: f.to_id })),
      reviews: reviews || [],
      notices: notices.error ? [] : notices.data || [],
      upcoming: Object.fromEntries((upcoming.data || []).map((u) => [u.novel_id, { at: Number(u.next_at), queued: u.queued }])),
    };
    if (PAYMENTS_ON) { try { await gifting.load(); } catch { gifting.ready = false; } } // the site still works if gifting.sql hasn't been run
    else gifting.ready = false;
  }

  const GENRES = ['Fantasy', 'Romance', 'Mystery', 'Sci-fi', 'Thriller', 'Drama', 'Horror', 'Slice of life', 'Historical', 'Comedy'];
  const COVERS = ['#2b3be8', '#17181c', '#0f766e', '#b91c1c', '#7c3aed', '#c2410c', '#0369a1', '#4d7c0f', '#9d174d', '#78350f'];

  /* 3. Data API (reads come from the cache, writes go to Supabase) -------- */
  const api = {
    users: {
      byId: (id) => db.users.find((u) => u.id === id),
      byUsername: (u) => db.users.find((x) => x.username.toLowerCase() === String(u).toLowerCase()),
      async update(id, patch) { await must(sb.from('profiles').update(patch).eq('id', id)); Object.assign(api.users.byId(id), patch); },
    },
    novels: {
      byId: (id) => db.novels.find((n) => n.id === id),
      /** Finds a series by its current link, or by an old one from before it was renamed. */
      bySlug: (slug) => db.novels.find((n) => n.slug === slug) || db.novels.find((n) => (n.old_slugs || []).includes(slug)),
      published: (novelId) => db.chapters.filter((c) => c.novel_id === novelId && c.status === 'published').sort((a, b) => a.chapter_number - b.chapter_number),
      all: (novelId) => db.chapters.filter((c) => c.novel_id === novelId).sort((a, b) => a.chapter_number - b.chapter_number),
      isPublic: (n) => n.status !== 'draft' && api.novels.published(n.id).length > 0,
      /** Public series for lists (home, browse, schedule). Mature series are left out unless the reader turned them on in Settings. */
      listPublic: () => db.novels.filter((n) => api.novels.isPublic(n) && (n.maturity !== 'mature' || contentPrefs.showMature())),
      byAuthor: (authorId) => db.novels.filter((n) => n.author_id === authorId).sort((a, b) => b.updated_at - a.updated_at),
      subscribers: (n) => (n.subscriber_count || 0) + (n.subscriber_offset || 0),
      stats(n) {
        const chs = api.novels.published(n.id);
        const words = chs.reduce((a, c) => a + wordCount(c.content), 0);
        const likes = chs.reduce((a, c) => a + c.likes, 0);
        const comments = db.chapter_comments.filter((c) => chs.some((x) => x.id === c.chapter_id)).length;
        const subs = api.novels.subscribers(n);
        return { chapters: chs.length, words, likes, comments, subs, views: n.views, trend: n.views + subs * 12 + likes * 3 + comments * 5 };
      },
      hasUpToday: (n) => (n.last_published_at || 0) > now() - DAY,
      isNew: (n) => n.created_at > now() - 21 * DAY,
      async create(authorId) {
        const n = { id: 'n_' + uid(), slug: '', author_id: authorId, title: '', synopsis: '', cover_image: '', cover_color: COVERS[Math.floor(Math.random() * COVERS.length)], genres: [], tags: [], status: 'draft', update_day: null, featured: false, views: 0, subscriber_offset: 0, created_at: now(), updated_at: now(), last_published_at: null };
        await must(sb.from('novels').insert(n)); db.novels.push(n); return n;
      },
      async update(id, patch) {
        const n = api.novels.byId(id); const p = { ...patch, updated_at: now() };
        if (!features.sql) delete p.maturity;
        if (patch.title !== undefined) {
          const taken = (s) => db.novels.some((x) => x.id !== id && (x.slug === s || (x.old_slugs || []).includes(s)));
          const base = slugify(patch.title || 'untitled'); let s = base, i = 2;
          if ((n.old_slugs || []).includes(s) || s === n.slug) { /* renaming back is fine */ } else while (taken(s)) s = `${base}-${i++}`;
          if (s !== n.slug) {
            p.slug = s;
            // Keep the old link working after a rename (needs the November SQL update).
            if (features.sql && n.slug) p.old_slugs = [...new Set([...(n.old_slugs || []), n.slug])].filter((x) => x !== s).slice(-20);
          }
        }
        await must(sb.from('novels').update(p).eq('id', id)); Object.assign(n, p); return n;
      },
      setStatus: (id, status) => api.novels.update(id, { status }),
      async remove(id) {
        await must(sb.from('novels').delete().eq('id', id)); // chapters, comments, likes, subscriptions etc. cascade in the database
        const ids = db.chapters.filter((c) => c.novel_id === id).map((c) => c.id);
        db.chapters = db.chapters.filter((c) => c.novel_id !== id);
        db.chapter_comments = db.chapter_comments.filter((c) => !ids.includes(c.chapter_id));
        db.chapter_likes = db.chapter_likes.filter((l) => !ids.includes(l.chapter_id));
        db.subscriptions = db.subscriptions.filter((s) => s.novel_id !== id);
        db.notifications = db.notifications.filter((x) => x.novel_id !== id);
        db.favorites = db.favorites.filter((f) => f.novel_id !== id);
        db.novels = db.novels.filter((n) => n.id !== id);
      },
      /** Counts a view once per chapter per browser session, only when the reader actually reaches it, and never for the author. */
      recordView(novelId, chapterId) {
        if (sessionUid && api.novels.byId(novelId)?.author_id === sessionUid) return;
        const k = 'v:' + chapterId; if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1');
        api.novels.byId(novelId).views++; api.chapters.byId(chapterId).views++;
        sb.rpc('record_view', { p_chapter: chapterId }).then(noop, noop);
      },
    },
    chapters: {
      byId: (id) => db.chapters.find((c) => c.id === id),
      async create(novelId) {
        const c = { id: 'c_' + uid(), novel_id: novelId, chapter_number: api.novels.all(novelId).length + 1, title: '', content: '', author_note: '', status: 'draft', views: 0, likes: 0, created_at: now(), updated_at: now(), published_at: null };
        await must(sb.from('chapters').insert(c)); db.chapters.push(c); return c;
      },
      async update(id, patch) {
        const c = api.chapters.byId(id); const p = { ...patch, updated_at: now() };
        if (p.content !== undefined) p.content = sanitize(p.content);
        if (p.author_note !== undefined) p.author_note = String(p.author_note).slice(0, 1000);
        await must(sb.from('chapters').update(p).eq('id', id)); Object.assign(c, p);
        const n = api.novels.byId(c.novel_id); n.updated_at = now(); sb.from('novels').update({ updated_at: n.updated_at }).eq('id', n.id).then(noop, noop);
        return c;
      },
      /** Publish: chapter goes live, novel goes live if it was a draft, every subscriber gets a notification. */
      async publish(id) {
        const c = api.chapters.byId(id); const n = api.novels.byId(c.novel_id);
        const first = !c.published_at; const t = now();
        const cp = { status: 'published', published_at: c.published_at || t, updated_at: t };
        if (features.sql) cp.scheduled_at = null; // publishing now cancels any schedule
        await must(sb.from('chapters').update(cp).eq('id', id)); Object.assign(c, cp);
        if (features.sql) api.chapters.refreshUpcoming(n.id);
        const novelWentLive = n.status === 'draft';
        const np = { last_published_at: t, updated_at: t, ...(novelWentLive ? { status: 'ongoing' } : {}) };
        await must(sb.from('novels').update(np).eq('id', n.id)); Object.assign(n, np);
        const notified = first ? (await must(sb.rpc('notify_new_chapter', { p_chapter: id }))) || 0 : 0;
        return { chapter: c, novel: n, novelWentLive, notified };
      },
      async unpublish(id) { const p = { status: 'draft', updated_at: now() }; await must(sb.from('chapters').update(p).eq('id', id)); Object.assign(api.chapters.byId(id), p); },
      /** Scheduling: the chapter stays a draft with a release time. The database publishes it when the time comes. */
      async schedule(id, at) {
        const p = { scheduled_at: at, updated_at: now() }; await must(sb.from('chapters').update(p).eq('id', id)); Object.assign(api.chapters.byId(id), p);
        api.chapters.refreshUpcoming(api.chapters.byId(id).novel_id);
      },
      async unschedule(id) {
        const p = { scheduled_at: null, updated_at: now() }; await must(sb.from('chapters').update(p).eq('id', id)); Object.assign(api.chapters.byId(id), p);
        api.chapters.refreshUpcoming(api.chapters.byId(id).novel_id);
      },
      refreshUpcoming(novelId) {
        const q = api.novels.all(novelId).filter((c) => c.status !== 'published' && c.scheduled_at);
        if (q.length) db.upcoming[novelId] = { at: Math.min(...q.map((c) => c.scheduled_at)), queued: q.length }; else delete db.upcoming[novelId];
      },
      /** 'published' | 'scheduled' | 'draft' */
      state: (c) => (c.status === 'published' ? 'published' : c.scheduled_at ? 'scheduled' : 'draft'),
      async remove(id) {
        const c = api.chapters.byId(id);
        await must(sb.from('chapters').delete().eq('id', id));
        db.chapters = db.chapters.filter((x) => x.id !== id);
        db.chapter_comments = db.chapter_comments.filter((x) => x.chapter_id !== id);
        db.chapter_likes = db.chapter_likes.filter((x) => x.chapter_id !== id);
        db.notifications = db.notifications.filter((x) => x.chapter_id !== id);
        const moved = api.novels.all(c.novel_id).filter((x, i) => x.chapter_number !== i + 1 && ((x.chapter_number = i + 1), true));
        await Promise.all(moved.map((x) => must(sb.from('chapters').update({ chapter_number: x.chapter_number }).eq('id', x.id))));
      },
      async move(id, dir) {
        const c = api.chapters.byId(id); const list = api.novels.all(c.novel_id); const i = list.indexOf(c), j = i + dir;
        if (j < 0 || j >= list.length) return;
        const a = list[i], b = list[j]; const na = b.chapter_number, nb = a.chapter_number;
        await Promise.all([must(sb.from('chapters').update({ chapter_number: na }).eq('id', a.id)), must(sb.from('chapters').update({ chapter_number: nb }).eq('id', b.id))]);
        a.chapter_number = na; b.chapter_number = nb;
      },
    },
    comments: {
      forChapter: (id) => db.chapter_comments.filter((c) => c.chapter_id === id).sort((a, b) => b.created_at - a.created_at),
      async add(chapterId, userId, body) { const c = { id: 'cm_' + uid(), chapter_id: chapterId, user_id: userId, body: body.trim().slice(0, 2000), created_at: now() }; await must(sb.from('chapter_comments').insert(c)); db.chapter_comments.push(c); return c; },
      async remove(id) { await must(sb.from('chapter_comments').delete().eq('id', id)); db.chapter_comments = db.chapter_comments.filter((c) => c.id !== id); },
    },
    likes: {
      has: (userId, chapterId) => db.chapter_likes.some((l) => l.user_id === userId && l.chapter_id === chapterId),
      async toggle(userId, chapterId) {
        const on = await must(sb.rpc('toggle_like', { p_chapter: chapterId })); const c = api.chapters.byId(chapterId);
        db.chapter_likes = db.chapter_likes.filter((l) => !(l.user_id === userId && l.chapter_id === chapterId));
        if (on) { db.chapter_likes.push({ user_id: userId, chapter_id: chapterId, created_at: now() }); c.likes++; } else c.likes = Math.max(0, c.likes - 1);
        return on;
      },
    },
    subscriptions: {
      has: (userId, novelId) => db.subscriptions.some((s) => s.user_id === userId && s.novel_id === novelId),
      forUser: (userId) => db.subscriptions.filter((s) => s.user_id === userId).sort((a, b) => b.created_at - a.created_at),
      async toggle(userId, novelId) {
        const novel = db.novels.find((x) => x.id === novelId);
        if (api.subscriptions.has(userId, novelId)) {
          await must(sb.from('subscriptions').delete().eq('user_id', userId).eq('novel_id', novelId));
          db.subscriptions = db.subscriptions.filter((s) => !(s.user_id === userId && s.novel_id === novelId));
          if (novel) novel.subscriber_count = Math.max((novel.subscriber_count || 0) - 1, 0);
          return false;
        }
        const s = { user_id: userId, novel_id: novelId, created_at: now() };
        await must(sb.from('subscriptions').insert(s));
        db.subscriptions.push(s);
        if (novel) novel.subscriber_count = (novel.subscriber_count || 0) + 1;
        return true;
      },
    },
    notifications: {
      forUser: (userId) => db.notifications.filter((n) => n.user_id === userId).sort((a, b) => b.created_at - a.created_at),
      unread: (userId) => db.notifications.filter((n) => n.user_id === userId && !n.read_at).length + db.notices.filter((n) => n.user_id === userId && !n.read_at).length,
      async markAllRead(userId) {
        const t = now();
        if (db.notifications.some((n) => n.user_id === userId && !n.read_at)) {
          await must(sb.from('notifications').update({ read_at: t }).eq('user_id', userId).is('read_at', null));
          db.notifications.forEach((n) => { if (n.user_id === userId && !n.read_at) n.read_at = t; });
        }
        if (db.notices.some((n) => n.user_id === userId && !n.read_at)) {
          await must(sb.from('notices').update({ read_at: t }).eq('user_id', userId).is('read_at', null));
          db.notices.forEach((n) => { if (n.user_id === userId && !n.read_at) n.read_at = t; });
        }
      },
    },
    progress: {
      get: (userId, novelId) => db.reading_progress?.[userId]?.[novelId] || null,
      /** Last chapter opened in a series (synced). pct = how far into that chapter, synced so another device can resume. */
      set(userId, novelId, chapterId, pct) {
        const at = now();
        (db.reading_progress[userId] ||= {})[novelId] = chapterId;
        if (pct != null) (db.reading_pct[userId] ||= {})[novelId] = Math.round(pct);
        db.reading_log[userId] = { novel_id: novelId, chapter_id: chapterId, at }; // most recent read, shown to friends
        const row = { user_id: userId, novel_id: novelId, chapter_id: chapterId, at };
        if (features.sql && pct != null) row.pct = Math.round(pct);
        if (userId === sessionUid) sb.from('reading_progress').upsert(row).then(noop, noop);
      },
      pct: (userId, novelId) => db.reading_pct?.[userId]?.[novelId] ?? null,
      readSet: (userId) => { const s = new Set(); try { Object.values(db.reading_progress[userId] || {}).forEach((id) => s.add(id)); } catch {} return s; },
    },
    favorites: {
      has: (userId, novelId) => db.favorites.some((f) => f.user_id === userId && f.novel_id === novelId),
      forUser: (userId) => db.favorites.filter((f) => f.user_id === userId).sort((a, b) => b.created_at - a.created_at).map((f) => api.novels.byId(f.novel_id)).filter((n) => n && api.novels.isPublic(n)),
      async toggle(userId, novelId) {
        if (api.favorites.has(userId, novelId)) { await must(sb.from('favorites').delete().eq('user_id', userId).eq('novel_id', novelId)); db.favorites = db.favorites.filter((f) => !(f.user_id === userId && f.novel_id === novelId)); return false; }
        const f = { user_id: userId, novel_id: novelId, created_at: now() }; await must(sb.from('favorites').insert(f)); db.favorites.push(f); return true;
      },
    },
    /** Friendships are requests: pending until the recipient accepts. */
    friends: {
      pair: (a, b) => db.friendships.find((f) => (f.from === a && f.to === b) || (f.from === b && f.to === a)),
      status(me, other) { const f = api.friends.pair(me, other); if (!f) return 'none'; if (f.status === 'accepted') return 'friends'; return f.from === me ? 'outgoing' : 'incoming'; },
      list: (userId) => db.friendships.filter((f) => f.status === 'accepted' && (f.from === userId || f.to === userId)).map((f) => api.users.byId(f.from === userId ? f.to : f.from)).filter(Boolean),
      incoming: (userId) => db.friendships.filter((f) => f.status === 'pending' && f.to === userId),
      async request(from, to) {
        if (from === to || api.friends.pair(from, to)) return;
        const f = { id: 'fr_' + uid(), from_id: from, to_id: to, status: 'pending', created_at: now() };
        await must(sb.from('friendships').insert(f)); db.friendships.push({ ...f, from, to });
      },
      async accept(me, other) {
        const f = api.friends.pair(me, other); if (!f || f.to !== me) return;
        const p = { status: 'accepted', accepted_at: now() }; await must(sb.from('friendships').update(p).eq('id', f.id)); Object.assign(f, p);
      },
      async remove(me, other) { const f = api.friends.pair(me, other); if (!f) return; await must(sb.from('friendships').delete().eq('id', f.id)); db.friendships = db.friendships.filter((x) => x !== f); },
      /** Each friend with the book they most recently read, newest first. */
      activity(userId) {
        return api.friends.list(userId).map((user) => {
          const log = db.reading_log?.[user.id]; const n = log && api.novels.byId(log.novel_id); const c = log && api.chapters.byId(log.chapter_id);
          if (!n || !c || !api.novels.isPublic(n) || c.status !== 'published') return { user, at: 0 };
          return { user, novel: n, chapterNo: api.novels.published(n.id).indexOf(c) + 1, at: log.at };
        }).sort((a, b) => b.at - a.at);
      },
    },
    /** Reviews: one per reader per series, 0 to 5 stars. */
    reviews: {
      forNovel: (novelId) => db.reviews.filter((r) => r.novel_id === novelId),
      mine: (userId, novelId) => db.reviews.find((r) => r.novel_id === novelId && r.user_id === userId) || null,
      summary(novelId) {
        const list = api.reviews.forNovel(novelId); const count = list.length;
        const hist = [0, 0, 0, 0, 0, 0]; list.forEach((r) => { hist[r.rating]++; });
        const avg = count ? list.reduce((t, r) => t + r.rating, 0) / count : 0;
        return { count, avg, hist };
      },
      async save(userId, novelId, { rating, body, spoiler }) {
        const mine = api.reviews.mine(userId, novelId);
        const p = { rating, body: String(body || '').trim().slice(0, 4000), spoiler: !!spoiler };
        if (mine) { const row = await must(sb.from('reviews').update(p).eq('id', mine.id).select().single()); Object.assign(mine, row); return mine; }
        const row = await must(sb.from('reviews').insert({ ...p, novel_id: novelId, user_id: userId }).select().single());
        db.reviews.push(row); return row;
      },
      async remove(id) { await must(sb.from('reviews').delete().eq('id', id)); db.reviews = db.reviews.filter((r) => r.id !== id); },
      async reply(id, text) {
        await must(sb.rpc('reply_to_review', { p_review: id, p_reply: text }));
        const r = db.reviews.find((x) => x.id === id); if (r) { r.author_reply = text.trim() || null; r.author_reply_at = text.trim() ? now() : null; }
      },
    },
    /** Reports go to the moderators. The database fills in who owns the reported thing. */
    reports: {
      async file({ type, id, reason, details }) {
        const { error } = await sb.from('reports').insert({ target_type: type, target_id: String(id), reason, details: String(details || '').trim().slice(0, 1000) });
        if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'You already reported this. A moderator will look at it.' : error.message);
      },
      open: () => must(sb.from('reports').select('*').eq('status', 'open').order('created_at', { ascending: true }).limit(500)),
      closed: () => must(sb.from('reports').select('*').neq('status', 'open').order('resolved_at', { ascending: false }).limit(50)),
      resolve: (reportId, action, note) => must(sb.rpc('mod_resolve', { p_report: reportId, p_action: action, p_note: note || null })),
    },
    /** Cover images live in the Supabase Storage bucket "covers", in a folder named after the writer. */
    covers: {
      async upload(userId, novelId, blob) {
        const path = `${userId}/${novelId}-${Date.now()}.jpg`;
        const { error } = await sb.storage.from('covers').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
        if (error) throw new Error(/bucket|not found/i.test(error.message) ? 'Cover uploads aren’t set up yet. Run the November SQL update in Supabase.' : error.message);
        return sb.storage.from('covers').getPublicUrl(path).data.publicUrl;
      },
      /** Deletes an old upload. Ignores links to images hosted elsewhere. */
      async remove(url) {
        const m = /\/storage\/v1\/object\/public\/covers\/(.+)$/.exec(url || ''); if (!m) return;
        await sb.storage.from('covers').remove([decodeURIComponent(m[1])]).catch(noop);
      },
    },
    /** Featured: the top 5 up-and-coming series, picked once per local day (remembered in this browser). */
    featured: {
      today: () => new Date().toLocaleDateString('en-CA'),
      nextRefresh: () => { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); },
      picks() {
        const day = api.featured.today();
        const cached = db.featured_daily;
        if (cached?.date === day) { const list = cached.ids.map(api.novels.byId).filter((n) => n && api.novels.isPublic(n) && (n.maturity !== 'mature' || contentPrefs.showMature())); if (list.length) return list; }
        // Momentum, weighted toward younger series so new work can surface.
        const scored = api.novels.listPublic().map((n) => {
          const st = api.novels.stats(n); const ageDays = Math.max(7, (now() - n.created_at) / DAY);
          const fresh = (n.last_published_at || 0) > now() - 7 * DAY ? 1.25 : 1;
          return { n, score: ((st.subs + st.likes * 0.5 + st.comments * 20) / Math.sqrt(ageDays)) * fresh };
        }).sort((a, b) => b.score - a.score).slice(0, 5).map((x) => x.n);
        db.featured_daily = { date: day, ids: scored.map((n) => n.id) };
        try { localStorage.setItem(FEATURED_KEY, JSON.stringify(db.featured_daily)); } catch {}
        return scored;
      },
    },
  };

  /* Maturity ratings. Everyone and Teen show everywhere; Mature (17+) is hidden from lists until the
     reader switches it on in Settings, and opening one asks first. Saved in this browser. */
  const MATURITY = {
    everyone: { label: 'Everyone', short: '', hint: 'Fine for all ages.' },
    teen: { label: 'Teen 13+', short: '13+', hint: 'Some violence, language or dark themes. Nothing explicit.' },
    mature: { label: 'Mature 17+', short: '17+', hint: 'Graphic violence, strong language, sexual content or disturbing themes.' },
  };
  const contentPrefs = {
    showMature() { try { return localStorage.getItem('sfb.showMature') === '1'; } catch { return false; } },
    setShowMature(v) { try { localStorage.setItem('sfb.showMature', v ? '1' : '0'); } catch {} },
    okMature(novelId) { try { return contentPrefs.showMature() || sessionStorage.getItem('sfb.mature.' + novelId) === '1'; } catch { return false; } },
    allowMature(novelId) { try { sessionStorage.setItem('sfb.mature.' + novelId, '1'); } catch {} },
  };
  const ICON_CLOCK = '<svg class="ico-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const ICON_FLAG = '<svg class="ico-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4h11l-1.5 4L16 12H5"/></svg>';
  const maturityBadge = (n) => (MATURITY[n.maturity]?.short ? `<span class="badge badge-age ${n.maturity === 'mature' ? 'm' : ''}" title="${esc(MATURITY[n.maturity].label)}">${MATURITY[n.maturity].short}</span>` : '');
  /** "Are you sure?" screen before a Mature series. Returns true if the page should stop here. */
  function matureGate(app, n) {
    if (n.maturity !== 'mature' || contentPrefs.okMature(n.id) || auth.current()?.id === n.author_id) return false;
    setTitle(n.title);
    app.innerHTML = `<section class="auth mature-gate"><span class="badge badge-age m">17+</span><h1>${esc(n.title)} is rated Mature</h1>
      <p class="lead">${esc(MATURITY.mature.hint)} It’s meant for readers 17 and older.</p>
      <div class="row" style="gap:10px;justify-content:center"><button class="btn btn-primary" id="mgYes">I’m 17 or older, continue</button><a class="btn btn-ghost" href="#/browse">Go back</a></div>
      <p class="alt">To stop seeing this, turn on Mature series in <a href="#/settings">Settings</a>.</p></section>`;
    $('#mgYes').addEventListener('click', () => { contentPrefs.allowMature(n.id); render(); });
    return true;
  }

  /* Dates for scheduling: "Thu, Dec 3 · 6:00 PM" in the reader's own time zone. */
  const fmtWhen = (ts) => new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtIn = (ts) => {
    const ms = ts - now(); if (ms <= 60000) return 'any minute now';
    const m = Math.round(ms / 60000); if (m < 60) return `in ${m} min`;
    const h = Math.round(m / 60); if (h < 48) return `in ${h} ${h === 1 ? 'hour' : 'hours'}`;
    return `in ${Math.round(h / 24)} days`;
  };
  const stars = (r, { small = false } = {}) => { const full = Math.round(r * 2) / 2; return `<span class="stars ${small ? 'sm' : ''}" aria-label="${(Math.round(r * 10) / 10).toLocaleString()} out of 5 stars">${[1, 2, 3, 4, 5].map((i) => `<i class="${full >= i ? 'on' : full >= i - 0.5 ? 'half' : ''}" aria-hidden="true">★</i>`).join('')}</span>`; };
  const ratingText = (avg) => (Math.round(avg * 10) / 10).toFixed(1);

  /* 3b. Gifting + Ink ------------------------------------------------------
     Prices, balances and the 60/40 split all live in Supabase (supabase/gifting.sql).
     The browser only displays them and asks the database to act. */
  const money = (cents) => '$' + (cents / 100).toFixed(2);
  const gifting = {
    ready: false, catalog: [], packs: [], ink: 0, crowned: new Set(),
    async load() {
      const [cat, packs, crowns] = await Promise.all([
        sb.from('gift_catalog').select('*').order('sort'),
        sb.from('ink_packs').select('*').order('sort'),
        sb.rpc('crowned_authors'),
      ]);
      if (cat.error || packs.error) { gifting.ready = false; return; }
      gifting.catalog = cat.data || []; gifting.packs = packs.data || [];
      gifting.crowned = new Set(crowns.error ? [] : (crowns.data || []).map((r) => (typeof r === 'string' ? r : r.crowned_authors)));
      gifting.ready = gifting.catalog.length > 0;
      await gifting.refreshWallet();
    },
    async refreshWallet() {
      if (!sessionUid) { gifting.ink = 0; return 0; }
      const { data } = await sb.from('wallets').select('ink').eq('user_id', sessionUid).maybeSingle();
      gifting.ink = data?.ink || 0; return gifting.ink;
    },
    byId: (id) => gifting.catalog.find((g) => g.id === id),
    tier: (t) => gifting.catalog.filter((g) => g.tier === t),
    async send({ giftId, novelId, chapterId, anonymous, note }) {
      const res = await must(sb.rpc('send_gift', { p_gift: giftId, p_novel: novelId, p_chapter: chapterId || null, p_anonymous: !!anonymous, p_note: note || null }));
      gifting.ink = res.ink_left;
      const n = api.novels.byId(novelId); if (n) n.gift_count = (n.gift_count || 0) + 1;
      const c = chapterId && api.chapters.byId(chapterId); if (c) c.gift_count = (c.gift_count || 0) + 1;
      if (giftId === 'crown' && n) gifting.crowned.add(n.author_id);
      return res;
    },
    supporters: (novelId) => must(sb.rpc('top_supporters', { p_novel: novelId })),
    summary: () => must(sb.rpc('my_gift_summary')),
    lastPurchase: () => must(sb.from('ink_purchases').select('status, ink').order('created_at', { ascending: false }).limit(1).maybeSingle()),
    /** Ask the server for a Stripe Checkout link, then go there. */
    async checkout(packId) {
      const { data, error } = await sb.functions.invoke('create-ink-checkout', { body: { pack: packId } });
      if (error) {
        let msg = 'Payments are not available right now. Try again in a moment.';
        try { const body = await error.context?.json?.(); if (body?.error) msg = body.error; } catch {}
        throw new Error(msg);
      }
      if (!data?.url) throw new Error('Payments are not available right now. Try again in a moment.');
      location.href = data.url;
    },
  };

  /* 4. Auth (Supabase Auth: email + password) ------------------------------ */
  /** Make sure a signed-in user has a profile row (the database trigger normally creates it). */
  async function ensureProfile(user) {
    if (!user || api.users.byId(user.id)) return;
    const m = user.user_metadata || {};
    const p = { id: user.id, username: m.username || 'reader_' + user.id.slice(0, 8), name: m.name || 'New reader', bio: '', created_at: now() };
    const { error } = await sb.from('profiles').insert(p); if (!error) db.users.push(p);
  }
  const auth = {
    current: () => (sessionUid ? api.users.byId(sessionUid) || null : null),
    async signup({ name, username, email, password }) {
      if (!name.trim()) throw new Error('Enter your name.');
      if (!/^[a-z0-9_]{3,20}$/i.test(username)) throw new Error('Usernames are 3 to 20 letters, numbers or underscores.');
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
      if (password.length < 8) throw new Error('Passwords need at least 8 characters.');
      if (api.users.byUsername(username)) throw new Error('That username is taken.');
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username, name: name.trim() }, emailRedirectTo: location.origin + location.pathname } });
      if (error) throw new Error(error.message);
      if (!data.session) return { pending: true, name: name.trim() }; // email confirmation is switched on
      sessionUid = data.user.id; await loadAll(); await ensureProfile(data.user); return auth.current();
    },
    async login(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(/confirm/i.test(error.message) ? 'Confirm your email first. Check your inbox for the link.' : 'No account matches that email and password.');
      sessionUid = data.user.id; await loadAll(); await ensureProfile(data.user); return auth.current();
    },
    async logout() { sessionUid = null; await sb.auth.signOut(); await loadAll(); },
    /** Ends the session on every device, this one included. */
    async logoutEverywhere() { const { error } = await sb.auth.signOut({ scope: 'global' }); if (error) throw new Error(error.message); sessionUid = null; await loadAll(); },
  };

  /* 5. Router + shell ----------------------------------------------------- */
  const routes = [];
  const route = (pattern, handler) => { const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$'); routes.push({ re, keys, handler }); };
  const go = (h) => { location.hash = h; };
  const parseHash = () => { const raw = location.hash.replace(/^#/, '') || '/'; const [path, qs] = raw.split('?'); return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) }; };
  const setTitle = (t) => { document.title = t ? `${t} · Stories From Beyond` : 'Stories From Beyond'; };
  let cleanup = null; // per-view teardown (observers, scroll listeners)
  let renderSeq = 0;  // bumps on every navigation, so a slow page can tell it's been left and stop drawing

  async function render() {
    if (cleanup) { cleanup(); cleanup = null; }
    const seq = ++renderSeq; const stale = () => seq !== renderSeq;
    document.body.classList.remove('reading', 'home');
    $$('dialog[open]').forEach((d) => d.close());
    const { path, query } = parseHash(); const app = $('#app');
    const si = $('#searchInput'); if (si && document.activeElement !== si) si.value = path === '/browse' ? (query.q || '') : '';
    for (const r of routes) {
      const m = path.match(r.re);
      if (m) {
        const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); app.innerHTML = '';
        await r.handler({ params, query, app, stale });
        if (stale()) return;
        if (!app.dataset.keepScroll) window.scrollTo(0, 0); delete app.dataset.keepScroll; renderShell(); return;
      }
    }
    notFound(app, 'That page does not exist.'); renderShell();
  }
  function notFound(app, msg) { setTitle('Not found'); app.innerHTML = `<div class="page"><h1>Not available</h1><p class="muted">${esc(msg)} <a href="#/" style="color:var(--ultra);font-weight:600">Back home</a>.</p></div>`; }

  function renderShell() {
    const u = auth.current(); const { path } = parseHash();
    const unread = u ? api.notifications.unread(u.id) + api.friends.incoming(u.id).length : 0;
    $('#accountMenu').innerHTML = u
      ? `<a class="bell" href="#/notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>${unread ? `<span class="dot">${unread > 9 ? '9+' : unread}</span>` : ''}</a>
         <button type="button" class="avatar am-btn" id="amBtn" aria-haspopup="true" aria-expanded="false" aria-controls="amPanel" aria-label="Account menu">${esc(initials(u.name))}</button>
         <div class="am-panel" id="amPanel" hidden>
           <a class="am-item am-profile" href="#/u/${esc(u.username)}"><span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span><span class="am-who"><span class="am-name">${nm(u)}</span><span class="am-sub">View profile</span></span></a>
           <div class="am-div" role="separator"></div>
           ${gifting.ready ? `<a class="am-item am-ink" href="#/ink"><span>Ink</span><span class="ink-pill">${ICON_DROP}${gifting.ink.toLocaleString()}</span></a>` : ''}
           ${features.mod ? '<a class="am-item" href="#/mod">Moderation</a>' : ''}
           <a class="am-item" href="#/settings">Settings</a>
           <div class="am-theme"><span id="amThemeLbl">Theme</span>${themeSeg('amThemeLbl')}</div>
           <a class="am-item" href="#/help">Help &amp; safety</a>
           <button type="button" class="am-item" data-am="switch">Switch account</button>
           <div class="am-div" role="separator"></div>
           <button type="button" class="am-item am-danger" data-am="logout">Sign out</button>
         </div>`
      : `<a class="btn btn-ghost btn-sm" href="#/login">Log in</a><a class="btn btn-sm" href="#/signup">Sign up</a>`;
    $$('[data-auth="in"]').forEach((el) => { el.style.display = u ? '' : 'none'; });
    $$('.topnav a').forEach((a) => { const h = a.getAttribute('href').slice(1); a.classList.toggle('active', h === '/' ? path === '/' : path.startsWith(h)); });
  }
  function requireAuth(next) { if (auth.current()) return true; go('/login?next=' + encodeURIComponent(next || parseHash().path)); return false; }

  /** Account menu: opens from the avatar, closes on outside click, Escape, Tab away or navigation. */
  const menu = {
    panel: () => $('#amPanel'),
    items: () => $$('#amPanel a, #amPanel button'),
    isOpen: () => !!menu.panel() && !menu.panel().hidden,
    open() { const p = menu.panel(); if (!p) return; p.hidden = false; $('#amBtn').setAttribute('aria-expanded', 'true'); menu.items()[0]?.focus(); },
    close(returnFocus) { if (!menu.isOpen()) return; menu.panel().hidden = true; $('#amBtn').setAttribute('aria-expanded', 'false'); if (returnFocus) $('#amBtn').focus(); },
    toggle() { if (menu.isOpen()) menu.close(false); else menu.open(); },
  };
  async function signOut(next) {
    menu.close(false); await auth.logout();
    toast(next ? 'Signed out. Log in with the other account.' : 'Signed out');
    const target = next || '/';
    if (parseHash().path === target) render(); else go(target);
  }
  function initAccountMenu() {
    document.addEventListener('click', async (e) => {
      const choice = e.target.closest('[data-theme-choice]');
      if (choice) { theme.set(choice.dataset.themeChoice); return; }
      if (e.target.closest('#amBtn')) { menu.toggle(); return; }
      const act = e.target.closest('[data-am]');
      if (act) { await signOut(act.dataset.am === 'switch' ? '/login' : null); return; }
      if (e.target.closest('#amPanel a')) { menu.close(false); return; }
      if (menu.isOpen() && !e.target.closest('#amPanel')) menu.close(false);
    });
    document.addEventListener('keydown', (e) => {
      if (!menu.isOpen()) return;
      if (e.key === 'Escape') { e.preventDefault(); menu.close(true); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = menu.items(); const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    });
    $('#accountMenu').addEventListener('focusout', (e) => { if (menu.isOpen() && !$('#accountMenu').contains(e.relatedTarget) && e.relatedTarget) menu.close(false); });
  }

  /* 6. Partials ------------------------------------------------------------ */
  const thumb = (n, { sm = false, badge = true } = {}) => {
    const b = badge ? (api.novels.hasUpToday(n) ? '<span class="badge badge-up">UP</span>' : api.novels.isNew(n) ? '<span class="badge badge-new">NEW</span>' : '') : '';
    return `<div class="thumb ${sm ? 'sm' : ''} ${n.cover_image ? 'has-image' : ''}" style="--cv:${esc(n.cover_color)};${n.cover_image ? `background-image:url('${esc(n.cover_image)}')` : ''}" aria-hidden="true">${b}${n.cover_image ? '' : `<span class="big">${esc(initial(n.title))}</span>`}<span class="tt">${esc(n.title || 'Untitled')}</span></div>`;
  };
  const sCard = (n, { when = null } = {}) => {
    const a = api.users.byId(n.author_id); const st = api.novels.stats(n);
    const rv = features.sql ? api.reviews.summary(n.id) : { count: 0 };
    return `<a class="s-card" href="#/novel/${esc(n.slug)}">${thumb(n)}<div class="st">${esc(n.title)}${maturityBadge(n)}</div><div class="sm">${nm(a)} · ${compact(st.subs)} ${pl(st.subs, 'follower')}${rv.count ? ` · <span class="sc-rate">★ ${ratingText(rv.avg)}</span>` : ''}</div>${when ? `<div class="sm sc-when">${esc(when)}</div>` : ''}</a>`;
  };
  const rail = (list) => `<div class="rail">${list.map(sCard).join('')}</div>`;
  const dayLink = (d, sel, today) => `<a href="#/daily/${d}" class="${d === sel ? 'on' : ''} ${d === today ? 'today' : ''}"><span>${DAYS[d]}</span>${d === today ? '<span class="d">today</span>' : ''}</a>`;

  /* 6a. Home --------------------------------------------------------------- */
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
  const chev = (dir) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dir < 0 ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6'}"/></svg>`;
  /** A display name, with a check badge for official accounts (set in Supabase, not editable by users). */
  const nm = (u) => `${esc(u?.name || 'Deleted user')}${u?.official ? '<span class="official" title="Official Stories From Beyond account" aria-label="Official account"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.6 2.2 3.4-.3.9 3.3 3 1.7-1.2 3.1 1.2 3.1-3 1.7-.9 3.3-3.4-.3L12 22l-2.6-2.2-3.4.3-.9-3.3-3-1.7L3.3 12 2.1 8.9l3-1.7.9-3.3 3.4.3z" fill="currentColor"/><path d="M8 12.2l2.7 2.6L16 9.6" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : ''}`;
  const userLink = (u) => `<a class="avatar" href="#/u/${esc(u.username)}" aria-label="${esc(u.name)}'s profile">${esc(initials(u.name))}</a>`;

  route('/', async ({ app }) => {
    setTitle(''); document.body.classList.add('home');
    const me = auth.current();
    const pub = api.novels.listPublic();
    const picks = api.featured.picks();
    const trending = pub.map((n) => ({ n, st: api.novels.stats(n) })).sort((a, b) => b.st.trend - a.st.trend).slice(0, 12);
    const fresh = [...pub].sort((a, b) => b.created_at - a.created_at).slice(0, 10);
    const byGenre = GENRES.map((g) => ({ g, list: pub.filter((n) => n.genres.includes(g)) })).filter((x) => x.list.length).slice(0, 3);

    const slide = (n, i) => {
      const a = api.users.byId(n.author_id); const st = api.novels.stats(n);
      return `<article class="feat-slide" aria-roledescription="slide" aria-label="${i + 1} of ${picks.length}: ${esc(n.title)}" ${i ? 'hidden' : ''}>
        <a class="feat-art ${n.cover_image ? 'has-image' : ''}" href="#/novel/${esc(n.slug)}" style="--cv:${esc(n.cover_color)};${n.cover_image ? `background-image:url('${esc(n.cover_image)}')` : ''}">
          <span class="feat-letter" aria-hidden="true">${esc(initial(n.title))}</span>
          <span class="feat-rank">#${i + 1} up and coming</span>
          <span class="feat-title">${esc(n.title)}</span>
        </a>
        <div class="feat-info">
          <div><div class="feat-by">${esc(n.genres[0] || 'Series')} by <a href="#/u/${esc(a.username)}">${nm(a)}</a></div><p>${esc(n.synopsis)}</p></div>
          <ul class="feat-stats"><li><b>${compact(st.subs)}</b> ${pl(st.subs, 'follower')}</li><li><b>${st.chapters}</b> ${st.chapters === 1 ? 'chapter' : 'chapters'}</li><li><b>${compact(st.likes)}</b> ${pl(st.likes, 'like')}</li></ul>
        </div></article>`;
    };

    const featured = picks.length ? `
      <div class="feat" id="feat" role="region" aria-roledescription="carousel" aria-label="Featured series">
        <div class="feat-stage">${picks.map(slide).join('')}
          ${picks.length > 1 ? `<button class="feat-arrow prev" id="featPrev" aria-label="Previous featured series">${chev(-1)}</button><button class="feat-arrow next" id="featNext" aria-label="Next featured series">${chev(1)}</button>` : ''}
        </div>
        ${picks.length > 1 ? `<div class="feat-thumbs" role="tablist" aria-label="Choose a featured series">${picks.map((n, i) => `<button role="tab" aria-selected="${i === 0}" aria-label="${esc(n.title)}" data-i="${i}">${thumb(n, { sm: true, badge: false })}</button>`).join('')}</div>` : ''}
      </div>` : `<div class="hub-empty"><p>Nothing to feature yet. Published series show up here.</p></div>`;

    let friendsBody;
    if (!me) friendsBody = `<div class="hub-empty"><p>Log in to see what your friends are reading.</p><a class="btn btn-sm" href="#/login">Log in</a></div>`;
    else {
      const requests = api.friends.incoming(me.id).map((r) => api.users.byId(r.from)).filter(Boolean);
      const activity = api.friends.activity(me.id);
      friendsBody = (requests.length || activity.length) ? `<ul class="hub-list">
        ${requests.map((u) => `<li class="fr fr-req">${userLink(u)}<div class="fr-main"><a class="fr-name" href="#/u/${esc(u.username)}">${esc(u.name)}</a><div class="fr-act">Wants to be friends</div><div class="row fr-btns"><button class="btn btn-primary btn-sm" data-accept="${u.id}">Accept</button><button class="btn btn-ghost btn-sm" data-decline="${u.id}">Decline</button></div></div></li>`).join('')}
        ${activity.map(({ user, novel, chapterNo, at }) => `<li class="fr">${userLink(user)}<div class="fr-main"><a class="fr-name" href="#/u/${esc(user.username)}">${esc(user.name)}</a>
          ${novel ? `<div class="fr-act">Reading <a href="#/novel/${esc(novel.slug)}">${esc(novel.title)}</a></div><div class="fr-time">Chapter ${chapterNo}, ${esc(timeAgo(at))}</div>` : '<div class="fr-time">Hasn’t read anything yet</div>'}</div>
          ${novel ? `<a class="go" href="#/novel/${esc(novel.slug)}" aria-label="Open ${esc(novel.title)}">${ICON_PLAY}</a>` : ''}</li>`).join('')}
      </ul>` : `<div class="hub-empty"><p>No friends yet. Open someone’s profile and choose Add friend.</p><a class="btn btn-ghost btn-sm" href="#/browse">Find authors</a></div>`;
    }

    let favBody;
    if (!me) favBody = `<div class="hub-empty"><p>Log in and favorite a series to keep it here.</p><a class="btn btn-sm" href="#/signup">Sign up</a></div>`;
    else {
      const favs = api.favorites.forUser(me.id);
      favBody = favs.length ? `<ul class="hub-list">${favs.map((n) => {
        const sp = seriesProgress(me, n);
        return `<li class="fav"><a href="#/novel/${esc(n.slug)}" tabindex="-1" aria-hidden="true">${thumb(n, { sm: true })}</a><div class="fav-main"><a class="fav-t" href="#/novel/${esc(n.slug)}">${esc(n.title)}</a>
          <div class="fav-m">${esc(n.genres[0] || '')}${n.genres[0] ? ', ' : ''}${compact(api.novels.subscribers(n))} ${pl(api.novels.subscribers(n), 'follower')}</div>
          <div class="fav-m">${sp.started ? (sp.caughtUp ? `All ${sp.chs.length} read` : `Read ${sp.doneCount} of ${sp.chs.length}`) : `${plural(sp.chs.length, 'chapter')}, not started`}</div>
          <div class="fav-bar" aria-hidden="true"><i style="width:${sp.overall}%"></i></div></div>
          <a class="go" href="#/novel/${esc(n.slug)}/ch/${sp.resumeIdx + 1}" aria-label="${sp.started ? 'Continue' : 'Start'} ${esc(n.title)}">${ICON_PLAY}</a></li>`;
      }).join('')}</ul>` : `<div class="hub-empty"><p>No favorites yet. Choose Favorite on any series page to pin it here.</p><a class="btn btn-ghost btn-sm" href="#/browse">Browse series</a></div>`;
    }

    const tCard = ({ n, st }) => `<a class="s-card t-card" href="#/novel/${esc(n.slug)}">${thumb(n)}<div class="st">${esc(n.title)}</div><div class="t-meta"><span>♥ ${compact(st.likes)}</span><span>${compact(st.subs)} subs</span></div></a>`;

    app.innerHTML = `
      <section class="hub">
        <div class="hub-feat">
          <div class="hub-head"><h1>Featured</h1><span class="refresh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span id="featRefresh"></span></span></div>
          ${featured}
        </div>
        <div class="hub-col" id="hubFriends"><div class="hub-head"><h2>Friend activity</h2>${me ? `<a href="#/u/${esc(me.username)}">Your friends</a>` : ''}</div>${friendsBody}</div>
        <div class="hub-col"><div class="hub-head"><h2>Your favorites</h2>${me ? `<a href="#/u/${esc(me.username)}">See all</a>` : ''}</div>${favBody}</div>
      </section>
      <section class="section trend"><div class="section-head"><h2>Top trending</h2><a href="#/browse?sort=trending">See all</a></div>
        <div class="trend-wrap"><button class="rail-arrow prev" id="trPrev" aria-label="Scroll trending back">${chev(-1)}</button><div class="rail" id="trendRail">${trending.map(tCard).join('')}</div><button class="rail-arrow next" id="trNext" aria-label="Scroll trending forward">${chev(1)}</button></div></section>
      <section class="section"><div class="section-head"><h2>New series</h2><a href="#/browse?sort=new">See all</a></div>${rail(fresh)}</section>
      ${byGenre.map(({ g, list }) => `<section class="section"><div class="section-head"><h2>${esc(g)}</h2><a href="#/browse?genre=${encodeURIComponent(g)}">See all</a></div>${rail(list)}</section>`).join('')}`;

    // Featured carousel
    const slides = $$('.feat-slide', app), tabs = $$('.feat-thumbs button', app); let cur = 0;
    const show = (i) => { cur = (i + slides.length) % slides.length; slides.forEach((s, k) => { s.hidden = k !== cur; }); tabs.forEach((t, k) => t.setAttribute('aria-selected', String(k === cur))); };
    $('#featPrev')?.addEventListener('click', () => show(cur - 1));
    $('#featNext')?.addEventListener('click', () => show(cur + 1));
    tabs.forEach((t) => t.addEventListener('click', () => show(+t.dataset.i)));
    $('#feat')?.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); });

    // Countdown to the daily refresh
    const tick = () => {
      const ms = api.featured.nextRefresh() - now();
      if (api.featured.today() !== db.featured_daily?.date) { render(); return; }
      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
      $('#featRefresh').textContent = `New picks in ${h}h ${m}m`;
    };
    tick(); const timer = setInterval(tick, 30000);

    // Friend requests
    $('#hubFriends').addEventListener('click', async (e) => {
      const acc = e.target.closest('[data-accept]'); const dec = e.target.closest('[data-decline]');
      if (acc) { await api.friends.accept(me.id, acc.dataset.accept); toast(`You and ${api.users.byId(acc.dataset.accept).name} are now friends`); render(); }
      if (dec) { await api.friends.remove(me.id, dec.dataset.decline); toast('Friend request declined'); render(); }
    });

    // Trending rail arrows
    const tr = $('#trendRail'), trPrev = $('#trPrev'), trNext = $('#trNext');
    const upd = () => { trPrev.disabled = tr.scrollLeft < 4; trNext.disabled = tr.scrollLeft + tr.clientWidth >= tr.scrollWidth - 4; };
    tr.addEventListener('scroll', upd, { passive: true }); window.addEventListener('resize', upd); upd();
    trPrev.addEventListener('click', () => tr.scrollBy({ left: -tr.clientWidth * 0.8, behavior: 'smooth' }));
    trNext.addEventListener('click', () => tr.scrollBy({ left: tr.clientWidth * 0.8, behavior: 'smooth' }));

    cleanup = () => { clearInterval(timer); window.removeEventListener('resize', upd); };
  });

  /* 6b. Schedule ------------------------------------------------------------ */
  route('/daily', async () => go('/daily/' + new Date().getDay()));
  route('/daily/:d', async ({ app, params }) => {
    if (!/^[0-6]$/.test(params.d)) { location.replace('#/daily'); return; }
    const sel = +params.d; const today = new Date().getDay();
    setTitle(`${DAYS_LONG[sel]} releases`);
    // A series shows on a day if that's its release day, or a chapter is scheduled for that day in the next week.
    const soon = (n) => { const u = db.upcoming[n.id]; return u && u.at - now() < 7 * DAY && new Date(u.at).getDay() === sel ? u.at : null; };
    const list = api.novels.listPublic().filter((n) => n.update_day === sel || soon(n)).sort((a, b) => (soon(a) || Infinity) - (soon(b) || Infinity) || api.novels.stats(b).trend - api.novels.stats(a).trend);
    const whenFor = (n) => { const at = soon(n); return at ? `Next: ${new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${sel === today ? '' : ` ${DAYS[sel]}`}` : null; };
    app.innerHTML = `<section class="sched"><div class="sched-head"><h1>Release schedule</h1></div>
      <nav class="days" aria-label="Release days">${[1, 2, 3, 4, 5, 6, 0].map((d) => dayLink(d, sel, today)).join('')}</nav>
      <h2 style="margin:22px 0 4px">${DAYS_LONG[sel]}${sel === today ? ' · today' : ''}<span class="sub muted" style="font-weight:400;font-size:var(--t-sm);margin-left:8px">${plural(list.length, 'series', 'series')}</span></h2>
      <div class="grid">${list.map((n) => sCard(n, { when: whenFor(n) })).join('') || `<div class="empty" style="grid-column:1/-1"><h3>Nothing releases on ${DAYS_LONG[sel]}s yet</h3><p>Authors choose a release day in the Studio.</p></div>`}</div></section>`;
  });

  /* 6c. Browse ------------------------------------------------------------- */
  route('/browse', async ({ app, query }) => {
    setTitle('Browse');
    const q = (query.q || '').trim().toLowerCase(); const genre = query.genre || ''; const sort = query.sort || 'trending';
    let list = api.novels.listPublic().map((n) => ({ n, st: api.novels.stats(n), a: api.users.byId(n.author_id) }));
    const hiddenMature = contentPrefs.showMature() ? 0 : db.novels.filter((n) => api.novels.isPublic(n) && n.maturity === 'mature' && (!genre || n.genres.includes(genre))).length;
    if (q) list = list.filter(({ n, a }) => [n.title, n.synopsis, a.name, a.username, ...n.tags, ...n.genres].join(' ').toLowerCase().includes(q));
    if (genre) list = list.filter(({ n }) => n.genres.includes(genre));
    // Top rated: a few reviews shouldn't beat many, so blend each average toward 3 stars until it has ~5 reviews.
    const score = (n) => { const s = api.reviews.summary(n.id); return s.count ? (s.avg * s.count + 3 * 5) / (s.count + 5) : -1; };
    list.sort((x, y) => sort === 'updated' ? (y.n.last_published_at || 0) - (x.n.last_published_at || 0) : sort === 'new' ? y.n.created_at - x.n.created_at : sort === 'subs' ? y.st.subs - x.st.subs : sort === 'rated' ? score(y.n) - score(x.n) : y.st.trend - x.st.trend);
    const link = (patch) => '#/browse?' + new URLSearchParams(Object.fromEntries(Object.entries({ q: query.q, genre, sort, ...patch }).filter(([, v]) => v))).toString();
    app.innerHTML = `<div class="browse-head"><div><h1>${q ? `Results for “${esc(query.q)}”` : genre ? esc(genre) : 'All series'}</h1><p class="muted small" style="margin:4px 0 0">${plural(list.length, 'series', 'series')}${hiddenMature ? ` · ${hiddenMature} Mature hidden (<a href="#/settings" style="color:var(--ultra);font-weight:600">show</a>)` : ''}</p></div>
      <select class="select" id="sortSel" aria-label="Sort" style="width:auto"><option value="trending" ${sort === 'trending' ? 'selected' : ''}>Trending</option><option value="subs" ${sort === 'subs' ? 'selected' : ''}>Most followed</option>${features.sql ? `<option value="rated" ${sort === 'rated' ? 'selected' : ''}>Top rated</option>` : ''}<option value="updated" ${sort === 'updated' ? 'selected' : ''}>Recently updated</option><option value="new" ${sort === 'new' ? 'selected' : ''}>Newest</option></select></div>
      <div class="chip-set"><a class="chip ${!genre ? 'on' : ''}" href="${link({ genre: '' })}">All</a>${GENRES.map((g) => `<a class="chip ${genre === g ? 'on' : ''}" href="${link({ genre: g })}">${esc(g)}</a>`).join('')}</div>
      <div class="grid">${list.map(({ n }) => sCard(n)).join('') || `<div class="empty" style="grid-column:1/-1"><h3>No series match</h3><p>Try another word or clear the genre.</p><a class="btn btn-ghost btn-sm" href="#/browse">Clear filters</a></div>`}</div>`;
    $('#sortSel').addEventListener('change', (e) => go(link({ sort: e.target.value })));
  });

  /* 6d. Novel landing page -------------------------------------------------- */
  /* Follow (was "Subscribe": the word is saved for paid writer subscriptions later).
     The database table is still called subscriptions; only the words readers see changed. */
  const ICON_BELL = '<svg class="ico-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
  const followLabel = (on, long = false) => (on ? `${ICON_BELL}Following` : `${ICON_BELL}${long ? 'Follow for updates' : 'Follow'}`);

  /* How far into each chapter a reader got, saved in this browser.
     p = where they are now (0-100), d = finished it at least once. */
  const readPos = {
    all() { try { return JSON.parse(localStorage.getItem('sfb.readpos') || '{}'); } catch { return {}; } },
    get: (chId) => readPos.all()[chId] || { p: 0, d: false },
    set(chId, pct) {
      const all = readPos.all(); const prev = all[chId] || { p: 0, d: false };
      all[chId] = { p: Math.round(pct), d: prev.d || pct >= 97 };
      try { localStorage.setItem('sfb.readpos', JSON.stringify(all)); } catch {}
    },
  };

  /** Where a reader is in a series. Used by the series page and Favorites so they always agree.
      A chapter counts as read if they finished it, or have moved past it. Resume = the chapter they're in,
      or the next one if they finished it. */
  function seriesProgress(me, n) {
    const chs = api.novels.published(n.id);
    const prog = me ? api.progress.get(me.id, n.id) : null; const progIdx = prog ? chs.findIndex((c) => c.id === prog) : -1;
    const readSet = me ? api.progress.readSet(me.id) : new Set();
    const states = chs.map((c, i) => { const pos = readPos.get(c.id); const done = pos.d || (progIdx > i) || (readSet.has(c.id) && pos.p >= 97); return { done, pct: done ? 100 : pos.p }; });
    const doneCount = states.filter((s) => s.done).length;
    const overall = chs.length ? Math.round(states.reduce((t, s) => t + s.pct, 0) / chs.length) : 0;
    const started = progIdx >= 0 || states.some((s) => s.pct > 0);
    let resumeIdx = progIdx >= 0 ? progIdx : Math.max(0, states.findIndex((s) => !s.done));
    if (progIdx >= 0 && states[progIdx]?.done && progIdx + 1 < chs.length) resumeIdx = progIdx + 1;
    return { chs, progIdx, states, doneCount, overall, started, resumeIdx, caughtUp: chs.length > 0 && doneCount === chs.length };
  }

  route('/novel/:slug', async ({ app, params, query }) => {
    const n = api.novels.bySlug(params.slug); const me = auth.current();
    if (!n) return notFound(app, 'That series does not exist.');
    const mine = me && me.id === n.author_id;
    if (!api.novels.isPublic(n) && !mine) return notFound(app, 'This series has not been published yet.');
    if (n.slug !== params.slug) { location.replace(`#/novel/${n.slug}${location.hash.includes('?') ? '?' + location.hash.split('?')[1] : ''}`); return; } // old link from before a rename
    if (matureGate(app, n)) return;
    setTitle(n.title);
    const a = api.users.byId(n.author_id); const st = api.novels.stats(n);
    const following = me ? api.subscriptions.has(me.id, n.id) : false;
    const faved = me ? api.favorites.has(me.id, n.id) : false;
    const canGift = gifting.ready && !mine && api.novels.isPublic(n);
    const asc = query.sort === 'asc';
    const { chs, states, doneCount, overall, started, resumeIdx, caughtUp } = seriesProgress(me, n);
    const list = asc ? chs : [...chs].reverse();
    const next = features.sql ? db.upcoming[n.id] : null;
    const nextLine = next && next.at > now() ? `<div class="next-up">${ICON_CLOCK}<span>Next chapter <b>${esc(fmtWhen(next.at))}</b> <span class="muted">(${esc(fmtIn(next.at))})</span></span></div>` : '';

    const row = (c) => {
      const i = chs.indexOf(c); const s = states[i]; const isNew = c.published_at > now() - 7 * DAY;
      const right = s.done ? '<span class="r done">✓ Read</span>' : s.pct > 0 ? `<span class="r">${s.pct}%</span>` : '<span class="r"></span>';
      return `<li class="${s.done ? 'read' : ''}${canGift ? ' has-gift' : ''}">
        <a href="#/novel/${esc(n.slug)}/ch/${i + 1}"><span class="n"><small>Ch.</small>${i + 1}</span>
          <div><div class="t">${esc(c.title)}${isNew ? '<span class="badge badge-up">NEW</span>' : ''}</div>
            <div class="m">${esc(fmtDate(c.published_at))} · ${readMin(wordCount(c.content))} min · ♥ ${compact(c.likes)}<span class="row-gifts" data-row-gifts="${c.id}">${c.gift_count ? ` · ${giftCountText(c.gift_count)}` : ''}</span></div>
            ${!s.done && s.pct > 0 ? `<div class="ep-prog" aria-hidden="true"><i style="width:${s.pct}%"></i></div>` : ''}</div>
          ${right}</a>
        ${canGift ? `<button type="button" class="ep-gift" data-gift-ch="${c.id}" aria-label="Send a gift for chapter ${i + 1}" title="Gift this chapter">${ICON_GIFT}</button>` : ''}
      </li>`;
    };

    app.innerHTML = `
      ${mine && !api.novels.isPublic(n) ? `<div class="pub-state" style="margin-top:16px">Draft preview. Only you can see this. <a href="#/studio/novel/${n.id}">Manage in Studio</a></div>` : ''}
      <div class="series-band" style="--cv:${esc(n.cover_color)}">
        <div class="series-top">${thumb(n, { badge: false })}
          <div><div class="chip-set" style="margin-bottom:8px">${n.genres.map((g) => `<a class="chip" href="#/browse?genre=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}</div>
            <h1>${esc(n.title)}${maturityBadge(n)}</h1><div class="by">by <a href="#/u/${esc(a.username)}">${nm(a)}</a></div>
            <div class="series-meta">${features.sql && api.reviews.summary(n.id).count ? `<a href="#rvSection" class="sm-rate" data-jump="rvSection">${stars(api.reviews.summary(n.id).avg, { small: true })}<b>${ratingText(api.reviews.summary(n.id).avg)}</b> (${api.reviews.summary(n.id).count})</a>` : ''}<span><b>${compact(st.subs)}</b> ${pl(st.subs, 'follower')}</span><span><b>${compact(st.views)}</b> ${pl(st.views, 'view')}</span><span><b>${compact(st.likes)}</b> ${pl(st.likes, 'like')}</span>${gifting.ready ? `<span class="gift-pill" id="giftCount">${giftCountText(n.gift_count)}</span>` : ''}<span>${n.status === 'completed' ? '<b>Completed</b>' : n.update_day === null ? '<b>Ongoing</b>' : `Updates <b>${DAYS_LONG[n.update_day]}s</b>`}</span></div>
            ${nextLine}
            <div class="series-cta">
              ${chs.length ? `<a class="btn btn-primary btn-lg" href="#/novel/${esc(n.slug)}/ch/${started ? resumeIdx + 1 : 1}">${!started ? 'Read first chapter' : caughtUp ? `Reread · Ch. ${resumeIdx + 1}` : `Continue · Ch. ${resumeIdx + 1}`}</a>` : '<span></span>'}
              <button class="btn btn-ghost btn-lg sub-btn" id="subBtn" aria-pressed="${following}">${followLabel(following)}</button>
              <button class="btn btn-ghost btn-lg fav-btn" id="favBtn" aria-pressed="${faved}">${faved ? '★ Favorited' : '☆ Favorite'}</button>
              ${canGift ? `<button class="btn btn-ghost btn-lg gift-btn" id="giftBtn">${ICON_GIFT}Gift series</button>` : ''}
            </div>
            ${me && started && chs.length ? `<div class="series-prog"><div class="sp-row"><span>Your progress</span><b>${doneCount} of ${plural(chs.length, 'chapter')} read</b></div><div class="sp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${overall}" aria-label="Series progress"><i style="width:${overall}%"></i></div></div>` : ''}
          </div></div></div>
      <div class="series-body series-layout">
        <div>
          <div class="ep-head"><h2>${plural(chs.length, 'chapter')}</h2><button class="btn btn-soft btn-sm" id="sortBtn">${asc ? 'Oldest first' : 'Newest first'}</button></div>
          <ol class="ep-list" id="epList">${list.map(row).join('') || '<li class="muted small" style="padding:12px 0">No chapters published yet.</li>'}</ol>
          ${features.sql ? '<section class="reviews" id="rvSection" aria-labelledby="rvTitle"></section>' : ''}
        </div>
        <aside>
          <h2 style="font-size:var(--t-md);margin:24px 0 8px">About</h2>
          <p class="series-syn clamp" id="syn">${esc(n.synopsis) || '<span class="muted">No synopsis yet.</span>'}</p><button class="series-more" id="synMore">Read more</button>
          <div class="chip-set" style="margin-top:12px">${n.tags.map((t) => `<a class="chip" href="#/browse?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>
          ${gifting.ready ? '<section class="supporters" id="supporters" aria-labelledby="supTitle"><div class="sup-head"><h2 id="supTitle">Top supporters</h2></div><p class="muted small">Loading…</p></section>' : ''}
          <a class="author-row" href="#/u/${esc(a.username)}">${crownedAvatar(a)}<div><div class="n">${nm(a)}</div><div class="b">${esc(a.bio) || 'No bio yet.'}</div></div></a>
          ${mine ? `<a class="btn btn-ghost btn-block" style="margin-top:14px" href="#/studio/novel/${n.id}">Edit in Studio</a>` : ''}
          ${features.sql && !mine ? `<button type="button" class="report-link" data-report="novel" data-report-id="${esc(n.id)}" data-report-label="${esc(n.title)}">${ICON_FLAG}Report this series</button>` : ''}
        </aside></div>`;

    if (features.sql) paintReviews({ n, host: $('#rvSection'), me, mine, sort: query.rsort || 'new' });
    if (query.go === 'reviews') setTimeout(() => $('#rvSection')?.scrollIntoView({ block: 'start' }), 50);
    app.querySelector('[data-jump]')?.addEventListener('click', (e) => { e.preventDefault(); $('#rvSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

    if (gifting.ready) paintSupporters(n, $('#supporters'), mine);
    const afterGift = ({ chapterId } = {}) => {
      $('#giftCount').textContent = giftCountText(n.gift_count);
      if (chapterId) { const el = $(`[data-row-gifts="${chapterId}"]`); if (el) el.textContent = ` · ${giftCountText(api.chapters.byId(chapterId).gift_count)}`; }
      paintSupporters(n, $('#supporters'), mine);
      const av = $('.author-row .av-wrap'); if (av) av.outerHTML = crownedAvatar(a);
    };
    $('#giftBtn')?.addEventListener('click', () => openGiftSheet({ novel: n, onSent: afterGift }));
    $('#epList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-gift-ch]'); if (!b) return;
      openGiftSheet({ novel: n, chapter: api.chapters.byId(b.dataset.giftCh), onSent: afterGift });
    });
    $('#sortBtn').addEventListener('click', () => go(`/novel/${n.slug}${asc ? '' : '?sort=asc'}`));
    $('#synMore').addEventListener('click', () => { const s = $('#syn'); s.classList.toggle('clamp'); $('#synMore').textContent = s.classList.contains('clamp') ? 'Read more' : 'Show less'; });
    $('#subBtn').addEventListener('click', async () => {
      if (!requireAuth()) return;
      const on = await api.subscriptions.toggle(me.id, n.id);
      toast(on ? `Following ${n.title}. You’ll be notified when ${a.name} posts a new chapter.` : `Unfollowed ${n.title}`); render();
    });
    $('#favBtn').addEventListener('click', async () => {
      if (!requireAuth()) return;
      const on = await api.favorites.toggle(me.id, n.id);
      toast(on ? `Added ${n.title} to your favorites` : `Removed ${n.title} from your favorites`); render();
    });
  });

  /* 6e. Reader (continuous scroll) ------------------------------------------ */
  /* Reader theme: 'auto' follows the site theme (Light/Dark/System in the account menu).
     Older saved settings always stored 'light' even if the reader never picked it, which is
     why the reader stayed white in dark mode. v:2 resets that once to 'auto'. */
  const READER_DEFAULTS = { v: 2, theme: 'auto', size: 18, lh: 'normal', font: 'serif' };
  const prefs = {
    get: () => {
      try {
        const saved = JSON.parse(localStorage.getItem('sfb.prefs') || localStorage.getItem('chapterhouse.v2.prefs') || '{}');
        if (saved.v !== 2) { saved.theme = 'auto'; saved.v = 2; }
        return { ...READER_DEFAULTS, ...saved };
      } catch { return { ...READER_DEFAULTS }; }
    },
    set: (p) => { try { localStorage.setItem('sfb.prefs', JSON.stringify({ ...prefs.get(), ...p })); localStorage.removeItem('chapterhouse.v2.prefs'); } catch {} },
  };
  const LH = { tight: 1.5, normal: 1.7, loose: 1.95 };
  const readerTheme = (t) => (t === 'auto' ? (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light') : t);

  /* Permanent chapter links (used by notifications and shares). Chapter positions can shift when a draft
     in the middle gets published; the chapter id never changes. Sends you to the chapter's current number. */
  route('/novel/:slug/c/:cid', async ({ app, params, query }) => {
    const n = api.novels.bySlug(params.slug); const c = api.chapters.byId(params.cid);
    if (!n || !c || c.novel_id !== n.id) return notFound(app, 'That chapter does not exist.');
    const i = api.novels.published(n.id).indexOf(c);
    if (i < 0) return notFound(app, 'That chapter isn’t available right now. The writer may have taken it down.');
    const qs = new URLSearchParams(query).toString();
    location.replace(`#/novel/${n.slug}/ch/${i + 1}${qs ? '?' + qs : ''}`);
  });
  const chapterLink = (n, c) => `#/novel/${n.slug}/c/${c.id}`;

  route('/novel/:slug/ch/:n', async ({ app, params, query }) => {
    const n = api.novels.bySlug(params.slug); const me = auth.current();
    if (!n) return notFound(app, 'That series does not exist.');
    const mine = me && me.id === n.author_id;
    if (!api.novels.isPublic(n) && !mine) return notFound(app, 'This series has not been published yet.');
    if (n.slug !== params.slug) { location.replace(`#/novel/${n.slug}/ch/${params.n}`); return; }
    if (matureGate(app, n)) return;
    const chs = api.novels.published(n.id); const startIdx = parseInt(params.n, 10) - 1;
    if (!chs[startIdx]) return notFound(app, 'That chapter does not exist.');
    const upcoming = features.sql ? db.upcoming[n.id] : null;
    const a = api.users.byId(n.author_id); const p = prefs.get();
    const following = () => (me ? api.subscriptions.has(me.id, n.id) : false);
    document.body.classList.add('reading');

    const svgBack = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
    const svgList = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';
    const svgType = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>';

    app.innerHTML = `<div class="reader" id="reader" data-theme="${esc(readerTheme(p.theme))}" data-font="${esc(p.font)}" style="--rd-size:${p.size}px;--rd-lh:${LH[p.lh] || 1.7}">
      <div class="rd-progress" id="rdProgress" role="progressbar" aria-label="Chapter progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="rdBar"></i></div>
      <div class="rd-top" id="rdTop"><div class="rd-top-in">
        <a class="back" href="#/novel/${esc(n.slug)}" aria-label="Back to series">${svgBack}</a>
        <div class="meta"><div class="s">${esc(n.title)}</div><div class="e"><span id="rdNow"></span><span class="rd-left" id="rdLeft"></span></div></div>
        <button class="tool" id="rdWhoBtn" aria-label="Who’s who: characters and places so far" title="Who’s who" hidden>${ICON_PEOPLE}</button>
        <button class="tool" id="rdSettingsBtn" aria-expanded="false" aria-controls="rdSettings" aria-label="Reading settings">${svgType}</button>
        <a class="tool" href="#/novel/${esc(n.slug)}" aria-label="Chapter list">${svgList}</a>
      </div></div>
      <div class="rd-settings" id="rdSettings" hidden>
        <div class="grp"><div class="lbl">Theme</div><div class="seg" id="segTheme">
          <button data-v="auto" aria-pressed="${p.theme === 'auto'}"><span class="sw sw-auto"></span>Auto</button>
          <button data-v="light" aria-pressed="${p.theme === 'light'}"><span class="sw" style="background:#fff"></span>Light</button>
          <button data-v="sepia" aria-pressed="${p.theme === 'sepia'}"><span class="sw" style="background:#f3ead8"></span>Sepia</button>
          <button data-v="dark" aria-pressed="${p.theme === 'dark'}"><span class="sw" style="background:#121317"></span>Dark</button></div>
          <p class="rd-hint">Auto matches the site theme from your account menu.</p></div>
        <div class="grp"><div class="lbl">Text size</div><div class="stepper"><button id="szDown" aria-label="Smaller text">A−</button><output id="szOut">${p.size}px</output><button id="szUp" aria-label="Larger text">A+</button></div></div>
        <div class="grp"><div class="lbl">Line spacing</div><div class="seg" id="segLh"><button data-v="tight" aria-pressed="${p.lh === 'tight'}">Tight</button><button data-v="normal" aria-pressed="${p.lh === 'normal'}">Normal</button><button data-v="loose" aria-pressed="${p.lh === 'loose'}">Loose</button></div></div>
        <div class="grp"><div class="lbl">Typeface</div><div class="seg" id="segFont"><button data-v="serif" aria-pressed="${p.font === 'serif'}" style="font-family:var(--read)">Serif</button><button data-v="sans" aria-pressed="${p.font === 'sans'}">Sans</button></div></div>
      </div>
      <div class="rd-canvas" id="rdCanvas"></div>
      <div class="rd-bottom" id="rdBottom"><div class="rd-bottom-in">
        <a class="nav" id="navPrev">${svgBack}<span>Prev</span></a>
        <select id="navSel" aria-label="Jump to chapter">${chs.map((c, i) => `<option value="${i + 1}">Ch. ${i + 1} · ${esc(c.title)}</option>`).join('')}</select>
        <a class="nav" id="navNext"><span>Next</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></a>
      </div></div></div>`;

    const reader = $('#reader'), canvas = $('#rdCanvas');
    const loaded = new Set(); let current = startIdx;

    const chapterBlock = (idx) => {
      const c = chs[idx]; const words = wordCount(c.content);
      return `<article class="ep" id="ch-${idx + 1}" data-idx="${idx}">
        <header class="ep-head"><div class="k">Chapter ${idx + 1} of ${chs.length}</div><h1>${esc(c.title)}</h1><div class="d">${esc(fmtDate(c.published_at))} · ${readMin(words)} min read · ${compact(c.views)} ${pl(c.views, 'view')}</div></header>
        <div class="ep-body">${sanitize(c.content)}</div>
        ${c.author_note ? `<aside class="note"><span class="avatar" aria-hidden="true">${esc(initials(a.name))}</span><div><div class="nh">Author's note</div><div class="nn">${nm(a)}</div><div class="nb">${esc(c.author_note)}</div></div></aside>` : ''}
        <div class="ep-actions">
          <button class="like" data-like="${c.id}" aria-pressed="${me ? api.likes.has(me.id, c.id) : false}">♥ <span>${compact(c.likes)}</span></button>
          <button class="subq" data-sub aria-pressed="${following()}">${followLabel(following())}</button>
          ${features.sql && !mine ? `<button type="button" class="report-link rd" data-report="chapter" data-report-id="${esc(c.id)}" data-report-label="Chapter ${idx + 1}: ${esc(c.title)}" aria-label="Report this chapter">${ICON_FLAG}<span>Report</span></button>` : ''}
          <span class="sp"></span>
          ${idx + 1 < chs.length ? `<a href="#/novel/${esc(n.slug)}/ch/${idx + 2}" data-next="${idx + 1}">Next chapter</a>` : ''}
        </div>
        ${!gifting.ready ? '' : mine
          ? `<div class="gift-band mine"><span class="gb-art">${giftSvg('candle', 40)}</span><div class="gb-t"><b>Gifts on this chapter</b><span data-gift-count="${c.id}">${giftCountText(c.gift_count, 'No gifts yet')}</span></div></div>`
          : `<div class="gift-band"><span class="gb-art">${giftSvg('candle', 40)}</span><div class="gb-t"><b>Enjoyed this chapter?</b><span>Send ${esc(a.name)} a gift. <span class="gb-count" data-gift-count="${c.id}">${c.gift_count ? giftCountText(c.gift_count) + ' so far.' : ''}</span></span></div><button type="button" class="gb-btn" data-gift="${c.id}">${ICON_GIFT}Send a gift</button></div>`}
        <section class="ep-comments" id="cmts-${c.id}"></section>
        ${idx + 1 < chs.length ? `<div class="ep-next" data-sentinel="${idx + 1}"></div>` : `<div class="ep-end"><b>You are caught up</b>${upcoming && upcoming.at > now() ? `The next chapter arrives ${esc(fmtWhen(upcoming.at))} (${esc(fmtIn(upcoming.at))}).` : n.status === 'completed' ? 'This series is complete.' : n.update_day !== null ? `New chapters arrive on ${DAYS_LONG[n.update_day]}s.` : 'More is on the way.'}${features.sql && !mine ? `<br><a class="ep-review" href="#/novel/${esc(n.slug)}?go=reviews">${api.reviews.mine(me?.id, n.id) ? 'Edit your review' : 'Rate and review this series'}</a>` : ''}<br><button class="btn btn-sm" data-sub data-long aria-pressed="${following()}" style="margin-top:12px">${followLabel(following(), true)}</button></div>`}
      </article>`;
    };

    function renderComments(c) {
      const host = $(`#cmts-${c.id}`); if (!host) return;
      const list = api.comments.forChapter(c.id);
      host.innerHTML = `<h2>Comments <span class="c">${list.length}</span></h2>
        ${me ? `<form class="c-form" data-ch="${c.id}"><label class="sr-only" for="cb-${c.id}">Comment on chapter ${c.chapter_number}</label><textarea id="cb-${c.id}" placeholder="Leave a comment on this chapter" maxlength="2000" required></textarea><div class="row"><button class="btn btn-sm" type="submit">Post</button></div></form>`
             : `<div class="c-login"><a href="#/login?next=${encodeURIComponent(parseHash().path)}">Log in</a> to comment on this chapter.</div>`}
        ${list.map((cm) => { const u = api.users.byId(cm.user_id); return `<div class="comment"><span class="avatar" aria-hidden="true">${esc(initials(u?.name))}</span><div><div class="w"><b>${nm(u)}</b>${u?.id === n.author_id ? '<span class="badge badge-new">Author</span>' : ''}<time>${esc(timeAgo(cm.created_at))}</time>${me && (me.id === cm.user_id || mine) ? `<button class="del" data-del="${cm.id}">Delete</button>` : ''}${features.sql && me?.id !== cm.user_id ? `<button class="del" data-report="comment" data-report-id="${esc(cm.id)}" data-report-label="${esc(u?.name || 'someone')}’s comment">Report</button>` : ''}</div><div class="b">${esc(cm.body)}</div></div></div>`; }).join('') || `<p class="small" style="color:var(--rd-muted);padding:12px 0">No comments yet. Be the first.</p>`}`;
      host.querySelector('form')?.addEventListener('submit', async (e) => { e.preventDefault(); const ta = e.target.querySelector('textarea'); if (!ta.value.trim()) return; const btn = e.submitter; if (btn) btn.disabled = true; try { await api.comments.add(c.id, me.id, ta.value); toast('Comment posted'); renderComments(c); } finally { if (btn) btn.disabled = false; } });
      host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (!(await askConfirm('This comment will be deleted for everyone.', { title: 'Delete comment?', ok: 'Delete', danger: true }))) return; await api.comments.remove(b.dataset.del); renderComments(c); }));
    }

    function appendChapter(idx) {
      if (loaded.has(idx) || !chs[idx]) return;
      loaded.add(idx);
      canvas.insertAdjacentHTML('beforeend', chapterBlock(idx));
      renderComments(chs[idx]);
      const sentinel = canvas.querySelector(`[data-sentinel="${idx + 1}"]`); if (sentinel) io.observe(sentinel);
      headIO.observe($(`#ch-${idx + 1}`));
    }

    // Continuous scroll: when the end of a chapter comes into view, append the next one.
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); appendChapter(+e.target.dataset.sentinel); } }), { rootMargin: '600px 0px' });
    // Track which chapter is "current" for the top bar, dropdown, URL and progress.
    const headIO = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) setCurrent(+e.target.dataset.idx); }), { rootMargin: '-40% 0px -55% 0px' });
    function setCurrent(idx) {
      if (idx === current && $('#rdNow').textContent) return;
      current = idx; const c = chs[idx];
      $('#rdNow').textContent = `Ch. ${idx + 1} · ${c.title}`;
      $('#navSel').value = String(idx + 1);
      $('#navPrev').setAttribute('aria-disabled', idx === 0); $('#navPrev').href = idx > 0 ? `#/novel/${n.slug}/ch/${idx}` : '#';
      $('#navNext').setAttribute('aria-disabled', idx + 1 >= chs.length); $('#navNext').href = idx + 1 < chs.length ? `#/novel/${n.slug}/ch/${idx + 2}` : '#';
      history.replaceState(null, '', `#/novel/${n.slug}/ch/${idx + 1}`);
      setTitle(`Ch. ${idx + 1} · ${n.title}`);
      api.novels.recordView(n.id, c.id); // counted when the reader actually reaches the chapter, not when it preloads
      if (me) api.progress.set(me.id, n.id, c.id, idx === startIdx && !leftStart ? spot.p : 0);
      if (idx !== startIdx) leftStart = true;
      updateProgress();
    }
    // Sync how far into the chapter you are every 20 seconds, so another device can pick up the same spot.
    const syncTimer = me ? setInterval(() => { const p = chapterPct(current); if (p >= 0) api.progress.set(me.id, n.id, chs[current].id, p); }, 20000) : null;

    /* Chapter progress: how far through the current chapter's text you are (not the whole page,
       which keeps growing as chapters load). Also shows minutes left and saves your spot. */
    let saveAt = 0;
    function chapterPct(idx) {
      const body = $(`#ch-${idx + 1} .ep-body`); if (!body) return -1;
      const r = body.getBoundingClientRect(); const view = window.innerHeight;
      const total = r.height - view * 0.6; if (total <= 0) return r.top < view ? 100 : 0;
      return Math.min(100, Math.max(0, ((view * 0.4 - r.top) / total) * 100));
    }
    function updateProgress() {
      const pct = chapterPct(current); const c = chs[current]; if (pct < 0) return;
      $('#rdBar').style.width = pct + '%';
      $('#rdProgress').setAttribute('aria-valuenow', String(Math.round(pct)));
      const left = Math.ceil(readMin(wordCount(c.content)) * (1 - pct / 100));
      $('#rdLeft').textContent = pct >= 99 ? ' · Finished' : ` · ${Math.round(pct)}% · ${left} min left`;
      const t = Date.now(); if (t - saveAt > 600 || pct >= 97) { saveAt = t; readPos.set(c.id, pct); }
    }

    // Pick up where you left off in this chapter (read before anything saves a new position).
    const spot = { ...readPos.get(chs[startIdx].id) };
    // Nothing saved on this device? Use the spot saved to the account from another device.
    if (me && !spot.p && !spot.d && api.progress.get(me.id, n.id) === chs[startIdx].id) spot.p = api.progress.pct(me.id, n.id) || 0;
    const toComments = query.to === 'comments';
    let leftStart = false;
    appendChapter(startIdx); setCurrent(startIdx);
    if (toComments) requestAnimationFrame(() => setTimeout(() => $(`#cmts-${chs[startIdx].id}`)?.scrollIntoView({ block: 'start' }), 60));
    else if (spot.p > 3 && spot.p < 97) {
      requestAnimationFrame(() => setTimeout(() => {
        const body = $(`#ch-${startIdx + 1} .ep-body`); if (!body) return;
        const r = body.getBoundingClientRect(); const view = window.innerHeight;
        const y = window.scrollY + r.top - view * 0.4 + (spot.p / 100) * (r.height - view * 0.6);
        window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
        toast(`Picked up where you left off (${spot.p}%)`);
      }, 60));
    }

    // Who's who: only shows up if the writer has made bible entries visible to readers.
    const whoBtn = $('#rdWhoBtn');
    bible.forReader(n.id, chs.length).then((all) => { if (all && (all.entries.length || all.locked)) whoBtn.hidden = false; });
    whoBtn.addEventListener('click', async () => {
      const upto = current + 1;
      const data = await bible.forReader(n.id, upto);
      if (!data) { toast('Couldn’t load the guide. Try again in a moment.'); return; }
      openWhosWho({ n, upto, data, mount: reader });
    });

    // Hide chrome on scroll down, reveal on scroll up; progress bar.
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY; const dy = y - lastY; lastY = y;
      if (Math.abs(dy) > 6 && settings.hidden) { const hide = dy > 0 && y > 80; $('#rdTop').classList.toggle('hide', hide); $('#rdBottom').classList.toggle('hide', hide); reader.classList.toggle('chrome-hidden', hide); }
      updateProgress();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    const saveOnLeave = () => { const c = chs[current]; const pct = chapterPct(current); if (c && pct >= 0) { readPos.set(c.id, pct); if (me) api.progress.set(me.id, n.id, c.id, pct); } };
    window.addEventListener('pagehide', saveOnLeave);

    // Settings popover
    const settings = $('#rdSettings'), sBtn = $('#rdSettingsBtn');
    const closeSettings = () => { settings.hidden = true; sBtn.setAttribute('aria-expanded', 'false'); };
    sBtn.addEventListener('click', () => { settings.hidden = !settings.hidden; sBtn.setAttribute('aria-expanded', String(!settings.hidden)); });
    const onDocClick = (e) => { if (!settings.hidden && !settings.contains(e.target) && e.target !== sBtn && !sBtn.contains(e.target)) closeSettings(); };
    document.addEventListener('click', onDocClick);
    const seg = (id, key, apply) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; prefs.set({ [key]: b.dataset.v }); $$('button', $(id)).forEach((x) => x.setAttribute('aria-pressed', x === b)); apply(b.dataset.v); });
    seg('#segTheme', 'theme', (v) => { reader.dataset.theme = readerTheme(v); });
    seg('#segLh', 'lh', (v) => { reader.style.setProperty('--rd-lh', LH[v]); updateProgress(); });
    seg('#segFont', 'font', (v) => { reader.dataset.font = v; updateProgress(); });
    const setSize = (d) => { const size = Math.min(26, Math.max(14, prefs.get().size + d)); prefs.set({ size }); reader.style.setProperty('--rd-size', size + 'px'); $('#szOut').textContent = size + 'px'; updateProgress(); };
    $('#szDown').addEventListener('click', () => setSize(-1)); $('#szUp').addEventListener('click', () => setSize(1));
    // If the reader is on Auto and the site theme changes (e.g. System and the device flips), follow it.
    const themeObs = new MutationObserver(() => { if (prefs.get().theme === 'auto') reader.dataset.theme = readerTheme('auto'); });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // Bottom nav
    $('#navSel').addEventListener('change', (e) => go(`/novel/${n.slug}/ch/${e.target.value}`));
    canvas.addEventListener('click', async (e) => {
      const nxt = e.target.closest('[data-next]');
      if (nxt) { const block = $(`#ch-${+nxt.dataset.next + 1}`); if (block) { e.preventDefault(); block.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; } }
      const gift = e.target.closest('[data-gift]');
      if (gift) {
        const gc = api.chapters.byId(gift.dataset.gift);
        openGiftSheet({ novel: n, chapter: gc, onSent: ({ chapterId }) => { if (!chapterId) return; $$(`[data-gift-count="${chapterId}"]`, canvas).forEach((el) => { el.textContent = giftCountText(api.chapters.byId(chapterId).gift_count) + ' so far.'; }); } });
        return;
      }
      const like = e.target.closest('[data-like]'); const sub = e.target.closest('[data-sub]');
      if (like) { if (!requireAuth()) return; const on = await api.likes.toggle(me.id, like.dataset.like); like.setAttribute('aria-pressed', on); like.querySelector('span').textContent = compact(api.chapters.byId(like.dataset.like).likes); }
      if (sub) {
        if (!requireAuth()) return;
        const on = await api.subscriptions.toggle(me.id, n.id);
        $$('[data-sub]', canvas).forEach((b) => { b.setAttribute('aria-pressed', on); b.innerHTML = followLabel(on, b.hasAttribute('data-long')); });
        toast(on ? `Following ${n.title}. You’ll hear about new chapters.` : `Unfollowed ${n.title}`);
      }
    });
    const onKey = (e) => { if (e.target.matches('input, textarea, select, [contenteditable]')) return; if (e.key === 'ArrowRight' && current + 1 < chs.length) go(`/novel/${n.slug}/ch/${current + 2}`); if (e.key === 'ArrowLeft' && current > 0) go(`/novel/${n.slug}/ch/${current}`); if (e.key === 'Escape') closeSettings(); };
    document.addEventListener('keydown', onKey);
    cleanup = () => { saveOnLeave(); clearInterval(syncTimer); io.disconnect(); headIO.disconnect(); themeObs.disconnect(); window.removeEventListener('scroll', onScroll); window.removeEventListener('pagehide', saveOnLeave); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); };
  });

  /* 6f. Auth views ---------------------------------------------------------- */
  route('/login', async ({ app, query }) => {
    setTitle('Log in');
    app.innerHTML = `<section class="auth"><h1>Welcome back</h1><p class="lead">Pick up where you left off.</p>
      <form id="loginForm" novalidate><div class="field"><label for="li_id">Email</label><input class="input" id="li_id" type="email" autocomplete="email" required></div>
      <div class="field"><div class="row between"><label for="li_pw">Password</label><a class="forgot" href="#/forgot" id="forgotLink">Forgot password?</a></div><input class="input" id="li_pw" type="password" autocomplete="current-password" required></div>
      <div class="form-error" id="err" role="alert"></div><button class="btn btn-primary btn-block btn-lg" type="submit">Log in</button></form>
      <p class="alt">New here? <a href="#/signup">Create an account</a></p></section>`;
    // Carry the typed email over to the reset page.
    $('#forgotLink').addEventListener('click', (e) => { const v = $('#li_id').value.trim(); if (v) { e.preventDefault(); go('/forgot?email=' + encodeURIComponent(v)); } });
    $('#loginForm').addEventListener('submit', async (e) => { e.preventDefault(); const btn = e.submitter; if (btn) btn.disabled = true; try { const u = await auth.login($('#li_id').value, $('#li_pw').value); toast(u ? `Logged in as ${u.name}` : 'Logged in'); go(query.next || '/'); } catch (err) { $('#err').textContent = err.message; } finally { if (btn) btn.disabled = false; } });
  });
  route('/signup', async ({ app, query }) => {
    setTitle('Sign up');
    app.innerHTML = `<section class="auth"><h1>Create your account</h1><p class="lead">Follow series, comment on chapters, write your own.</p>
      <form id="signupForm" novalidate>
      <div class="field"><label for="su_name">Display name</label><input class="input" id="su_name" autocomplete="name" required></div>
      <div class="field"><label for="su_user">Username</label><input class="input" id="su_user" autocomplete="username" required><span class="hint">Letters, numbers, underscores. This is your public handle.</span></div>
      <div class="field"><label for="su_email">Email</label><input class="input" id="su_email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="su_pw">Password</label><input class="input" id="su_pw" type="password" autocomplete="new-password" required><span class="hint">At least 8 characters.</span></div>
      <div class="form-error" id="err" role="alert"></div><button class="btn btn-primary btn-block btn-lg" type="submit">Create account</button></form>
      <p class="alt">Already have one? <a href="#/login">Log in</a></p></section>`;
    $('#signupForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = e.submitter; if (btn) btn.disabled = true;
      try {
        const email = $('#su_email').value.trim();
        const u = await auth.signup({ name: $('#su_name').value, username: $('#su_user').value.trim(), email, password: $('#su_pw').value });
        if (u?.pending) { app.innerHTML = `<section class="auth"><h1>Check your email</h1><p class="lead">We sent a confirmation link to <b>${esc(email)}</b>. Open it to finish creating your account, then you will be logged in.</p><p class="alt"><a href="#/login">Back to log in</a></p></section>`; return; }
        toast(`Welcome, ${u?.name || 'reader'}`); go(query.next || '/');
      } catch (err) { $('#err').textContent = err.message; } finally { if (btn) btn.disabled = false; }
    });
  });

  /* Forgot password: Supabase emails a link. Opening it signs you in for a moment and lands on #/reset-password.
     In Supabase > Authentication > URL Configuration, the site's address must be in Redirect URLs. */
  route('/forgot', async ({ app, query }) => {
    setTitle('Reset your password');
    app.innerHTML = `<section class="auth"><h1>Reset your password</h1><p class="lead">Enter the email you signed up with. We’ll send you a link to choose a new password.</p>
      ${query.expired ? '<div class="pub-state" role="status" style="margin-bottom:16px">That reset link expired or was already used. Request a new one below.</div>' : ''}
      <form id="fgForm" novalidate><div class="field"><label for="fg_email">Email</label><input class="input" id="fg_email" type="email" autocomplete="email" value="${esc(query.email || '')}" required></div>
      <div class="form-error" id="err" role="alert"></div><button class="btn btn-primary btn-block btn-lg" type="submit">Send reset link</button></form>
      <p class="alt">Remembered it? <a href="#/login">Log in</a></p></section>`;
    $('#fgForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = e.submitter; const email = $('#fg_email').value.trim(); $('#err').textContent = '';
      if (!/^\S+@\S+\.\S+$/.test(email)) { $('#err').textContent = 'Enter a valid email address.'; return; }
      if (btn) btn.disabled = true;
      try {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        if (error) throw new Error(/rate|seconds/i.test(error.message) ? 'Too many tries. Wait a minute, then try again.' : error.message);
        // Same message whether or not the account exists, so this page can't be used to check who has an account.
        app.innerHTML = `<section class="auth"><h1>Check your email</h1><p class="lead">If an account uses <b>${esc(email)}</b>, a reset link is on its way. It works once and expires after an hour.</p><p class="muted small">Nothing after a few minutes? Check spam, or <a href="#/forgot?email=${encodeURIComponent(email)}" style="color:var(--ultra);font-weight:600">send it again</a>.</p><p class="alt"><a href="#/login">Back to log in</a></p></section>`;
      } catch (err) { $('#err').textContent = err.message; } finally { if (btn) btn.disabled = false; }
    });
  });

  route('/reset-password', async ({ app, stale }) => {
    setTitle('Choose a new password');
    const { data } = await sb.auth.getSession(); if (stale()) return;
    if (!data.session) {
      app.innerHTML = `<section class="auth"><h1>Link expired</h1><p class="lead">This reset link has expired or was already used.</p><a class="btn btn-primary btn-block btn-lg" href="#/forgot">Send a new link</a></section>`;
      return;
    }
    app.innerHTML = `<section class="auth"><h1>Choose a new password</h1><p class="lead">For ${esc(data.session.user.email || 'your account')}.</p>
      <form id="rpForm" novalidate>
        <div class="field"><label for="rp_pw">New password</label><input class="input" id="rp_pw" type="password" autocomplete="new-password" required><span class="hint">At least 8 characters.</span></div>
        <div class="field"><label for="rp_again">Confirm new password</label><input class="input" id="rp_again" type="password" autocomplete="new-password" required></div>
        <div class="form-error" id="err" role="alert"></div><button class="btn btn-primary btn-block btn-lg" type="submit">Save new password</button></form></section>`;
    $('#rpForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = e.submitter; const pw = $('#rp_pw').value, again = $('#rp_again').value; $('#err').textContent = '';
      if (pw.length < 8) { $('#err').textContent = 'Passwords need at least 8 characters.'; return; }
      if (pw !== again) { $('#err').textContent = 'The passwords don’t match.'; return; }
      if (btn) btn.disabled = true;
      try {
        const { error } = await sb.auth.updateUser({ password: pw });
        if (error) throw new Error(/different|same/i.test(error.message) ? 'Choose a password you haven’t used on this account.' : error.message);
        toast('Password changed. You’re logged in.'); go('/');
      } catch (err) { $('#err').textContent = err.message; } finally { if (btn) btn.disabled = false; }
    });
  });

  /* 6g. Profile + notifications -------------------------------------------- */
  route('/u/:username', async ({ app, params }) => {
    const u = api.users.byUsername(params.username); if (!u) return notFound(app, 'No one has that username.');
    setTitle(u.name); const me = auth.current(); const mine = me && me.id === u.id;
    const published = api.novels.byAuthor(u.id).filter(api.novels.isPublic);
    const subs = api.subscriptions.forUser(u.id).map((s) => api.novels.byId(s.novel_id)).filter((n) => n && api.novels.isPublic(n));
    const favs = api.favorites.forUser(u.id); const friends = api.friends.list(u.id);
    const fs = me && !mine ? api.friends.status(me.id, u.id) : 'none';
    const actions = mine ? '<button class="btn btn-ghost btn-sm" id="editProfile">Edit profile</button><button class="btn btn-soft btn-sm" id="logoutBtn">Log out</button>'
      : fs === 'friends' ? '<span class="fr-state">✓ Friends</span><button class="btn btn-ghost btn-sm" data-fr="remove">Remove friend</button>'
      : fs === 'outgoing' ? '<span class="fr-state">Friend request sent</span><button class="btn btn-ghost btn-sm" data-fr="remove">Cancel request</button>'
      : fs === 'incoming' ? '<button class="btn btn-primary btn-sm" data-fr="accept">Accept friend request</button><button class="btn btn-ghost btn-sm" data-fr="remove">Decline</button>'
      : '<button class="btn btn-primary btn-sm" data-fr="request">Add friend</button>';
    const reportBtn = features.sql && !mine ? `<button type="button" class="report-link" data-report="user" data-report-id="${esc(u.id)}" data-report-label="@${esc(u.username)}">${ICON_FLAG}Report</button>` : '';
    app.innerHTML = `<header class="profile-head"><span class="avatar lg" aria-hidden="true">${esc(initials(u.name))}</span><div><h1>${nm(u)}</h1><div class="h">@${esc(u.username)} · joined ${esc(fmtDate(u.created_at))}</div><p class="bio">${esc(u.bio) || (mine ? 'Add a short bio so readers know who you are.' : '')}</p></div><div class="row profile-actions">${actions}${reportBtn}</div></header>
      <div id="profileEdit"></div>
      <section class="section"><div class="section-head"><h2>Friends<span class="sub">${friends.length}</span></h2></div>${friends.length ? `<ul class="friend-chips">${friends.map((f) => `<li><a href="#/u/${esc(f.username)}"><span class="avatar" aria-hidden="true">${esc(initials(f.name))}</span>${esc(f.name)}</a></li>`).join('')}</ul>` : `<div class="empty"><h3>No friends yet</h3><p>${mine ? 'Open someone’s profile and choose Add friend.' : 'Send a friend request to be the first.'}</p></div>`}</section>
      <section class="section"><div class="section-head"><h2>Favorites<span class="sub">${favs.length}</span></h2></div><div class="grid">${favs.map(sCard).join('') || `<div class="empty" style="grid-column:1/-1"><h3>No favorites yet</h3><p>${mine ? 'Choose Favorite on a series page to keep it here.' : 'Nothing favorited yet.'}</p></div>`}</div></section>
      <section class="section"><div class="section-head"><h2>${mine ? 'Your series' : `Series by ${esc(u.name)}`}</h2></div><div class="grid">${published.map(sCard).join('') || `<div class="empty" style="grid-column:1/-1"><h3>Nothing published yet</h3><p>${mine ? 'Series you publish show up here.' : 'Check back later.'}</p>${mine ? '<a class="btn btn-sm" href="#/studio">Open Studio</a>' : ''}</div>`}</div></section>
      <section class="section"><div class="section-head"><h2>Following<span class="sub">${subs.length}</span></h2></div><div class="grid">${subs.map(sCard).join('') || `<div class="empty" style="grid-column:1/-1"><h3>Not following anything yet</h3><p>Follow a series and new chapters will show up in your notifications.</p><a class="btn btn-ghost btn-sm" href="#/browse">Browse series</a></div>`}</div></section>`;
    $('#logoutBtn')?.addEventListener('click', async () => { await auth.logout(); toast('Logged out'); if (location.hash === '#/') render(); else go('/'); });
    $$('[data-fr]', app).forEach((b) => b.addEventListener('click', async () => {
      if (!requireAuth()) return;
      const act = b.dataset.fr;
      if (act === 'request') { await api.friends.request(me.id, u.id); toast(`Friend request sent to ${u.name}`); }
      if (act === 'accept') { await api.friends.accept(me.id, u.id); toast(`You and ${u.name} are now friends`); }
      if (act === 'remove') { const label = fs === 'friends' ? `Remove ${u.name} from your friends?` : null; if (label && !(await askConfirm(label, { ok: 'Remove friend', danger: true }))) return; await api.friends.remove(me.id, u.id); toast(fs === 'friends' ? 'Friend removed' : fs === 'incoming' ? 'Friend request declined' : 'Friend request canceled'); }
      render();
    }));
    $('#editProfile')?.addEventListener('click', () => {
      $('#profileEdit').innerHTML = `<form class="card" id="pf" style="max-width:520px;margin-bottom:8px"><div class="field"><label for="pf_name">Display name</label><input class="input" id="pf_name" value="${esc(u.name)}" required></div><div class="field"><label for="pf_bio">Bio</label><textarea class="textarea" id="pf_bio" maxlength="280">${esc(u.bio)}</textarea></div><div class="row"><button class="btn" type="submit">Save changes</button><button class="btn btn-ghost" type="button" id="pfCancel">Cancel</button></div></form>`;
      $('#pfCancel').addEventListener('click', () => { $('#profileEdit').innerHTML = ''; });
      $('#pf').addEventListener('submit', async (e) => { e.preventDefault(); await api.users.update(u.id, { name: $('#pf_name').value.trim() || u.name, bio: $('#pf_bio').value.trim() }); toast('Profile saved'); render(); });
    });
  });

  /* Notifications. Reading: new chapters from series you follow, friend requests, report updates.
     Your writing: comments, follows, likes, reviews, milestones and scheduled releases on your series.
     Likes and follows on the same thing on the same day are grouped into one line. */
  const NOTICE_KINDS = [
    ['comment', 'Comments on your chapters'], ['review', 'Reviews of your series'], ['follow', 'New followers'],
    ['like', 'Likes on your chapters'], ['milestone', 'Follower milestones'], ['released', 'Scheduled chapters going live'],
  ];
  const WRITING_KINDS = new Set(['comment', 'review', 'follow', 'like', 'milestone', 'released', 'removed']);
  const REPORT_WHAT = { novel: 'series', chapter: 'chapter', comment: 'comment', review: 'review', user: 'profile' };

  function noticeItems(me) {
    const items = [];
    api.notifications.forUser(me.id).forEach((x) => {
      const n = api.novels.byId(x.novel_id); const c = api.chapters.byId(x.chapter_id);
      if (!n || !c || c.status !== 'published' || !api.novels.isPublic(n)) return;
      const a = api.users.byId(n.author_id); const i = api.novels.published(n.id).indexOf(c) + 1;
      items.push({ tab: 'reading', at: x.created_at, unread: !x.read_at, n, href: chapterLink(n, c), html: `<b>${esc(a?.name || 'A writer')}</b> posted Chapter ${i} of <b>${esc(n.title)}</b>: ${esc(c.title)}` });
    });
    // Group likes (per chapter) and follows (per series) that happened on the same day.
    const groups = new Map();
    db.notices.filter((x) => x.user_id === me.id).forEach((x) => {
      const day = new Date(Number(x.created_at)).toDateString();
      const key = x.kind === 'like' ? `like:${x.chapter_id}:${day}` : x.kind === 'follow' ? `follow:${x.novel_id}:${day}` : `one:${x.id}`;
      const g = groups.get(key); if (g) { g.list.push(x); g.at = Math.max(g.at, Number(x.created_at)); g.unread ||= !x.read_at; }
      else groups.set(key, { list: [x], at: Number(x.created_at), unread: !x.read_at });
    });
    groups.forEach(({ list, at, unread }) => {
      const x = list[0]; const n = api.novels.byId(x.novel_id); const c = x.chapter_id ? api.chapters.byId(x.chapter_id) : null;
      const actors = [...new Set(list.map((y) => y.actor_id).filter(Boolean))].map((id) => api.users.byId(id)?.name || 'Someone');
      const who = actors.length === 0 ? 'Someone' : actors.length === 1 ? `<b>${esc(actors[0])}</b>` : actors.length === 2 ? `<b>${esc(actors[0])}</b> and <b>${esc(actors[1])}</b>` : `<b>${esc(actors[0])}</b> and ${actors.length - 1} others`;
      const title = n ? `<b>${esc(n.title)}</b>` : 'your series';
      const chNo = n && c ? api.novels.published(n.id).indexOf(c) + 1 : 0;
      const chName = chNo ? `Chapter ${chNo}` : 'a chapter';
      const base = { tab: WRITING_KINDS.has(x.kind) ? 'writing' : 'reading', at, unread, n };
      switch (x.kind) {
        case 'comment': items.push({ ...base, icon: 'comment', href: n && c ? chapterLink(n, c) + '?to=comments' : null, html: `${who} commented on ${chName} of ${title}`, quote: x.body }); break;
        case 'like': items.push({ ...base, icon: 'like', href: n && c ? chapterLink(n, c) : null, html: `${who} liked ${chName} of ${title}` }); break;
        case 'follow': items.push({ ...base, icon: 'follow', href: n ? `#/novel/${n.slug}` : null, html: `${who} started following ${title}` }); break;
        case 'review': items.push({ ...base, icon: 'review', href: n ? `#/novel/${n.slug}?go=reviews` : null, html: `${who} rated ${title} ${stars(x.value || 0, { small: true })}`, quote: x.body }); break;
        case 'milestone': items.push({ ...base, icon: 'milestone', href: n ? `#/novel/${n.slug}` : null, html: `${title} reached <b>${Number(x.value).toLocaleString()} followers</b>. Nice work.` }); break;
        case 'released': items.push({ ...base, icon: 'released', href: n && c ? chapterLink(n, c) : null, html: `Your scheduled chapter <b>${esc(x.body || 'Untitled')}</b> is now live on ${title}` }); break;
        case 'removed': items.push({ ...base, icon: 'flag', href: n ? `#/studio/novel/${n.id}` : null, html: `A moderator took down your ${esc(REPORT_WHAT[x.ref_id] || 'post')}${n ? ` on ${title}` : ''} for breaking the community rules.`, quote: x.body ? `Reason: ${x.body}` : '' }); break;
        case 'report_closed': items.push({ ...base, icon: 'flag', href: null, html: `Thanks for your report about a ${esc(REPORT_WHAT[x.ref_id] || 'post')}${n ? ` on ${title}` : ''}. ${x.body === 'action' ? 'A moderator took action.' : 'A moderator reviewed it and didn’t find a rule break.'}` }); break;
        default: break;
      }
    });
    return items.sort((a, b) => b.at - a.at);
  }
  const NOTICE_ICON = {
    comment: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    like: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    follow: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    review: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    milestone: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4"/>',
    released: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flag: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>',
  };

  route('/notifications', async ({ app, query }) => {
    if (!requireAuth('/notifications')) return;
    setTitle('Notifications'); const me = auth.current();
    const tab = ['writing', 'reading'].includes(query.tab) ? query.tab : 'all';
    const all = noticeItems(me);
    const list = tab === 'all' ? all : all.filter((x) => x.tab === tab);
    const unreadIn = (t) => all.filter((x) => x.unread && x.tab === t).length;
    const reqs = api.friends.incoming(me.id).map((r) => api.users.byId(r.from)).filter(Boolean);
    const writes = api.novels.byAuthor(me.id).length > 0;
    const tabBtn = (k, label, count) => `<a href="#/notifications${k === 'all' ? '' : '?tab=' + k}" aria-current="${tab === k ? 'page' : 'false'}">${label}${count ? `<span class="nt-count">${count}</span>` : ''}</a>`;
    app.innerHTML = `<div class="studio-head"><div><h1>Notifications</h1><p class="lead">${writes ? 'What readers are doing with your series, and new chapters from series you follow.' : 'Friend requests and new chapters from series you follow.'}</p></div>${features.sql ? '<a class="btn btn-ghost btn-sm" href="#/settings?s=notif">Notification settings</a>' : ''}</div>
      ${features.sql ? `<nav class="nt-tabs" aria-label="Filter notifications">${tabBtn('all', 'All')}${tabBtn('writing', 'Your writing', unreadIn('writing'))}${tabBtn('reading', 'Reading', unreadIn('reading'))}</nav>` : ''}
      ${reqs.length && tab !== 'writing' ? `<ul class="req-list" id="reqList">${reqs.map((u) => `<li class="fr fr-req">${userLink(u)}<div class="fr-main"><a class="fr-name" href="#/u/${esc(u.username)}">${esc(u.name)}</a><div class="fr-act">Wants to be friends</div><div class="row fr-btns"><button class="btn btn-primary btn-sm" data-accept="${u.id}">Accept</button><button class="btn btn-ghost btn-sm" data-decline="${u.id}">Decline</button></div></div></li>`).join('')}</ul>` : ''}
      <ul class="notif">${list.map((x) => `<li class="${x.unread ? 'unread' : ''}">${x.n ? `<a href="#/novel/${esc(x.n.slug)}" tabindex="-1" aria-hidden="true">${thumb(x.n, { sm: true, badge: false })}</a>` : '<span></span>'}
        <div>${x.icon ? `<span class="nt-ico nt-${x.icon}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NOTICE_ICON[x.icon]}</svg></span>` : ''}${x.href ? `<a class="t" href="${esc(x.href)}">${x.html}</a>` : `<span class="t">${x.html}</span>`}
          ${x.quote ? `<div class="nt-quote">${esc(x.quote)}</div>` : ''}<div class="m">${esc(timeAgo(x.at))}</div></div></li>`).join('')
        || `<li style="display:block;padding:0"><div class="empty"><h3>Nothing yet</h3><p>${tab === 'writing' ? 'When readers comment on, like, follow or review your series, it shows up here.' : 'Follow a series and you will hear about every new chapter here.'}</p>${tab === 'writing' ? '<a class="btn btn-ghost btn-sm" href="#/studio">Open Studio</a>' : '<a class="btn btn-ghost btn-sm" href="#/browse">Browse series</a>'}</div></li>`}</ul>`;
    $('#reqList')?.addEventListener('click', async (e) => {
      const acc = e.target.closest('[data-accept]'); const dec = e.target.closest('[data-decline]');
      if (acc) { await api.friends.accept(me.id, acc.dataset.accept); toast(`You and ${api.users.byId(acc.dataset.accept).name} are now friends`); render(); }
      if (dec) { await api.friends.remove(me.id, dec.dataset.decline); toast('Friend request declined'); render(); }
    });
    await api.notifications.markAllRead(me.id); renderShell();
  });

  /* 6h. Studio dashboard ---------------------------------------------------- */
  route('/studio', async ({ app }) => {
    if (!requireAuth('/studio')) return;
    setTitle('Studio'); const me = auth.current(); const list = api.novels.byAuthor(me.id);
    app.innerHTML = `<header class="studio-head"><div><h1>Studio</h1><p class="lead">Your series, drafts and chapters.</p></div><button class="btn btn-primary" id="newNovel">New series</button></header>
      ${features.sql ? '' : '<div class="pub-state" role="status" style="margin-bottom:16px"><b>Some Studio tools are switched off.</b> Run <b>supabase-update-nov-2026.sql</b> in the Supabase SQL Editor to turn on scheduling, cover uploads, maturity ratings, reviews, reports and writer notifications.</div>'}
      ${gifting.ready ? '<section class="card gift-earn" id="giftEarn" aria-labelledby="geTitle"><h2 id="geTitle">Gifts</h2><p class="muted small">Loading…</p></section>' : ''}
      <ul class="st-rows">${list.map((n) => { const all = api.novels.all(n.id); const pub = all.filter((c) => c.status === 'published'); const live = api.novels.isPublic(n); const drafts = all.length - pub.length; return `<li>${thumb(n, { sm: true, badge: false })}<div><a class="t" href="#/studio/novel/${n.id}">${esc(n.title || 'Untitled series')}</a><div class="m"><span class="badge ${live ? 'badge-live' : 'badge-draft'}">${live ? (n.status === 'completed' ? 'COMPLETED' : 'LIVE') : 'DRAFT'}</span><span>${pub.length} published${drafts ? ` · ${drafts} draft${drafts > 1 ? 's' : ''}` : ''}</span><span>${compact(api.novels.subscribers(n))} ${pl(api.novels.subscribers(n), 'follower')}</span>${gifting.ready ? `<span>${giftCountText(n.gift_count)}</span>` : ''}${features.sql && api.reviews.summary(n.id).count ? `<span>★ ${ratingText(api.reviews.summary(n.id).avg)} (${api.reviews.summary(n.id).count})</span>` : ''}<span>${n.update_day !== null ? DAYS_LONG[n.update_day] + 's' : 'no release day'}</span>${features.sql && db.upcoming[n.id] ? `<span class="sched-note">Next: ${esc(fmtWhen(db.upcoming[n.id].at))}${db.upcoming[n.id].queued > 1 ? ` · ${db.upcoming[n.id].queued} queued` : ''}</span>` : ''}</div></div><div class="a"><a class="btn btn-soft btn-sm" href="#/studio/novel/${n.id}">Manage</a>${live ? `<a class="btn btn-ghost btn-sm" href="#/novel/${esc(n.slug)}">View</a>` : ''}</div></li>`; }).join('') || `<li style="display:block"><div class="empty"><h3>Start your first series</h3><p>Create a series, add chapters, publish when ready. Drafts stay private.</p><button class="btn" id="newNovel2">New series</button></div></li>`}</ul>`;
    if (gifting.ready) paintEarnings(me, $('#giftEarn'));
    const create = async () => { const n = await api.novels.create(me.id); go(`/studio/novel/${n.id}`); };
    $('#newNovel').addEventListener('click', create); $('#newNovel2')?.addEventListener('click', create);
  });

  /* 6i. Studio: novel details + chapters ----------------------------------- */
  route('/studio/novel/:id', async ({ app, params }) => {
    if (!requireAuth()) return;
    const me = auth.current(); const n = api.novels.byId(params.id);
    if (!n || n.author_id !== me.id) return notFound(app, 'That series is not in your Studio.');
    setTitle(`${n.title || 'Untitled series'} · Studio`);
    const chs = api.novels.all(n.id); const live = api.novels.isPublic(n); const pubCount = chs.filter((c) => c.status === 'published').length;
    const pubList = api.novels.published(n.id);
    const queued = chs.filter((c) => api.chapters.state(c) === 'scheduled').sort((a, b) => a.scheduled_at - b.scheduled_at);
    const drafts = chs.filter((c) => api.chapters.state(c) === 'draft');
    const isUpload = /\/storage\/v1\/object\/public\/covers\//.test(n.cover_image || '');

    const chRow = (c, i) => {
      const stt = features.sql ? api.chapters.state(c) : (c.status === 'published' ? 'published' : 'draft');
      const readerNo = pubList.indexOf(c) + 1;
      const badge = stt === 'published' ? '<span class="badge badge-live">PUBLISHED</span>' : stt === 'scheduled' ? '<span class="badge badge-sched">SCHEDULED</span>' : '<span class="badge badge-draft">DRAFT</span>';
      const acts = stt === 'published' ? `<button class="btn btn-ghost btn-sm" data-unpub="${c.id}">Unpublish</button>`
        : stt === 'scheduled' ? `<button class="btn btn-ghost btn-sm" data-sched="${c.id}">Change time</button><button class="btn btn-ghost btn-sm" data-unsched="${c.id}">Unschedule</button><button class="btn btn-primary btn-sm" data-pub="${c.id}">Publish now</button>`
        : `${features.sql ? `<button class="btn btn-ghost btn-sm" data-sched="${c.id}">Schedule</button>` : ''}<button class="btn btn-primary btn-sm" data-pub="${c.id}">Publish</button>`;
      return `<li class="${stt === 'scheduled' ? 'is-sched' : ''}"><span class="n">${c.chapter_number}</span><div><a class="t" href="#/studio/novel/${n.id}/ch/${c.id}">${esc(c.title || 'Untitled chapter')}</a>
        <div class="m">${badge}${stt === 'scheduled' ? `<span class="sched-note">${ICON_CLOCK}Goes live ${esc(fmtWhen(c.scheduled_at))}</span>` : ''}${readerNo && readerNo !== c.chapter_number ? `<span>Readers see Ch. ${readerNo}</span>` : ''}<span>${wordCount(c.content).toLocaleString()} words</span>${c.author_note ? '<span>note ✓</span>' : ''}<span>${esc(timeAgo(c.updated_at))}</span></div></div>
        <div class="a"><button class="btn btn-soft btn-sm" data-move="-1" data-id="${c.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="btn btn-soft btn-sm" data-move="1" data-id="${c.id}" ${i === chs.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>${acts}<button class="btn btn-ghost btn-sm" data-del="${c.id}">Delete</button></div></li>`;
    };

    app.innerHTML = `<div class="studio-series"><div class="crumbs"><a href="#/studio">Studio</a> / ${esc(n.title || 'Untitled series')}</div>
      <div class="cols"><div>
        <form class="card" id="details"><h2>Series details</h2>
          <div class="field"><label for="f_title">Title</label><input class="input" id="f_title" value="${esc(n.title)}" placeholder="Series title" maxlength="120" required>${live && features.sql ? '<span class="hint">Renaming changes the link, but old links keep working.</span>' : ''}</div>
          <div class="field"><label for="f_syn">Synopsis</label><textarea class="textarea" id="f_syn" maxlength="600" placeholder="Two or three sentences that tell a reader what they are in for.">${esc(n.synopsis)}</textarea></div>
          <div class="field"><span class="lbl">Genres</span><div class="chip-set" id="genreSet">${GENRES.map((g) => `<button type="button" class="chip ${n.genres.includes(g) ? 'on' : ''}" data-g="${esc(g)}" aria-pressed="${n.genres.includes(g)}">${esc(g)}</button>`).join('')}</div><span class="hint">Up to two.</span></div>
          <div class="field"><label for="f_tags">Tags</label><input class="input" id="f_tags" value="${esc(n.tags.join(', '))}" placeholder="slow burn, found family"><span class="hint">Comma separated. Searchable.</span></div>
          ${features.sql ? `<fieldset class="field maturity-set"><legend class="lbl">Maturity rating</legend>${Object.entries(MATURITY).map(([k, m]) => `<label class="mat-opt"><input type="radio" name="f_mat" value="${k}" ${n.maturity === k ? 'checked' : ''}><span><b>${m.label}</b><span>${esc(m.hint)}</span></span></label>`).join('')}<span class="hint">Mature series are hidden from Home and Browse for readers who haven’t switched them on, and readers confirm their age before reading.</span></fieldset>` : ''}
          <div class="row" style="gap:16px;align-items:start">
            <div class="field" style="flex:1"><label for="f_day">Release day</label><select class="select" id="f_day"><option value="">No fixed day</option>${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${n.update_day === d ? 'selected' : ''}>${DAYS_LONG[d]}</option>`).join('')}</select><span class="hint">Shown on the schedule. Scheduling suggests this day.</span></div>
            <div class="field" style="flex:1"><label for="f_status">Status</label><select class="select" id="f_status"><option value="ongoing" ${n.status !== 'completed' ? 'selected' : ''}>Ongoing</option><option value="completed" ${n.status === 'completed' ? 'selected' : ''}>Completed</option></select></div></div>
          <div class="field"><span class="lbl">Cover</span><div class="thumb-picker"><div id="thumbPreview">${thumb(n, { badge: false })}</div><div>
            ${features.sql ? `<div class="row cover-btns"><label class="btn btn-sm" for="f_file">${n.cover_image ? 'Replace image' : 'Upload image'}</label><input type="file" id="f_file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" class="sr-only">${n.cover_image ? '<button type="button" class="btn btn-ghost btn-sm" id="coverRemove">Remove image</button>' : ''}</div><div class="drop-hint" id="dropZone">or drop an image here · JPG, PNG or WebP, up to 15 MB. You can crop it next.</div>` : ''}
            <div class="lbl small" style="margin:10px 0 6px">${features.sql ? 'Background colour (shows when there’s no image)' : 'Colour'}</div>
            <div class="swatches" id="swatches">${COVERS.map((c) => `<button type="button" style="background:${c}" data-c="${c}" aria-label="Cover colour ${c}" aria-pressed="${n.cover_color === c}"></button>`).join('')}</div>
            <details class="cover-link" ${!features.sql || (n.cover_image && !isUpload) ? 'open' : ''}><summary>Use an image link instead</summary><input class="input" id="f_cover" value="${esc(n.cover_image)}" placeholder="https://…"><span class="hint">Square images, 600 × 600 or larger. Leave empty for a typographic cover.</span></details>
          </div></div></div>
          <div class="row"><button class="btn" type="submit">Save details</button></div></form>
        <div class="card"><h2>Danger zone</h2><p class="small muted">Deleting removes the series, every chapter, comments and followers. No undo.</p><button class="btn btn-danger btn-sm" id="delNovel">Delete series</button></div>
      </div><div>
        <div class="pub-state ${live ? 'live' : ''}">${live ? `<b>Live.</b> Readers can find it at <a href="#/novel/${esc(n.slug)}">/novel/${esc(n.slug)}</a>. ${pubCount} of ${plural(chs.length, 'chapter')} published · ${compact(api.novels.subscribers(n))} ${pl(api.novels.subscribers(n), 'follower')}.` : n.status !== 'draft' ? '<b>Published, but hidden.</b> No published chapters yet, so readers cannot see it. Publish a chapter to go live.' : queued.length ? `<b>Draft.</b> Goes live with the first scheduled chapter on ${esc(fmtWhen(queued[0].scheduled_at))}.` : '<b>Draft.</b> Only you can see this series. Publishing any chapter makes it live and notifies followers.'}</div>
        <div class="row" style="margin-bottom:14px">${n.status !== 'draft' ? '<button class="btn btn-ghost btn-sm" id="offline">Take offline</button>' : pubCount ? '<button class="btn btn-primary btn-sm" id="pubNovel">Publish series</button>' : ''}${live ? `<a class="btn btn-ghost btn-sm" href="#/novel/${esc(n.slug)}">View public page</a>` : ''}</div>
        ${features.sql ? `<div class="card plan-card"><div class="row between" style="margin-bottom:6px"><h2 style="margin:0">Release plan</h2>${drafts.length ? `<button class="btn btn-sm" id="planBtn">Schedule drafts</button>` : ''}</div>
          ${queued.length ? `<ol class="plan-list">${queued.map((c) => `<li><span class="pl-when">${esc(fmtWhen(c.scheduled_at))}</span><a href="#/studio/novel/${n.id}/ch/${c.id}">${esc(c.title || 'Untitled chapter')}</a><span class="muted small">${esc(fmtIn(c.scheduled_at))}</span></li>`).join('')}</ol><p class="hint">Scheduled chapters keep saving as you edit, right up until they go live. Followers are notified at release.</p>`
            : `<p class="muted small" style="margin:0">Nothing scheduled. ${drafts.length ? 'Use <b>Schedule drafts</b> to queue your drafts on a regular rhythm, or schedule one at a time below.' : 'Write a draft, then schedule it to go live on your release day.'}</p>`}</div>` : ''}
        <a class="card bible-card" href="#/studio/novel/${n.id}/bible"><span class="bible-card-ico">${ICON_BOOK}</span><span><b>Story bible</b><span>Characters, places, rules and open threads. Private to you.</span></span><span class="bible-card-go" aria-hidden="true">›</span></a>
        <div class="card"><div class="row between" style="margin-bottom:8px"><h2 style="margin:0">Chapters</h2><button class="btn btn-sm" id="newCh">New chapter</button></div>
          <ol class="ep-rows">${chs.map(chRow).join('') || '<li style="display:block"><div class="empty"><h3>No chapters yet</h3><p>Add the first one and start writing.</p></div></li>'}</ol></div>
      </div></div></div>`;

    const gs = $('#genreSet');
    gs.addEventListener('click', (e) => { const b = e.target.closest('button[data-g]'); if (!b) return; const on = b.classList.contains('on'); if (!on && $$('button.on', gs).length >= 2) { toast('Pick up to two genres'); return; } b.classList.toggle('on'); b.setAttribute('aria-pressed', !on); });
    let color = n.cover_color;
    const refresh = () => { $('#thumbPreview').innerHTML = thumb({ ...n, title: $('#f_title').value, cover_color: color, cover_image: $('#f_cover').value.trim() }, { badge: false }); };
    $('#swatches').addEventListener('click', (e) => { const b = e.target.closest('button[data-c]'); if (!b) return; color = b.dataset.c; $$('button', $('#swatches')).forEach((x) => x.setAttribute('aria-pressed', x === b)); refresh(); });
    $('#f_title').addEventListener('input', refresh); $('#f_cover').addEventListener('change', refresh);
    $('#details').addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = e.submitter; if (btn) btn.disabled = true;
      try {
        const status = n.status === 'draft' ? 'draft' : $('#f_status').value;
        const patch = { title: $('#f_title').value.trim(), synopsis: $('#f_syn').value.trim(), genres: $$('button.on', gs).map((b) => b.dataset.g), tags: $('#f_tags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10), update_day: $('#f_day').value === '' ? null : +$('#f_day').value, cover_color: color, cover_image: $('#f_cover').value.trim(), status };
        const mat = $('input[name="f_mat"]:checked'); if (mat) patch.maturity = mat.value;
        const oldCover = n.cover_image;
        await api.novels.update(n.id, patch);
        if (oldCover && oldCover !== patch.cover_image) api.covers.remove(oldCover);
        toast('Details saved'); render();
      } finally { if (btn) btn.disabled = false; }
    });

    // Cover upload: pick or drop a file, crop it square, upload, save right away.
    const takeFile = async (file) => {
      if (!file) return;
      if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) { toast('That isn’t an image. Choose a JPG, PNG or WebP.'); return; }
      if (file.size > 15 * 1024 * 1024) { toast('That image is over 15 MB. Choose a smaller one.'); return; }
      const blob = await openCropDialog(file); if (!blob) return;
      const st = $('#dropZone'); if (st) st.textContent = 'Uploading…';
      try {
        const url = await api.covers.upload(me.id, n.id, blob);
        const old = n.cover_image; await api.novels.update(n.id, { cover_image: url }); if (old) api.covers.remove(old);
        toast('Cover updated'); render();
      } catch (err) { toast(err.message); if (st) st.textContent = 'Upload failed. Try again.'; }
    };
    $('#f_file')?.addEventListener('change', (e) => { takeFile(e.target.files[0]); e.target.value = ''; });
    const dz = $('#dropZone'); const picker = $('.thumb-picker');
    if (dz && picker) {
      ['dragenter', 'dragover'].forEach((t) => picker.addEventListener(t, (e) => { e.preventDefault(); picker.classList.add('dragging'); }));
      ['dragleave', 'drop'].forEach((t) => picker.addEventListener(t, (e) => { e.preventDefault(); picker.classList.remove('dragging'); }));
      picker.addEventListener('drop', (e) => takeFile(e.dataTransfer?.files?.[0]));
    }
    $('#coverRemove')?.addEventListener('click', async () => {
      if (!(await askConfirm('The series will use a typographic cover in its background colour.', { title: 'Remove the cover image?', ok: 'Remove' }))) return;
      const old = n.cover_image; await api.novels.update(n.id, { cover_image: '' }); api.covers.remove(old); toast('Cover image removed'); render();
    });

    $('#pubNovel')?.addEventListener('click', async () => { await api.novels.setStatus(n.id, 'ongoing'); toast('Series published', { href: `#/novel/${n.slug}`, label: 'View' }); render(); });
    $('#offline')?.addEventListener('click', async () => { if (!(await askConfirm(`Readers will not see it. Nothing is deleted.${queued.length ? ' Scheduled chapters will still go live at their time, which puts the series back online. Unschedule them first if you want it to stay offline.' : ''}`, { title: 'Take the series offline?', ok: 'Take offline' }))) return; await api.novels.setStatus(n.id, 'draft'); toast('Series is offline'); render(); });
    $('#delNovel').addEventListener('click', async () => { if (!(await askConfirm(`“${n.title || 'Untitled series'}” and all its chapters, comments and followers will be deleted. This cannot be undone.`, { title: 'Delete this series?', ok: 'Delete series', danger: true }))) return; const old = n.cover_image; await api.novels.remove(n.id); api.covers.remove(old); toast('Series deleted'); go('/studio'); });
    $('#newCh').addEventListener('click', async () => { const c = await api.chapters.create(n.id); go(`/studio/novel/${n.id}/ch/${c.id}`); });
    $('#planBtn')?.addEventListener('click', async () => { if (await openPlanDialog(n)) render(); });
    $$('[data-pub]').forEach((b) => b.addEventListener('click', () => publishChapter(b.dataset.pub)));
    $$('[data-sched]').forEach((b) => b.addEventListener('click', async () => { if (await scheduleChapter(b.dataset.sched)) render(); }));
    $$('[data-unsched]').forEach((b) => b.addEventListener('click', async () => { await api.chapters.unschedule(b.dataset.unsched); toast('Back to draft. It won’t go live on its own.'); render(); }));
    $$('[data-unpub]').forEach((b) => b.addEventListener('click', async () => { await api.chapters.unpublish(b.dataset.unpub); toast('Chapter unpublished'); render(); }));
    $$('[data-move]').forEach((b) => b.addEventListener('click', async () => { await api.chapters.move(b.dataset.id, +b.dataset.move); render(); }));
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => { const c = api.chapters.byId(b.dataset.del); if (!(await askConfirm(`“${c.title || 'Untitled chapter'}” and its comments will be deleted. This cannot be undone.`, { title: 'Delete this chapter?', ok: 'Delete chapter', danger: true }))) return; await api.chapters.remove(c.id); toast('Chapter deleted'); render(); }));
  });

  /** On-page yes/no window (browser pop-ups are blocked in some in-app browsers). Resolves true on confirm. */
  function askConfirm(message, { ok = 'Confirm', cancel = 'Cancel', danger = false, title = 'Are you sure?' } = {}) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'rules-dialog';
      d.innerHTML = `<form method="dialog" class="rd-in">
        <h2>${esc(title)}</h2>
        <p class="muted">${esc(message)}</p>
        <div class="rd-actions"><button class="btn btn-ghost" value="no" autofocus>${esc(cancel)}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="yes">${esc(ok)}</button></div>
      </form>`;
      document.body.appendChild(d);
      d.addEventListener('close', () => { const yes = d.returnValue === 'yes'; d.remove(); resolve(yes); });
      d.showModal();
    });
  }

  const COMMUNITY_RULES = [
    'Only publish work you wrote yourself.',
    'Use genres and tags that honestly describe your story, and mention mature themes in the synopsis.',
    'No sexual content involving minors, no hate speech, no harassment, and nothing illegal.',
    'Be respectful to other writers and readers in the comments.',
    'Breaking these rules can get stories removed or your account suspended.',
  ];

  /** Show the community rules in an on-page window. Resolves true if the writer agrees. */
  function askRules() {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'rules-dialog';
      d.setAttribute('aria-labelledby', 'rulesTitle');
      d.innerHTML = `<form method="dialog" class="rd-in">
        <h2 id="rulesTitle">Community rules</h2>
        <p class="muted">Before your first publish, please read and agree to these.</p>
        <ol>${COMMUNITY_RULES.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
        <div class="rd-actions"><button class="btn btn-ghost" value="no">Not now</button><button class="btn btn-primary" value="yes" autofocus>I agree</button></div>
      </form>`;
      document.body.appendChild(d);
      d.addEventListener('close', () => { const ok = d.returnValue === 'yes'; d.remove(); resolve(ok); });
      d.showModal();
    });
  }

  /** Ask the database whether this writer may publish (bans, rules, new-account wait). The database enforces the same check. */
  async function checkCanPublish() {
    let res = await must(sb.rpc('publish_check'));
    if (res && res.code === 'rules') {
      if (!(await askRules())) { toast('You need to agree to the community rules before publishing.'); return false; }
      await must(sb.rpc('accept_rules'));
      res = await must(sb.rpc('publish_check'));
    }
    if (!res || !res.ok) { toast((res && res.message) || 'You cannot publish right now.'); return false; }
    return true;
  }

  /** The checks every chapter must pass before it can go live, now or on a schedule. */
  function readyToPublish(c, n, verb = 'publishing') {
    if (!(c.title || '').trim()) { toast(`Give the chapter a title before ${verb}`); return false; }
    if (wordCount(c.content) === 0) { toast('The chapter is empty. Write something first.'); return false; }
    if (!(n.title || '').trim()) { toast(`Give the series a title before ${verb}`); return false; }
    return true;
  }

  async function publishChapter(id) {
    const c = api.chapters.byId(id); const n = api.novels.byId(c.novel_id);
    if (!readyToPublish(c, n)) return false;
    if (!(await checkCanPublish())) return false;
    const { novel, novelWentLive, notified } = await api.chapters.publish(id);
    const i = api.novels.published(novel.id).findIndex((x) => x.id === id) + 1;
    toast(novelWentLive ? 'Published. Your series is now live for everyone.' : `Chapter published${notified ? `. ${plural(notified, 'follower')} notified.` : ''}`, { href: `#/novel/${novel.slug}/ch/${i}`, label: 'Read it' });
    render(); return true;
  }

  /* Scheduling ---------------------------------------------------------------- */
  const pad2 = (x) => String(x).padStart(2, '0');
  const toLocalInput = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const fromLocalInput = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : null; };
  const releaseTime = { get() { try { return localStorage.getItem('sfb.releaseTime') || '18:00'; } catch { return '18:00'; } }, set(v) { try { localStorage.setItem('sfb.releaseTime', v); } catch {} } };
  /** The next time on `day` (0-6, or any day if null) at hh:mm that's at least 10 minutes away. */
  function nextSlot(day, hhmm = releaseTime.get(), after = now() + 10 * 60000) {
    const [h, m] = hhmm.split(':').map(Number); const d = new Date(after); d.setHours(h, m, 0, 0);
    if (d.getTime() < after) d.setDate(d.getDate() + 1);
    if (day !== null && day !== undefined) while (d.getDay() !== day) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' '); } catch { return 'your time zone'; } })();

  /** Pick a release time for one chapter. Resolves to a timestamp, or null if cancelled. */
  function openScheduleDialog({ n, c }) {
    return new Promise((resolve) => {
      const start = c.scheduled_at && c.scheduled_at > now() ? c.scheduled_at : nextSlot(n.update_day);
      const t = releaseTime.get(); const [th, tm] = t.split(':').map(Number);
      const timeLabel = new Date(2000, 0, 1, th, tm).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const picks = [];
      if (n.update_day !== null) picks.push([`Next ${DAYS_LONG[n.update_day]}, ${timeLabel}`, nextSlot(n.update_day)]);
      picks.push([`Tomorrow, ${timeLabel}`, (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(th, tm, 0, 0); return d.getTime(); })()]);
      picks.push(['In 1 hour', Math.ceil((now() + 3600000) / 300000) * 300000]);
      // Earlier chapters that won't be out by then: readers would get this one first.
      const earlier = (at) => api.novels.all(n.id).filter((x) => x.chapter_number < c.chapter_number && x.status !== 'published' && (!x.scheduled_at || x.scheduled_at > at));
      const d = document.createElement('dialog'); d.className = 'rules-dialog sched-dialog'; d.setAttribute('aria-labelledby', 'sdTitle');
      d.innerHTML = `<form method="dialog" class="rd-in">
        <h2 id="sdTitle">${c.scheduled_at ? 'Change release time' : 'Schedule chapter'}</h2>
        <p class="muted">“${esc(c.title || 'Untitled chapter')}” goes live by itself at this time, and followers get notified then.</p>
        <div class="sd-picks">${picks.map(([label, ts]) => `<button type="button" class="chip" data-ts="${ts}">${esc(label)}</button>`).join('')}</div>
        <div class="field"><label for="sdAt">Date and time</label><input class="input" type="datetime-local" id="sdAt" value="${toLocalInput(start)}" min="${toLocalInput(now() + 5 * 60000)}" max="${toLocalInput(now() + 365 * DAY)}" required>
          <span class="hint">In ${esc(TZ)}. Readers see it in their own time zone.</span></div>
        <p class="sd-when" id="sdWhen" role="status"></p>
        <div class="sd-warn" id="sdWarn" role="status"></div>
        ${!api.novels.isPublic(n) ? '<p class="hint">This series isn’t live yet. It goes live with this chapter.</p>' : ''}
        <div class="rd-actions"><button class="btn btn-ghost" value="no">Cancel</button><button class="btn btn-primary" value="yes" id="sdOk">Schedule</button></div>
      </form>`;
      document.body.appendChild(d);
      const input = d.querySelector('#sdAt');
      const paint = () => {
        const at = fromLocalInput(input.value); const ok = at && at > now() + 2 * 60000 && at < now() + 366 * DAY;
        d.querySelector('#sdWhen').innerHTML = ok ? `Goes live <b>${esc(fmtWhen(at))}</b>, ${esc(fmtIn(at))}.` : '<span style="color:var(--danger)">Pick a time at least a few minutes from now, and within a year.</span>';
        const e = ok ? earlier(at) : [];
        d.querySelector('#sdWarn').innerHTML = e.length ? `Heads up: ${e.map((x) => `“${esc(x.title || 'Untitled')}”`).slice(0, 2).join(', ')}${e.length > 2 ? ` and ${e.length - 2} more` : ''} come${e.length === 1 ? 's' : ''} before this chapter but won’t be out yet, so readers would get this one first.` : '';
        d.querySelector('#sdOk').disabled = !ok;
        d.querySelectorAll('[data-ts]').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.ts - (at || 0)) < 60000));
      };
      d.addEventListener('click', (e) => { const b = e.target.closest('[data-ts]'); if (b) { input.value = toLocalInput(+b.dataset.ts); paint(); } });
      input.addEventListener('input', paint); paint();
      d.addEventListener('close', () => {
        const at = fromLocalInput(input.value); const yes = d.returnValue === 'yes' && at && at > now() + 60000; d.remove();
        if (yes) { const x = new Date(at); releaseTime.set(`${pad2(x.getHours())}:${pad2(x.getMinutes())}`); }
        resolve(yes ? at : null);
      });
      d.showModal();
    });
  }

  async function scheduleChapter(id) {
    const c = api.chapters.byId(id); const n = api.novels.byId(c.novel_id);
    if (!readyToPublish(c, n, 'scheduling')) return false;
    const at = await openScheduleDialog({ n, c }); if (!at) return false;
    if (!(await checkCanPublish())) return false;
    await api.chapters.schedule(id, at);
    toast(`Scheduled for ${fmtWhen(at)}`); return true;
  }

  /** Queue drafts on a rhythm: first one at a time you pick, then every N days, in chapter order. */
  function openPlanDialog(n) {
    return new Promise((resolve) => {
      const all = api.novels.all(n.id).filter((c) => c.status !== 'published');
      const d = document.createElement('dialog'); d.className = 'rules-dialog sched-dialog'; d.setAttribute('aria-labelledby', 'pdTitle');
      d.innerHTML = `<form method="dialog" class="rd-in">
        <h2 id="pdTitle">Schedule your drafts</h2>
        <p class="muted">Queue chapters to go live on a regular rhythm, in order. You can change any of them later.</p>
        <div class="row" style="gap:14px;align-items:start;flex-wrap:wrap">
          <div class="field" style="flex:1 1 200px"><label for="pdStart">First chapter</label><input class="input" type="datetime-local" id="pdStart" value="${toLocalInput(nextSlot(n.update_day))}" min="${toLocalInput(now() + 5 * 60000)}"></div>
          <div class="field" style="flex:1 1 160px"><label for="pdEvery">Then</label><select class="select" id="pdEvery"><option value="1">Every day</option><option value="2">Every 2 days</option><option value="3">Every 3 days</option><option value="7" selected>Every week</option><option value="14">Every 2 weeks</option></select></div>
        </div>
        <label class="b-check"><input type="checkbox" id="pdRe"> Also move chapters that are already scheduled</label>
        <ol class="plan-list pd-preview" id="pdList"></ol>
        <p class="hint">In ${esc(TZ)}. Empty or untitled drafts are skipped.</p>
        <div class="rd-actions"><button class="btn btn-ghost" value="no">Cancel</button><button class="btn btn-primary" value="yes" id="pdOk">Schedule</button></div>
      </form>`;
      document.body.appendChild(d);
      let plan = [];
      const paint = () => {
        const startAt = fromLocalInput(d.querySelector('#pdStart').value); const every = +d.querySelector('#pdEvery').value; const re = d.querySelector('#pdRe').checked;
        let k = 0;
        plan = all.map((c) => {
          if (!re && c.scheduled_at) return { c, keep: true };
          if (!(c.title || '').trim() || !wordCount(c.content)) return { c, skip: true };
          const at = startAt ? startAt + k * every * DAY : null; k++;
          return { c, at };
        });
        const valid = startAt && startAt > now() + 2 * 60000;
        d.querySelector('#pdList').innerHTML = plan.map((p) => `<li class="${p.skip ? 'skip' : ''}"><span class="pl-when">${p.keep ? esc(fmtWhen(p.c.scheduled_at)) : p.skip ? 'Skipped' : p.at ? esc(fmtWhen(p.at)) : '—'}</span><span>${esc(p.c.title || 'Untitled chapter')}</span><span class="muted small">${p.keep ? 'already scheduled' : p.skip ? 'empty or no title' : ''}</span></li>`).join('') || '<li class="muted">No drafts to schedule.</li>';
        const count = plan.filter((p) => p.at).length;
        const ok = d.querySelector('#pdOk'); ok.disabled = !valid || !count; ok.textContent = count ? `Schedule ${plural(count, 'chapter')}` : 'Schedule';
      };
      d.addEventListener('input', paint); d.addEventListener('change', paint); paint();
      d.addEventListener('close', async () => {
        const yes = d.returnValue === 'yes'; const todo = plan.filter((p) => p.at); d.remove();
        if (!yes || !todo.length) { resolve(false); return; }
        if (!(await checkCanPublish())) { resolve(false); return; }
        try { for (const p of todo) await api.chapters.schedule(p.c.id, p.at); toast(`${plural(todo.length, 'chapter')} scheduled. First one ${fmtWhen(todo[0].at)}.`); resolve(true); }
        catch (err) { toast(err.message); resolve(true); }
      });
      d.showModal();
    });
  }

  /* Cover cropper ------------------------------------------------------------ */
  /** Shows the chosen image in a square frame: drag to move, slider to zoom. Resolves to an 800×800 JPEG, or null. */
  function openCropDialog(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onerror = () => { URL.revokeObjectURL(url); toast('Couldn’t open that image. Try a JPG or PNG.'); resolve(null); };
      img.onload = () => {
        const S = 300; const OUT = 800; const w = img.naturalWidth, h = img.naturalHeight;
        if (w < 200 || h < 200) { URL.revokeObjectURL(url); toast('That image is too small. Use one at least 600 pixels on each side.'); resolve(null); return; }
        const base = Math.max(S / w, S / h); let zoom = 1; let ox = (S - w * base) / 2, oy = (S - h * base) / 2;
        const d = document.createElement('dialog'); d.className = 'rules-dialog crop-dialog'; d.setAttribute('aria-labelledby', 'cdTitle');
        d.innerHTML = `<form method="dialog" class="rd-in"><h2 id="cdTitle">Crop your cover</h2><p class="muted small">Drag to move. Covers are square.</p>
          <div class="crop-stage"><canvas id="cdCanvas" width="${S * 2}" height="${S * 2}" style="width:${S}px;height:${S}px" aria-label="Cover preview"></canvas></div>
          <div class="field crop-zoom"><label for="cdZoom">Zoom</label><input type="range" id="cdZoom" min="1" max="3" step="0.01" value="1"></div>
          ${Math.min(w, h) < 600 ? '<p class="hint" style="color:var(--danger)">This image is small, so it may look blurry.</p>' : ''}
          <div class="rd-actions"><button class="btn btn-ghost" value="no">Cancel</button><button class="btn btn-primary" value="yes">Use this cover</button></div></form>`;
        document.body.appendChild(d);
        const cv = d.querySelector('#cdCanvas'); const ctx = cv.getContext('2d');
        const scale = () => base * zoom;
        const clamp = () => { const s = scale(); ox = Math.min(0, Math.max(S - w * s, ox)); oy = Math.min(0, Math.max(S - h * s, oy)); };
        const draw = () => { clamp(); ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S); ctx.drawImage(img, ox, oy, w * scale(), h * scale()); };
        d.querySelector('#cdZoom').addEventListener('input', (e) => {
          const cx = (S / 2 - ox) / scale(), cy = (S / 2 - oy) / scale(); zoom = +e.target.value;
          ox = S / 2 - cx * scale(); oy = S / 2 - cy * scale(); draw();
        });
        let drag = null;
        cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, ox, oy }; cv.setPointerCapture(e.pointerId); });
        cv.addEventListener('pointermove', (e) => { if (!drag) return; ox = drag.ox + (e.clientX - drag.x); oy = drag.oy + (e.clientY - drag.y); draw(); });
        cv.addEventListener('pointerup', () => { drag = null; });
        cv.addEventListener('keydown', (e) => { const k = { ArrowLeft: [10, 0], ArrowRight: [-10, 0], ArrowUp: [0, 10], ArrowDown: [0, -10] }[e.key]; if (k) { e.preventDefault(); ox += k[0]; oy += k[1]; draw(); } });
        cv.tabIndex = 0; draw();
        d.addEventListener('close', () => {
          const yes = d.returnValue === 'yes';
          if (!yes) { d.remove(); URL.revokeObjectURL(url); resolve(null); return; }
          const out = document.createElement('canvas'); out.width = OUT; out.height = OUT; const k = OUT / S; const o = out.getContext('2d');
          o.fillStyle = '#fff'; o.fillRect(0, 0, OUT, OUT); o.imageSmoothingQuality = 'high'; o.drawImage(img, ox * k, oy * k, w * scale() * k, h * scale() * k);
          out.toBlob((blob) => { d.remove(); URL.revokeObjectURL(url); resolve(blob); }, 'image/jpeg', 0.86);
        });
        d.showModal();
      };
      img.src = url;
    });
  }

  /* Reports -------------------------------------------------------------------- */
  const REPORT_REASONS = [
    ['spam', 'Spam or scams'], ['harassment', 'Harassment or bullying'], ['hate', 'Hate speech'],
    ['minors', 'Sexual content involving minors'], ['violence', 'Threats or promoting violence'],
    ['plagiarism', 'Stolen or plagiarized work'], ['unlabeled', 'Mature content without a Mature rating'], ['other', 'Something else'],
  ];
  function openReportDialog({ type, id, label }) {
    if (!requireAuth()) return;
    const d = document.createElement('dialog'); d.className = 'rules-dialog report-dialog'; d.setAttribute('aria-labelledby', 'rpTitle');
    d.innerHTML = `<form method="dialog" class="rd-in">
      <h2 id="rpTitle">Report ${esc(REPORT_WHAT[type] || 'this')}</h2>
      <p class="muted small">${esc(label || '')}</p>
      <fieldset class="rp-reasons"><legend class="sr-only">Reason</legend>${REPORT_REASONS.map(([k, l]) => `<label class="rp-opt"><input type="radio" name="rpReason" value="${k}"> ${esc(l)}</label>`).join('')}</fieldset>
      <div class="field"><label for="rpDetails">Anything else a moderator should know? <span class="muted" id="rpReq">(optional)</span></label><textarea class="textarea" id="rpDetails" maxlength="1000" rows="3" placeholder=""></textarea></div>
      <p class="hint">Reports are private. The person you report won’t see who sent it. If someone is in danger, contact local emergency services.</p>
      <div class="form-error" id="rpErr" role="alert"></div>
      <div class="rd-actions"><button class="btn btn-ghost" value="no" formnovalidate>Cancel</button><button class="btn btn-primary" type="button" id="rpSend" disabled>Send report</button></div>
    </form>`;
    document.body.appendChild(d);
    const reason = () => d.querySelector('input[name="rpReason"]:checked')?.value;
    d.addEventListener('change', () => {
      const r = reason(); const needs = r === 'other' || r === 'plagiarism';
      d.querySelector('#rpReq').textContent = needs ? '(required)' : '(optional)';
      d.querySelector('#rpDetails').placeholder = r === 'plagiarism' ? 'Link to the original, and who wrote it' : r === 'other' ? 'What’s wrong?' : '';
      d.querySelector('#rpSend').disabled = !r;
    });
    d.querySelector('#rpSend').addEventListener('click', async (e) => {
      const r = reason(); const details = d.querySelector('#rpDetails').value.trim();
      if ((r === 'other' || r === 'plagiarism') && !details) { d.querySelector('#rpErr').textContent = 'Add a few words so a moderator knows what to look for.'; return; }
      e.target.disabled = true;
      try { await api.reports.file({ type, id, reason: r, details }); d.close(); toast('Thanks. A moderator will review it.'); }
      catch (err) { d.querySelector('#rpErr').textContent = err.message; e.target.disabled = false; }
    });
    d.addEventListener('submit', (e) => { if (e.submitter?.value !== 'no') e.preventDefault(); });
    d.addEventListener('close', () => d.remove());
    d.showModal();
  }

  /* Reviews -------------------------------------------------------------------- */
  /** Draws the reviews block on a series page: average, star bars, your review, everyone else's. */
  function paintReviews({ n, host, me, mine, sort = 'new' }) {
    if (!host) return;
    const sum = api.reviews.summary(n.id); const my = me ? api.reviews.mine(me.id, n.id) : null;
    const hasRead = me && (api.progress.get(me.id, n.id) || api.novels.published(n.id).some((c) => readPos.get(c.id).p > 0));
    const others = api.reviews.forNovel(n.id).filter((r) => r.id !== my?.id).sort((a, b) => sort === 'high' ? b.rating - a.rating || b.created_at - a.created_at : sort === 'low' ? a.rating - b.rating || b.created_at - a.created_at : b.created_at - a.created_at);
    let editing = !my; let pick = my ? my.rating : null; const shown = new Set();
    const one = (r, own = false) => {
      const u = api.users.byId(r.user_id); const author = api.users.byId(n.author_id);
      const body = r.body ? (r.spoiler && !own && !shown.has(r.id) ? `<div class="rv-spoiler"><span>This review has spoilers.</span><button type="button" class="btn btn-ghost btn-sm" data-show="${r.id}">Show it</button></div>` : `<p class="rv-body">${esc(r.body)}</p>`) : '';
      return `<li class="rv" data-rid="${r.id}"><span class="avatar" aria-hidden="true">${esc(initials(u?.name))}</span><div>
        <div class="rv-head">${u ? `<a href="#/u/${esc(u.username)}"><b>${nm(u)}</b></a>` : '<b>Deleted user</b>'}${stars(r.rating, { small: true })}<span class="rv-n">${r.rating}/5</span><time>${esc(timeAgo(Number(r.created_at)))}${Number(r.updated_at) - Number(r.created_at) > 60000 ? ' · edited' : ''}</time></div>
        ${body}
        ${r.author_reply ? `<div class="rv-reply"><div class="rv-head"><b>${nm(author)}</b><span class="badge badge-new">Author</span><time>${esc(timeAgo(Number(r.author_reply_at)))}</time></div><p class="rv-body">${esc(r.author_reply)}</p></div>` : ''}
        <div class="rv-acts">${own ? '<button type="button" data-edit>Edit</button><button type="button" data-delmine>Delete</button>' : ''}${mine ? `<button type="button" data-reply="${r.id}">${r.author_reply ? 'Edit reply' : 'Reply'}</button>` : ''}${!own && me && !mine ? `<button type="button" data-report="review" data-report-id="${r.id}" data-report-label="${esc(u?.name || 'Someone')}’s review">Report</button>` : ''}</div>
        <div class="rv-reply-form" id="rvr-${r.id}"></div></div></li>`;
    };
    const paint = () => {
      const s = api.reviews.summary(n.id); const max = Math.max(1, ...s.hist);
      const form = !me ? `<div class="rv-cta"><a href="#/login?next=${encodeURIComponent('/novel/' + n.slug)}">Log in</a> to rate and review this series.</div>`
        : mine ? '<p class="muted small">Readers rate your series here. You can reply once to each review.</p>'
        : !hasRead && !my ? '<div class="rv-cta">Start reading to leave a review.</div>'
        : editing ? `<form class="rv-form" id="rvForm"><div class="lbl" id="rvPickLbl">Your rating</div>
            <div class="star-pick" role="radiogroup" aria-labelledby="rvPickLbl">${[0, 1, 2, 3, 4, 5].map((v) => `<button type="button" role="radio" aria-checked="${pick === v}" data-v="${v}" class="${v === 0 ? 'zero' : pick !== null && v <= pick ? 'on' : ''}" aria-label="${v} out of 5">${v === 0 ? '0' : '★'}</button>`).join('')}<span class="sp-out">${pick === null ? 'Pick 0 to 5 stars' : `${pick} out of 5`}</span></div>
            <label class="sr-only" for="rvBody">Your review</label><textarea class="textarea" id="rvBody" maxlength="4000" placeholder="What worked for you? What didn’t? (optional)">${esc(my?.body || '')}</textarea>
            <div class="row between rv-form-foot"><label class="b-check"><input type="checkbox" id="rvSpoil" ${my?.spoiler ? 'checked' : ''}> Contains spoilers</label><div class="row">${my ? '<button type="button" class="btn btn-ghost btn-sm" id="rvCancel">Cancel</button>' : ''}<button class="btn btn-primary btn-sm" type="submit" ${pick === null ? 'disabled' : ''}>${my ? 'Save review' : 'Post review'}</button></div></div></form>`
        : '';
      host.innerHTML = `<div class="rv-top"><h2 id="rvTitle">Reviews</h2>${s.count > 1 ? `<select class="select rv-sort" id="rvSort" aria-label="Sort reviews"><option value="new" ${sort === 'new' ? 'selected' : ''}>Newest</option><option value="high" ${sort === 'high' ? 'selected' : ''}>Highest</option><option value="low" ${sort === 'low' ? 'selected' : ''}>Lowest</option></select>` : ''}</div>
        ${s.count ? `<div class="rv-sum"><div class="rv-big"><b>${ratingText(s.avg)}</b>${stars(s.avg)}<span>${plural(s.count, 'review')}</span></div>
          <ol class="rv-bars">${[5, 4, 3, 2, 1, 0].map((v) => `<li><span>${v}</span><span class="bar"><i style="width:${(s.hist[v] / max) * 100}%"></i></span><span class="c">${s.hist[v]}</span></li>`).join('')}</ol></div>` : '<p class="muted small">No reviews yet.</p>'}
        ${form}
        <ul class="rv-list">${my && !editing ? one(my, true) : ''}${others.map((r) => one(r)).join('')}</ul>`;
    };
    paint();
    host.addEventListener('click', async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.v !== undefined && t.closest('.star-pick')) { pick = +t.dataset.v; const body = $('#rvBody')?.value; paint(); if (body !== undefined) $('#rvBody').value = body; return; }
      if (t.dataset.show) { shown.add(+t.dataset.show); paint(); return; }
      if (t.hasAttribute('data-edit')) { editing = true; paint(); $('#rvBody')?.focus(); return; }
      if (t.id === 'rvCancel') { editing = false; pick = my?.rating ?? null; paint(); return; }
      if (t.hasAttribute('data-delmine')) {
        if (!(await askConfirm('Your rating and review will be removed.', { title: 'Delete your review?', ok: 'Delete', danger: true }))) return;
        await api.reviews.remove(my.id); toast('Review deleted'); $('#app').dataset.keepScroll = '1'; render(); return;
      }
      if (t.dataset.reply) {
        const r = db.reviews.find((x) => x.id === +t.dataset.reply); const box = $(`#rvr-${r.id}`);
        box.innerHTML = `<form class="rv-form" data-rform="${r.id}"><label class="sr-only" for="rr-${r.id}">Your reply</label><textarea class="textarea" id="rr-${r.id}" maxlength="1000" placeholder="Thank them, or answer a question. Everyone can see this.">${esc(r.author_reply || '')}</textarea><div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" data-rcancel="${r.id}">Cancel</button><button class="btn btn-primary btn-sm" type="submit">Post reply</button></div></form>`;
        $(`#rr-${r.id}`).focus(); return;
      }
      if (t.dataset.rcancel) { $(`#rvr-${t.dataset.rcancel}`).innerHTML = ''; }
    });
    host.addEventListener('change', (e) => { if (e.target.id === 'rvSort') go(`/novel/${n.slug}?rsort=${e.target.value}&go=reviews`); });
    host.addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = e.submitter; if (btn) btn.disabled = true;
      try {
        if (e.target.id === 'rvForm') {
          if (pick === null) { toast('Pick a rating from 0 to 5 stars'); return; }
          await api.reviews.save(me.id, n.id, { rating: pick, body: $('#rvBody').value, spoiler: $('#rvSpoil').checked });
          toast(my ? 'Review updated' : 'Thanks for your review'); $('#app').dataset.keepScroll = '1'; render(); return;
        }
        if (e.target.dataset.rform) { const id = +e.target.dataset.rform; await api.reviews.reply(id, $(`#rr-${id}`).value); toast('Reply posted'); paint(); }
      } catch (err) { toast(err.message); } finally { if (btn) btn.disabled = false; }
    });
  }

  /* 6j. Chapter editor ------------------------------------------------------ */
  /* Story bible -------------------------------------------------------------- */
  /* A private notebook for each series: characters, places, timeline, rules, items and open threads.
     Only the writer can read it (Supabase RLS). Readers only see entries the writer marks visible,
     through the reader_bible() function, and only up to the chapter they have reached.
     Needs story-bible.sql to be run once in Supabase. */
  const BIBLE_KINDS = [
    { k: 'character', label: 'Characters', one: 'character', roleLabel: 'Role in the story', rolePh: 'Lead, guide, rival…' },
    { k: 'place', label: 'Places', one: 'place', roleLabel: 'What kind of place', rolePh: 'Roadside inn, capital city…' },
    { k: 'timeline', label: 'Timeline', one: 'event', roleLabel: 'When it happens', rolePh: 'Ten years before Ch. 1…' },
    { k: 'rule', label: 'Rules & lore', one: 'rule', roleLabel: 'The rule in one line', rolePh: 'Magic always costs a memory…' },
    { k: 'item', label: 'Items', one: 'item', roleLabel: 'What it is', rolePh: 'A letter that won’t open…' },
    { k: 'thread', label: 'Open threads', one: 'thread', roleLabel: 'The question readers are waiting on', rolePh: 'Who is behind the locked door?' },
  ];
  const BIBLE_KIND = Object.fromEntries(BIBLE_KINDS.map((x) => [x.k, x]));
  const BIBLE_COLORS = ['#c8102e', '#0f766e', '#7c3aed', '#c2410c', '#0369a1', '#17181c', '#4d7c0f', '#9d174d'];
  const ICON_PEOPLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 20a6.5 6.5 0 0 0-3-5.5"/></svg>';
  const ICON_BOOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h14"/></svg>';
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plainText = (html) => new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '';

  const bible = {
    cache: {},
    async load(novelId, force = false) {
      if (!force && bible.cache[novelId]) return bible.cache[novelId];
      const { data, error } = await sb.from('bible_entries').select('*').eq('novel_id', novelId).order('name');
      if (error) throw new Error(/bible_entries|does not exist|schema cache/i.test(error.message) ? 'The story bible isn’t set up yet. Run story-bible.sql in the Supabase SQL Editor first.' : error.message);
      bible.cache[novelId] = (data || []).map((e) => ({ ...e, aliases: e.aliases || [], details: e.details || {} }));
      return bible.cache[novelId];
    },
    blank(novelId, kind) {
      const used = new Set((bible.cache[novelId] || []).map((e) => e.color));
      return { id: 'b_' + uid(), novel_id: novelId, kind, name: `New ${BIBLE_KIND[kind].one}`, aliases: [], role: '', details: {}, notes: '', first_chapter: null, reader_visible: false, reader_summary: '', visible_from: 1, color: BIBLE_COLORS.find((c) => !used.has(c)) || BIBLE_COLORS[0], created_at: now(), updated_at: now() };
    },
    async save(e) {
      const row = { ...e, updated_at: now() };
      await must(sb.from('bible_entries').upsert(row));
      const list = (bible.cache[e.novel_id] ||= []); const i = list.findIndex((x) => x.id === e.id);
      if (i >= 0) list[i] = row; else list.push(row);
      Object.assign(e, row); return row;
    },
    async remove(e) {
      await must(sb.from('bible_entries').delete().eq('id', e.id));
      const list = bible.cache[e.novel_id] || []; const i = list.findIndex((x) => x.id === e.id); if (i >= 0) list.splice(i, 1);
    },
    async forReader(novelId, upto) {
      const { data, error } = await sb.rpc('reader_bible', { p_novel: novelId, p_upto: upto });
      return error ? null : data;
    },
    names: (e) => [e.name, ...(e.aliases || [])].map((s) => String(s || '').trim()).filter((s) => s.length > 1),
    /** Does this text mention the entry by name or alias (whole word, any case)? */
    mentioned(e, text) { return bible.names(e).some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(n)}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text)); },
    /** Chapter numbers (all chapters, drafts too) that mention the entry. */
    appearsIn(e, chapters) { return chapters.filter((c) => bible.mentioned(e, plainText(c.title + '\n' + c.content))).map((c) => c.chapter_number); },
    /** Open threads not mentioned in the last 3+ chapters. */
    quiet(entries, chapters) {
      const latest = chapters.reduce((m, c) => Math.max(m, c.chapter_number), 0);
      return entries.filter((e) => e.kind === 'thread' && !e.details.resolved).map((e) => {
        const seen = bible.appearsIn(e, chapters); const last = Math.max(e.first_chapter || 0, ...seen, 0);
        return { e, last, gap: last ? latest - last : 0 };
      }).filter((x) => x.last && x.gap >= 3);
    },
    facts(e) {
      const d = e.details || {};
      if (e.kind === 'character') return [d.appearance, d.voice].filter(Boolean).join(' · ');
      return d.facts || '';
    },
  };
  const bibleAvatar = (e, size = '') => `<span class="b-av ${size}" style="background:${esc(e.color || '#17181c')}" aria-hidden="true">${e.kind === 'character' ? esc(initials(e.name)) : esc(BIBLE_KIND[e.kind].one.slice(0, 2).toUpperCase())}</span>`;

  route('/studio/novel/:id/bible', async ({ app, params, query }) => {
    if (!requireAuth()) return;
    const me = auth.current(); const n = api.novels.byId(params.id);
    if (!n || n.author_id !== me.id) return notFound(app, 'That series is not in your Studio.');
    setTitle(`Story bible · ${n.title || 'Untitled series'}`);
    app.innerHTML = `<div class="bible"><p class="muted" style="padding:40px 0">Opening the story bible…</p></div>`;
    let entries;
    try { entries = await bible.load(n.id, true); } catch (err) {
      app.innerHTML = `<div class="bible"><div class="crumbs"><a href="#/studio">Studio</a> / <a href="#/studio/novel/${n.id}">${esc(n.title || 'Untitled series')}</a> / Story bible</div><div class="card"><h2>Story bible</h2><p>${esc(err.message)}</p></div></div>`;
      return;
    }
    const chapters = api.novels.all(n.id);
    const st = { kind: BIBLE_KIND[query.kind] ? query.kind : 'character', sel: query.e || null, q: '' };
    if (st.sel) { const e = entries.find((x) => x.id === st.sel); if (e) st.kind = e.kind; else st.sel = null; }
    if (!st.sel) st.sel = (entries.find((x) => x.kind === st.kind) || {}).id || null;

    app.innerHTML = `<div class="bible">
      <div class="crumbs"><a href="#/studio">Studio</a> / <a href="#/studio/novel/${n.id}">${esc(n.title || 'Untitled series')}</a> / Story bible</div>
      <header class="bible-head"><div><h1>Story bible</h1><p class="lead">Private notes on your characters, places and rules. Only you can see this. Mark an entry for readers to add it to their spoiler-safe “Who’s who” guide.</p></div>
        <button class="btn btn-primary" id="bNew"></button></header>
      <div class="bible-cols">
        <nav class="bible-nav" id="bNav" aria-label="Bible sections"></nav>
        <section class="bible-list" aria-label="Entries"><label class="sr-only" for="bSearch">Search the bible</label><input class="input" id="bSearch" type="search" placeholder="Search names, aliases, notes"><div id="bQuiet"></div><div class="bible-grid" id="bGrid"></div></section>
        <section class="bible-edit card" id="bEdit" aria-label="Entry"></section>
      </div></div>`;

    const visible = () => {
      const q = st.q.trim().toLowerCase();
      return entries.filter((e) => (q ? [e.name, e.role, e.notes, ...(e.aliases || []), ...Object.values(e.details || {}).map(String)].join(' ').toLowerCase().includes(q) : e.kind === st.kind))
        .sort((a, b) => (a.first_chapter || 999) - (b.first_chapter || 999) || a.name.localeCompare(b.name));
    };
    const quiet = () => bible.quiet(entries, chapters);

    function paintNav() {
      const quietIds = new Set(quiet().map((x) => x.e.id));
      $('#bNav').innerHTML = BIBLE_KINDS.map((x) => { const count = entries.filter((e) => e.kind === x.k).length; const warn = x.k === 'thread' && quietIds.size; return `<button type="button" data-kind="${x.k}" aria-pressed="${!st.q && st.kind === x.k}"><span>${x.label}</span><span class="c">${warn ? `<span class="b-dot" title="${quietIds.size} quiet"></span>` : ''}${count}</span></button>`; }).join('')
        + '<p class="bible-tip"><b>Open threads</b> are promises you made the reader, like a locked door or a stranger’s name. The bible tells you when one has gone quiet for 3 chapters.</p>';
      $('#bNew').textContent = `+ New ${BIBLE_KIND[st.kind].one}`;
    }
    function paintList() {
      const list = visible(); const quietMap = new Map(quiet().map((x) => [x.e.id, x.gap]));
      $('#bQuiet').innerHTML = !st.q && st.kind === 'thread' && quietMap.size ? `<div class="bible-warn" role="status">${quietMap.size === 1 ? '1 thread has' : quietMap.size + ' threads have'} gone quiet. Readers may have forgotten, or think you did.</div>` : '';
      $('#bGrid').innerHTML = list.map((e) => `<button type="button" class="b-card" data-sel="${e.id}" aria-pressed="${e.id === st.sel}">
          ${bibleAvatar(e)}<span class="b-card-t"><b>${esc(e.name)}</b><span>${esc(e.role || BIBLE_KIND[e.kind].label)}${e.first_chapter ? ` · Ch. ${e.first_chapter}` : ''}</span>
          ${quietMap.has(e.id) ? `<span class="b-flag">Quiet for ${quietMap.get(e.id)} chapters</span>` : ''}${e.kind === 'thread' && e.details.resolved ? '<span class="b-ok">Resolved</span>' : ''}${e.reader_visible ? `<span class="b-eye">Readers see from Ch. ${e.visible_from}</span>` : ''}</span></button>`).join('')
        || `<div class="b-empty">${st.q ? 'Nothing matches that search.' : `No ${BIBLE_KIND[st.kind].label.toLowerCase()} yet. Add your first with the button above.`}</div>`;
    }

    let saveTimer = null; let pending = null;
    async function flush() {
      clearTimeout(saveTimer); if (!pending) return;
      const e = pending; pending = null; const s = $('#bState');
      if (s) s.textContent = 'Saving…';
      try { await bible.save(e); if (s && !pending) s.textContent = '✓ Saved'; } catch (err) { pending = e; if (s) s.textContent = 'Couldn’t save. Retrying…'; saveTimer = setTimeout(flush, 5000); }
    }
    const queueSave = (e) => { pending = e; const s = $('#bState'); if (s) s.textContent = 'Editing…'; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 900); };

    function paintEdit() {
      const e = entries.find((x) => x.id === st.sel); const box = $('#bEdit');
      if (!e) { box.innerHTML = `<div class="b-empty">${ICON_BOOK}<p>Pick an entry to see it here, or start a new one.</p></div>`; return; }
      const K = BIBLE_KIND[e.kind]; const d = e.details;
      const seen = bible.appearsIn(e, chapters);
      const chOpts = (val, none) => `${none ? `<option value="">${none}</option>` : ''}${chapters.map((c) => `<option value="${c.chapter_number}" ${+val === c.chapter_number ? 'selected' : ''}>Ch. ${c.chapter_number}${c.title ? ' · ' + esc(c.title.slice(0, 40)) : ''}</option>`).join('')}`;
      const area = (id, label, val, ph, rows = 2) => `<div class="field"><label for="${id}">${label}</label><textarea class="textarea" id="${id}" rows="${rows}" maxlength="600" placeholder="${esc(ph)}">${esc(val || '')}</textarea></div>`;
      box.innerHTML = `<form id="bForm" autocomplete="off">
        <div class="b-edit-head">${bibleAvatar(e, 'lg')}<div style="flex:1;min-width:0"><label class="sr-only" for="bName">Name</label><input class="b-name" id="bName" value="${esc(e.name)}" maxlength="80" required><div class="muted small">${esc(K.label.replace(/s$/, ''))}<span class="b-state" id="bState" aria-live="polite"></span></div></div></div>
        <div class="field"><label for="bAlias">Also called <span class="muted">(comma separated)</span></label><input class="input" id="bAlias" value="${esc((e.aliases || []).join(', '))}" placeholder="Nicknames, titles, what others call it"><span class="hint">Used to spot it in your chapters.</span></div>
        <div class="field"><label for="bRole">${K.roleLabel}</label><input class="input" id="bRole" value="${esc(e.role)}" maxlength="120" placeholder="${esc(K.rolePh)}"></div>
        ${e.kind === 'character'
          ? area('bLook', 'Appearance', d.appearance, 'Eye colour, scars, what they always wear') + area('bWants', 'What they want', d.wants, 'The thing they’d cross the world for') + area('bVoice', 'Voice', d.voice, 'How they talk. Short sentences? Never swears?') + area('bKnows', 'What they know (and don’t)', d.knows, 'Secrets, and what they haven’t found out yet')
          : area('bFacts', 'Key facts', d.facts, 'The details you must keep consistent', 4)}
        ${e.kind === 'thread' ? `<label class="b-check"><input type="checkbox" id="bResolved" ${d.resolved ? 'checked' : ''}> Resolved in the story</label>` : ''}
        <div class="row" style="gap:14px;align-items:start">
          <div class="field" style="flex:1"><label for="bFirst">First appears</label><select class="select" id="bFirst">${chOpts(e.first_chapter, 'Not yet')}</select></div>
          <div class="field" style="flex:1"><span class="lbl">Colour</span><div class="b-swatches" id="bColors">${BIBLE_COLORS.map((c) => `<button type="button" data-c="${c}" style="background:${c}" aria-label="Colour ${c}" aria-pressed="${e.color === c}"></button>`).join('')}</div></div>
        </div>
        <div class="b-seen"><span class="lbl">Mentioned in</span>${seen.length ? seen.map((num) => { const c = chapters.find((x) => x.chapter_number === num); return `<a class="chip" href="#/studio/novel/${n.id}/ch/${c.id}">Ch. ${num}</a>`; }).join('') : '<span class="muted small">No chapters yet</span>'}</div>
        ${area('bNotes', 'Private notes', e.notes, 'Plans, twists, things to remember. Never shown to readers.', 4).replace('maxlength="600"', 'maxlength="4000"')}
        <fieldset class="b-reader"><legend>Readers’ “Who’s who” guide</legend>
          <label class="b-check"><input type="checkbox" id="bVis" ${e.reader_visible ? 'checked' : ''}> Show this entry to readers</label>
          <div id="bVisFields" ${e.reader_visible ? '' : 'hidden'}>
            <div class="field"><label for="bSum">What readers see</label><textarea class="textarea" id="bSum" rows="2" maxlength="300" placeholder="Write it so it spoils nothing up to that chapter.">${esc(e.reader_summary)}</textarea></div>
            <div class="field"><label for="bFrom">Show from</label><select class="select" id="bFrom">${chapters.length ? chOpts(e.visible_from) : '<option value="1">Ch. 1</option>'}</select><span class="hint">Readers only see it once they reach this chapter. Your private notes are never shown.</span></div>
          </div></fieldset>
        <div class="row between"><button type="button" class="btn btn-ghost btn-sm" id="bDel">Delete</button><button type="button" class="btn btn-sm" id="bDone">Done</button></div>
      </form>`;

      const f = $('#bForm');
      const read = () => {
        const name = $('#bName').value.trim();
        e.name = name || e.name; e.role = $('#bRole').value.trim();
        e.aliases = $('#bAlias').value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
        e.details = e.kind === 'character'
          ? { appearance: $('#bLook').value.trim(), wants: $('#bWants').value.trim(), voice: $('#bVoice').value.trim(), knows: $('#bKnows').value.trim() }
          : { facts: $('#bFacts').value.trim(), ...(e.kind === 'thread' ? { resolved: $('#bResolved').checked } : {}) };
        e.first_chapter = $('#bFirst').value ? +$('#bFirst').value : null;
        e.notes = $('#bNotes').value.trim();
        e.reader_visible = $('#bVis').checked; e.reader_summary = $('#bSum').value.trim(); e.visible_from = +$('#bFrom').value || 1;
        if (e.reader_visible && e.first_chapter && e.visible_from < e.first_chapter && !f.dataset.fromTouched) { e.visible_from = e.first_chapter; $('#bFrom').value = String(e.first_chapter); }
      };
      const changed = () => { read(); queueSave(e); paintList(); paintNav(); box.querySelector('.b-av').outerHTML = bibleAvatar(e, 'lg'); };
      f.addEventListener('input', changed); f.addEventListener('change', changed);
      $('#bFrom').addEventListener('change', () => { f.dataset.fromTouched = '1'; });
      $('#bVis').addEventListener('change', () => { $('#bVisFields').hidden = !$('#bVis').checked; });
      $('#bColors').addEventListener('click', (ev) => { const b = ev.target.closest('[data-c]'); if (!b) return; e.color = b.dataset.c; $$('button', $('#bColors')).forEach((x) => x.setAttribute('aria-pressed', x === b)); changed(); });
      $('#bDone').addEventListener('click', async () => { await flush(); toast('Saved'); });
      $('#bDel').addEventListener('click', async () => {
        if (!(await askConfirm(`“${e.name}” will be removed from your story bible.`, { title: 'Delete this entry?', ok: 'Delete', danger: true }))) return;
        clearTimeout(saveTimer); pending = null;
        try { await bible.remove(e); } catch (err) { toast(err.message); return; }
        entries = bible.cache[n.id]; st.sel = (entries.find((x) => x.kind === st.kind) || {}).id || null;
        paintNav(); paintList(); paintEdit(); toast('Entry deleted');
      });
    }

    const select = async (id) => { await flush(); st.sel = id; history.replaceState(null, '', `#/studio/novel/${n.id}/bible?e=${id}`); paintList(); paintEdit(); };
    $('#bNav').addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-kind]'); if (!b) return;
      await flush(); st.kind = b.dataset.kind; st.q = ''; $('#bSearch').value = '';
      st.sel = (entries.find((x) => x.kind === st.kind) || {}).id || null;
      history.replaceState(null, '', `#/studio/novel/${n.id}/bible?kind=${st.kind}`);
      paintNav(); paintList(); paintEdit();
    });
    $('#bGrid').addEventListener('click', (ev) => { const b = ev.target.closest('[data-sel]'); if (b) select(b.dataset.sel); });
    $('#bSearch').addEventListener('input', (ev) => { st.q = ev.target.value; paintNav(); paintList(); });
    $('#bNew').addEventListener('click', async () => {
      await flush();
      const e = bible.blank(n.id, st.kind);
      try { await bible.save(e); } catch (err) { toast(err.message); return; }
      entries = bible.cache[n.id]; st.q = ''; $('#bSearch').value = '';
      await select(e.id); paintNav();
      const name = $('#bName'); name.focus(); name.select();
    });
    if (query.new && BIBLE_KIND[query.new]) { st.kind = query.new; paintNav(); $('#bNew').click(); }

    paintNav(); paintList(); paintEdit();
    const onKey = (ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') { ev.preventDefault(); flush().then(() => toast('Saved')); } };
    document.addEventListener('keydown', onKey);
    window.onbeforeunload = () => (pending ? 'Unsaved changes.' : undefined);
    cleanup = () => { document.removeEventListener('keydown', onKey); window.onbeforeunload = null; flush(); };
  });

  /* Bible drawer for the chapter editor: shows who and what this chapter mentions. */
  function mountBibleDrawer({ n, c, body, titleEl, btn }) {
    const host = document.createElement('aside');
    host.className = 'bible-drawer'; host.id = 'bibleDrawer'; host.setAttribute('aria-label', 'Story bible'); host.hidden = true;
    document.body.appendChild(host);
    let entries = null; let error = null; let open = false; let q = ''; const expanded = new Set();
    const chapters = () => api.novels.all(n.id).map((x) => (x.id === c.id ? { ...x, title: titleEl.value, content: body.innerHTML } : x));

    const item = (e) => {
      const d = e.details || {}; const more = expanded.has(e.id);
      const facts = bible.facts(e);
      return `<li class="bd-item ${more ? 'open' : ''}"><button type="button" data-x="${e.id}" aria-expanded="${more}">${bibleAvatar(e, 'sm')}<span class="bd-t"><b>${esc(e.name)}</b><span>${esc(e.role || BIBLE_KIND[e.kind].label)}</span></span></button>
        ${facts && !more ? `<p class="bd-facts">${esc(facts)}</p>` : ''}
        ${more ? `<dl class="bd-more">${e.kind === 'character' ? [['Appearance', d.appearance], ['Wants', d.wants], ['Voice', d.voice], ['Knows', d.knows]].filter((r) => r[1]).map((r) => `<dt>${r[0]}</dt><dd>${esc(r[1])}</dd>`).join('') : d.facts ? `<dt>Key facts</dt><dd>${esc(d.facts)}</dd>` : ''}${e.notes ? `<dt>Private notes</dt><dd>${esc(e.notes)}</dd>` : ''}${e.aliases?.length ? `<dt>Also called</dt><dd>${esc(e.aliases.join(', '))}</dd>` : ''}</dl><a class="bd-link" href="#/studio/novel/${n.id}/bible?e=${e.id}">Edit entry</a>` : ''}</li>`;
    };
    function paint() {
      if (!entries) { host.innerHTML = `<div class="bd-head"><h2>Story bible</h2><button type="button" class="bd-x" data-close aria-label="Close story bible">×</button></div><p class="bd-hint">${error ? esc(error) : 'Loading…'}</p>`; return; }
      const text = plainText(titleEl.value + '\n' + body.innerHTML);
      const inCh = entries.filter((e) => bible.mentioned(e, text));
      const ql = q.trim().toLowerCase();
      const found = ql ? entries.filter((e) => [e.name, ...(e.aliases || [])].join(' ').toLowerCase().includes(ql)) : [];
      const quiet = bible.quiet(entries, chapters());
      btn.innerHTML = `${ICON_BOOK}Bible${inCh.length ? ` · ${inCh.length}` : ''}`;
      host.innerHTML = `<div class="bd-head"><h2>In this chapter</h2><button type="button" class="bd-x" data-close aria-label="Close story bible">×</button></div>
        <p class="bd-hint">Found by name and alias as you type.</p>
        <ul class="bd-list">${inCh.map(item).join('') || `<li class="bd-none">${entries.length ? 'No bible entries mentioned yet.' : 'Your bible is empty.'}</li>`}</ul>
        <label class="sr-only" for="bdSearch">Look up an entry</label><input class="input bd-search" id="bdSearch" type="search" placeholder="Look up anyone or anything" value="${esc(q)}">
        ${ql ? `<ul class="bd-list">${found.map(item).join('') || '<li class="bd-none">No match.</li>'}</ul>` : ''}
        ${quiet.length ? `<h2 class="bd-sub">Quiet threads</h2><ul class="bd-list">${quiet.map(({ e, last }) => `<li class="bd-quiet"><b>${esc(e.name)}</b><span>Last mentioned in Ch. ${last}</span></li>`).join('')}</ul>` : ''}
        <div class="bd-actions"><a class="btn btn-ghost btn-sm" href="#/studio/novel/${n.id}/bible?new=character">+ New entry</a><a class="btn btn-ghost btn-sm" href="#/studio/novel/${n.id}/bible">Open full bible</a></div>`;
      if (ql) { const s = $('#bdSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }
    const setOpen = (v) => { open = v; host.hidden = !v; btn.setAttribute('aria-expanded', String(v)); document.body.classList.toggle('bible-open', v); try { localStorage.setItem('sfb.bibleDrawer', v ? '1' : '0'); } catch {} if (v) paint(); };
    btn.addEventListener('click', () => setOpen(!open));
    host.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-close]')) { setOpen(false); btn.focus(); return; }
      const x = ev.target.closest('[data-x]'); if (x) { expanded.has(x.dataset.x) ? expanded.delete(x.dataset.x) : expanded.add(x.dataset.x); paint(); }
    });
    host.addEventListener('input', (ev) => { if (ev.target.id === 'bdSearch') { q = ev.target.value; paint(); } });
    let t = null; const refresh = () => { clearTimeout(t); t = setTimeout(() => { if (entries) paint(); }, 600); };
    body.addEventListener('input', refresh); titleEl.addEventListener('input', refresh);
    bible.load(n.id).then((list) => { entries = list; paint(); }, (err) => { error = err.message; paint(); });
    try { if (localStorage.getItem('sfb.bibleDrawer') === '1') setOpen(true); } catch {}
    return () => { clearTimeout(t); host.remove(); document.body.classList.remove('bible-open'); };
  }

  /* Readers' spoiler-safe "Who's who" sheet. */
  function openWhosWho({ n, upto, data, mount }) {
    const d = document.createElement('dialog'); d.className = 'whos-sheet'; d.setAttribute('aria-labelledby', 'wwTitle');
    const groups = [['character', 'People'], ['place', 'Places'], ['other', 'More']].map(([k, label]) => ({ k, label, list: data.entries.filter((e) => (k === 'other' ? !['character', 'place'].includes(e.kind) : e.kind === k)) })).filter((g) => g.list.length);
    let tab = groups[0]?.k;
    const paint = () => {
      const g = groups.find((x) => x.k === tab);
      d.innerHTML = `<div class="ww-in"><div class="ww-head"><div><h2 id="wwTitle">Who’s who</h2><p>Only what you’ve read so far. No spoilers.</p></div><span class="ww-upto">Up to Ch. ${upto}</span><button type="button" class="ww-x" data-close aria-label="Close">×</button></div>
        ${groups.length > 1 ? `<div class="ww-tabs" role="group" aria-label="Sections">${groups.map((x) => `<button type="button" data-tab="${x.k}" aria-pressed="${x.k === tab}">${x.label}</button>`).join('')}</div>` : ''}
        <ul class="ww-list">${g ? g.list.map((e) => `<li>${bibleAvatar(e)}<div><b>${esc(e.name)}</b>${e.role ? `<span class="ww-role">${esc(e.role)}</span>` : ''}${e.summary ? `<p>${esc(e.summary)}</p>` : ''}</div></li>`).join('') : '<li class="ww-none">Nothing here yet.</li>'}
          ${data.locked ? `<li class="ww-locked"><span class="b-av" aria-hidden="true">?</span><div><b>${data.locked} more ${data.locked === 1 ? 'entry' : 'entries'}</b><p>Keep reading to unlock.</p></div></li>` : ''}</ul>
        <p class="ww-fine">Written by ${esc(api.users.byId(n.author_id)?.name || 'the author')}.</p></div>`;
    };
    d.addEventListener('click', (ev) => {
      if (ev.target === d || ev.target.closest('[data-close]')) { d.close(); return; }
      const b = ev.target.closest('[data-tab]'); if (b) { tab = b.dataset.tab; paint(); }
    });
    d.addEventListener('close', () => d.remove());
    paint(); (mount || document.body).appendChild(d); d.showModal();
  }

  /* Chapter editor autosave.
     Every keystroke is backed up in this browser right away (survives a closed tab, a crash, or no internet).
     Drafts also save to the server a moment after you stop typing, plus every 30 seconds while you keep going.
     Published chapters only back up on this device: readers see changes when you press Update chapter. */
  const draftBackup = {
    key: (cid) => 'sfb.draft.' + cid,
    get(cid) { try { return JSON.parse(localStorage.getItem(draftBackup.key(cid)) || 'null'); } catch { return null; } },
    set(cid, v) { try { localStorage.setItem(draftBackup.key(cid), JSON.stringify({ ...v, at: now() })); return true; } catch { return false; } },
    clear(cid) { try { localStorage.removeItem(draftBackup.key(cid)); } catch {} },
  };

  route('/studio/novel/:id/ch/:cid', async ({ app, params }) => {
    if (!requireAuth()) return;
    const me = auth.current(); const n = api.novels.byId(params.id); const c = api.chapters.byId(params.cid);
    if (!n || !c || n.author_id !== me.id || c.novel_id !== n.id) return notFound(app, 'That chapter is not in your Studio.');
    setTitle(`${c.title || 'Untitled chapter'} · Editor`);
    const isLive = c.status === 'published';
    const isSched = !isLive && features.sql && !!c.scheduled_at;
    app.innerHTML = `<div class="editor">
      <div class="ed-top"><div class="crumbs" style="margin:0"><a href="#/studio">Studio</a> / <a href="#/studio/novel/${n.id}">${esc(n.title || 'Untitled series')}</a> / Chapter ${c.chapter_number}</div>
        <div class="row ed-actions"><span class="badge ${isLive ? 'badge-live' : isSched ? 'badge-sched' : 'badge-draft'}">${isLive ? 'PUBLISHED' : isSched ? 'SCHEDULED' : 'DRAFT'}</span><span class="save-state" id="state" aria-live="polite"></span><button class="btn btn-ghost btn-sm bible-btn" id="bibleBtn" aria-expanded="false" aria-controls="bibleDrawer">${ICON_BOOK}Bible</button>${isLive ? '' : '<button class="btn btn-ghost btn-sm" id="saveBtn">Save draft</button>'}${isLive ? '<button class="btn btn-primary btn-sm" id="pubBtn">Update chapter</button><button class="btn btn-ghost btn-sm" id="unpubBtn">Unpublish</button>' : `${features.sql ? `<button class="btn btn-ghost btn-sm" id="schedBtn">${isSched ? 'Change time' : 'Schedule'}</button>` : ''}<button class="btn btn-primary btn-sm" id="pubBtn">${isSched ? 'Publish now' : 'Publish chapter'}</button>`}</div></div>
      ${isSched ? `<div class="sched-bar" role="status">${ICON_CLOCK}<span>Goes live <b>${esc(fmtWhen(c.scheduled_at))}</b> (${esc(fmtIn(c.scheduled_at))}). Your edits keep saving until then.</span><button class="btn btn-ghost btn-sm" id="unschedBtn">Unschedule</button></div>` : ''}
      <div id="restoreBar"></div>
      <input class="ed-title" id="title" value="${esc(c.title)}" placeholder="Chapter title" maxlength="140" aria-label="Chapter title">
      <div class="toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" data-cmd="bold" title="Bold"><b>B</b></button><button type="button" data-cmd="italic" title="Italic"><i>I</i></button><button type="button" data-cmd="underline" title="Underline"><u>U</u></button><span class="gap"></span>
        <button type="button" data-block="h2">Heading</button><button type="button" data-block="blockquote">Quote</button><button type="button" data-cmd="insertUnorderedList">• List</button><button type="button" data-cmd="insertOrderedList">1. List</button><button type="button" data-cmd="insertHorizontalRule">Scene break</button><span class="gap"></span><button type="button" data-block="p">Plain</button>
        <span class="words" id="words"></span></div>
      <div class="ed-body" id="body" contenteditable="true" data-placeholder="Begin the chapter…" spellcheck="true">${sanitize(c.content)}</div>
      <div class="ed-note"><div class="card"><h2>Author's note <span class="muted" style="font-weight:400;font-size:var(--t-xs)">optional</span></h2><p>Shown to readers at the end of this chapter, after the text. Thank people, tease what is next, or explain a delay.</p>
        <textarea class="textarea" id="note" maxlength="1000" placeholder="Thanks for reading. Next chapter lands Thursday.">${esc(c.author_note)}</textarea><div class="count" id="noteCount"></div></div></div></div>`;

    const body = $('#body'), title = $('#title'), note = $('#note'), state = $('#state');
    const words = () => { $('#words').textContent = `${wordCount(body.innerHTML).toLocaleString()} words · ${readMin(wordCount(body.innerHTML))} min`; $('#noteCount').textContent = `${note.value.length} / 1000`; };
    const snapshot = () => ({ title: title.value.trim(), content: body.innerHTML, author_note: note.value.trim() });
    const same = (x) => x && x.title === (c.title || '') && x.content === (c.content || '') && x.author_note === (c.author_note || '');
    words();

    // Status pill: Saving… / Saved 2 min ago / Saved on this device / Offline
    let dirty = false, timer = null, maxTimer = null, savedAt = null, saving = false, failed = false;
    const paintState = () => {
      if (saving) { state.className = 'save-state saving'; state.textContent = 'Saving…'; return; }
      if (failed) { state.className = 'save-state warn'; state.textContent = 'Couldn’t reach the server. Saved on this device, retrying…'; return; }
      if (dirty && isLive) { state.className = 'save-state local'; state.textContent = 'Saved on this device. Press Update chapter to go live.'; return; }
      if (dirty) { state.className = 'save-state'; state.textContent = 'Editing…'; return; }
      state.className = 'save-state ok'; state.textContent = savedAt ? `Saved ${timeAgo(savedAt).replace(/^now$/, 'just now')}` : 'All changes saved';
    };
    const tick = setInterval(paintState, 15000);
    paintState();
    const unmountBible = mountBibleDrawer({ n, c, body, titleEl: title, btn: $('#bibleBtn') });

    async function saveServer(announce) {
      clearTimeout(timer); clearTimeout(maxTimer); maxTimer = null;
      if (saving) return;
      saving = true; paintState();
      try {
        const snap = snapshot();
        await api.chapters.update(c.id, snap);
        draftBackup.clear(c.id);
        dirty = false; failed = false; savedAt = now();
        if (announce) toast(isLive ? 'Changes saved' : 'Draft saved');
      } catch (err) {
        failed = true; timer = setTimeout(() => saveServer(false), 8000); // try again shortly
        if (announce) toast('Couldn’t save to the server. Your work is safe on this device.');
      } finally { saving = false; paintState(); }
    }
    const markDirty = () => {
      dirty = true;
      draftBackup.set(c.id, snapshot()); // instant local backup
      if (!isLive) {
        clearTimeout(timer); timer = setTimeout(() => saveServer(false), 1500);
        if (!maxTimer) maxTimer = setTimeout(() => saveServer(false), 30000); // long typing streaks still save
      }
      paintState();
    };

    // Found unsaved work from last time (closed tab, crash, lost connection)? Offer it back.
    const backup = draftBackup.get(c.id);
    if (backup && !same(backup) && backup.at > (c.updated_at || 0) - 1000) {
      $('#restoreBar').innerHTML = `<div class="restore-bar" role="status"><span><b>Unsaved changes found</b> from ${esc(timeAgo(backup.at))}. Want them back?</span><button class="btn btn-primary btn-sm" id="rsYes">Restore</button><button class="btn btn-ghost btn-sm" id="rsNo">Discard</button></div>`;
      $('#rsYes').addEventListener('click', () => { title.value = backup.title || ''; body.innerHTML = sanitize(backup.content || ''); note.value = backup.author_note || ''; $('#restoreBar').innerHTML = ''; words(); markDirty(); toast('Changes restored'); });
      $('#rsNo').addEventListener('click', async () => { if (!(await askConfirm('The unsaved changes on this device will be deleted.', { title: 'Discard changes?', ok: 'Discard', danger: true }))) return; draftBackup.clear(c.id); $('#restoreBar').innerHTML = ''; });
    } else if (backup && same(backup)) draftBackup.clear(c.id);

    body.addEventListener('input', () => { words(); markDirty(); }); title.addEventListener('input', () => { setTitle(`${title.value.trim() || 'Untitled chapter'} · Editor`); markDirty(); }); note.addEventListener('input', () => { words(); markDirty(); });
    // Paste keeps bold and italics from Google Docs or Word, and drops fonts, colours, links and images.
    body.addEventListener('paste', (e) => {
      e.preventDefault(); const cd = e.clipboardData || window.clipboardData;
      const html = cd.getData('text/html'); const t = cd.getData('text/plain');
      const clean = html ? cleanPaste(html) : '';
      document.execCommand('insertHTML', false, clean && stripHtml(clean).trim() ? clean : t.split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join(''));
    });
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (isLive) { draftBackup.set(c.id, snapshot()); toast('Saved on this device. Press Update chapter to make it live.'); } else saveServer(true);
      }
    }
    document.addEventListener('keydown', onKey);
    // Save when the tab is hidden (switching apps on a phone, closing the laptop).
    const onHide = () => { if (document.visibilityState === 'hidden' && dirty && !isLive) saveServer(false); };
    document.addEventListener('visibilitychange', onHide);
    const onOnline = () => { if (failed) saveServer(false); };
    window.addEventListener('online', onOnline);
    $$('.toolbar button').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); body.focus(); if (b.dataset.cmd) document.execCommand(b.dataset.cmd, false, null); if (b.dataset.block) document.execCommand('formatBlock', false, b.dataset.block); words(); markDirty(); }));
    $('#saveBtn')?.addEventListener('click', () => saveServer(true));
    $('#pubBtn').addEventListener('click', async () => { await saveServer(false); if (failed) return; if (isLive) { toast('Chapter updated'); go(`/studio/novel/${n.id}`); return; } if (await publishChapter(c.id)) go(`/studio/novel/${n.id}`); });
    $('#unpubBtn')?.addEventListener('click', async () => { await saveServer(false); if (failed) return; await api.chapters.unpublish(c.id); toast('Chapter unpublished'); render(); });
    $('#schedBtn')?.addEventListener('click', async () => { await saveServer(false); if (failed) return; if (await scheduleChapter(c.id)) render(); });
    $('#unschedBtn')?.addEventListener('click', async () => { await api.chapters.unschedule(c.id); toast('Unscheduled. It’s a draft again.'); render(); });
    window.onbeforeunload = () => (dirty && (isLive || failed) ? 'Unsaved changes.' : undefined);
    cleanup = () => {
      window.onbeforeunload = null; clearInterval(tick); clearTimeout(timer); clearTimeout(maxTimer); unmountBible();
      document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('online', onOnline);
      if (dirty && !isLive) saveServer(false);
    };
  });

  /* Moderation queue (moderators only; the database checks too). Reports about the same thing are grouped. */
  const REASON_LABEL = Object.fromEntries(REPORT_REASONS.map(([k, l]) => [k, l]));
  route('/mod', async ({ app, query, stale }) => {
    if (!requireAuth('/mod')) return;
    if (!features.mod) return notFound(app, 'Only moderators can open this page.');
    setTitle('Moderation'); const view = query.view === 'closed' ? 'closed' : 'open';
    app.innerHTML = '<div class="page"><p class="muted">Loading reports…</p></div>';
    let rows; try { rows = view === 'open' ? await api.reports.open() : await api.reports.closed(); } catch (err) { if (!stale()) notFound(app, err.message); return; }
    if (stale()) return;
    const groups = new Map();
    rows.forEach((r) => { const k = `${r.target_type}:${r.target_id}`; (groups.get(k) || groups.set(k, []).get(k)).push(r); });
    const preview = (type, id) => {
      if (type === 'comment') { const cm = db.chapter_comments.find((x) => String(x.id) === id); if (!cm) return { gone: true }; const c = api.chapters.byId(cm.chapter_id); const n = c && api.novels.byId(c.novel_id); const u = api.users.byId(cm.user_id); return { who: u, title: `Comment${n ? ` on ${n.title}` : ''}`, text: cm.body, href: n && c ? chapterLink(n, c) + '?to=comments' : null }; }
      if (type === 'review') { const r = db.reviews.find((x) => String(x.id) === id); if (!r) return { gone: true }; const n = api.novels.byId(r.novel_id); return { who: api.users.byId(r.user_id), title: `${r.rating}/5 review${n ? ` of ${n.title}` : ''}`, text: r.body || '(no text)', href: n ? `#/novel/${n.slug}?go=reviews` : null }; }
      if (type === 'chapter') { const c = api.chapters.byId(id); if (!c) return { gone: true }; const n = api.novels.byId(c.novel_id); return { who: api.users.byId(n?.author_id), title: `Chapter: ${c.title}${n ? ` (${n.title})` : ''}`, text: stripHtml(c.content).slice(0, 280) + '…', href: n && c.status === 'published' ? chapterLink(n, c) : null, note: c.status !== 'published' ? 'Not public right now.' : '' }; }
      if (type === 'novel') { const n = api.novels.byId(id); if (!n) return { gone: true }; return { who: api.users.byId(n.author_id), title: `Series: ${n.title}`, text: n.synopsis, href: api.novels.isPublic(n) ? `#/novel/${n.slug}` : null, note: !api.novels.isPublic(n) ? 'Offline right now.' : `Rated ${MATURITY[n.maturity]?.label || 'Everyone'}` }; }
      if (type === 'user') { const u = api.users.byId(id); if (!u) return { gone: true }; return { who: u, title: `Profile: @${u.username}`, text: u.bio, href: `#/u/${u.username}` }; }
      return { gone: true };
    };
    const removeLabel = { comment: 'Delete comment', review: 'Delete review', chapter: 'Unpublish chapter', novel: 'Take series offline' };
    app.innerHTML = `<div class="studio-head"><div><h1>Moderation</h1><p class="lead">${view === 'open' ? `${plural(groups.size, 'thing')} reported, oldest first.` : 'Recently closed reports.'}</p></div></div>
      <nav class="nt-tabs" aria-label="Reports"><a href="#/mod" aria-current="${view === 'open' ? 'page' : 'false'}">Open</a><a href="#/mod?view=closed" aria-current="${view === 'closed' ? 'page' : 'false'}">Closed</a></nav>
      <ul class="mod-list" id="modList">${[...groups.values()].map((list) => {
        const r = list[0]; const p = preview(r.target_type, r.target_id);
        const reasons = [...new Set(list.map((x) => x.reason))].map((k) => `<span class="chip">${esc(REASON_LABEL[k] || k)}</span>`).join('');
        return `<li class="card mod-item"><div class="mod-top"><span class="badge badge-draft">${esc((REPORT_WHAT[r.target_type] || r.target_type).toUpperCase())}</span><b>${plural(list.length, 'report')}</b><span class="muted small">first ${esc(timeAgo(Number(r.created_at)))}</span></div>
          ${p.gone ? '<p class="muted">Already removed or deleted.</p>' : `<div class="mod-prev">${p.href ? `<a href="${esc(p.href)}" target="_blank" rel="noopener"><b>${esc(p.title)}</b></a>` : `<b>${esc(p.title)}</b>`}<div class="muted small">by ${p.who ? `<a href="#/u/${esc(p.who.username)}">@${esc(p.who.username)}</a>` : 'unknown'}${p.note ? ` · ${esc(p.note)}` : ''}</div>${p.text ? `<blockquote>${esc(String(p.text).slice(0, 600))}</blockquote>` : ''}</div>`}
          <div class="chip-set">${reasons}</div>
          ${list.filter((x) => x.details).map((x) => `<p class="mod-detail">“${esc(x.details)}” <span class="muted small">— ${esc(api.users.byId(x.reporter_id)?.username ? '@' + api.users.byId(x.reporter_id).username : 'a reader')}</span></p>`).join('')}
          ${view === 'open' ? `<div class="field" style="margin:12px 0 10px"><label for="mn-${r.id}">Note to the writer <span class="muted">(shown if you remove it)</span></label><input class="input" id="mn-${r.id}" maxlength="300" placeholder="Which rule it broke"></div>
          <div class="row" style="gap:8px;flex-wrap:wrap">${removeLabel[r.target_type] && !p.gone ? `<button class="btn btn-danger btn-sm" data-act="remove" data-rid="${r.id}">${removeLabel[r.target_type]}</button>` : ''}${r.target_type === 'user' ? `<button class="btn btn-sm" data-act="keep" data-rid="${r.id}">Mark handled</button>` : ''}<button class="btn btn-ghost btn-sm" data-act="dismiss" data-rid="${r.id}">Dismiss, no rule broken</button></div>`
          : `<p class="small"><b>${r.status === 'dismissed' ? 'Dismissed' : 'Action taken'}</b>${r.mod_note ? ` · ${esc(r.mod_note)}` : ''} · ${esc(timeAgo(Number(r.resolved_at)))}</p>`}</li>`;
      }).join('') || `<li class="empty"><h3>${view === 'open' ? 'All clear' : 'Nothing closed yet'}</h3><p>${view === 'open' ? 'No open reports right now.' : 'Reports you close show up here.'}</p></li>`}</ul>
      ${groups.size && [...groups.values()].some((l) => l[0].target_type === 'user') ? '<p class="hint">Suspending accounts isn’t built in yet. For a user report, handle it in Supabase, then mark it handled.</p>' : ''}`;
    $('#modList').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const rid = +b.dataset.rid; const r = rows.find((x) => x.id === rid); const act = b.dataset.act; const note = $(`#mn-${rid}`)?.value.trim() || '';
      if (act === 'remove' && !(await askConfirm(`${removeLabel[r.target_type]}? The writer is told why${note ? '' : ' (you didn’t add a note)'}.`, { title: 'Remove this?', ok: removeLabel[r.target_type], danger: true }))) return;
      b.disabled = true;
      try {
        await api.reports.resolve(rid, act, note);
        if (act === 'remove') { // keep this page's copy of the data in step with the database
          if (r.target_type === 'comment') db.chapter_comments = db.chapter_comments.filter((x) => String(x.id) !== r.target_id);
          if (r.target_type === 'review') db.reviews = db.reviews.filter((x) => String(x.id) !== r.target_id);
          if (r.target_type === 'chapter') { const c = api.chapters.byId(r.target_id); if (c) { c.status = 'draft'; c.scheduled_at = null; } }
          if (r.target_type === 'novel') { const n = api.novels.byId(r.target_id); if (n) n.status = 'draft'; }
        }
        toast(act === 'dismiss' ? 'Report dismissed' : act === 'remove' ? 'Removed. The writer has been told.' : 'Marked handled'); render();
      } catch (err) { toast(err.message); b.disabled = false; }
    });
  });

  /* 6k. Settings ------------------------------------------------------------ */
  route('/settings', async ({ app, query, stale }) => {
    if (!requireAuth('/settings')) return;
    setTitle('Settings'); const me = auth.current();
    const { data } = await sb.auth.getUser(); if (stale()) return; const email = data?.user?.email || '';
    const prefsOn = (k) => (me.notice_prefs || {})[k] !== false;
    app.innerHTML = `<div class="settings">
      <header class="studio-head"><div><h1>Settings</h1><p class="lead">Appearance, sign-in and security.</p></div></header>
      <section class="card"><h2>Appearance</h2>
        <div class="set-row"><div><div class="set-t" id="stThemeLbl">Theme</div><p class="hint">System matches your device’s light or dark setting. Saved in this browser.</p></div>${themeSeg('stThemeLbl')}</div></section>
      <section class="card"><h2>Content</h2>
        <div class="set-row"><div><div class="set-t" id="stMatLbl">Show Mature (17+) series</div><p class="hint">When off, Mature series are hidden from Home, Browse and the schedule, and opening one asks first. Saved in this browser.</p></div><label class="switch"><input type="checkbox" id="stMature" aria-labelledby="stMatLbl" ${contentPrefs.showMature() ? 'checked' : ''}><span></span></label></div></section>
      ${features.sql ? `<section class="card" id="notifCard"><h2>Notifications</h2><p class="hint" style="margin-top:-6px">About your series. New chapters from series you follow always show up.</p>
        ${NOTICE_KINDS.map(([k, label]) => `<div class="set-row"><div class="set-t" id="np-${k}">${esc(label)}</div><label class="switch"><input type="checkbox" data-np="${k}" aria-labelledby="np-${k}" ${prefsOn(k) ? 'checked' : ''}><span></span></label></div>`).join('')}</section>` : ''}
      <section class="card"><h2>Profile</h2>
        <div class="set-row"><div><div class="set-t">${nm(me)}</div><p class="hint">@${esc(me.username)}. Your display name and bio are edited on your profile.</p></div><a class="btn btn-ghost btn-sm" href="#/u/${esc(me.username)}">Edit profile</a></div></section>
      <section class="card"><h2>Email</h2>
        <form id="emailForm" novalidate>
          <div class="field"><label for="st_email">New email</label><input class="input" id="st_email" type="email" autocomplete="email" required><span class="hint">Currently ${esc(email) || 'unknown'}. We send a link to confirm the new address before it changes.</span></div>
          <div class="form-error" id="emailErr" role="alert"></div><div class="form-note" id="emailNote" role="status"></div>
          <button class="btn btn-sm" type="submit">Change email</button></form></section>
      <section class="card"><h2>Password</h2>
        <form id="pwForm" novalidate>
          <div class="field"><label for="st_pw_cur">Current password</label><input class="input" id="st_pw_cur" type="password" autocomplete="current-password" required></div>
          <div class="field"><label for="st_pw_new">New password</label><input class="input" id="st_pw_new" type="password" autocomplete="new-password" required><span class="hint">At least 8 characters.</span></div>
          <div class="field"><label for="st_pw_again">Confirm new password</label><input class="input" id="st_pw_again" type="password" autocomplete="new-password" required></div>
          <div class="form-error" id="pwErr" role="alert"></div>
          <button class="btn btn-sm" type="submit">Change password</button></form></section>
      <section class="card"><h2>Sessions</h2>
        <div class="set-row"><div><div class="set-t">Sign out everywhere</div><p class="hint">Ends your session on every device, this one included. Use it if you signed in on a computer that isn’t yours.</p></div><button class="btn btn-ghost btn-sm" id="signOutAll">Sign out everywhere</button></div></section>
    </div>`;

    $('#stMature').addEventListener('change', (e) => { contentPrefs.setShowMature(e.target.checked); toast(e.target.checked ? 'Mature series will show' : 'Mature series are hidden'); });
    $('#notifCard')?.addEventListener('change', async (e) => {
      const k = e.target.dataset.np; if (!k) return;
      const next = { ...(me.notice_prefs || {}), [k]: e.target.checked };
      try { await api.users.update(me.id, { notice_prefs: next }); toast('Saved'); } catch (err) { e.target.checked = !e.target.checked; toast(err.message); }
    });
    if (query.s === 'notif') setTimeout(() => $('#notifCard')?.scrollIntoView({ block: 'start' }), 30);

    $('#emailForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = e.submitter; $('#emailErr').textContent = ''; $('#emailNote').textContent = '';
      const next = $('#st_email').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(next)) { $('#emailErr').textContent = 'Enter a valid email address.'; return; }
      if (next.toLowerCase() === email.toLowerCase()) { $('#emailErr').textContent = 'That is already your email.'; return; }
      if (btn) btn.disabled = true;
      try {
        const { error } = await sb.auth.updateUser({ email: next }, { emailRedirectTo: location.origin + location.pathname });
        if (error) throw new Error(error.message);
        $('#emailNote').textContent = `Check ${next} for a confirmation link. Your email changes once you open it.`; $('#st_email').value = '';
      } catch (err) { $('#emailErr').textContent = err.message; } finally { if (btn) btn.disabled = false; }
    });

    $('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = e.submitter; const err = $('#pwErr'); err.textContent = '';
      const cur = $('#st_pw_cur').value, nxt = $('#st_pw_new').value, again = $('#st_pw_again').value;
      if (!cur) { err.textContent = 'Enter your current password.'; return; }
      if (nxt.length < 8) { err.textContent = 'New passwords need at least 8 characters.'; return; }
      if (nxt !== again) { err.textContent = 'The new passwords don’t match.'; return; }
      if (nxt === cur) { err.textContent = 'Choose a password you aren’t using now.'; return; }
      if (btn) btn.disabled = true;
      try {
        // Check the current password first, so someone at an unlocked screen can't change it.
        const check = await sb.auth.signInWithPassword({ email, password: cur });
        if (check.error) throw new Error('Your current password is wrong.');
        const { error } = await sb.auth.updateUser({ password: nxt });
        if (error) throw new Error(error.message);
        e.target.reset(); toast('Password changed');
      } catch (x) { err.textContent = x.message; } finally { if (btn) btn.disabled = false; }
    });

    $('#signOutAll').addEventListener('click', async () => {
      if (!(await askConfirm('You will need to log in again on every device, including this one.', { title: 'Sign out everywhere?', ok: 'Sign out everywhere' }))) return;
      await auth.logoutEverywhere(); toast('Signed out on every device'); go('/');
    });
  });

  /* 6l. Help & safety -------------------------------------------------------- */
  route('/help', async ({ app }) => {
    setTitle('Help & safety');
    app.innerHTML = `<div class="page help"><h1>Help &amp; safety</h1>
      <p class="muted">How Stories From Beyond works, and what we expect from everyone on it.</p>
      <h2>Community rules</h2>
      <ol>${COMMUNITY_RULES.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
      <h2>Your account</h2>
      <p>Change your theme, email and password in <a href="#/settings">Settings</a>. If you signed in somewhere you shouldn’t have, use <b>Sign out everywhere</b> there.</p>
      <h2>Comments</h2>
      <p>You can delete your own comments, and authors can delete any comment on their chapters.</p>
      <h2>Reviews</h2>
      <p>Once you’ve started reading a series you can rate it from 0 to 5 stars and write a review. You get one review per series and can edit or delete it any time. Mark it as containing spoilers if it gives away the plot. Writers can post one public reply to each review, but can’t delete reviews.</p>
      <h2>Reporting</h2>
      <p>Use <b>Report</b> on a series, chapter, comment, review or profile that breaks the rules. Reports are private: the person you report never sees who sent it. A moderator reviews every report, and you’ll get a notification when it’s been looked at. If someone is in danger, contact local emergency services.</p>
      <h2>Maturity ratings</h2>
      <p>Writers rate each series <b>Everyone</b>, <b>Teen 13+</b> or <b>Mature 17+</b>. Mature series are hidden from lists until you turn them on in <a href="#/settings">Settings</a>. If a series has mature content without a Mature rating, report it.</p>
      <h2>For writers: scheduling</h2>
      <p>In the Studio, choose <b>Schedule</b> on a draft to pick when it goes live, or <b>Schedule drafts</b> to queue several on a regular rhythm. Scheduled chapters keep saving as you edit, and your followers are notified the moment they go live.</p>
      ${PAYMENTS_ON ? `<h2>Gifts and Ink</h2>
      <p>Ink is what you use to send gifts to writers. Writers keep 60% of every gift. Ink has no cash value and can’t be cashed out or transferred. Unspent Ink packs can be refunded within 14 days if none of the pack has been used. See <a href="#/ink">Ink</a> for the details.</p>` : ''}
      <h2>Contact</h2>
      <p>Questions or account problems: <a href="mailto:storiesfrombeyondofficial@gmail.com">storiesfrombeyondofficial@gmail.com</a>.</p></div>`;
  });

  /* 6m. Gifting UI ----------------------------------------------------------
     Gift icons, the gift sheet, the Ink page, the Supporter Wall, Studio earnings,
     and the gift animations and sounds. */
  const ICON_DROP = '<svg class="ico-drop" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z" fill="currentColor"/></svg>';
  const ICON_GIFT = '<svg class="ico-gift" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1s6 1 6 1 6 2 6-1-4-3-6 1"/></svg>';
  const GIFT_TIERS = [{ t: 1, name: 'Small thanks' }, { t: 2, name: 'Cozy cheers' }, { t: 3, name: 'Story moments' }, { t: 4, name: 'Grand gestures' }];
  const GIFT_ART = {
    ribbon: '<path d="M22 8h20v48l-10-8-10 8z" fill="#CC1531"/><rect x="22" y="8" width="20" height="7" fill="#F5C542"/><path d="M28 18v26" stroke="#E8566B" stroke-width="3"/>',
    ink: '<ellipse cx="32" cy="56" rx="16" ry="3.5" fill="#D9DCF8" stroke="none"/><path d="M32 6c10 13 16 21 16 30a16 16 0 0 1-32 0c0-9 6-17 16-30z" fill="#2A2F6B"/><path d="M24 37a8 8 0 0 0 6 8" stroke="#fff" stroke-width="3"/><circle cx="38" cy="26" r="2" fill="#fff" stroke="none"/>',
    postit: '<path d="M12 12h40v30l-10 10H12z" fill="#FFE066"/><path d="M42 52V42h10z" fill="#F2C94C"/><path d="M32 38c-7-5-10-8-10-12a5 5 0 0 1 10-2 5 5 0 0 1 10 2c0 4-3 7-10 12z" fill="#CC1531"/>',
    tea: '<ellipse cx="30" cy="54" rx="21" ry="4.5" fill="#E9EAEE"/><path d="M44 30h4a6 6 0 0 1 0 12h-5"/><path d="M13 26h32v9a16 16 0 0 1-16 16h0a16 16 0 0 1-16-16z" fill="#fff"/><path d="M14 32h30" stroke="#CC1531" stroke-width="3"/><path class="gfx-steamline" d="M23 20c-3-4 3-6 0-10M31 20c-3-4 3-6 0-10M39 20c-3-4 3-6 0-10" stroke="#9AA0A6"/>',
    candle: '<ellipse cx="32" cy="55" rx="15" ry="4.5" fill="#C9A227"/><rect x="24" y="28" width="16" height="26" rx="3" fill="#FFF4D6"/><path d="M28 28v6a2 2 0 0 0 4 0v-6" fill="#FFF4D6"/><path d="M32 28v-4"/><g class="gfx-flame"><path d="M32 6c5 6 7 9 7 13a7 7 0 0 1-14 0c0-4 2-7 7-13z" fill="#F97316"/><path d="M32 13c2 3 3 4.5 3 6.5a3 3 0 0 1-6 0c0-2 1-3.5 3-6.5z" fill="#F5C542" stroke="none"/></g>',
    cat: '<g class="gfx-tail"><path d="M50 48c8 4 4 10-8 9" stroke="#22232A" stroke-width="8"/><path d="M50 48c8 4 4 10-8 9" stroke="#F4A261" stroke-width="4"/></g><ellipse cx="38" cy="44" rx="16" ry="11" fill="#F4A261"/><path d="M13 31l1-11 7 6zM24 26l7-6 1 11z" fill="#F4A261"/><circle cx="22" cy="38" r="11" fill="#F4A261"/><path d="M16 38q2.5 2.5 5 0M24 38q2.5 2.5 5 0"/><path d="M21 43h2"/><path d="M44 14h6l-6 7h6" stroke="#3445E6"/>',
    typewriter: '<rect x="19" y="8" width="26" height="22" rx="1" fill="#fff"/><path d="M24 15h16M24 20h12" stroke="#9AA0A6"/><rect x="7" y="26" width="50" height="6" rx="2" fill="#22232A"/><rect x="10" y="32" width="44" height="22" rx="5" fill="#14B8A6"/><circle cx="19" cy="40" r="2.5" fill="#fff"/><circle cx="27" cy="40" r="2.5" fill="#fff"/><circle cx="35" cy="40" r="2.5" fill="#fff"/><circle cx="43" cy="40" r="2.5" fill="#fff"/><path d="M22 47h20" stroke="#fff" stroke-width="3"/>',
    star: '<path d="M30 36L10 56M25 30L11 44M37 42L23 56" stroke="#A5B4FC" stroke-width="4"/><path d="M40 9L43.6 18.5L54 19.2L46 25.8L48.7 36L40 30.3L31.3 36L34 25.8L26 19.2L36.4 18.5Z" fill="#F5C542"/><path d="M54 40v6M51 43h6M14 14v4M12 16h4" stroke="#F5C542"/>',
    crown: '<path d="M10 22l12 11 10-17 10 17 12-11-5 30H15z" fill="#F5C542"/><rect x="15" y="44" width="34" height="8" fill="#E0A800"/><circle cx="24" cy="48" r="2.5" fill="#CC1531"/><circle cx="32" cy="48" r="2.5" fill="#3445E6"/><circle cx="40" cy="48" r="2.5" fill="#CC1531"/><circle cx="10" cy="21" r="3.5" fill="#F5C542"/><circle cx="32" cy="14" r="3.5" fill="#F5C542"/><circle cx="54" cy="21" r="3.5" fill="#F5C542"/>',
    aurora: '<rect x="5" y="5" width="54" height="54" rx="14" fill="#1E2050"/><path d="M10 28c8-10 16 6 24-4s14-6 20 2" stroke="#34D399" stroke-width="5"/><path d="M10 38c8-10 16 6 24-4s14-6 20 2" stroke="#A78BFA" stroke-width="4"/><path d="M7 54l13-11 9 7 11-12 17 16" fill="#0F1033" stroke="none"/><circle cx="18" cy="15" r="1.5" fill="#fff" stroke="none"/><circle cx="44" cy="12" r="1.5" fill="#fff" stroke="none"/><circle cx="50" cy="20" r="1" fill="#fff" stroke="none"/>',
    dragon: '<path class="gfx-wing" d="M30 32L36 8L46 28Z" fill="#F5C542"/><path d="M6 38L24 28L34 34L58 14L52 36L40 40L30 54L24 42Z" fill="#CC1531"/><path d="M24 28L34 34L24 42Z" fill="#9E0F25"/><path d="M34 34L58 14L40 40Z" fill="#E8566B"/><circle cx="13" cy="36" r="1.8" fill="#22232A" stroke="none"/>',
    phoenix: '<path d="M32 30C22 14 10 16 5 9c2 13 10 21 23 25z" fill="#F97316"/><path d="M32 30C42 14 54 16 59 9c-2 13-10 21-23 25z" fill="#F97316"/><path d="M30 30C24 22 17 21 13 18c3 7 8 11 15 14zM34 30C40 22 47 21 51 18c-3 7-8 11-15 14z" fill="#F5C542" stroke="none"/><path d="M32 42c-5 7-2 13 0 16 2-3 5-9 0-16z" fill="#F97316"/><path d="M32 20c5 6 6 15 0 24-6-9-5-18 0-24z" fill="#CC1531"/><circle cx="32" cy="17" r="4.5" fill="#CC1531"/><path d="M32 12l-2-5M35 13l2-5" stroke="#F5C542"/>',
  };
  const giftSvg = (id, size = 64) => `<svg class="gift-svg" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="#22232A" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GIFT_ART[id] || GIFT_ART.ribbon}</svg>`;
  const giftCountText = (count, none = '0 gifts') => (count ? `${compact(count)} ${pl(count, 'gift')}` : none);
  /** Author avatar, with a small crown for 48 hours after someone sends an Author's Crown. */
  const crownedAvatar = (u) => `<span class="av-wrap">${gifting.crowned.has(u?.id) ? `<span class="av-crown" title="Crowned by a reader">${giftSvg('crown', 26)}</span>` : ''}<span class="avatar lg" aria-hidden="true">${esc(initials(u?.name))}</span></span>`;

  /** Supporter Wall on the series page. Anonymous gifters never show a name. */
  async function paintSupporters(n, host, mine) {
    if (!host) return;
    try {
      const rows = await gifting.supporters(n.id);
      host.innerHTML = `<div class="sup-head"><h2 id="supTitle">Top supporters</h2></div>${rows?.length ? `<ol class="sup-list">${rows.map((r) => `<li>
        <span class="sup-rank">${r.rank}</span>
        <span class="avatar ${r.anonymous ? 'anon' : ''}" aria-hidden="true">${r.anonymous ? '?' : esc(initials(r.name))}</span>
        <span class="sup-who">${r.anonymous ? '<b>Anonymous</b>' : `<a href="#/u/${esc(r.username)}"><b>${esc(r.name)}</b></a>`}<span>${esc(r.top_gift)}${Number(r.gifts) > 1 ? ` + ${Number(r.gifts) - 1} more` : ''}</span></span>
        <span class="sup-ink">${Number(r.total_ink).toLocaleString()} Ink</span></li>`).join('')}</ol>` : `<p class="muted small">No gifts yet.${mine ? ' Readers who send gifts show up here.' : ' Be the first to send one.'}</p>`}`;
    } catch { host.remove(); }
  }

  /** Studio card: what this writer has received. */
  async function paintEarnings(me, host) {
    if (!host) return;
    try {
      const s = await gifting.summary();
      host.innerHTML = me.official
        ? `<h2 id="geTitle">Gifts</h2>
           <div class="ge-stats"><div><span>Gifts received</span><b>${Number(s.received).toLocaleString()}</b></div><div><span>Ink received</span><b>${Number(s.ink).toLocaleString()}</b></div><div><span>Site income</span><b>${money(Number(s.house_ink))}</b></div></div>
           <p class="hint">This is an official account, so gifts here are site income. There’s no 60% split and nothing to cash out.</p>`
        : `<h2 id="geTitle">Gifts</h2>
           <div class="ge-stats"><div><span>Gifts received</span><b>${Number(s.received).toLocaleString()}</b></div><div><span>Pending</span><b>${money(Number(s.pending_cents))}</b></div><div><span>Available</span><b>${money(Number(s.available_cents))}</b></div></div>
           <p class="hint">You keep 60% of every gift. New gifts stay pending for 14 days in case of refunds. Cash-outs (minimum $25, paid monthly) open soon.</p>`;
    } catch { host.remove(); }
  }

  /** The gift sheet. chapter is optional: without it, the gift goes to the whole series. */
  function openGiftSheet({ novel, chapter = null, onSent } = {}) {
    if (!requireAuth()) return;
    if (!gifting.ready) { toast('Gifting isn’t switched on yet.'); return; }
    const me = auth.current(); const author = api.users.byId(novel.author_id);
    if (me.id === novel.author_id) { toast('You can’t send gifts to your own series.'); return; }
    const st = { target: chapter ? 'chapter' : 'series', tier: 2, pick: null, anon: false, note: '', busy: false };
    st.pick = (gifting.tier(2)[1] || gifting.tier(2)[0] || gifting.catalog[0]).id;

    const d = document.createElement('dialog');
    d.className = 'gift-sheet'; d.setAttribute('aria-labelledby', 'gsTitle');
    document.body.appendChild(d);

    const paint = () => {
      const g = gifting.byId(st.pick); const enough = g && gifting.ink >= g.cost;
      d.innerHTML = `<form method="dialog" class="gs-in">
        <div class="gs-head">
          <div><h2 id="gsTitle">Send a gift</h2><p class="muted small">to ${nm(author)}${chapter && st.target === 'chapter' ? ` for Chapter ${api.novels.published(novel.id).indexOf(chapter) + 1}` : ` for ${esc(novel.title)}`}</p></div>
          <div class="gs-bal"><span class="ink-pill">${ICON_DROP}${gifting.ink.toLocaleString()} Ink</span><a href="#/ink" class="gs-more">Get Ink</a></div>
        </div>
        ${chapter ? `<div class="gs-seg" role="group" aria-label="What the gift is for"><button type="button" data-target="chapter" aria-pressed="${st.target === 'chapter'}">This chapter</button><button type="button" data-target="series" aria-pressed="${st.target === 'series'}">Whole series</button></div>` : ''}
        <div class="gs-tabs" role="group" aria-label="Gift tiers">${GIFT_TIERS.map(({ t, name }) => { const l = gifting.tier(t); return `<button type="button" data-tier="${t}" aria-pressed="${st.tier === t}"><b>${name}</b><span>${l.length ? `${l[0].cost.toLocaleString()}–${l[l.length - 1].cost.toLocaleString()}` : ''}</span></button>`; }).join('')}</div>
        <div class="gs-grid" role="radiogroup" aria-label="Gifts">${gifting.tier(st.tier).map((x) => `<button type="button" role="radio" aria-checked="${x.id === st.pick}" class="gs-gift" data-pick="${x.id}"><span class="gs-art tile-t${x.tier}">${giftSvg(x.id, 56)}</span><span class="gs-name">${esc(x.name)}</span><span class="gs-cost">${x.cost.toLocaleString()} Ink</span></button>`).join('')}</div>
        ${g?.allows_note ? `<div class="field gs-note"><label for="gsNote">Add a note <span class="muted">(optional)</span></label><input class="input" id="gsNote" maxlength="120" value="${esc(st.note)}" placeholder="Say something to the writer" autocomplete="off"></div>` : ''}
        <div class="gs-opts">
          <label class="gs-check"><input type="checkbox" id="gsAnon" ${st.anon ? 'checked' : ''}> Send anonymously</label>
          <label class="gs-check"><input type="checkbox" id="gsSound" ${sfx.on() ? 'checked' : ''}> Gift sounds</label>
        </div>
        <p class="gs-fine">${st.anon ? 'You’ll show as Anonymous on the Supporter Wall.' : 'Your name will show on the Supporter Wall.'} ${esc(author?.name || 'The writer')} ${author?.official ? 'runs this site.' : 'keeps 60% of every gift.'}</p>
        <div class="gs-actions">
          <button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button>
          ${enough ? `<button class="btn btn-primary" type="button" id="gsSend" ${st.busy ? 'disabled' : ''}>Send ${esc(g.name)} · ${g.cost.toLocaleString()} Ink</button>` : `<a class="btn btn-primary" href="#/ink" id="gsGet">Not enough Ink · Get more</a>`}
        </div>
      </form>`;
    };
    const repaint = (focusSel) => { paint(); if (focusSel) d.querySelector(focusSel)?.focus(); };

    async function send() {
      const g = gifting.byId(st.pick); if (!g || st.busy) return;
      sfx.prime(); // must happen during the click, before any waiting, or browsers block the sound
      st.busy = true; const btn = d.querySelector('#gsSend'); if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
      try {
        const chapterId = st.target === 'chapter' && chapter ? chapter.id : null;
        await gifting.send({ giftId: g.id, novelId: novel.id, chapterId, anonymous: st.anon, note: g.allows_note ? st.note : '' });
        d.close();
        gfx.play(g.id); sfx.play(g.id);
        toast(`${g.name} sent to ${author.name}${st.anon ? ' anonymously' : ''}`);
        renderShell();
        onSent?.({ gift: g, chapterId });
      } catch (err) { st.busy = false; toast(err.message); repaint('#gsSend'); }
    }

    d.addEventListener('click', (e) => {
      const tgt = e.target.closest('[data-target]'); const tier = e.target.closest('[data-tier]'); const pick = e.target.closest('[data-pick]');
      if (tgt) { st.target = tgt.dataset.target; repaint(`[data-target="${st.target}"]`); return; }
      if (tier) { st.tier = +tier.dataset.tier; st.pick = gifting.tier(st.tier)[0]?.id || st.pick; repaint(`[data-tier="${st.tier}"]`); return; }
      if (pick) { st.pick = pick.dataset.pick; repaint(`[data-pick="${st.pick}"]`); return; }
      if (e.target.closest('#gsSend')) { send(); return; }
      if (e.target.closest('a[href="#/ink"]')) d.close();
    });
    d.addEventListener('change', (e) => {
      if (e.target.id === 'gsAnon') { st.anon = e.target.checked; repaint('#gsAnon'); }
      if (e.target.id === 'gsSound') { sfx.set(e.target.checked); if (e.target.checked) { sfx.prime(); sfx.play('ink'); } }
    });
    d.addEventListener('input', (e) => { if (e.target.id === 'gsNote') st.note = e.target.value; });
    d.addEventListener('submit', (e) => { if (e.submitter?.value !== 'cancel') e.preventDefault(); }); // Enter in the note field must not close the sheet
    d.addEventListener('close', () => d.remove());
    paint(); d.showModal();
    d.querySelector(`[data-pick="${st.pick}"]`)?.focus();
  }

  /* Gift animations. The sender sees them; nothing ever stays over the text.
     With "reduce motion" switched on, the icon just shows for a moment instead. */
  const GIFT_MS = { ribbon: 1100, ink: 1200, postit: 1300, tea: 2200, candle: 2600, cat: 2600, typewriter: 3200, star: 2600, crown: 3000, aurora: 4200, dragon: 4600, phoenix: 5000 };
  const gfx = {
    reduced: () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    bits: (cls, n, style) => Array.from({ length: n }, (_, i) => `<i class="${cls}" style="${style(i, n)}"></i>`).join(''),
    extras(id) {
      const r = (a, b) => (a + Math.random() * (b - a)).toFixed(2);
      const colors = ['#CC1531', '#F5C542', '#3445E6', '#14B8A6', '#F97316', '#A78BFA'];
      switch (id) {
        case 'ink': return '<i class="gfx-ring"></i><i class="gfx-ring r2"></i>';
        case 'tea': return gfx.bits('gfx-steam', 3, (i) => `--x:${-30 + i * 30}px;--d:${0.5 + i * 0.18}s`);
        case 'candle': return '<i class="gfx-glow"></i>';
        case 'cat': return '<i class="gfx-z">z</i><i class="gfx-z z2">z</i>';
        case 'typewriter': return '<span class="gfx-type" id="gfxType"></span>';
        case 'star': return gfx.bits('gfx-spark', 16, (i, n) => { const p = i / n; return `left:${(84 - 74 * p).toFixed(1)}vw;top:${(8 + 72 * p).toFixed(1)}vh;--d:${(0.15 + p * 1.5).toFixed(2)}s`; });
        case 'crown': return gfx.bits('gfx-burst', 12, (i, n) => `--a:${Math.round((360 / n) * i)}deg;--d:1.15s`);
        case 'aurora': return '<i class="gfx-band b1"></i><i class="gfx-band b2"></i><i class="gfx-band b3"></i>' + gfx.bits('gfx-twinkle', 14, () => `left:${r(4, 96)}vw;top:${r(4, 40)}vh;--d:${r(0, 2)}s`);
        case 'dragon': return gfx.bits('gfx-conf', 34, () => `left:${r(10, 95)}vw;--d:${r(0.8, 2.6)}s;--c:${colors[Math.floor(Math.random() * colors.length)]};--r:${r(-200, 200)}deg`);
        case 'phoenix': return gfx.bits('gfx-ember', 30, () => `left:${r(30, 70)}vw;--d:${r(0, 1.4)}s;--x:${r(-60, 60)}px`) + gfx.bits('gfx-feather', 18, () => `left:${r(15, 85)}vw;--d:${r(3.4, 4.2)}s;--x:${r(-80, 80)}px;--r:${r(-90, 90)}deg`);
        default: return '';
      }
    },
    play(id) {
      const g = gifting.byId(id); if (!g) return;
      $$('.gfx, .gfx-skip').forEach((x) => x.remove());
      const reduced = gfx.reduced();
      const el = document.createElement('div');
      el.className = `gfx gfx-t${g.tier} ${reduced ? 'gfx-still' : 'gfx-' + id}`;
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = `${g.tier === 4 && !reduced ? '<i class="gfx-dim"></i>' : ''}${reduced ? '' : gfx.extras(id)}<div class="gfx-art">${giftSvg(id, 200)}</div>`;
      document.body.appendChild(el);
      let skip = null, typer = null;
      const end = () => { clearTimeout(timer); clearInterval(typer); el.remove(); skip?.remove(); };
      const timer = setTimeout(end, reduced ? 1400 : GIFT_MS[id] || 2000);
      if (g.tier === 4 && !reduced) {
        skip = document.createElement('button'); skip.type = 'button'; skip.className = 'gfx-skip'; skip.textContent = 'Skip';
        skip.addEventListener('click', end); el.addEventListener('click', end); document.body.appendChild(skip);
      }
      if (id === 'typewriter' && !reduced) {
        const text = 'THANK YOU!'; let i = 0; const out = $('#gfxType');
        setTimeout(() => { typer = setInterval(() => { out.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(typer); }, 160); }, 250);
      }
    },
  };

  /* Gift sounds, made in the browser with Web Audio (no sound files to license or download).
     Off until the reader switches them on in the gift sheet. Replace with real recordings later if you like. */
  const sfx = {
    ctx: null, out: null, buf: null,
    on() { try { return localStorage.getItem('sfb.giftSound') === 'on'; } catch { return false; } },
    set(v) { try { localStorage.setItem('sfb.giftSound', v ? 'on' : 'off'); } catch {} },
    prime() {
      if (!sfx.on()) return null;
      if (!sfx.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
        sfx.ctx = new AC(); sfx.out = sfx.ctx.createGain(); sfx.out.gain.value = 0.7; sfx.out.connect(sfx.ctx.destination);
      }
      if (sfx.ctx.state === 'suspended') sfx.ctx.resume();
      return sfx.ctx;
    },
    env(g, t, dur, vol, attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); },
    tone(f, t, dur, { type = 'sine', vol = 0.1, to = null, attack = 0.006 } = {}) {
      const a = sfx.ctx, o = a.createOscillator(), g = a.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      sfx.env(g, t, dur, vol, Math.min(attack, dur / 2)); o.connect(g).connect(sfx.out); o.start(t); o.stop(t + dur + 0.05);
    },
    noise(t, dur, { freq = 1500, to = null, vol = 0.1, type = 'bandpass', q = 1 } = {}) {
      const a = sfx.ctx;
      if (!sfx.buf) { sfx.buf = a.createBuffer(1, a.sampleRate, a.sampleRate); const ch = sfx.buf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; }
      const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
      s.buffer = sfx.buf; s.loop = true; f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(freq, t); if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
      sfx.env(g, t, dur, vol, Math.min(0.01, dur / 3)); s.connect(f).connect(g).connect(sfx.out); s.start(t); s.stop(t + dur + 0.05);
    },
    purr(t, dur) {
      const a = sfx.ctx, o = a.createOscillator(), lp = a.createBiquadFilter(), am = a.createGain(), lfo = a.createOscillator(), depth = a.createGain(), g = a.createGain();
      o.type = 'sawtooth'; o.frequency.value = 52; lp.type = 'lowpass'; lp.frequency.value = 280;
      am.gain.value = 0.5; lfo.frequency.value = 24; depth.gain.value = 0.5; lfo.connect(depth).connect(am.gain);
      sfx.env(g, t, dur, 0.22, 0.3); o.connect(lp).connect(am).connect(g).connect(sfx.out);
      o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    },
    play(id) { const a = sfx.prime(); if (!a) return; try { (SOUNDS[id] || noop)(a.currentTime + 0.03); } catch {} },
  };
  const SOUNDS = {
    ribbon: (t) => sfx.noise(t, 0.4, { freq: 2600, to: 1200, vol: 0.08 }),
    ink: (t) => { sfx.tone(1100, t, 0.12, { to: 380, vol: 0.18 }); sfx.tone(700, t + 0.1, 0.25, { to: 300, vol: 0.05 }); },
    postit: (t) => { sfx.noise(t, 0.2, { freq: 4000, vol: 0.06, type: 'highpass' }); sfx.noise(t + 0.22, 0.05, { freq: 900, vol: 0.2 }); },
    tea: (t) => { sfx.noise(t, 0.7, { freq: 700, to: 1500, vol: 0.07, type: 'lowpass' }); sfx.tone(2600, t + 0.8, 0.45, { type: 'triangle', vol: 0.08 }); sfx.tone(3900, t + 0.8, 0.3, { vol: 0.04 }); },
    candle: (t) => { sfx.noise(t, 0.14, { freq: 3200, vol: 0.18, type: 'highpass' }); for (let i = 0; i < 9; i++) sfx.noise(t + 0.3 + i * 0.17 + Math.random() * 0.08, 0.03, { freq: 2000, vol: 0.05 }); },
    cat: (t) => sfx.purr(t, 2),
    typewriter: (t) => { for (let i = 0; i < 10; i++) sfx.noise(t + 0.25 + i * 0.16, 0.035, { freq: 3500, vol: 0.14 }); sfx.tone(1760, t + 2.05, 0.9, { vol: 0.12 }); sfx.tone(2637, t + 2.05, 0.6, { vol: 0.04 }); },
    star: (t) => { sfx.tone(500, t, 1.3, { to: 1800, vol: 0.05, type: 'triangle' }); sfx.noise(t, 1.3, { freq: 1500, to: 6000, vol: 0.04 }); [2093, 2637, 3136].forEach((f, i) => sfx.tone(f, t + 1.35 + i * 0.07, 0.6, { vol: 0.06 })); },
    crown: (t) => { sfx.tone(523, t + 0.5, 0.35, { type: 'sawtooth', vol: 0.05 }); sfx.tone(784, t + 0.85, 0.6, { type: 'sawtooth', vol: 0.05 }); sfx.tone(3136, t + 1.5, 0.5, { vol: 0.05 }); },
    aurora: (t) => [220, 277, 330, 440].forEach((f) => sfx.tone(f, t, 3.8, { vol: 0.035, attack: 1.2 })),
    dragon: (t) => { for (let i = 0; i < 4; i++) sfx.noise(t + i * 0.12, 0.08, { freq: 2500, vol: 0.06 }); for (let i = 0; i < 5; i++) sfx.noise(t + 0.8 + i * 0.5, 0.25, { freq: 400, vol: 0.1, type: 'lowpass' }); sfx.tone(110, t + 2.3, 0.7, { type: 'sawtooth', to: 80, vol: 0.06 }); },
    phoenix: (t) => { sfx.noise(t, 1.7, { freq: 300, to: 2500, vol: 0.09, type: 'lowpass' }); sfx.tone(1200, t + 1.7, 0.5, { to: 1900, vol: 0.07, type: 'triangle' }); [1568, 2093, 2637, 3136, 4186].forEach((f, i) => sfx.tone(f, t + 2.4 + i * 0.09, 0.5, { vol: 0.04 })); },
  };

  /* 6n. Ink page --------------------------------------------------------------- */
  route('/ink', async ({ app }) => {
    setTitle('Ink');
    if (!gifting.ready) { app.innerHTML = '<div class="page"><h1>Gifts are coming soon</h1><p class="muted">Sending gifts to writers isn’t open yet. Nothing can be bought right now, and you haven’t been charged for anything.</p><a class="btn btn-ghost btn-sm" href="#/browse">Browse series</a></div>'; return; }
    if (!requireAuth('/ink')) return;
    const status = new URLSearchParams(location.search).get('ink'); // set by Stripe's return link
    if (status) history.replaceState(null, '', location.pathname + location.hash);
    if (!gifting.ready) { app.innerHTML = '<div class="page"><h1>Gifts are coming soon</h1><p class="muted">Sending gifts to writers isn’t open yet. Nothing can be bought right now, and you haven’t been charged for anything.</p><a class="btn btn-ghost btn-sm" href="#/browse">Browse series</a></div>'; return; }
    await gifting.refreshWallet();
    app.innerHTML = `<div class="ink-page">
      <header class="studio-head"><div><h1>Ink</h1><p class="lead">Ink is how you send gifts to writers. Writers keep 60% of every gift.</p></div>
        <div class="ink-balance"><span>Your balance</span><b id="inkBal">${ICON_DROP}${gifting.ink.toLocaleString()}</b></div></header>
      ${status === 'paid' ? '<div class="pub-state live" id="inkStatus" role="status">Payment received. Adding your Ink…</div>' : status === 'canceled' ? '<div class="pub-state" role="status">Checkout canceled. You weren’t charged.</div>' : ''}
      <ul class="ink-packs">${gifting.packs.map((p) => `<li>
        <span class="ink-pack-art">${giftSvg('ink', 48)}</span>
        <span class="ink-amt">${p.ink.toLocaleString()} Ink</span>
        <span class="ink-label">${p.label ? `<span class="badge badge-up">${esc(p.label)}</span>` : ''}</span>
        <button class="btn btn-primary btn-block" data-pack="${esc(p.id)}">${money(p.price_cents)}</button></li>`).join('')}</ul>
      <section class="card ink-rules"><h2>Good to know</h2><ul>
        <li>Ink can only be spent on gifts. It has no cash value and can’t be cashed out or transferred.</li>
        <li>An Ink pack can be refunded within 14 days if none of it has been spent. Email <a href="mailto:storiesfrombeyondofficial@gmail.com">storiesfrombeyondofficial@gmail.com</a>.</li>
        <li>Spent Ink can’t be refunded. Unspent Ink is removed if you delete your account.</li>
        <li>You can buy up to $100 of Ink in 24 hours.</li>
        <li>Payments are handled by Stripe. Stories From Beyond never sees your card details.</li>
      </ul></section></div>`;

    $$('[data-pack]', app).forEach((b) => b.addEventListener('click', async () => {
      const label = b.textContent; $$('[data-pack]', app).forEach((x) => { x.disabled = true; }); b.textContent = 'Opening checkout…';
      try { await gifting.checkout(b.dataset.pack); } catch (err) { toast(err.message); $$('[data-pack]', app).forEach((x) => { x.disabled = false; }); b.textContent = label; }
    }));

    if (status === 'paid') {
      let stopped = false; cleanup = () => { stopped = true; };
      for (let i = 0; i < 10 && !stopped; i++) {
        const last = await gifting.lastPurchase().catch(() => null);
        if (last?.status === 'paid') {
          await gifting.refreshWallet(); if (stopped) return;
          $('#inkBal').innerHTML = `${ICON_DROP}${gifting.ink.toLocaleString()}`;
          $('#inkStatus').textContent = `${last.ink.toLocaleString()} Ink added. Your balance is ${gifting.ink.toLocaleString()} Ink.`;
          renderShell(); return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!stopped) $('#inkStatus').textContent = 'Your payment went through. Ink can take a minute to arrive. Refresh this page shortly.';
    }
  });

  /* Boot --------------------------------------------------------------------- */
  async function init() {
    $('#app').innerHTML = '<div class="page"><p class="muted">Loading stories…</p></div>';
    // What the email link put in the address bar: sign-up confirmation, password reset, or an error like an expired link.
    const recovery = /type=recovery/.test(BOOT_HASH);
    const authErr = /error_description=([^&]+)/.exec(BOOT_HASH);
    const fromEmail = /access_token=|error_description=|type=(signup|recovery|magiclink|email_change|invite)/.test(BOOT_HASH);
    try {
      const { data } = await sb.auth.getSession(); // also finishes an email-link login
      sessionUid = data.session?.user?.id || null;
      await sb.rpc('release_due_chapters').then(noop, noop); // publish anything whose scheduled time has passed
      await loadAll();
      if (data.session) await ensureProfile(data.session.user);
    } catch (err) {
      console.error(err);
      $('#app').innerHTML = `<div class="page"><h1>Couldn’t load stories</h1><p class="muted">Something went wrong reaching the server. Check your connection and reload the page.</p><button class="btn btn-sm" onclick="location.reload()">Reload</button></div>`;
      return;
    }
    if (fromEmail) {
      let target = '#/';
      if (recovery && sessionUid) target = '#/reset-password';
      else if (authErr) {
        const msg = decodeURIComponent(authErr[1].replace(/\+/g, ' '));
        if (/expired|invalid/i.test(msg)) target = recovery || /recovery|reset/i.test(BOOT_HASH) ? '#/forgot?expired=1' : '#/login';
        setTimeout(() => toast(/expired|invalid/i.test(msg) ? 'That email link expired or was already used.' : msg), 300);
      } else if (sessionUid) setTimeout(() => toast('Email confirmed. You are logged in.'), 300);
      history.replaceState(null, '', location.pathname + location.search + target);
    }
    sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && parseHash().path !== '/reset-password') go('/reset-password');
      if (event === 'SIGNED_OUT' && sessionUid) { sessionUid = null; loadAll().then(render, noop); }
    });
    window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Something went wrong. Try again.'));
    $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#searchInput').value.trim(); go(q ? `/browse?q=${encodeURIComponent(q)}` : '/browse'); });
    // Any element with data-report="type" opens the report window (series, chapters, comments, reviews, profiles).
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-report]'); if (!b) return;
      e.preventDefault(); openReportDialog({ type: b.dataset.report, id: b.dataset.reportId, label: b.dataset.reportLabel });
    });
    window.addEventListener('hashchange', render);
    initAccountMenu();
    theme.apply();
    window.addEventListener('storage', (e) => { if (e.key === THEME_KEY) theme.apply(); }); // theme changed in another tab
    if (!location.hash) location.hash = '#/';
    render();
  }
  init();
})();
