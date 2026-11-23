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
  const stripHtml = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent || ''; };
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

  const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'H2', 'H3', 'BLOCKQUOTE', 'HR', 'UL', 'OL', 'LI']);
  function sanitize(html) {
    const root = document.createElement('div'); root.innerHTML = html || '';
    const walk = (node) => Array.from(node.childNodes).forEach((c) => {
      if (c.nodeType === 3) return;
      if (c.nodeType !== 1) { c.remove(); return; }
      walk(c);
      let tag = c.tagName; if (tag === 'DIV') tag = 'P'; if (/^H[1456]$/.test(tag)) tag = 'H3';
      if (!ALLOWED.has(tag)) { c.replaceWith(...c.childNodes); return; }
      const clean = document.createElement(tag); clean.append(...c.childNodes); c.replaceWith(clean);
    });
    walk(root);
    Array.from(root.childNodes).forEach((n) => { if (n.nodeType === 3) { if (n.textContent.trim()) { const p = document.createElement('p'); n.replaceWith(p); p.append(n); } else n.remove(); } });
    return root.innerHTML;
  }

  /* 2. Supabase connection + in-memory cache ------------------------------
     Everything is loaded from Supabase at start-up into `db`, so the views can
     read synchronously. Every write goes to Supabase first, then updates `db`.
     Row level security (supabase-schema.sql) decides who may change what. */
  const SUPABASE_URL = 'https://roeibtcsrgegskslvlbd.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_4g7D5_4SCj2GiEgue6fbgg_veUSxtmq';
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const FEATURED_KEY = 'sfb.featured';
  const noop = () => {};
  let db = null;
  let sessionUid = null;

  /** Await a Supabase query; throw a readable error if it failed. */
  async function must(q) { const { data, error } = await q; if (error) throw new Error(error.message || 'Something went wrong talking to the server.'); return data; }

  const TABLES = ['profiles', 'novels', 'chapters', 'chapter_comments', 'chapter_likes', 'subscriptions', 'favorites', 'notifications', 'friendships', 'reading_progress'];
  async function loadAll() {
    const res = await Promise.all(TABLES.map((t) => sb.from(t).select('*').limit(5000)));
    const bad = res.find((r) => r.error); if (bad) throw new Error(bad.error.message);
    const [users, novels, chapters, chapter_comments, chapter_likes, subscriptions, favorites, notifications, friendships, progress] = res.map((r) => r.data || []);
    const reading_progress = {}, reading_log = {};
    progress.forEach((p) => {
      (reading_progress[p.user_id] ||= {})[p.novel_id] = p.chapter_id;
      if (!reading_log[p.user_id] || reading_log[p.user_id].at < p.at) reading_log[p.user_id] = { novel_id: p.novel_id, chapter_id: p.chapter_id, at: p.at };
    });
    let featured_daily = null; try { featured_daily = JSON.parse(localStorage.getItem(FEATURED_KEY)); } catch {}
    db = {
      users, chapters, chapter_comments, chapter_likes, subscriptions, favorites, notifications, reading_progress, reading_log, featured_daily,
      novels: novels.map((n) => ({ ...n, genres: n.genres || [], tags: n.tags || [] })),
      friendships: friendships.map((f) => ({ ...f, from: f.from_id, to: f.to_id })),
    };
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
      bySlug: (slug) => db.novels.find((n) => n.slug === slug),
      published: (novelId) => db.chapters.filter((c) => c.novel_id === novelId && c.status === 'published').sort((a, b) => a.chapter_number - b.chapter_number),
      all: (novelId) => db.chapters.filter((c) => c.novel_id === novelId).sort((a, b) => a.chapter_number - b.chapter_number),
      isPublic: (n) => n.status !== 'draft' && api.novels.published(n.id).length > 0,
      listPublic: () => db.novels.filter(api.novels.isPublic),
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
        if (patch.title !== undefined) { const base = slugify(patch.title || 'untitled'); let s = base, i = 2; while (db.novels.some((x) => x.slug === s && x.id !== id)) s = `${base}-${i++}`; p.slug = s; }
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
      recordView(novelId, chapterId) {
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
        await must(sb.from('chapters').update(cp).eq('id', id)); Object.assign(c, cp);
        const novelWentLive = n.status === 'draft';
        const np = { last_published_at: t, updated_at: t, ...(novelWentLive ? { status: 'ongoing' } : {}) };
        await must(sb.from('novels').update(np).eq('id', n.id)); Object.assign(n, np);
        const notified = first ? (await must(sb.rpc('notify_new_chapter', { p_chapter: id }))) || 0 : 0;
        return { chapter: c, novel: n, novelWentLive, notified };
      },
      async unpublish(id) { const p = { status: 'draft', updated_at: now() }; await must(sb.from('chapters').update(p).eq('id', id)); Object.assign(api.chapters.byId(id), p); },
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
      unread: (userId) => db.notifications.filter((n) => n.user_id === userId && !n.read_at).length,
      async markAllRead(userId) {
        if (!api.notifications.unread(userId)) return; const t = now();
        await must(sb.from('notifications').update({ read_at: t }).eq('user_id', userId).is('read_at', null));
        db.notifications.forEach((n) => { if (n.user_id === userId && !n.read_at) n.read_at = t; });
      },
    },
    progress: {
      get: (userId, novelId) => db.reading_progress?.[userId]?.[novelId] || null,
      set(userId, novelId, chapterId) {
        const at = now();
        (db.reading_progress[userId] ||= {})[novelId] = chapterId;
        db.reading_log[userId] = { novel_id: novelId, chapter_id: chapterId, at }; // most recent read, shown to friends
        if (userId === sessionUid) sb.from('reading_progress').upsert({ user_id: userId, novel_id: novelId, chapter_id: chapterId, at }).then(noop, noop);
      },
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
    /** Featured: the top 5 up-and-coming series, picked once per local day (remembered in this browser). */
    featured: {
      today: () => new Date().toLocaleDateString('en-CA'),
      nextRefresh: () => { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); },
      picks() {
        const day = api.featured.today();
        const cached = db.featured_daily;
        if (cached?.date === day) { const list = cached.ids.map(api.novels.byId).filter((n) => n && api.novels.isPublic(n)); if (list.length) return list; }
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
  };

  /* 5. Router + shell ----------------------------------------------------- */
  const routes = [];
  const route = (pattern, handler) => { const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$'); routes.push({ re, keys, handler }); };
  const go = (h) => { location.hash = h; };
  const parseHash = () => { const raw = location.hash.replace(/^#/, '') || '/'; const [path, qs] = raw.split('?'); return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) }; };
  const setTitle = (t) => { document.title = t ? `${t} · Stories From Beyond` : 'Stories From Beyond'; };
  let cleanup = null; // per-view teardown (observers, scroll listeners)

  async function render() {
    if (cleanup) { cleanup(); cleanup = null; }
    document.body.classList.remove('reading', 'home');
    const { path, query } = parseHash(); const app = $('#app');
    const si = $('#searchInput'); if (si && document.activeElement !== si) si.value = path === '/browse' ? (query.q || '') : '';
    for (const r of routes) {
      const m = path.match(r.re);
      if (m) { const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); app.innerHTML = ''; await r.handler({ params, query, app }); if (!app.dataset.keepScroll) window.scrollTo(0, 0); delete app.dataset.keepScroll; renderShell(); return; }
    }
    notFound(app, 'That page does not exist.'); renderShell();
  }
  function notFound(app, msg) { setTitle('Not found'); app.innerHTML = `<div class="page"><h1>Not available</h1><p class="muted">${esc(msg)} <a href="#/" style="color:var(--ultra);font-weight:600">Back home</a>.</p></div>`; }

  function renderShell() {
    const u = auth.current(); const { path } = parseHash();
    const unread = u ? api.notifications.unread(u.id) + api.friends.incoming(u.id).length : 0;
    $('#accountMenu').innerHTML = u
      ? `<a class="bell" href="#/notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>${unread ? `<span class="dot">${unread > 9 ? '9+' : unread}</span>` : ''}</a>
         <a class="avatar" href="#/u/${esc(u.username)}" aria-label="Your profile">${esc(initials(u.name))}</a>`
      : `<a class="btn btn-ghost btn-sm" href="#/login">Log in</a><a class="btn btn-sm" href="#/signup">Sign up</a>`;
    $$('[data-auth="in"]').forEach((el) => { el.style.display = u ? '' : 'none'; });
    $$('.topnav a').forEach((a) => { const h = a.getAttribute('href').slice(1); a.classList.toggle('active', h === '/' ? path === '/' : path.startsWith(h)); });
  }
  function requireAuth(next) { if (auth.current()) return true; go('/login?next=' + encodeURIComponent(next || parseHash().path)); return false; }

  /* 6. Partials ------------------------------------------------------------ */
  const thumb = (n, { sm = false, badge = true } = {}) => {
    const b = badge ? (api.novels.hasUpToday(n) ? '<span class="badge badge-up">UP</span>' : api.novels.isNew(n) ? '<span class="badge badge-new">NEW</span>' : '') : '';
    return `<div class="thumb ${sm ? 'sm' : ''} ${n.cover_image ? 'has-image' : ''}" style="--cv:${esc(n.cover_color)};${n.cover_image ? `background-image:url('${esc(n.cover_image)}')` : ''}" aria-hidden="true">${b}${n.cover_image ? '' : `<span class="big">${esc(initial(n.title))}</span>`}<span class="tt">${esc(n.title || 'Untitled')}</span></div>`;
  };
  const sCard = (n) => { const a = api.users.byId(n.author_id); const st = api.novels.stats(n); return `<a class="s-card" href="#/novel/${esc(n.slug)}">${thumb(n)}<div class="st">${esc(n.title)}</div><div class="sm">${nm(a)} · ${compact(st.subs)} ${pl(st.subs, 'subscriber')}</div></a>`; };
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
          <ul class="feat-stats"><li><b>${compact(st.subs)}</b> ${pl(st.subs, 'subscriber')}</li><li><b>${st.chapters}</b> ${st.chapters === 1 ? 'chapter' : 'chapters'}</li><li><b>${compact(st.likes)}</b> ${pl(st.likes, 'like')}</li></ul>
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
        const chs = api.novels.published(n.id); const prog = api.progress.get(me.id, n.id); const at = prog ? chs.findIndex((c) => c.id === prog) + 1 : 0;
        const pct = chs.length ? Math.round((at / chs.length) * 100) : 0;
        return `<li class="fav"><a href="#/novel/${esc(n.slug)}" tabindex="-1" aria-hidden="true">${thumb(n, { sm: true })}</a><div class="fav-main"><a class="fav-t" href="#/novel/${esc(n.slug)}">${esc(n.title)}</a>
          <div class="fav-m">${esc(n.genres[0] || '')}${n.genres[0] ? ', ' : ''}${compact(api.novels.subscribers(n))} ${pl(api.novels.subscribers(n), 'subscriber')}</div>
          <div class="fav-m">${at ? `Read ${at} of ${chs.length}` : `${plural(chs.length, 'chapter')}, not started`}</div>
          <div class="fav-bar" aria-hidden="true"><i style="width:${pct}%"></i></div></div>
          <a class="go" href="#/novel/${esc(n.slug)}/ch/${at && at < chs.length ? at + 1 : Math.max(at, 1)}" aria-label="${at ? 'Continue' : 'Start'} ${esc(n.title)}">${ICON_PLAY}</a></li>`;
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
    const sel = parseInt(params.d, 10) % 7; const today = new Date().getDay();
    setTitle(`${DAYS_LONG[sel]} releases`);
    const list = api.novels.listPublic().filter((n) => n.update_day === sel).sort((a, b) => api.novels.stats(b).trend - api.novels.stats(a).trend);
    app.innerHTML = `<section class="sched"><div class="sched-head"><h1>Release schedule</h1></div>
      <nav class="days" aria-label="Release days">${[1, 2, 3, 4, 5, 6, 0].map((d) => dayLink(d, sel, today)).join('')}</nav>
      <h2 style="margin:22px 0 4px">${DAYS_LONG[sel]}${sel === today ? ' · today' : ''}<span class="sub muted" style="font-weight:400;font-size:var(--t-sm);margin-left:8px">${plural(list.length, 'series', 'series')}</span></h2>
      <div class="grid">${list.map(sCard).join('') || `<div class="empty" style="grid-column:1/-1"><h3>Nothing releases on ${DAYS_LONG[sel]}s yet</h3><p>Authors choose a release day in the Studio.</p></div>`}</div></section>`;
  });

  /* 6c. Browse ------------------------------------------------------------- */
  route('/browse', async ({ app, query }) => {
    setTitle('Browse');
    const q = (query.q || '').trim().toLowerCase(); const genre = query.genre || ''; const sort = query.sort || 'trending';
    let list = api.novels.listPublic().map((n) => ({ n, st: api.novels.stats(n), a: api.users.byId(n.author_id) }));
    if (q) list = list.filter(({ n, a }) => [n.title, n.synopsis, a.name, a.username, ...n.tags, ...n.genres].join(' ').toLowerCase().includes(q));
    if (genre) list = list.filter(({ n }) => n.genres.includes(genre));
    list.sort((x, y) => sort === 'updated' ? (y.n.last_published_at || 0) - (x.n.last_published_at || 0) : sort === 'new' ? y.n.created_at - x.n.created_at : sort === 'subs' ? y.st.subs - x.st.subs : y.st.trend - x.st.trend);
    const link = (patch) => '#/browse?' + new URLSearchParams(Object.fromEntries(Object.entries({ q: query.q, genre, sort, ...patch }).filter(([, v]) => v))).toString();
    app.innerHTML = `<div class="browse-head"><div><h1>${q ? `Results for “${esc(query.q)}”` : genre ? esc(genre) : 'All series'}</h1><p class="muted small" style="margin:4px 0 0">${plural(list.length, 'series', 'series')}</p></div>
      <select class="select" id="sortSel" aria-label="Sort" style="width:auto"><option value="trending" ${sort === 'trending' ? 'selected' : ''}>Trending</option><option value="subs" ${sort === 'subs' ? 'selected' : ''}>Most subscribed</option><option value="updated" ${sort === 'updated' ? 'selected' : ''}>Recently updated</option><option value="new" ${sort === 'new' ? 'selected' : ''}>Newest</option></select></div>
      <div class="chip-set"><a class="chip ${!genre ? 'on' : ''}" href="${link({ genre: '' })}">All</a>${GENRES.map((g) => `<a class="chip ${genre === g ? 'on' : ''}" href="${link({ genre: g })}">${esc(g)}</a>`).join('')}</div>
      <div class="grid">${list.map(({ n }) => sCard(n)).join('') || `<div class="empty" style="grid-column:1/-1"><h3>No series match</h3><p>Try another word or clear the genre.</p><a class="btn btn-ghost btn-sm" href="#/browse">Clear filters</a></div>`}</div>`;
    $('#sortSel').addEventListener('change', (e) => go(link({ sort: e.target.value })));
  });

  /* 6d. Novel landing page -------------------------------------------------- */
  route('/novel/:slug', async ({ app, params, query }) => {
    const n = api.novels.bySlug(params.slug); const me = auth.current();
    if (!n) return notFound(app, 'That series does not exist.');
    const mine = me && me.id === n.author_id;
    if (!api.novels.isPublic(n) && !mine) return notFound(app, 'This series has not been published yet.');
    setTitle(n.title);
    const a = api.users.byId(n.author_id); const chs = api.novels.published(n.id); const st = api.novels.stats(n);
    const subbed = me ? api.subscriptions.has(me.id, n.id) : false;
    const faved = me ? api.favorites.has(me.id, n.id) : false;
    const prog = me ? api.progress.get(me.id, n.id) : null; const progIdx = prog ? chs.findIndex((c) => c.id === prog) : -1;
    const readSet = me ? api.progress.readSet(me.id) : new Set();
    const asc = query.sort === 'asc';
    const list = asc ? chs : [...chs].reverse();
    app.innerHTML = `
      ${mine && !api.novels.isPublic(n) ? `<div class="pub-state" style="margin-top:16px">Draft preview. Only you can see this. <a href="#/studio/novel/${n.id}">Manage in Studio</a></div>` : ''}
      <div class="series-band" style="--cv:${esc(n.cover_color)}">
        <div class="series-top">${thumb(n, { badge: false })}
          <div><div class="chip-set" style="margin-bottom:8px">${n.genres.map((g) => `<a class="chip" href="#/browse?genre=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}</div>
            <h1>${esc(n.title)}</h1><div class="by">by <a href="#/u/${esc(a.username)}">${nm(a)}</a></div>
            <div class="series-meta"><span><b>${compact(st.subs)}</b> ${pl(st.subs, 'subscriber')}</span><span><b>${compact(st.views)}</b> ${pl(st.views, 'view')}</span><span><b>${compact(st.likes)}</b> ${pl(st.likes, 'like')}</span><span>${n.status === 'completed' ? '<b>Completed</b>' : n.update_day === null ? '<b>Ongoing</b>' : `Updates <b>${DAYS_LONG[n.update_day]}s</b>`}</span></div>
            <div class="series-cta">
              ${chs.length ? `<a class="btn btn-primary btn-lg" href="#/novel/${esc(n.slug)}/ch/${progIdx > 0 ? progIdx + 1 : 1}">${progIdx > 0 ? `Continue · Ch. ${progIdx + 1}` : 'Read first chapter'}</a>` : '<span></span>'}
              <button class="btn btn-ghost btn-lg sub-btn" id="subBtn" aria-pressed="${subbed}">${subbed ? '✓ Subscribed' : '+ Subscribe'}</button>
              <button class="btn btn-ghost btn-lg fav-btn" id="favBtn" aria-pressed="${faved}">${faved ? '★ Favorited' : '☆ Favorite'}</button>
            </div></div></div></div>
      <div class="series-body series-layout">
        <div>
          <div class="ep-head"><h2>${plural(chs.length, 'chapter')}</h2><button class="btn btn-soft btn-sm" id="sortBtn">${asc ? 'Oldest first' : 'Newest first'}</button></div>
          <ol class="ep-list">${list.map((c) => { const i = chs.indexOf(c); const isNew = c.published_at > now() - 7 * DAY; return `<li class="${readSet.has(c.id) ? 'read' : ''}"><a href="#/novel/${esc(n.slug)}/ch/${i + 1}"><span class="n"><small>Ch.</small>${i + 1}</span><div><div class="t">${esc(c.title)}${isNew ? '<span class="badge badge-up">NEW</span>' : ''}</div><div class="m">${esc(fmtDate(c.published_at))} · ${readMin(wordCount(c.content))} min · ♥ ${compact(c.likes)}</div></div><span class="r">${readSet.has(c.id) ? 'Read' : ''}</span></a></li>`; }).join('') || '<li class="muted small" style="padding:12px 0">No chapters published yet.</li>'}</ol>
        </div>
        <aside>
          <h2 style="font-size:var(--t-md);margin:24px 0 8px">About</h2>
          <p class="series-syn clamp" id="syn">${esc(n.synopsis) || '<span class="muted">No synopsis yet.</span>'}</p><button class="series-more" id="synMore">Read more</button>
          <div class="chip-set" style="margin-top:12px">${n.tags.map((t) => `<a class="chip" href="#/browse?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}</div>
          <a class="author-row" href="#/u/${esc(a.username)}"><span class="avatar lg" aria-hidden="true">${esc(initials(a.name))}</span><div><div class="n">${nm(a)}</div><div class="b">${esc(a.bio) || 'No bio yet.'}</div></div></a>
          ${mine ? `<a class="btn btn-ghost btn-block" style="margin-top:14px" href="#/studio/novel/${n.id}">Edit in Studio</a>` : ''}
        </aside></div>`;
    $('#sortBtn').addEventListener('click', () => go(`/novel/${n.slug}${asc ? '' : '?sort=asc'}`));
    $('#synMore').addEventListener('click', () => { const s = $('#syn'); s.classList.toggle('clamp'); $('#synMore').textContent = s.classList.contains('clamp') ? 'Read more' : 'Show less'; });
    $('#subBtn').addEventListener('click', async () => {
      if (!requireAuth()) return;
      const on = await api.subscriptions.toggle(me.id, n.id);
      toast(on ? `Subscribed. You will be notified when ${a.name} posts a new chapter.` : 'Unsubscribed'); render();
    });
    $('#favBtn').addEventListener('click', async () => {
      if (!requireAuth()) return;
      const on = await api.favorites.toggle(me.id, n.id);
      toast(on ? `Added ${n.title} to your favorites` : `Removed ${n.title} from your favorites`); render();
    });
  });

  /* 6e. Reader (continuous scroll) ------------------------------------------ */
  const prefs = {
    get: () => { try { return { theme: 'light', size: 18, lh: 'normal', font: 'serif', ...JSON.parse(localStorage.getItem('sfb.prefs') || localStorage.getItem('chapterhouse.v2.prefs') || '{}') }; } catch { return { theme: 'light', size: 18, lh: 'normal', font: 'serif' }; } },
    set: (p) => { try { localStorage.setItem('sfb.prefs', JSON.stringify({ ...prefs.get(), ...p })); localStorage.removeItem('chapterhouse.v2.prefs'); } catch {} },
  };
  const LH = { tight: 1.5, normal: 1.7, loose: 1.95 };

  route('/novel/:slug/ch/:n', async ({ app, params }) => {
    const n = api.novels.bySlug(params.slug); const me = auth.current();
    if (!n) return notFound(app, 'That series does not exist.');
    const mine = me && me.id === n.author_id;
    if (!api.novels.isPublic(n) && !mine) return notFound(app, 'This series has not been published yet.');
    const chs = api.novels.published(n.id); const startIdx = parseInt(params.n, 10) - 1;
    if (!chs[startIdx]) return notFound(app, 'That chapter does not exist.');
    const a = api.users.byId(n.author_id); const p = prefs.get();
    document.body.classList.add('reading');

    const svgBack = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
    const svgList = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';
    const svgType = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>';

    app.innerHTML = `<div class="reader" id="reader" data-theme="${esc(p.theme)}" data-font="${esc(p.font)}" style="--rd-size:${p.size}px;--rd-lh:${LH[p.lh] || 1.7}">
      <div class="rd-progress" id="rdProgress"></div>
      <div class="rd-top" id="rdTop"><div class="rd-top-in">
        <a class="back" href="#/novel/${esc(n.slug)}" aria-label="Back to series">${svgBack}</a>
        <div class="meta"><div class="s">${esc(n.title)}</div><div class="e" id="rdNow"></div></div>
        <button class="tool" id="rdSettingsBtn" aria-expanded="false" aria-controls="rdSettings" aria-label="Reading settings">${svgType}</button>
        <a class="tool" href="#/novel/${esc(n.slug)}" aria-label="Chapter list">${svgList}</a>
      </div></div>
      <div class="rd-settings" id="rdSettings" hidden>
        <div class="grp"><div class="lbl">Theme</div><div class="seg" id="segTheme">
          <button data-v="light" aria-pressed="${p.theme === 'light'}"><span class="sw" style="background:#fff"></span>Light</button>
          <button data-v="sepia" aria-pressed="${p.theme === 'sepia'}"><span class="sw" style="background:#f3ead8"></span>Sepia</button>
          <button data-v="dark" aria-pressed="${p.theme === 'dark'}"><span class="sw" style="background:#121317"></span>Dark</button></div></div>
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
          <button class="subq" data-sub aria-pressed="${me ? api.subscriptions.has(me.id, n.id) : false}">${me && api.subscriptions.has(me.id, n.id) ? '✓ Subscribed' : '+ Subscribe'}</button>
          <span class="sp"></span>
          ${idx + 1 < chs.length ? `<a href="#/novel/${esc(n.slug)}/ch/${idx + 2}" data-next="${idx + 1}">Next chapter</a>` : ''}
        </div>
        <section class="ep-comments" id="cmts-${c.id}"></section>
        ${idx + 1 < chs.length ? `<div class="ep-next" data-sentinel="${idx + 1}"></div>` : `<div class="ep-end"><b>You are caught up</b>${n.update_day !== null ? `New chapters arrive on ${DAYS_LONG[n.update_day]}s.` : 'More is on the way.'}<br><button class="btn btn-sm" data-sub style="margin-top:12px">${me && api.subscriptions.has(me.id, n.id) ? '✓ Subscribed' : 'Subscribe for updates'}</button></div>`}
      </article>`;
    };

    function renderComments(c) {
      const host = $(`#cmts-${c.id}`); if (!host) return;
      const list = api.comments.forChapter(c.id);
      host.innerHTML = `<h2>Comments <span class="c">${list.length}</span></h2>
        ${me ? `<form class="c-form" data-ch="${c.id}"><label class="sr-only" for="cb-${c.id}">Comment on chapter ${c.chapter_number}</label><textarea id="cb-${c.id}" placeholder="Leave a comment on this chapter" maxlength="2000" required></textarea><div class="row"><button class="btn btn-sm" type="submit">Post</button></div></form>`
             : `<div class="c-login"><a href="#/login?next=${encodeURIComponent(parseHash().path)}">Log in</a> to comment on this chapter.</div>`}
        ${list.map((cm) => { const u = api.users.byId(cm.user_id); return `<div class="comment"><span class="avatar" aria-hidden="true">${esc(initials(u?.name))}</span><div><div class="w"><b>${nm(u)}</b>${u?.id === n.author_id ? '<span class="badge badge-new">Author</span>' : ''}<time>${esc(timeAgo(cm.created_at))}</time>${me && (me.id === cm.user_id || mine) ? `<button class="del" data-del="${cm.id}">Delete</button>` : ''}</div><div class="b">${esc(cm.body)}</div></div></div>`; }).join('') || `<p class="small" style="color:var(--rd-muted);padding:12px 0">No comments yet. Be the first.</p>`}`;
      host.querySelector('form')?.addEventListener('submit', async (e) => { e.preventDefault(); const ta = e.target.querySelector('textarea'); if (!ta.value.trim()) return; await api.comments.add(c.id, me.id, ta.value); toast('Comment posted'); renderComments(c); });
      host.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { await api.comments.remove(b.dataset.del); renderComments(c); }));
    }

    function appendChapter(idx) {
      if (loaded.has(idx) || !chs[idx]) return;
      loaded.add(idx);
      canvas.insertAdjacentHTML('beforeend', chapterBlock(idx));
      renderComments(chs[idx]);
      api.novels.recordView(n.id, chs[idx].id);
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
      if (me) api.progress.set(me.id, n.id, c.id);
    }

    appendChapter(startIdx); setCurrent(startIdx);

    // Hide chrome on scroll down, reveal on scroll up; progress bar.
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY; const dy = y - lastY; lastY = y;
      if (Math.abs(dy) > 6 && settings.hidden) { const hide = dy > 0 && y > 80; $('#rdTop').classList.toggle('hide', hide); $('#rdBottom').classList.toggle('hide', hide); }
      const h = document.documentElement; $('#rdProgress').style.width = Math.min(100, (y / Math.max(1, h.scrollHeight - h.clientHeight)) * 100) + '%';
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Settings popover
    const settings = $('#rdSettings'), sBtn = $('#rdSettingsBtn');
    const closeSettings = () => { settings.hidden = true; sBtn.setAttribute('aria-expanded', 'false'); };
    sBtn.addEventListener('click', () => { settings.hidden = !settings.hidden; sBtn.setAttribute('aria-expanded', String(!settings.hidden)); });
    const onDocClick = (e) => { if (!settings.hidden && !settings.contains(e.target) && e.target !== sBtn && !sBtn.contains(e.target)) closeSettings(); };
    document.addEventListener('click', onDocClick);
    const seg = (id, key, apply) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (!b) return; prefs.set({ [key]: b.dataset.v }); $$('button', $(id)).forEach((x) => x.setAttribute('aria-pressed', x === b)); apply(b.dataset.v); });
    seg('#segTheme', 'theme', (v) => { reader.dataset.theme = v; });
    seg('#segLh', 'lh', (v) => reader.style.setProperty('--rd-lh', LH[v]));
    seg('#segFont', 'font', (v) => { reader.dataset.font = v; });
    const setSize = (d) => { const size = Math.min(26, Math.max(14, prefs.get().size + d)); prefs.set({ size }); reader.style.setProperty('--rd-size', size + 'px'); $('#szOut').textContent = size + 'px'; };
    $('#szDown').addEventListener('click', () => setSize(-1)); $('#szUp').addEventListener('click', () => setSize(1));

    // Bottom nav
    $('#navSel').addEventListener('change', (e) => go(`/novel/${n.slug}/ch/${e.target.value}`));
    canvas.addEventListener('click', async (e) => {
      const nxt = e.target.closest('[data-next]');
      if (nxt) { const block = $(`#ch-${+nxt.dataset.next + 1}`); if (block) { e.preventDefault(); block.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; } }
      const like = e.target.closest('[data-like]'); const sub = e.target.closest('[data-sub]');
      if (like) { if (!requireAuth()) return; const on = await api.likes.toggle(me.id, like.dataset.like); like.setAttribute('aria-pressed', on); like.querySelector('span').textContent = compact(api.chapters.byId(like.dataset.like).likes); }
      if (sub) { if (!requireAuth()) return; const on = await api.subscriptions.toggle(me.id, n.id); $$('[data-sub]', canvas).forEach((b) => { b.setAttribute('aria-pressed', on); b.textContent = on ? '✓ Subscribed' : (b.classList.contains('btn') ? 'Subscribe for updates' : '+ Subscribe'); }); toast(on ? `Subscribed to ${n.title}` : 'Unsubscribed'); }
    });
    const onKey = (e) => { if (e.target.matches('input, textarea, select, [contenteditable]')) return; if (e.key === 'ArrowRight' && current + 1 < chs.length) go(`/novel/${n.slug}/ch/${current + 2}`); if (e.key === 'ArrowLeft' && current > 0) go(`/novel/${n.slug}/ch/${current}`); if (e.key === 'Escape') closeSettings(); };
    document.addEventListener('keydown', onKey);
    cleanup = () => { io.disconnect(); headIO.disconnect(); window.removeEventListener('scroll', onScroll); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKey); };
  });

  /* 6f. Auth views ---------------------------------------------------------- */
  route('/login', async ({ app, query }) => {
    setTitle('Log in');
    app.innerHTML = `<section class="auth"><h1>Welcome back</h1><p class="lead">Pick up where you left off.</p>
      <form id="loginForm" novalidate><div class="field"><label for="li_id">Email</label><input class="input" id="li_id" type="email" autocomplete="email" required></div>
      <div class="field"><label for="li_pw">Password</label><input class="input" id="li_pw" type="password" autocomplete="current-password" required></div>
      <div class="form-error" id="err" role="alert"></div><button class="btn btn-primary btn-block btn-lg" type="submit">Log in</button></form>
      <p class="alt">New here? <a href="#/signup">Create an account</a></p></section>`;
    $('#loginForm').addEventListener('submit', async (e) => { e.preventDefault(); const btn = e.submitter; if (btn) btn.disabled = true; try { const u = await auth.login($('#li_id').value, $('#li_pw').value); toast(u ? `Logged in as ${u.name}` : 'Logged in'); go(query.next || '/'); } catch (err) { $('#err').textContent = err.message; } finally { if (btn) btn.disabled = false; } });
  });
  route('/signup', async ({ app, query }) => {
    setTitle('Sign up');
    app.innerHTML = `<section class="auth"><h1>Create your account</h1><p class="lead">Subscribe to series, comment on chapters, write your own.</p>
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
    app.innerHTML = `<header class="profile-head"><span class="avatar lg" aria-hidden="true">${esc(initials(u.name))}</span><div><h1>${nm(u)}</h1><div class="h">@${esc(u.username)} · joined ${esc(fmtDate(u.created_at))}</div><p class="bio">${esc(u.bio) || (mine ? 'Add a short bio so readers know who you are.' : '')}</p></div><div class="row profile-actions">${actions}</div></header>
      <div id="profileEdit"></div>
      <section class="section"><div class="section-head"><h2>Friends<span class="sub">${friends.length}</span></h2></div>${friends.length ? `<ul class="friend-chips">${friends.map((f) => `<li><a href="#/u/${esc(f.username)}"><span class="avatar" aria-hidden="true">${esc(initials(f.name))}</span>${esc(f.name)}</a></li>`).join('')}</ul>` : `<div class="empty"><h3>No friends yet</h3><p>${mine ? 'Open someone’s profile and choose Add friend.' : 'Send a friend request to be the first.'}</p></div>`}</section>
      <section class="section"><div class="section-head"><h2>Favorites<span class="sub">${favs.length}</span></h2></div><div class="grid">${favs.map(sCard).join('') || `<div class="empty" style="grid-column:1/-1"><h3>No favorites yet</h3><p>${mine ? 'Choose Favorite on a series page to keep it here.' : 'Nothing favorited yet.'}</p></div>`}</div></section>
      <section class="section"><div class="section-head"><h2>${mine ? 'Your series' : `Series by ${esc(u.name)}`}</h2></div><div class="grid">${published.map(sCard).join('') || `<div class="empty" style="grid-column:1/-1"><h3>Nothing published yet</h3><p>${mine ? 'Series you publish show up here.' : 'Check back later.'}</p>${mine ? '<a class="btn btn-sm" href="#/studio">Open Studio</a>' : ''}</div>`}</div></section>
      <section class="section"><div class="section-head"><h2>Subscriptions<span class="sub">${subs.length}</span></h2></div><div class="grid">${subs.map(sCard).join('') || `<div class="empty" style="grid-column:1/-1"><h3>No subscriptions yet</h3><p>Subscribe to a series and new chapters will show up in your notifications.</p><a class="btn btn-ghost btn-sm" href="#/browse">Browse series</a></div>`}</div></section>`;
    $('#logoutBtn')?.addEventListener('click', async () => { await auth.logout(); toast('Logged out'); if (location.hash === '#/') render(); else go('/'); });
    $$('[data-fr]', app).forEach((b) => b.addEventListener('click', async () => {
      if (!requireAuth()) return;
      const act = b.dataset.fr;
      if (act === 'request') { await api.friends.request(me.id, u.id); toast(`Friend request sent to ${u.name}`); }
      if (act === 'accept') { await api.friends.accept(me.id, u.id); toast(`You and ${u.name} are now friends`); }
      if (act === 'remove') { const label = fs === 'friends' ? `Remove ${u.name} from your friends?` : null; if (label && !confirm(label)) return; await api.friends.remove(me.id, u.id); toast(fs === 'friends' ? 'Friend removed' : fs === 'incoming' ? 'Friend request declined' : 'Friend request canceled'); }
      render();
    }));
    $('#editProfile')?.addEventListener('click', () => {
      $('#profileEdit').innerHTML = `<form class="card" id="pf" style="max-width:520px;margin-bottom:8px"><div class="field"><label for="pf_name">Display name</label><input class="input" id="pf_name" value="${esc(u.name)}" required></div><div class="field"><label for="pf_bio">Bio</label><textarea class="textarea" id="pf_bio" maxlength="280">${esc(u.bio)}</textarea></div><div class="row"><button class="btn" type="submit">Save changes</button><button class="btn btn-ghost" type="button" id="pfCancel">Cancel</button></div></form>`;
      $('#pfCancel').addEventListener('click', () => { $('#profileEdit').innerHTML = ''; });
      $('#pf').addEventListener('submit', async (e) => { e.preventDefault(); await api.users.update(u.id, { name: $('#pf_name').value.trim() || u.name, bio: $('#pf_bio').value.trim() }); toast('Profile saved'); render(); });
    });
  });

  route('/notifications', async ({ app }) => {
    if (!requireAuth('/notifications')) return;
    setTitle('Notifications'); const me = auth.current();
    const list = api.notifications.forUser(me.id);
    const reqs = api.friends.incoming(me.id).map((r) => api.users.byId(r.from)).filter(Boolean);
    app.innerHTML = `<div class="studio-head"><div><h1>Notifications</h1><p class="lead">Friend requests and new chapters from series you subscribe to.</p></div></div>
      ${reqs.length ? `<ul class="req-list" id="reqList">${reqs.map((u) => `<li class="fr fr-req">${userLink(u)}<div class="fr-main"><a class="fr-name" href="#/u/${esc(u.username)}">${esc(u.name)}</a><div class="fr-act">Wants to be friends</div><div class="row fr-btns"><button class="btn btn-primary btn-sm" data-accept="${u.id}">Accept</button><button class="btn btn-ghost btn-sm" data-decline="${u.id}">Decline</button></div></div></li>`).join('')}</ul>` : ''}
      <ul class="notif">${list.map((x) => { const n = api.novels.byId(x.novel_id); const c = api.chapters.byId(x.chapter_id); if (!n || !c) return ''; const a = api.users.byId(n.author_id); const i = api.novels.published(n.id).indexOf(c); return `<li class="${x.read_at ? '' : 'unread'}"><a href="#/novel/${esc(n.slug)}">${thumb(n, { sm: true, badge: false })}</a><div><a class="t" href="#/novel/${esc(n.slug)}/ch/${i + 1}">${esc(a.name)} posted Chapter ${c.chapter_number} of ${esc(n.title)}: ${esc(c.title)}</a><div class="m">${esc(timeAgo(x.created_at))}</div></div></li>`; }).join('') || `<li style="display:block;padding:0"><div class="empty"><h3>Nothing yet</h3><p>Subscribe to a series and you will hear about every new chapter here.</p><a class="btn btn-ghost btn-sm" href="#/browse">Browse series</a></div></li>`}</ul>`;
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
      <ul class="st-rows">${list.map((n) => { const all = api.novels.all(n.id); const pub = all.filter((c) => c.status === 'published'); const live = api.novels.isPublic(n); const drafts = all.length - pub.length; return `<li>${thumb(n, { sm: true, badge: false })}<div><a class="t" href="#/studio/novel/${n.id}">${esc(n.title || 'Untitled series')}</a><div class="m"><span class="badge ${live ? 'badge-live' : 'badge-draft'}">${live ? (n.status === 'completed' ? 'COMPLETED' : 'LIVE') : 'DRAFT'}</span><span>${pub.length} published${drafts ? ` · ${drafts} draft${drafts > 1 ? 's' : ''}` : ''}</span><span>${compact(api.novels.subscribers(n))} ${pl(api.novels.subscribers(n), 'subscriber')}</span><span>${n.update_day !== null ? DAYS_LONG[n.update_day] + 's' : 'no release day'}</span></div></div><div class="a"><a class="btn btn-soft btn-sm" href="#/studio/novel/${n.id}">Manage</a>${live ? `<a class="btn btn-ghost btn-sm" href="#/novel/${esc(n.slug)}">View</a>` : ''}</div></li>`; }).join('') || `<li style="display:block"><div class="empty"><h3>Start your first series</h3><p>Create a series, add chapters, publish when ready. Drafts stay private.</p><button class="btn" id="newNovel2">New series</button></div></li>`}</ul>`;
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
    app.innerHTML = `<div class="studio-series"><div class="crumbs"><a href="#/studio">Studio</a> / ${esc(n.title || 'Untitled series')}</div>
      <div class="cols"><div>
        <form class="card" id="details"><h2>Series details</h2>
          <div class="field"><label for="f_title">Title</label><input class="input" id="f_title" value="${esc(n.title)}" placeholder="Series title" maxlength="120" required></div>
          <div class="field"><label for="f_syn">Synopsis</label><textarea class="textarea" id="f_syn" maxlength="600" placeholder="Two or three sentences that tell a reader what they are in for.">${esc(n.synopsis)}</textarea></div>
          <div class="field"><span class="lbl">Genres</span><div class="chip-set" id="genreSet">${GENRES.map((g) => `<button type="button" class="chip ${n.genres.includes(g) ? 'on' : ''}" data-g="${esc(g)}" aria-pressed="${n.genres.includes(g)}">${esc(g)}</button>`).join('')}</div><span class="hint">Up to two.</span></div>
          <div class="field"><label for="f_tags">Tags</label><input class="input" id="f_tags" value="${esc(n.tags.join(', '))}" placeholder="slow burn, found family"><span class="hint">Comma separated. Searchable.</span></div>
          <div class="row" style="gap:16px;align-items:start">
            <div class="field" style="flex:1"><label for="f_day">Release day</label><select class="select" id="f_day"><option value="">No fixed day</option>${[1, 2, 3, 4, 5, 6, 0].map((d) => `<option value="${d}" ${n.update_day === d ? 'selected' : ''}>${DAYS_LONG[d]}</option>`).join('')}</select><span class="hint">Shown on the home schedule.</span></div>
            <div class="field" style="flex:1"><label for="f_status">Status</label><select class="select" id="f_status"><option value="ongoing" ${n.status !== 'completed' ? 'selected' : ''}>Ongoing</option><option value="completed" ${n.status === 'completed' ? 'selected' : ''}>Completed</option></select></div></div>
          <div class="field"><span class="lbl">Cover</span><div class="thumb-picker"><div id="thumbPreview">${thumb(n, { badge: false })}</div><div><div class="swatches" id="swatches">${COVERS.map((c) => `<button type="button" style="background:${c}" data-c="${c}" aria-label="Cover colour ${c}" aria-pressed="${n.cover_color === c}"></button>`).join('')}</div><input class="input" id="f_cover" value="${esc(n.cover_image)}" placeholder="Image URL (optional)"><span class="hint">Square images, 600 × 600 or larger. Leave empty for a typographic cover.</span></div></div></div>
          <div class="row"><button class="btn" type="submit">Save details</button></div></form>
        <div class="card"><h2>Danger zone</h2><p class="small muted">Deleting removes the series, every chapter, comments and subscriptions. No undo.</p><button class="btn btn-danger btn-sm" id="delNovel">Delete series</button></div>
      </div><div>
        <div class="pub-state ${live ? 'live' : ''}">${live ? `<b>Live.</b> Readers can find it at <a href="#/novel/${esc(n.slug)}">/novel/${esc(n.slug)}</a>. ${pubCount} of ${plural(chs.length, 'chapter')} published · ${compact(api.novels.subscribers(n))} ${pl(api.novels.subscribers(n), 'subscriber')}.` : n.status !== 'draft' ? '<b>Published, but hidden.</b> No published chapters yet, so readers cannot see it. Publish a chapter to go live.' : '<b>Draft.</b> Only you can see this series. Publishing any chapter makes it live and notifies subscribers.'}</div>
        <div class="row" style="margin-bottom:14px">${n.status !== 'draft' ? '<button class="btn btn-ghost btn-sm" id="offline">Take offline</button>' : pubCount ? '<button class="btn btn-primary btn-sm" id="pubNovel">Publish series</button>' : ''}${live ? `<a class="btn btn-ghost btn-sm" href="#/novel/${esc(n.slug)}">View public page</a>` : ''}</div>
        <div class="card"><div class="row between" style="margin-bottom:8px"><h2 style="margin:0">Chapters</h2><button class="btn btn-sm" id="newCh">New chapter</button></div>
          <ol class="ep-rows">${chs.map((c, i) => `<li><span class="n">${c.chapter_number}</span><div><a class="t" href="#/studio/novel/${n.id}/ch/${c.id}">${esc(c.title || 'Untitled chapter')}</a><div class="m"><span class="badge ${c.status === 'published' ? 'badge-live' : 'badge-draft'}">${c.status === 'published' ? 'PUBLISHED' : 'DRAFT'}</span><span>${wordCount(c.content).toLocaleString()} words</span>${c.author_note ? '<span>note ✓</span>' : ''}<span>${esc(timeAgo(c.updated_at))}</span></div></div>
            <div class="a"><button class="btn btn-soft btn-sm" data-move="-1" data-id="${c.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="btn btn-soft btn-sm" data-move="1" data-id="${c.id}" ${i === chs.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>${c.status === 'published' ? `<button class="btn btn-ghost btn-sm" data-unpub="${c.id}">Unpublish</button>` : `<button class="btn btn-primary btn-sm" data-pub="${c.id}">Publish</button>`}<button class="btn btn-ghost btn-sm" data-del="${c.id}">Delete</button></div></li>`).join('') || '<li style="display:block"><div class="empty"><h3>No chapters yet</h3><p>Add the first one and start writing.</p></div></li>'}</ol></div>
      </div></div></div>`;

    const gs = $('#genreSet');
    gs.addEventListener('click', (e) => { const b = e.target.closest('button[data-g]'); if (!b) return; const on = b.classList.contains('on'); if (!on && $$('button.on', gs).length >= 2) { toast('Pick up to two genres'); return; } b.classList.toggle('on'); b.setAttribute('aria-pressed', !on); });
    let color = n.cover_color;
    const refresh = () => { $('#thumbPreview').innerHTML = thumb({ ...n, title: $('#f_title').value, cover_color: color, cover_image: $('#f_cover').value.trim() }, { badge: false }); };
    $('#swatches').addEventListener('click', (e) => { const b = e.target.closest('button[data-c]'); if (!b) return; color = b.dataset.c; $$('button', $('#swatches')).forEach((x) => x.setAttribute('aria-pressed', x === b)); refresh(); });
    $('#f_title').addEventListener('input', refresh); $('#f_cover').addEventListener('change', refresh);
    $('#details').addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = n.status === 'draft' ? 'draft' : $('#f_status').value;
      await api.novels.update(n.id, { title: $('#f_title').value.trim(), synopsis: $('#f_syn').value.trim(), genres: $$('button.on', gs).map((b) => b.dataset.g), tags: $('#f_tags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10), update_day: $('#f_day').value === '' ? null : +$('#f_day').value, cover_color: color, cover_image: $('#f_cover').value.trim(), status });
      toast('Details saved'); render();
    });
    $('#pubNovel')?.addEventListener('click', async () => { await api.novels.setStatus(n.id, 'ongoing'); toast('Series published', { href: `#/novel/${n.slug}`, label: 'View' }); render(); });
    $('#offline')?.addEventListener('click', async () => { if (!confirm('Take the series offline? Readers will not see it. Nothing is deleted.')) return; await api.novels.setStatus(n.id, 'draft'); toast('Series is offline'); render(); });
    $('#delNovel').addEventListener('click', async () => { if (!confirm(`Delete “${n.title || 'Untitled series'}” and all chapters? This cannot be undone.`)) return; await api.novels.remove(n.id); toast('Series deleted'); go('/studio'); });
    $('#newCh').addEventListener('click', async () => { const c = await api.chapters.create(n.id); go(`/studio/novel/${n.id}/ch/${c.id}`); });
    $$('[data-pub]').forEach((b) => b.addEventListener('click', () => publishChapter(b.dataset.pub)));
    $$('[data-unpub]').forEach((b) => b.addEventListener('click', async () => { await api.chapters.unpublish(b.dataset.unpub); toast('Chapter unpublished'); render(); }));
    $$('[data-move]').forEach((b) => b.addEventListener('click', async () => { await api.chapters.move(b.dataset.id, +b.dataset.move); render(); }));
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => { const c = api.chapters.byId(b.dataset.del); if (!confirm(`Delete “${c.title || 'Untitled chapter'}”? Its comments go too.`)) return; await api.chapters.remove(c.id); toast('Chapter deleted'); render(); }));
  });

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

  async function publishChapter(id) {
    const c = api.chapters.byId(id); const n = api.novels.byId(c.novel_id);
    if (!c.title.trim()) { toast('Give the chapter a title before publishing'); return false; }
    if (wordCount(c.content) === 0) { toast('The chapter is empty. Write something first.'); return false; }
    if (!n.title.trim()) { toast('Give the series a title before publishing'); return false; }
    if (!(await checkCanPublish())) return false;
    const { novel, novelWentLive, notified } = await api.chapters.publish(id);
    const i = api.novels.published(novel.id).findIndex((x) => x.id === id) + 1;
    toast(novelWentLive ? 'Published. Your series is now live for everyone.' : `Chapter published${notified ? `. ${plural(notified, 'subscriber')} notified.` : ''}`, { href: `#/novel/${novel.slug}/ch/${i}`, label: 'Read it' });
    render(); return true;
  }

  /* 6j. Chapter editor ------------------------------------------------------ */
  route('/studio/novel/:id/ch/:cid', async ({ app, params }) => {
    if (!requireAuth()) return;
    const me = auth.current(); const n = api.novels.byId(params.id); const c = api.chapters.byId(params.cid);
    if (!n || !c || n.author_id !== me.id || c.novel_id !== n.id) return notFound(app, 'That chapter is not in your Studio.');
    setTitle(`${c.title || 'Untitled chapter'} · Editor`);
    app.innerHTML = `<div class="editor">
      <div class="ed-top"><div class="crumbs" style="margin:0"><a href="#/studio">Studio</a> / <a href="#/studio/novel/${n.id}">${esc(n.title || 'Untitled series')}</a> / Chapter ${c.chapter_number}</div>
        <div class="row"><span class="state" id="state"><span class="badge ${c.status === 'published' ? 'badge-live' : 'badge-draft'}">${c.status === 'published' ? 'PUBLISHED' : 'DRAFT'}</span></span><button class="btn btn-ghost btn-sm" id="saveBtn">Save draft</button>${c.status === 'published' ? '<button class="btn btn-primary btn-sm" id="pubBtn">Update chapter</button><button class="btn btn-ghost btn-sm" id="unpubBtn">Unpublish</button>' : '<button class="btn btn-primary btn-sm" id="pubBtn">Publish chapter</button>'}</div></div>
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
    words();
    let dirty = false, timer = null;
    const badge = () => `<span class="badge ${c.status === 'published' ? 'badge-live' : 'badge-draft'}">${c.status === 'published' ? 'PUBLISHED' : 'DRAFT'}</span>`;
    const markDirty = () => { dirty = true; state.innerHTML = badge() + ' Unsaved changes'; clearTimeout(timer); timer = setTimeout(() => saveDraft(false), 1500); };
    async function saveDraft(announce) { clearTimeout(timer); await api.chapters.update(c.id, { title: title.value.trim(), content: body.innerHTML, author_note: note.value.trim() }); dirty = false; state.innerHTML = badge() + ' Saved just now'; if (announce) toast('Draft saved'); }
    body.addEventListener('input', () => { words(); markDirty(); }); title.addEventListener('input', () => { setTitle(`${title.value.trim() || 'Untitled chapter'} · Editor`); markDirty(); }); note.addEventListener('input', () => { words(); markDirty(); });
    body.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertHTML', false, t.split(/\n{2,}/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('')); });
    document.addEventListener('keydown', onKey);
    function onKey(e) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveDraft(true); } }
    $$('.toolbar button').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); body.focus(); if (b.dataset.cmd) document.execCommand(b.dataset.cmd, false, null); if (b.dataset.block) document.execCommand('formatBlock', false, b.dataset.block); words(); markDirty(); }));
    $('#saveBtn').addEventListener('click', () => saveDraft(true));
    $('#pubBtn').addEventListener('click', async () => { await saveDraft(false); if (await publishChapter(c.id)) go(`/studio/novel/${n.id}`); });
    $('#unpubBtn')?.addEventListener('click', async () => { await saveDraft(false); await api.chapters.unpublish(c.id); toast('Chapter unpublished'); render(); });
    window.onbeforeunload = () => (dirty ? 'Unsaved changes.' : undefined);
    cleanup = () => { window.onbeforeunload = null; document.removeEventListener('keydown', onKey); if (dirty) saveDraft(false); };
  });

  /* Boot --------------------------------------------------------------------- */
  async function init() {
    $('#app').innerHTML = '<div class="page"><p class="muted">Loading stories…</p></div>';
    try {
      const { data } = await sb.auth.getSession(); // also finishes an email-confirmation link login
      sessionUid = data.session?.user?.id || null;
      await loadAll();
      if (data.session) await ensureProfile(data.session.user);
    } catch (err) {
      $('#app').innerHTML = `<div class="page"><h1>Could not load stories</h1><p class="muted">${esc(err.message)}</p><p class="muted">If the site was just set up, run supabase-schema.sql in the Supabase SQL Editor, then reload.</p></div>`;
      return;
    }
    if (/access_token|error_description|type=/.test(location.hash)) { history.replaceState(null, '', location.pathname + '#/'); if (sessionUid) toast('Email confirmed. You are logged in.'); }
    sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT' && sessionUid) { sessionUid = null; loadAll().then(render, noop); } });
    window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || 'Something went wrong. Try again.'));
    $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#searchInput').value.trim(); go(q ? `/browse?q=${encodeURIComponent(q)}` : '/browse'); });
    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = '#/';
    render();
  }
  init();
})();
