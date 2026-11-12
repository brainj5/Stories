/* ==========================================================================
   Chapterhouse v2 — app.js
   Webtoon-style serial novel platform. Client-side prototype whose data layer
   mirrors the production schema:
     novels, chapters (chapter_number, author_note), subscriptions,
     chapter_comments, notifications, chapter_likes, reading_progress
   Sections: 1 utils · 2 storage+seed · 3 data API · 4 auth · 5 router/shell ·
             6 views (home, schedule, browse, novel, reader, auth, profile,
             notifications, studio, editor)
   ========================================================================== */
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

  /* 2. Storage + seed ----------------------------------------------------- */
  const KEY = 'chapterhouse.v2';
  let db = null;
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  async function sha256(t) {
    if (crypto?.subtle) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join(''); }
    let h = 5381; for (const c of t) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return 'djb2:' + (h >>> 0).toString(16);
  }

  const GENRES = ['Fantasy', 'Romance', 'Mystery', 'Sci-fi', 'Thriller', 'Drama', 'Horror', 'Slice of life', 'Historical', 'Comedy'];
  const COVERS = ['#2b3be8', '#17181c', '#0f766e', '#b91c1c', '#7c3aed', '#c2410c', '#0369a1', '#4d7c0f', '#9d174d', '#78350f'];
  const P = (...ps) => ps.map((t) => `<p>${t}</p>`).join('');

  async function seed() {
    const t0 = now();
    const pw = await sha256('chapterhouse');
    const users = [
      { id: 'u_mara', username: 'maravoss', name: 'Mara Voss', email: 'mara@example.com', password_hash: pw, bio: 'Maps for places that refuse to stay put. Salt Cartographer updates Thursdays.', created_at: t0 - 400 * DAY },
      { id: 'u_june', username: 'juneokafor', name: 'June Okafor', email: 'june@example.com', password_hash: pw, bio: 'Mysteries set in houses with too many rooms. Former archivist.', created_at: t0 - 300 * DAY },
      { id: 'u_theo', username: 'theolind', name: 'Theo Lindqvist', email: 'theo@example.com', password_hash: pw, bio: 'Quiet novels about weather and the people who notice it.', created_at: t0 - 220 * DAY },
      { id: 'u_demo', username: 'demo', name: 'Demo Writer', email: 'demo@example.com', password_hash: pw, bio: 'Demo account. Log in as demo / chapterhouse to try the Studio.', created_at: t0 - 10 * DAY },
    ];
    const novels = [], chapters = [];
    const todayDow = new Date().getDay();
    const mk = (n, chs) => {
      const novel = {
        id: 'n_' + uid(), slug: slugify(n.title), author_id: n.author_id, title: n.title, synopsis: n.synopsis, cover_image: '', cover_color: n.cover_color,
        genres: n.genres, tags: n.tags, status: n.status || 'ongoing', update_day: n.update_day ?? null, featured: !!n.featured, views: n.views || 0,
        created_at: t0 - n.age * DAY, updated_at: t0 - n.upd * DAY, last_published_at: t0 - n.upd * DAY,
      };
      novels.push(novel);
      chs.forEach((c, i) => chapters.push({
        id: 'c_' + uid(), novel_id: novel.id, chapter_number: i + 1, title: c.title, content: c.content, author_note: c.note || '',
        status: c.status || 'published', views: Math.round((n.views || 0) * (1 - i * 0.15)), likes: Math.round((n.views || 0) * 0.06 * (1 - i * 0.12)),
        created_at: t0 - (n.age - i * 7) * DAY, updated_at: t0 - Math.max(0, n.age - i * 7 - 1) * DAY,
        published_at: c.status === 'draft' ? null : (i === chs.length - 1 ? t0 - n.upd * DAY : t0 - (n.age - i * 7) * DAY),
      }));
    };

    mk({ author_id: 'u_mara', title: 'The Salt Cartographer', featured: true, views: 48200, age: 92, upd: 0.2, update_day: todayDow, genres: ['Fantasy'], tags: ['maps', 'sea', 'slow burn'], cover_color: '#0f766e',
      synopsis: 'Every map Ilse Varen draws comes true a little, which is why the Admiralty keeps her in a windowless room. When a coastline she has never seen appears under her pen, she has one tide to decide whether to follow it.' }, [
      { title: 'The room without windows', note: 'First chapter! This one has lived in my drafts folder for two years. New chapters every week. Tell me what you think of Ilse.', content: P(
        'The Admiralty had given Ilse Varen a room with no windows, which she understood to be a kindness. A window would have shown her the harbour, and the harbour would have shown her the ships, and she would have drawn them before she could stop herself, and then the ships would have gone wherever her hand had decided they should go.',
        'So: a lamp, a desk, a stack of vellum thick enough to stop an arrow, and a brass bowl of salt that the clerk refilled each morning without meeting her eyes. She did not know what the salt was for. Nobody had told her. She had come to suspect that nobody knew, and that it was refilled the way one keeps relighting a candle in a church, because stopping would mean deciding it had never mattered.',
        'She was inking the eastern approaches to Caul when the coastline appeared.',
        'It did not arrive the way her mistakes arrived, with a wobble of the nib and a muttered word. It came clean. A long concave bay, two headlands like a pair of hands held slightly apart, and a river mouth braided into six channels that she drew, she was certain, from memory. But she had never been east of Caul. She had never been anywhere.',
        'Ilse put the pen down. The ink dried. The bay stayed.') },
      { title: 'What the clerk knew', content: P(
        'The clerk was named Pell, and he had the particular stillness of a man who has been told he will be hanged if he speaks of his work and has decided, pragmatically, to stop speaking of anything at all.',
        'He looked at the bay for a long time. Then he picked up the brass bowl, tipped a little salt into his palm, and let it run through his fingers onto the vellum. Where it touched the drawn water it darkened, as if it had got wet.',
        '"That is for finding out," he said, "whether a thing is a drawing or a place."', '"And which is it?"',
        'Pell brushed the salt off the desk and into the bowl again, every grain, with the side of his hand. "I would get your coat," he said.') },
      { title: 'One tide', note: 'Yes, the oranges are important. No, I will not say why yet.', content: P(
        'There are rules about leaving the Admiralty and Ilse broke each of them in order, as though following a different set.',
        'The harbour at night smelled of tar and oranges, which she had not expected. She had spent eleven years drawing this harbour from the reports of men who had stood in it, and not one of them had mentioned oranges. It made her wonder what else they had left out, and whether the maps had been wrong all along in ways nobody would notice until they tried to come home.',
        'The <em>Hollow Mercy</em> was a coastal cutter with a crew of four and a captain who was asleep. Pell woke her by the simple expedient of standing beside the bunk until she opened her eyes.',
        '"She has a place," he said, nodding at Ilse. "Nobody has been there. I thought you might like to be first."') },
      { title: 'Six channels', note: 'Thank you for 1,000 subscribers. I read every comment, even the ones about Pell deserving a raise.', content: P(
        'The river mouth was exactly as she had drawn it, and that was the problem.',
        'A real river does not braid so evenly. Real channels silt and shift and argue with each other. These six ran parallel as the tines of a fork, and the water in them was the flat grey of unmixed ink, and when the leadsman called the depth his voice came back off the headlands a half-second late, as if the place were still deciding whether to have an echo.',
        '"You drew it well," the captain said, not kindly.',
        'Ilse looked at the bay with its two patient hands. "I drew it quickly," she said. "I think that may be different."') },
    ]);

    mk({ author_id: 'u_june', title: 'Thirteen Doors on Ashby Lane', featured: true, views: 33100, age: 70, upd: 2, update_day: (todayDow + 2) % 7, genres: ['Mystery'], tags: ['locked room', 'cosy', 'one house'], cover_color: '#b91c1c',
      synopsis: 'Number 9 Ashby Lane has twelve doors on its floor plan and thirteen on the ground. Retired archivist Dorothea Mabb bought it for the garden. She is going to have to count again.' }, [
      { title: 'A house with an extra', content: P(
        'Dorothea Mabb had catalogued eleven thousand documents in her career, and she could tell you that the number of mistakes in the world is always one more than you have found.',
        'This philosophy had made her good at her job and difficult at dinner parties. It had also, she now suspected, made her buy a house.',
        'The estate agent had produced a floor plan on glossy paper: ground floor, twelve doors, including the cupboard under the stairs, which she had thought was a cheat. Dorothea had walked the house twice and counted thirteen. She had not mentioned it. One does not, at the point of exchange, mention a surplus door.') },
      { title: 'The cupboard that was not', content: P(
        'It was not the cupboard under the stairs. She checked that first, because it is always the cupboard under the stairs, and it was simply a cupboard, with a bucket in it.',
        'The thirteenth door was in the scullery, behind the door to the garden, so that when the garden door stood open it was hidden entirely. It had no handle. It had a keyhole, painted over four or five times, the last coat a cheerful municipal green.',
        'Dorothea made a cup of tea and sat where she could see it. Documents, she had always said, will tell you what they are if you give them an afternoon.') },
      { title: 'Correspondence', note: 'Short one this week, I was moving house. Appropriately.', content: P(
        'The previous owners had left a box of letters in the loft, which was the sort of thing previous owners did, and Dorothea had been saving them as a treat.',
        'Most were bills. One was from a locksmith in 1961, declining to attend.') },
    ]);

    mk({ author_id: 'u_theo', title: 'Northing', views: 19800, age: 55, upd: 5, update_day: (todayDow + 5) % 7, genres: ['Drama'], tags: ['weather', 'grief', 'coastal'], cover_color: '#17181c',
      synopsis: 'After his father dies, Anders takes over the lighthouse log and discovers forty years of entries that record something other than the weather.' }, [
      { title: 'Fair, visibility good', content: P('The log had been kept in the same hand for forty years, and for the first week Anders could not bring himself to add to it. The last entry was his father’s. Fair. Visibility good. Wind NW 3. And then nothing, the way nothing comes after a sentence that did not know it was the last one.', 'On the eighth day the fog came in and he wrote it down because somebody had to.') },
      { title: 'Wind backing', content: P('He noticed it in the spring entries first. Among the pressures and the sea states, every few weeks, a word that was not a weather word. <em>Northing.</em> Just that. Sometimes with a time beside it.', 'He thought at first it was a bearing. Then he thought it was a mistake. Then he found it in 1987, in 1994, in 2003, always the same, always alone on its line, and he stopped thinking it was either.') },
      { title: 'A sea running', content: P('The woman who delivered the post said his father had been a quiet man, in the tone people use when they mean they had never managed to get anything out of him.', '"He wrote a lot," Anders said.', '"Did he." She looked at the lighthouse as if it might confirm this. "Well. Something to do."') },
    ]);

    mk({ author_id: 'u_mara', title: 'A Lesser Sun', views: 11200, age: 30, upd: 9, update_day: (todayDow + 3) % 7, genres: ['Sci-fi'], tags: ['generation ship', 'engineers'], cover_color: '#7c3aed',
      synopsis: 'The ship was built to last three hundred years. In year two hundred and ninety, the engineers find a note from the builders that reads: "We knew."' }, [
      { title: 'Year 290', content: P('The note was taped inside the housing of a coolant pump that had not been opened since launch, which meant somebody had put it there on purpose, which meant somebody had wanted it found by exactly the kind of person who opens coolant pumps.', 'Oyelaran read it twice and then put the housing back on, because the pump still needed fixing.') },
      { title: 'The builders', content: P('There were nine of them in the archive footage. They looked tired in the way that people in old footage always look tired, as if the past had been lit badly.', 'One of them, a woman with a shaved head, kept glancing at something off camera. Oyelaran watched the clip forty times before she realised the woman was looking at a clock.') },
    ]);

    mk({ author_id: 'u_june', title: 'Greenhouse Letters', featured: true, views: 26400, age: 40, upd: 1, update_day: (todayDow + 6) % 7, genres: ['Romance', 'Slice of life'], tags: ['epistolary', 'botany', 'slow burn'], cover_color: '#4d7c0f',
      synopsis: 'Two strangers share a rented allotment on alternating weeks. They have never met. They are leaving each other notes about the tomatoes, and then about other things.' }, [
      { title: 'Re: the tomatoes', content: P('To whoever has the even weeks,', 'I think you are overwatering. I say this with love, or at least with the beginnings of respect, because the beans are magnificent and I have no idea how you did that. But the tomatoes are sulking.', 'There is a trowel under the bench that I believe is yours. I have been using it. Sorry. It is a very good trowel.', 'Odd weeks.') },
      { title: 'Re: re: the tomatoes', note: 'Even Weeks has a name. You will not learn it for a while.', content: P('Odd weeks,', 'The trowel was my grandmother’s and you are welcome to it, on the understanding that you now owe me a favour of unspecified size.', 'I am not overwatering. I am watering exactly the right amount and the tomatoes are sulking for reasons of their own. They are, I have come to believe, dramatic plants.', 'Even weeks.') },
    ]);

    mk({ author_id: 'u_theo', title: 'The Winter Ferry', views: 7600, age: 20, upd: 20, update_day: todayDow, genres: ['Historical'], tags: ['1890s', 'island'], cover_color: '#0369a1',
      synopsis: 'In the winter of 1893 the ferry to Stenø ran once a week, and the island counted its people each time it did.' }, [
      { title: 'The first crossing', content: P('The ferry was called the <em>Agnes</em> and nobody on the island remembered why.', 'In winter she ran on Saturdays, weather permitting, and the weather permitted less and less.') },
    ]);

    mk({ author_id: 'u_demo', title: 'The Weight of Keys', status: 'draft', views: 0, age: 2, upd: 0, update_day: null, genres: ['Mystery'], tags: ['first draft'], cover_color: '#c2410c',
      synopsis: 'A locksmith inherits a ring of keys and a list of addresses. None of the keys fit any of the doors. All of the doors open anyway.' }, [
      { title: 'The ring', status: 'draft', note: 'Hi, this is the demo author’s note. It shows up at the end of the chapter when published.', content: P('There were forty-one keys on the ring and Hal counted them twice because the will had said forty.', 'This is a draft. Open it in the editor, make a change, and publish it to see it go live and notify subscribers.') },
    ]);

    const ch = (t) => chapters.find((c) => c.title === t).id;
    const nv = (t) => novels.find((n) => n.title === t).id;
    const chapter_comments = [
      { id: 'cm1', chapter_id: ch('The room without windows'), user_id: 'u_june', body: 'The salt bowl. I need to know about the salt bowl.', created_at: t0 - 60 * DAY },
      { id: 'cm2', chapter_id: ch('The room without windows'), user_id: 'u_theo', body: '"She had never been anywhere." That line is going to stay with me.', created_at: t0 - 58 * DAY },
      { id: 'cm3', chapter_id: ch('One tide'), user_id: 'u_june', body: 'Oranges! Of course nobody mentioned the oranges.', created_at: t0 - 20 * DAY },
      { id: 'cm4', chapter_id: ch('Six channels'), user_id: 'u_demo', body: 'Pell deserves a raise.', created_at: t0 - 0.1 * DAY },
      { id: 'cm5', chapter_id: ch('A house with an extra'), user_id: 'u_mara', body: 'One does not mention a surplus door. Perfect.', created_at: t0 - 50 * DAY },
      { id: 'cm6', chapter_id: ch('Re: the tomatoes'), user_id: 'u_theo', body: 'I would read four hundred chapters of this.', created_at: t0 - 30 * DAY },
    ];
    const subscriptions = [
      { user_id: 'u_june', novel_id: nv('The Salt Cartographer'), created_at: t0 - 80 * DAY },
      { user_id: 'u_theo', novel_id: nv('The Salt Cartographer'), created_at: t0 - 70 * DAY },
      { user_id: 'u_demo', novel_id: nv('The Salt Cartographer'), created_at: t0 - 5 * DAY },
      { user_id: 'u_mara', novel_id: nv('Thirteen Doors on Ashby Lane'), created_at: t0 - 40 * DAY },
      { user_id: 'u_demo', novel_id: nv('Greenhouse Letters'), created_at: t0 - 3 * DAY },
      { user_id: 'u_theo', novel_id: nv('Greenhouse Letters'), created_at: t0 - 9 * DAY },
      { user_id: 'u_mara', novel_id: nv('Northing'), created_at: t0 - 15 * DAY },
      { user_id: 'u_mara', novel_id: nv('The Salt Cartographer'), created_at: t0 - 90 * DAY }, // authors can follow their own
    ];
    // fake subscriber counts so the rails look alive: stored as an offset on the novel
    novels.forEach((n) => { n.subscriber_offset = Math.round(n.views / 38); });
    const notifications = [
      { id: 'nt1', user_id: 'u_demo', type: 'new_chapter', novel_id: nv('The Salt Cartographer'), chapter_id: ch('Six channels'), created_at: t0 - 0.2 * DAY, read_at: null },
      { id: 'nt2', user_id: 'u_demo', type: 'new_chapter', novel_id: nv('Greenhouse Letters'), chapter_id: ch('Re: re: the tomatoes'), created_at: t0 - 1 * DAY, read_at: null },
    ];
    return { version: 2, users, novels, chapters, subscriptions, chapter_comments, notifications, chapter_likes: [], reading_progress: {}, session: null };
  }

  /* 3. Data API (each method = one server route / Supabase query) -------- */
  const api = {
    users: {
      byId: (id) => db.users.find((u) => u.id === id),
      byUsername: (u) => db.users.find((x) => x.username.toLowerCase() === String(u).toLowerCase()),
      async update(id, patch) { Object.assign(api.users.byId(id), patch); save(); },
    },
    novels: {
      byId: (id) => db.novels.find((n) => n.id === id),
      bySlug: (slug) => db.novels.find((n) => n.slug === slug),
      published: (novelId) => db.chapters.filter((c) => c.novel_id === novelId && c.status === 'published').sort((a, b) => a.chapter_number - b.chapter_number),
      all: (novelId) => db.chapters.filter((c) => c.novel_id === novelId).sort((a, b) => a.chapter_number - b.chapter_number),
      isPublic: (n) => n.status !== 'draft' && api.novels.published(n.id).length > 0,
      listPublic: () => db.novels.filter(api.novels.isPublic),
      byAuthor: (authorId) => db.novels.filter((n) => n.author_id === authorId).sort((a, b) => b.updated_at - a.updated_at),
      subscribers: (n) => db.subscriptions.filter((s) => s.novel_id === n.id).length + (n.subscriber_offset || 0),
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
        db.novels.push(n); save(); return n;
      },
      async update(id, patch) {
        const n = api.novels.byId(id); Object.assign(n, patch, { updated_at: now() });
        if (patch.title !== undefined) { let base = slugify(patch.title || 'untitled'), s = base, i = 2; while (db.novels.some((x) => x.slug === s && x.id !== id)) s = `${base}-${i++}`; n.slug = s; }
        save(); return n;
      },
      async setStatus(id, status) { const n = api.novels.byId(id); n.status = status; n.updated_at = now(); save(); return n; },
      async remove(id) {
        const ids = db.chapters.filter((c) => c.novel_id === id).map((c) => c.id);
        db.chapters = db.chapters.filter((c) => c.novel_id !== id);
        db.chapter_comments = db.chapter_comments.filter((c) => !ids.includes(c.chapter_id));
        db.chapter_likes = db.chapter_likes.filter((l) => !ids.includes(l.chapter_id));
        db.subscriptions = db.subscriptions.filter((s) => s.novel_id !== id);
        db.notifications = db.notifications.filter((x) => x.novel_id !== id);
        db.novels = db.novels.filter((n) => n.id !== id); save();
      },
      recordView(novelId, chapterId) {
        const k = 'v:' + chapterId; if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1');
        api.novels.byId(novelId).views++; api.chapters.byId(chapterId).views++; save();
      },
    },
    chapters: {
      byId: (id) => db.chapters.find((c) => c.id === id),
      async create(novelId) {
        const c = { id: 'c_' + uid(), novel_id: novelId, chapter_number: api.novels.all(novelId).length + 1, title: '', content: '', author_note: '', status: 'draft', views: 0, likes: 0, created_at: now(), updated_at: now(), published_at: null };
        db.chapters.push(c); save(); return c;
      },
      async update(id, patch) {
        const c = api.chapters.byId(id); if (patch.content !== undefined) patch.content = sanitize(patch.content);
        if (patch.author_note !== undefined) patch.author_note = String(patch.author_note).slice(0, 1000);
        Object.assign(c, patch, { updated_at: now() }); api.novels.byId(c.novel_id).updated_at = now(); save(); return c;
      },
      /** Publish: chapter goes live, novel goes live if it was a draft, every subscriber gets a notification. */
      async publish(id) {
        const c = api.chapters.byId(id); const n = api.novels.byId(c.novel_id);
        const first = !c.published_at;
        c.status = 'published'; c.published_at = c.published_at || now(); c.updated_at = now();
        n.last_published_at = now(); n.updated_at = now();
        const novelWentLive = n.status === 'draft'; if (novelWentLive) n.status = 'ongoing';
        let notified = 0;
        if (first) db.subscriptions.filter((s) => s.novel_id === n.id && s.user_id !== n.author_id).forEach((s) => {
          db.notifications.push({ id: 'nt_' + uid(), user_id: s.user_id, type: 'new_chapter', novel_id: n.id, chapter_id: c.id, created_at: now(), read_at: null }); notified++;
        });
        save(); return { chapter: c, novel: n, novelWentLive, notified };
      },
      async unpublish(id) { const c = api.chapters.byId(id); c.status = 'draft'; c.updated_at = now(); save(); },
      async remove(id) {
        const c = api.chapters.byId(id);
        db.chapters = db.chapters.filter((x) => x.id !== id);
        db.chapter_comments = db.chapter_comments.filter((x) => x.chapter_id !== id);
        db.chapter_likes = db.chapter_likes.filter((x) => x.chapter_id !== id);
        db.notifications = db.notifications.filter((x) => x.chapter_id !== id);
        api.novels.all(c.novel_id).forEach((x, i) => { x.chapter_number = i + 1; }); save();
      },
      async move(id, dir) {
        const c = api.chapters.byId(id); const list = api.novels.all(c.novel_id); const i = list.indexOf(c), j = i + dir;
        if (j < 0 || j >= list.length) return;
        [list[i].chapter_number, list[j].chapter_number] = [list[j].chapter_number, list[i].chapter_number]; save();
      },
    },
    comments: {
      forChapter: (id) => db.chapter_comments.filter((c) => c.chapter_id === id).sort((a, b) => b.created_at - a.created_at),
      async add(chapterId, userId, body) { const c = { id: 'cm_' + uid(), chapter_id: chapterId, user_id: userId, body: body.trim().slice(0, 2000), created_at: now() }; db.chapter_comments.push(c); save(); return c; },
      async remove(id) { db.chapter_comments = db.chapter_comments.filter((c) => c.id !== id); save(); },
    },
    likes: {
      has: (userId, chapterId) => db.chapter_likes.some((l) => l.user_id === userId && l.chapter_id === chapterId),
      async toggle(userId, chapterId) {
        const c = api.chapters.byId(chapterId);
        if (api.likes.has(userId, chapterId)) { db.chapter_likes = db.chapter_likes.filter((l) => !(l.user_id === userId && l.chapter_id === chapterId)); c.likes = Math.max(0, c.likes - 1); save(); return false; }
        db.chapter_likes.push({ user_id: userId, chapter_id: chapterId, created_at: now() }); c.likes++; save(); return true;
      },
    },
    subscriptions: {
      has: (userId, novelId) => db.subscriptions.some((s) => s.user_id === userId && s.novel_id === novelId),
      forUser: (userId) => db.subscriptions.filter((s) => s.user_id === userId).sort((a, b) => b.created_at - a.created_at),
      async toggle(userId, novelId) {
        if (api.subscriptions.has(userId, novelId)) { db.subscriptions = db.subscriptions.filter((s) => !(s.user_id === userId && s.novel_id === novelId)); save(); return false; }
        db.subscriptions.push({ user_id: userId, novel_id: novelId, created_at: now() }); save(); return true;
      },
    },
    notifications: {
      forUser: (userId) => db.notifications.filter((n) => n.user_id === userId).sort((a, b) => b.created_at - a.created_at),
      unread: (userId) => db.notifications.filter((n) => n.user_id === userId && !n.read_at).length,
      async markAllRead(userId) { db.notifications.forEach((n) => { if (n.user_id === userId && !n.read_at) n.read_at = now(); }); save(); },
    },
    progress: {
      get: (userId, novelId) => db.reading_progress?.[userId]?.[novelId] || null,
      set(userId, novelId, chapterId) { db.reading_progress ||= {}; db.reading_progress[userId] ||= {}; db.reading_progress[userId][novelId] = chapterId; save(); },
      readSet: (userId) => { const s = new Set(); try { Object.values(db.reading_progress[userId] || {}).forEach((id) => s.add(id)); } catch {} return s; },
    },
  };

  /* 4. Auth ---------------------------------------------------------------- */
  const auth = {
    current: () => (db.session ? api.users.byId(db.session.user_id) : null),
    async signup({ name, username, email, password }) {
      if (!name.trim()) throw new Error('Enter your name.');
      if (!/^[a-z0-9_]{3,20}$/i.test(username)) throw new Error('Usernames are 3 to 20 letters, numbers or underscores.');
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
      if (password.length < 8) throw new Error('Passwords need at least 8 characters.');
      if (api.users.byUsername(username)) throw new Error('That username is taken.');
      if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) throw new Error('An account already uses that email.');
      const u = { id: 'u_' + uid(), username, name: name.trim(), email, password_hash: await sha256(password), bio: '', created_at: now() };
      db.users.push(u); db.session = { user_id: u.id }; save(); return u;
    },
    async login(identifier, password) {
      const id = identifier.trim().toLowerCase();
      const u = db.users.find((x) => x.username.toLowerCase() === id || x.email.toLowerCase() === id);
      if (!u || u.password_hash !== (await sha256(password))) throw new Error('No account matches that username and password.');
      db.session = { user_id: u.id }; save(); return u;
    },
    logout() { db.session = null; save(); },
  };

  /* 5. Router + shell ----------------------------------------------------- */
  const routes = [];
  const route = (pattern, handler) => { const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$'); routes.push({ re, keys, handler }); };
  const go = (h) => { location.hash = h; };
  const parseHash = () => { const raw = location.hash.replace(/^#/, '') || '/'; const [path, qs] = raw.split('?'); return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) }; };
  const setTitle = (t) => { document.title = t ? `${t} · Chapterhouse` : 'Chapterhouse'; };
  let cleanup = null; // per-view teardown (observers, scroll listeners)

  async function render() {
    if (cleanup) { cleanup(); cleanup = null; }
    document.body.classList.remove('reading');
    const { path, query } = parseHash(); const app = $('#app');
    for (const r of routes) {
      const m = path.match(r.re);
      if (m) { const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); app.innerHTML = ''; await r.handler({ params, query, app }); if (!app.dataset.keepScroll) window.scrollTo(0, 0); delete app.dataset.keepScroll; renderShell(); return; }
    }
    notFound(app, 'That page does not exist.'); renderShell();
  }
  function notFound(app, msg) { setTitle('Not found'); app.innerHTML = `<div class="page"><h1>Not available</h1><p class="muted">${esc(msg)} <a href="#/" style="color:var(--ultra);font-weight:600">Back home</a>.</p></div>`; }

  function renderShell() {
    const u = auth.current(); const { path } = parseHash();
    const unread = u ? api.notifications.unread(u.id) : 0;
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
    return `<div class="thumb ${sm ? 'sm' : ''} ${n.cover_image ? 'has-image' : ''}" style="--cv:${esc(n.cover_color)};${n.cover_image ? `background-image:url('${esc(n.cover_image)}')` : ''}" aria-hidden="true">${b}${n.cover_image ? '' : `<span class="big">${esc((n.title || 'U')[0])}</span>`}<span class="tt">${esc(n.title || 'Untitled')}</span></div>`;
  };
  const sCard = (n) => { const a = api.users.byId(n.author_id); const st = api.novels.stats(n); return `<a class="s-card" href="#/novel/${esc(n.slug)}">${thumb(n)}<div class="st">${esc(n.title)}</div><div class="sm">${esc(a.name)} · ${compact(st.subs)} subscribers</div></a>`; };
  const rail = (list) => `<div class="rail">${list.map(sCard).join('')}</div>`;
  const dayLink = (d, sel, today) => `<a href="#/daily/${d}" class="${d === sel ? 'on' : ''} ${d === today ? 'today' : ''}"><span>${DAYS[d]}</span>${d === today ? '<span class="d">today</span>' : ''}</a>`;

  /* 6a. Home --------------------------------------------------------------- */
  route('/', async ({ app }) => {
    setTitle('');
    const pub = api.novels.listPublic(); const today = new Date().getDay();
    const todays = pub.filter((n) => n.update_day === today);
    const rising = pub.map((n) => ({ n, st: api.novels.stats(n) })).sort((a, b) => b.st.trend - a.st.trend);
    const pick = pub.find((n) => n.featured) || rising[0]?.n;
    const fresh = [...pub].sort((a, b) => b.created_at - a.created_at).slice(0, 10);
    const byGenre = GENRES.map((g) => ({ g, list: pub.filter((n) => n.genres.includes(g)) })).filter((x) => x.list.length).slice(0, 3);
    app.innerHTML = `
      <section class="sched">
        <div class="sched-head"><h1>This week</h1><a class="small" style="color:var(--ultra);font-weight:600" href="#/daily">Full schedule</a></div>
        <nav class="days" aria-label="Release days">${[1, 2, 3, 4, 5, 6, 0].map((d) => dayLink(d, today, today)).join('')}</nav>
        ${todays.length ? `<div class="sched-rail">${rail(todays)}</div>` : `<div class="empty sched-empty"><h3>No releases scheduled today</h3><p>Pick another day above, or browse everything.</p><a class="btn btn-ghost btn-sm" href="#/browse">Browse series</a></div>`}
        ${pick ? `<a class="hero-pick" href="#/novel/${esc(pick.slug)}">${thumb(pick, { badge: false })}<div><div class="k">Editor's pick</div><h2>${esc(pick.title)}</h2><p>${esc(pick.synopsis)}</p><span class="btn btn-sm">Start reading</span></div></a>` : ''}
      </section>
      <section class="section"><div class="section-head"><h2>Rising now<span class="sub">by subscribers, likes and comments this week</span></h2><a href="#/browse?sort=trending">See all</a></div>
        <ol class="rank">${rising.slice(0, 6).map(({ n, st }) => `<li><a href="#/novel/${esc(n.slug)}">${thumb(n, { sm: true })}</a><div><a class="rt" href="#/novel/${esc(n.slug)}">${esc(n.title)}</a><div class="rm">${esc(n.genres[0] || '')} · ${compact(st.subs)} subscribers · ${plural(st.chapters, 'chapter')}</div></div></li>`).join('')}</ol></section>
      <section class="section"><div class="section-head"><h2>New series</h2><a href="#/browse?sort=new">See all</a></div>${rail(fresh)}</section>
      ${byGenre.map(({ g, list }) => `<section class="section"><div class="section-head"><h2>${esc(g)}</h2><a href="#/browse?genre=${encodeURIComponent(g)}">See all</a></div>${rail(list)}</section>`).join('')}`;
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
    const prog = me ? api.progress.get(me.id, n.id) : null; const progIdx = prog ? chs.findIndex((c) => c.id === prog) : -1;
    const readSet = me ? api.progress.readSet(me.id) : new Set();
    const asc = query.sort === 'asc';
    const list = asc ? chs : [...chs].reverse();
    app.innerHTML = `
      ${mine && !api.novels.isPublic(n) ? `<div class="pub-state" style="margin-top:16px">Draft preview. Only you can see this. <a href="#/studio/novel/${n.id}">Manage in Studio</a></div>` : ''}
      <div class="series-band" style="--cv:${esc(n.cover_color)}">
        <div class="series-top">${thumb(n, { badge: false })}
          <div><div class="chip-set" style="margin-bottom:8px">${n.genres.map((g) => `<a class="chip" href="#/browse?genre=${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}</div>
            <h1>${esc(n.title)}</h1><div class="by">by <a href="#/u/${esc(a.username)}">${esc(a.name)}</a></div>
            <div class="series-meta"><span><b>${compact(st.subs)}</b> subscribers</span><span><b>${compact(st.views)}</b> views</span><span><b>${compact(st.likes)}</b> likes</span><span>${n.status === 'completed' ? '<b>Completed</b>' : n.update_day === null ? '<b>Ongoing</b>' : `Updates <b>${DAYS_LONG[n.update_day]}s</b>`}</span></div>
            <div class="series-cta">
              ${chs.length ? `<a class="btn btn-primary btn-lg" href="#/novel/${esc(n.slug)}/ch/${progIdx > 0 ? progIdx + 1 : 1}">${progIdx > 0 ? `Continue · Ch. ${progIdx + 1}` : 'Read first chapter'}</a>` : '<span></span>'}
              <button class="btn btn-ghost btn-lg sub-btn" id="subBtn" aria-pressed="${subbed}">${subbed ? '✓ Subscribed' : '+ Subscribe'}</button>
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
          <a class="author-row" href="#/u/${esc(a.username)}"><span class="avatar lg" aria-hidden="true">${esc(initials(a.name))}</span><div><div class="n">${esc(a.name)}</div><div class="b">${esc(a.bio) || 'No bio yet.'}</div></div></a>
          ${mine ? `<a class="btn btn-ghost btn-block" style="margin-top:14px" href="#/studio/novel/${n.id}">Edit in Studio</a>` : ''}
        </aside></div>`;
    $('#sortBtn').addEventListener('click', () => go(`/novel/${n.slug}${asc ? '' : '?sort=asc'}`));
    $('#synMore').addEventListener('click', () => { const s = $('#syn'); s.classList.toggle('clamp'); $('#synMore').textContent = s.classList.contains('clamp') ? 'Read more' : 'Show less'; });
    $('#subBtn').addEventListener('click', async () => {
      if (!requireAuth()) return;
      const on = await api.subscriptions.toggle(me.id, n.id);
      toast(on ? `Subscribed. You will be notified when ${a.name} posts a new chapter.` : 'Unsubscribed'); render();
    });
  });

  /* 6e. Reader (continuous scroll) ------------------------------------------ */
  const prefs = {
    get: () => { try { return { theme: 'light', size: 18, lh: 'normal', font: 'serif', ...JSON.parse(localStorage.getItem('chapterhouse.v2.prefs') || '{}') }; } catch { return { theme: 'light', size: 18, lh: 'normal', font: 'serif' }; } },
    set: (p) => localStorage.setItem('chapterhouse.v2.prefs', JSON.stringify({ ...prefs.get(), ...p })),
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
        <header class="ep-head"><div class="k">Chapter ${idx + 1} of ${chs.length}</div><h1>${esc(c.title)}</h1><div class="d">${esc(fmtDate(c.published_at))} · ${readMin(words)} min read · ${compact(c.views)} views</div></header>
        <div class="ep-body">${sanitize(c.content)}</div>
        ${c.author_note ? `<aside class="note"><span class="avatar" aria-hidden="true">${esc(initials(a.name))}</span><div><div class="nh">Author's note</div><div class="nn">${esc(a.name)}</div><div class="nb">${esc(c.author_note)}</div></div></aside>` : ''}
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
        ${list.map((cm) => { const u = api.users.byId(cm.user_id); return `<div class="comment"><span class="avatar" aria-hidden="true">${esc(initials(u?.name))}</span><div><div class="w"><b>${esc(u?.name || 'Deleted user')}</b>${u?.id === n.author_id ? '<span class="badge badge-new">Author</span>' : ''}<time>${esc(timeAgo(cm.created_at))}</time>${me && (me.id === cm.user_id || mine) ? `<button class="del" data-del="${cm.id}">Delete</button>` : ''}</div><div class="b">${esc(cm.body)}</div></div></div>`; }).join('') || `<p class="small" style="color:var(--rd-muted);padding:12px 0">No comments yet. Be the first.</p>`}`;
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
      <form id="loginForm" novalidate><div class="field"><label for="li_id">Username or email</label><input class="input" id="li_id" autocomplete="username" required></div>
      <div class="field"><label for="li_pw">Password</label><input class="input" id="li_pw" type="password" autocomplete="current-password" required></div>
      <div class="form-error" id="err" role="alert"></div><button class="btn btn-primary btn-block btn-lg" type="submit">Log in</button></form>
      <p class="alt">New here? <a href="#/signup">Create an account</a></p>
      <div class="demo">Demo accounts: <code>demo</code> <code>maravoss</code> <code>juneokafor</code> <code>theolind</code> · password <code>chapterhouse</code></div></section>`;
    $('#loginForm').addEventListener('submit', async (e) => { e.preventDefault(); try { const u = await auth.login($('#li_id').value, $('#li_pw').value); toast(`Logged in as ${u.name}`); go(query.next || '/'); } catch (err) { $('#err').textContent = err.message; } });
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
    $('#signupForm').addEventListener('submit', async (e) => { e.preventDefault(); try { const u = await auth.signup({ name: $('#su_name').value, username: $('#su_user').value.trim(), email: $('#su_email').value.trim(), password: $('#su_pw').value }); toast(`Welcome, ${u.name}`); go(query.next || '/'); } catch (err) { $('#err').textContent = err.message; } });
  });

  /* 6g. Profile + notifications -------------------------------------------- */
  route('/u/:username', async ({ app, params }) => {
    const u = api.users.byUsername(params.username); if (!u) return notFound(app, 'No one has that username.');
    setTitle(u.name); const me = auth.current(); const mine = me && me.id === u.id;
    const published = api.novels.byAuthor(u.id).filter(api.novels.isPublic);
    const subs = api.subscriptions.forUser(u.id).map((s) => api.novels.byId(s.novel_id)).filter((n) => n && api.novels.isPublic(n));
    app.innerHTML = `<header class="profile-head"><span class="avatar lg" aria-hidden="true">${esc(initials(u.name))}</span><div><h1>${esc(u.name)}</h1><div class="h">@${esc(u.username)} · joined ${esc(fmtDate(u.created_at))}</div><p class="bio">${esc(u.bio) || (mine ? 'Add a short bio so readers know who you are.' : '')}</p></div>${mine ? '<button class="btn btn-ghost btn-sm" id="editProfile">Edit profile</button><button class="btn btn-soft btn-sm" id="logoutBtn">Log out</button>' : ''}</header>
      <div id="profileEdit"></div>
      <section class="section"><div class="section-head"><h2>${mine ? 'Your series' : `Series by ${esc(u.name)}`}</h2></div><div class="grid">${published.map(sCard).join('') || `<div class="empty" style="grid-column:1/-1"><h3>Nothing published yet</h3><p>${mine ? 'Series you publish show up here.' : 'Check back later.'}</p>${mine ? '<a class="btn btn-sm" href="#/studio">Open Studio</a>' : ''}</div>`}</div></section>
      <section class="section"><div class="section-head"><h2>Subscriptions<span class="sub">${subs.length}</span></h2></div><div class="grid">${subs.map(sCard).join('') || `<div class="empty" style="grid-column:1/-1"><h3>No subscriptions yet</h3><p>Subscribe to a series and new chapters will show up in your notifications.</p><a class="btn btn-ghost btn-sm" href="#/browse">Browse series</a></div>`}</div></section>`;
    $('#logoutBtn')?.addEventListener('click', () => { auth.logout(); toast('Logged out'); go('/'); });
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
    app.innerHTML = `<div class="studio-head"><div><h1>Notifications</h1><p class="lead">New chapters from series you subscribe to.</p></div></div>
      <ul class="notif">${list.map((x) => { const n = api.novels.byId(x.novel_id); const c = api.chapters.byId(x.chapter_id); if (!n || !c) return ''; const a = api.users.byId(n.author_id); const i = api.novels.published(n.id).indexOf(c); return `<li class="${x.read_at ? '' : 'unread'}"><a href="#/novel/${esc(n.slug)}">${thumb(n, { sm: true, badge: false })}</a><div><a class="t" href="#/novel/${esc(n.slug)}/ch/${i + 1}">${esc(a.name)} posted Chapter ${c.chapter_number} of ${esc(n.title)}: ${esc(c.title)}</a><div class="m">${esc(timeAgo(x.created_at))}</div></div></li>`; }).join('') || `<li style="display:block;padding:0"><div class="empty"><h3>Nothing yet</h3><p>Subscribe to a series and you will hear about every new chapter here.</p><a class="btn btn-ghost btn-sm" href="#/browse">Browse series</a></div></li>`}</ul>`;
    await api.notifications.markAllRead(me.id); renderShell();
  });

  /* 6h. Studio dashboard ---------------------------------------------------- */
  route('/studio', async ({ app }) => {
    if (!requireAuth('/studio')) return;
    setTitle('Studio'); const me = auth.current(); const list = api.novels.byAuthor(me.id);
    app.innerHTML = `<header class="studio-head"><div><h1>Studio</h1><p class="lead">Your series, drafts and chapters.</p></div><button class="btn btn-primary" id="newNovel">New series</button></header>
      <ul class="st-rows">${list.map((n) => { const all = api.novels.all(n.id); const pub = all.filter((c) => c.status === 'published'); const live = api.novels.isPublic(n); const drafts = all.length - pub.length; return `<li>${thumb(n, { sm: true, badge: false })}<div><a class="t" href="#/studio/novel/${n.id}">${esc(n.title || 'Untitled series')}</a><div class="m"><span class="badge ${live ? 'badge-live' : 'badge-draft'}">${live ? (n.status === 'completed' ? 'COMPLETED' : 'LIVE') : 'DRAFT'}</span><span>${pub.length} published${drafts ? ` · ${drafts} draft${drafts > 1 ? 's' : ''}` : ''}</span><span>${compact(api.novels.subscribers(n))} subscribers</span><span>${n.update_day !== null ? DAYS_LONG[n.update_day] + 's' : 'no release day'}</span></div></div><div class="a"><a class="btn btn-soft btn-sm" href="#/studio/novel/${n.id}">Manage</a>${live ? `<a class="btn btn-ghost btn-sm" href="#/novel/${esc(n.slug)}">View</a>` : ''}</div></li>`; }).join('') || `<li style="display:block"><div class="empty"><h3>Start your first series</h3><p>Create a series, add chapters, publish when ready. Drafts stay private.</p><button class="btn" id="newNovel2">New series</button></div></li>`}</ul>`;
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
        <div class="pub-state ${live ? 'live' : ''}">${live ? `<b>Live.</b> Readers can find it at <a href="#/novel/${esc(n.slug)}">/novel/${esc(n.slug)}</a>. ${pubCount} of ${plural(chs.length, 'chapter')} published · ${compact(api.novels.subscribers(n))} subscribers.` : n.status !== 'draft' ? '<b>Published, but hidden.</b> No published chapters yet, so readers cannot see it. Publish a chapter to go live.' : '<b>Draft.</b> Only you can see this series. Publishing any chapter makes it live and notifies subscribers.'}</div>
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

  async function publishChapter(id) {
    const c = api.chapters.byId(id); const n = api.novels.byId(c.novel_id);
    if (!c.title.trim()) { toast('Give the chapter a title before publishing'); return false; }
    if (wordCount(c.content) === 0) { toast('The chapter is empty. Write something first.'); return false; }
    if (!n.title.trim()) { toast('Give the series a title before publishing'); return false; }
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
    body.addEventListener('input', () => { words(); markDirty(); }); title.addEventListener('input', markDirty); note.addEventListener('input', () => { words(); markDirty(); });
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
    db = load(); if (!db || db.version !== 2) { db = await seed(); save(); }
    $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#searchInput').value.trim(); go(q ? `/browse?q=${encodeURIComponent(q)}` : '/browse'); });
    window.addEventListener('hashchange', render);
    if (!location.hash) location.hash = '#/';
    render();
  }
  window.chapterhouse = { reset: async () => { localStorage.removeItem(KEY); localStorage.removeItem('chapterhouse.v2.prefs'); sessionStorage.clear(); db = await seed(); save(); go('/'); render(); toast('Demo data reset'); } };
  init();
})();
