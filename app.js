/* 3. Data API (Supabase Integration) ------------------------------------ */
  const api = {
    users: {
      async byId(id) {
        const { data, error } = await supabase.from('users').select('*').eq('id', id).single();
        if (error) { console.error('Error fetching user by ID:', error); return null; }
        return data;
      },
      async byUsername(username) {
        const { data, error } = await supabase.from('users').select('*').ilike('username', username).single();
        if (error) { return null; }
        return data;
      },
      async update(id, patch) {
        const { data, error } = await supabase.from('users').update(patch).eq('id', id).select().single();
        if (error) console.error('Error updating user:', error);
        return data;
      },
    },
    novels: {
      async byId(id) {
        const { data, error } = await supabase.from('novels').select('*').eq('id', id).single();
        if (error) return null;
        return data;
      },
      async bySlug(slug) {
        const { data, error } = await supabase.from('novels').select('*').eq('slug', slug).single();
        if (error) return null;
        return data;
      },
      async published(novelId) {
        const { data, error } = await supabase
          .from('chapters')
          .select('*')
          .eq('novel_id', novelId)
          .eq('status', 'published')
          .order('chapter_number', { ascending: true });
        if (error) return [];
        return data;
      },
      async all(novelId) {
        const { data, error } = await supabase
          .from('chapters')
          .select('*')
          .eq('novel_id', novelId)
          .order('chapter_number', { ascending: true });
        if (error) return [];
        return data;
      },
      isPublic(n) {
        return n.status !== 'draft';
      },
      async listPublic() {
        const { data, error } = await supabase.from('novels').select('*').neq('status', 'draft');
        if (error) return [];
        return data;
      },
      async byAuthor(authorId) {
        const { data, error } = await supabase
          .from('novels')
          .select('*')
          .eq('author_id', authorId)
          .order('updated_at', { ascending: false });
        if (error) return [];
        return data;
      },
      async subscribers(n) {
        const { count, error } = await supabase
          .from('subscriptions')
          .select('*', { count: 'exact', head: true })
          .eq('novel_id', n.id);
        if (error) return n.subscriber_offset || 0;
        return (count || 0) + (n.subscriber_offset || 0);
      },
      async stats(n) {
        const chs = await api.novels.published(n.id);
        const words = chs.reduce((a, c) => a + wordCount(c.content), 0);
        const likes = chs.reduce((a, c) => a + (c.likes || 0), 0);
        
        const chapterIds = chs.map(c => c.id);
        let commentsCount = 0;
        if (chapterIds.length > 0) {
          const { count } = await supabase
            .from('chapter_comments')
            .select('*', { count: 'exact', head: true })
            .in('chapter_id', chapterIds);
          commentsCount = count || 0;
        }

        const subs = await api.novels.subscribers(n);
        return { 
          chapters: chs.length, 
          words, 
          likes, 
          comments: commentsCount, 
          subs, 
          views: n.views || 0, 
          trend: (n.views || 0) + subs * 12 + likes * 3 + commentsCount * 5 
        };
      },
      hasUpToday(n) {
        return (n.last_published_at || 0) > now() - DAY;
      },
      isNew(n) {
        return n.created_at > now() - 21 * DAY;
      },
      async create(authorId) {
        const n = { 
          id: 'n_' + uid(), 
          slug: 'untitled-' + uid(), 
          author_id: authorId, 
          title: '', 
          synopsis: '', 
          cover_image: '', 
          cover_color: COVERS[Math.floor(Math.random() * COVERS.length)], 
          genres: [], 
          tags: [], 
          status: 'draft', 
          update_day: null, 
          featured: false, 
          views: 0, 
          subscriber_offset: 0, 
          created_at: now(), 
          updated_at: now(), 
          last_published_at: null 
        };
        const { data, error } = await supabase.from('novels').insert([n]).select().single();
        if (error) console.error('Error creating novel:', error);
        return data || n;
      },
      async update(id, patch) {
        if (patch.title !== undefined) {
          let base = slugify(patch.title || 'untitled');
          patch.slug = base;
        }
        patch.updated_at = now();
        const { data, error } = await supabase.from('novels').update(patch).eq('id', id).select().single();
        if (error) console.error('Error updating novel:', error);
        return data;
      },
      async setStatus(id, status) {
        const { data, error } = await supabase.from('novels').update({ status, updated_at: now() }).eq('id', id).select().single();
        if (error) console.error('Error setting novel status:', error);
        return data;
      },
      async remove(id) {
        const { error } = await supabase.from('novels').delete().eq('id', id);
        if (error) console.error('Error deleting novel:', error);
      },
      async recordView(novelId, chapterId) {
        const k = 'v:' + chapterId; 
        if (sessionStorage.getItem(k)) return; 
        sessionStorage.setItem(k, '1');
        
        // Fetch current views and increment
        const nov = await api.novels.byId(novelId);
        const chp = await api.chapters.byId(chapterId);
        if (nov) await supabase.from('novels').update({ views: (nov.views || 0) + 1 }).eq('id', novelId);
        if (chp) await supabase.from('chapters').update({ views: (chp.views || 0) + 1 }).eq('id', chapterId);
      },
    },
    chapters: {
      async byId(id) {
        const { data, error } = await supabase.from('chapters').select('*').eq('id', id).single();
        if (error) return null;
        return data;
      },
      async create(novelId) {
        const allChs = await api.novels.all(novelId);
        const c = { 
          id: 'c_' + uid(), 
          novel_id: novelId, 
          chapter_number: allChs.length + 1, 
          title: '', 
          content: '', 
          author_note: '', 
          status: 'draft', 
          views: 0, 
          likes: 0, 
          created_at: now(), 
          updated_at: now(), 
          published_at: null 
        };
        const { data, error } = await supabase.from('chapters').insert([c]).select().single();
        if (error) console.error('Error creating chapter:', error);
        return data || c;
      },
      async update(id, patch) {
        if (patch.content !== undefined) patch.content = sanitize(patch.content);
        if (patch.author_note !== undefined) patch.author_note = String(patch.author_note).slice(0, 1000);
        patch.updated_at = now();
        
        const { data, error } = await supabase.from('chapters').update(patch).eq('id', id).select().single();
        if (error) console.error('Error updating chapter:', error);
        return data;
      },
      async publish(id) {
        const c = await api.chapters.byId(id); 
        const n = await api.novels.byId(c.novel_id);
        const first = !c.published_at;
        
        const updateData = {
          status: 'published',
          published_at: c.published_at || now(),
          updated_at: now()
        };
        await supabase.from('chapters').update(updateData).eq('id', id);

        const novelWentLive = n.status === 'draft';
        const newNovelStatus = novelWentLive ? 'ongoing' : n.status;
        
        await supabase.from('novels').update({ 
          last_published_at: now(), 
          updated_at: now(),
          status: newNovelStatus
        }).eq('id', n.id);

        let notified = 0;
        if (first) {
          const { data: subs } = await supabase.from('subscriptions').select('*').eq('novel_id', n.id);
          if (subs) {
            for (const s of subs) {
              if (s.user_id !== n.author_id) {
                await supabase.from('notifications').insert([{
                  id: 'nt_' + uid(),
                  user_id: s.user_id,
                  type: 'new_chapter',
                  novel_id: n.id,
                  chapter_id: c.id,
                  created_at: now(),
                  read_at: null
                }]);
                notified++;
              }
            }
          }
        }
        return { chapter: c, novel: n, novelWentLive, notified };
      },
      async unpublish(id) {
        await supabase.from('chapters').update({ status: 'draft', updated_at: now() }).eq('id', id);
      },
      async remove(id) {
        const c = await api.chapters.byId(id);
        await supabase.from('chapters').delete().eq('id', id);
      },
    },
    comments: {
      async forChapter(id) {
        const { data, error } = await supabase
          .from('chapter_comments')
          .select('*')
          .eq('chapter_id', id)
          .order('created_at', { ascending: false });
        if (error) return [];
        return data;
      },
      async add(chapterId, userId, body) {
        const c = { 
          id: 'cm_' + uid(), 
          chapter_id: chapterId, 
          user_id: userId, 
          body: body.trim().slice(0, 2000), 
          created_at: now() 
        };
        const { data, error } = await supabase.from('chapter_comments').insert([c]).select().single();
        if (error) console.error('Error adding comment:', error);
        return data || c;
      },
      async remove(id) {
        await supabase.from('chapter_comments').delete().eq('id', id);
      },
    },
    likes: {
      async has(userId, chapterId) {
        const { data } = await supabase
          .from('chapter_likes')
          .select('*')
          .eq('user_id', userId)
          .eq('chapter_id', chapterId)
          .single();
        return !!data;
      },
      async toggle(userId, chapterId) {
        const hasLiked = await api.likes.has(userId, chapterId);
        const ch = await api.chapters.byId(chapterId);

        if (hasLiked) {
          await supabase.from('chapter_likes').delete().eq('user_id', userId).eq('chapter_id', chapterId);
          await supabase.from('chapters').update({ likes: Math.max(0, (ch.likes || 1) - 1) }).eq('id', chapterId);
          return false;
        } else {
          await supabase.from('chapter_likes').insert([{ user_id: userId, chapter_id: chapterId, created_at: now() }]);
          await supabase.from('chapters').update({ likes: (ch.likes || 0) + 1 }).eq('id', chapterId);
          return true;
        }
      },
    },
    subscriptions: {
      async has(userId, novelId) {
        const { data } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', userId)
          .eq('novel_id', novelId)
          .single();
        return !!data;
      },
      async forUser(userId) {
        const { data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (error) return [];
        return data;
      },
      async toggle(userId, novelId) {
        const isSubbed = await api.subscriptions.has(userId, novelId);
        if (isSubbed) {
          await supabase.from('subscriptions').delete().eq('user_id', userId).eq('novel_id', novelId);
          return false;
        } else {
          await supabase.from('subscriptions').insert([{ user_id: userId, novel_id: novelId, created_at: now() }]);
          return true;
        }
      },
    },
    notifications: {
      async forUser(userId) {
        const { data, error } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });
        if (error) return [];
        return data;
      },
      async unread(userId) {
        const { count, error } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .is('read_at', null);
        if (error) return 0;
        return count || 0;
      },
      async markAllRead(userId) {
        await supabase
          .from('notifications')
          .update({ read_at: now() })
          .eq('user_id', userId)
          .is('read_at', null);
      },
    },
    progress: {
      // Local session/browser storage can still be used for reading progress if desired, 
      // or mapped to a database table if you prefer server-side sync.
      get(userId, novelId) { 
        try { return JSON.parse(localStorage.getItem('progress.' + userId) || '{}')[novelId] || null; } catch { return null; } 
      },
      set(userId, novelId, chapterId) { 
        try {
          const key = 'progress.' + userId;
          const store = JSON.parse(localStorage.getItem(key) || '{}');
          store[novelId] = chapterId;
          localStorage.setItem(key, JSON.stringify(store));
        } catch {} 
      },
      readSet(userId) { 
        const s = new Set(); 
        try { Object.values(JSON.parse(localStorage.getItem('progress.' + userId) || '{}')).forEach((id) => s.add(id)); } catch {} 
        return s; 
      },
    },
  };
