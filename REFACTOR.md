# Chapterhouse v2 — refactoring to a novel platform

This guide walks through turning the v1 codebase (Next.js + Tailwind + Prisma/PostgreSQL, or
Supabase) into an episodic, mobile-first serial platform. It starts with the database and works
up through the frontend. The three files beside this guide (`index.html`, `styles.css`, `app.js`)
are a working prototype of the finished product; its data layer uses the exact table and column
names below, so every function in `app.js` section 3 is the spec for one server call.

Run the prototype from any static host. Demo logins: `demo`, `maravoss`, `juneokafor`, `theolind`,
password `chapterhouse`. `theolind` already has unread notifications; `demo` owns a draft series.
`chapterhouse.reset()` in the console restores the seed.

---

## Step 1. Database and schema refactoring

### 1.1 Rename and reshape the core tables

v1 had `Story` and `Chapter(order)`. v2 uses `novels` and `chapters(chapter_number)`, adds an
author's note, a release day, and a series status that distinguishes *ongoing* from *completed*.

```sql
-- migration 0002_serial_platform.sql (Postgres; works unchanged on Supabase)

ALTER TABLE "Story" RENAME TO novels;
ALTER TABLE novels
  RENAME COLUMN "coverImageUrl" TO cover_image;
ALTER TABLE novels
  ADD COLUMN update_day   smallint CHECK (update_day BETWEEN 0 AND 6),   -- 0 = Sunday, null = no fixed day
  ADD COLUMN subscriber_count integer NOT NULL DEFAULT 0,                 -- denormalised, kept by trigger
  ALTER COLUMN status TYPE text,                                          -- 'draft' | 'ongoing' | 'completed'
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE "Chapter" RENAME TO chapters;
ALTER TABLE chapters
  RENAME COLUMN "storyId" TO novel_id;
ALTER TABLE chapters
  RENAME COLUMN "order" TO chapter_number;
ALTER TABLE chapters
  ADD COLUMN author_note text CHECK (char_length(author_note) <= 1000),
  ADD COLUMN like_count integer NOT NULL DEFAULT 0;
-- chapter_number is 1-based and unique per novel
UPDATE chapters SET chapter_number = chapter_number + 1;
ALTER TABLE chapters ADD CONSTRAINT chapters_novel_number_uniq UNIQUE (novel_id, chapter_number) DEFERRABLE INITIALLY DEFERRED;
```

Making the unique constraint `DEFERRABLE` lets a reorder swap two numbers inside one transaction.

### 1.2 New relationship tables

```sql
CREATE TABLE subscriptions (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id   text NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  notify     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, novel_id)
);
CREATE INDEX subscriptions_novel_idx ON subscriptions (novel_id);

-- v1 "Bookmark" rows become subscriptions
INSERT INTO subscriptions (user_id, novel_id, created_at)
  SELECT "userId", "storyId", "createdAt" FROM "Bookmark" ON CONFLICT DO NOTHING;
DROP TABLE "Bookmark";

ALTER TABLE "Comment" RENAME TO chapter_comments;
ALTER TABLE chapter_comments RENAME COLUMN "chapterId" TO chapter_id;
ALTER TABLE chapter_comments RENAME COLUMN "userId" TO user_id;
CREATE INDEX chapter_comments_chapter_idx ON chapter_comments (chapter_id, created_at DESC);

CREATE TABLE chapter_likes (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chapter_id)
);

CREATE TABLE notifications (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,                       -- 'new_chapter'
  novel_id   text REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id text REFERENCES chapters(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE reading_progress (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  novel_id   text NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id text NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, novel_id)
);
```

### 1.3 The same schema in Prisma

```prisma
enum NovelStatus { draft ongoing completed }
enum ChapterStatus { draft published }

model Novel {
  id              String        @id @default(cuid())
  slug            String        @unique
  authorId        String        @map("author_id")
  author          User          @relation(fields: [authorId], references: [id], onDelete: Cascade)
  title           String        @db.VarChar(120)
  synopsis        String        @default("") @db.VarChar(600)
  coverImage      String?       @map("cover_image")
  coverColor      String        @default("#2b3be8") @map("cover_color")
  genres          String[]                                   // Postgres text[]; two max, enforced in Zod
  tags            String[]
  status          NovelStatus   @default(draft)
  updateDay       Int?          @map("update_day")           // 0..6, null = no fixed day
  featured        Boolean       @default(false)
  viewCount       Int           @default(0) @map("view_count")
  subscriberCount Int           @default(0) @map("subscriber_count")
  lastPublishedAt DateTime?     @map("last_published_at")
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")
  chapters        Chapter[]
  subscriptions   Subscription[]
  notifications   Notification[]
  progress        ReadingProgress[]
  @@index([status, lastPublishedAt(sort: Desc)])
  @@index([status, updateDay])
  @@map("novels")
}

model Chapter {
  id            String        @id @default(cuid())
  novelId       String        @map("novel_id")
  novel         Novel         @relation(fields: [novelId], references: [id], onDelete: Cascade)
  chapterNumber Int           @map("chapter_number")
  title         String        @db.VarChar(140)
  contentJson   Json?         @map("content_json")           // Tiptap document
  content       String        @default("")                   // sanitized HTML for readers
  authorNote    String?       @map("author_note") @db.VarChar(1000)
  wordCount     Int           @default(0) @map("word_count")
  status        ChapterStatus @default(draft)
  viewCount     Int           @default(0) @map("view_count")
  likeCount     Int           @default(0) @map("like_count")
  publishedAt   DateTime?     @map("published_at")
  createdAt     DateTime      @default(now()) @map("created_at")
  updatedAt     DateTime      @updatedAt @map("updated_at")
  comments      ChapterComment[]
  likes         ChapterLike[]
  @@unique([novelId, chapterNumber])
  @@index([novelId, status, chapterNumber])
  @@map("chapters")
}

model Subscription {
  userId    String   @map("user_id")
  novelId   String   @map("novel_id")
  notify    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at")
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  novel     Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  @@id([userId, novelId])
  @@map("subscriptions")
}

model ChapterComment {
  id        String   @id @default(cuid())
  chapterId String   @map("chapter_id")
  userId    String   @map("user_id")
  body      String   @db.VarChar(2000)
  createdAt DateTime @default(now()) @map("created_at")
  chapter   Chapter  @relation(fields: [chapterId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([chapterId, createdAt(sort: Desc)])
  @@map("chapter_comments")
}

model ChapterLike { userId String @map("user_id"); chapterId String @map("chapter_id"); createdAt DateTime @default(now()) @map("created_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade); chapter Chapter @relation(fields: [chapterId], references: [id], onDelete: Cascade)
  @@id([userId, chapterId]) @@map("chapter_likes") }

model Notification { id String @id @default(cuid()); userId String @map("user_id"); type String; novelId String? @map("novel_id"); chapterId String? @map("chapter_id")
  createdAt DateTime @default(now()) @map("created_at"); readAt DateTime? @map("read_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade); novel Novel? @relation(fields: [novelId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt(sort: Desc)]) @@map("notifications") }

model ReadingProgress { userId String @map("user_id"); novelId String @map("novel_id"); chapterId String @map("chapter_id"); updatedAt DateTime @updatedAt @map("updated_at")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade); novel Novel @relation(fields: [novelId], references: [id], onDelete: Cascade)
  @@id([userId, novelId]) @@map("reading_progress") }
```

### 1.4 Row-level security (Supabase) or the equivalent `where` guards (Prisma)

| Table | Read | Write |
|---|---|---|
| novels | public when `status <> 'draft'` and a published chapter exists; author always | author only |
| chapters | public when the novel is public and `status = 'published'`; author always | author only |
| subscriptions | own rows | own rows (insert/delete) |
| chapter_comments | public | own rows insert; delete own, or any on your own novel's chapters |
| chapter_likes | own rows | own rows |
| notifications | own rows | server only (service role) |
| reading_progress | own rows | own rows |

```sql
-- example Supabase policy for chapters
CREATE POLICY "read published chapters" ON chapters FOR SELECT USING (
  status = 'published' AND EXISTS (SELECT 1 FROM novels n WHERE n.id = chapters.novel_id AND n.status <> 'draft')
  OR auth.uid()::text = (SELECT author_id FROM novels WHERE id = chapters.novel_id)
);
```

### 1.5 Keep subscriber_count current

```sql
CREATE OR REPLACE FUNCTION bump_subscriber_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN UPDATE novels SET subscriber_count = subscriber_count + 1 WHERE id = NEW.novel_id;
  ELSE UPDATE novels SET subscriber_count = subscriber_count - 1 WHERE id = OLD.novel_id; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER subscriptions_count AFTER INSERT OR DELETE ON subscriptions FOR EACH ROW EXECUTE FUNCTION bump_subscriber_count();
```

The same pattern keeps `chapters.like_count` in step with `chapter_likes`.

---

## Step 2. Author Studio (creator dashboard)

Routes (Next.js App Router):

```
app/studio/layout.tsx                      requireUser(); sidebar-less, mobile-first
app/studio/page.tsx                        <SeriesRows>  — every novel with LIVE/DRAFT/COMPLETED badge,
                                           published vs draft chapter counts, subscriber count, release day
app/studio/novel/[id]/page.tsx             <NovelDetailsForm> + <PublishState> + <ChapterRows>
app/studio/novel/[id]/ch/[chapterId]/page.tsx   <ChapterEditor>
```

Server actions in `actions/novels.ts` and `actions/chapters.ts` mirror `api.novels.*` and
`api.chapters.*` in the prototype: `createNovel`, `updateNovel`, `setNovelStatus`, `deleteNovel`,
`createChapter`, `saveChapterDraft`, `publishChapter`, `unpublishChapter`, `moveChapter`,
`deleteChapter`. Every one validates with Zod and puts the ownership check in the Prisma `where`:

```ts
export async function saveChapterDraft(input: unknown) {
  const me = await requireUser();
  const data = z.object({
    chapterId: z.string(), title: z.string().max(140),
    contentJson: tiptapDoc, authorNote: z.string().max(1000).optional().default(''),
  }).parse(input);
  const content = sanitize(generateHTML(data.contentJson, extensions));
  return db.chapter.update({
    where: { id: data.chapterId, novel: { authorId: me.id } },
    data: { title: data.title, contentJson: data.contentJson, content, authorNote: data.authorNote, wordCount: countWords(content) },
  });
}
```

**NovelDetailsForm** fields: title, synopsis (600), up to two genres, tags, release day (select,
Monday to Sunday or none), status (ongoing/completed; drafts stay draft until first publish),
cover (colour swatch or square image upload).

**ChapterEditor**: Tiptap StarterKit + Underline, with these toolbar items only: bold, italic,
underline, heading, quote, bullet list, numbered list, scene break, plain. Autosave 1.5 s after the
last keystroke, Ctrl/Cmd+S saves immediately, `beforeunload` guard. Below the body sits the
**Author's note** card: a plain textarea, 1,000 characters, with a counter. It is stored on the
chapter row and rendered after the chapter text in the reader.

Buttons: *Save draft*, *Publish chapter* (becomes *Update chapter* + *Unpublish* once live).

---

## Step 3. Immersive reader (continuous scroll)

Route: `app/novel/[slug]/ch/[n]/page.tsx`. `n` is the 1-based position among published chapters.

The page server-renders chapter `n` and ships the ordered list of published chapter ids and titles.
Everything else is one client component, `<ReaderCanvas>`, which does what the prototype does:

1. **Continuous scroll.** A sentinel `div` after each chapter is watched with an
   `IntersectionObserver` (`rootMargin: 600px`). When it comes into view the next chapter is
   fetched from `GET /api/novels/[slug]/chapters/[n+1]` and appended with a dashed divider.
2. **Current chapter tracking.** A second observer on each chapter header (`rootMargin: -40% 0 -55%`)
   decides which chapter is "current", then updates the top bar title, the dropdown, the URL via
   `history.replaceState`, and `reading_progress` (debounced server action).
3. **Hide-on-scroll chrome.** Scrolling down past 80 px hides both bars; scrolling up brings them
   back. Chrome never hides while the settings panel is open (reflow from a line-spacing change
   nudges scroll position and would otherwise close it).
4. **Settings panel**: theme (light/sepia/dark), text size 14–26 px, line spacing (1.5/1.7/1.95),
   typeface (Literata serif or Sora sans). Stored in `localStorage` and applied as CSS custom
   properties and a `data-theme` attribute on the reader root, so switching is a repaint, not a
   re-render.
5. **Bottom bar**: Prev, a `<select>` of every chapter, Next. Arrow keys also navigate.
6. After each chapter: the author's note (if any), like button, subscribe button, *Next chapter*,
   then that chapter's comments. The last chapter ends with "You are caught up" and the release day.

Reader CSS tokens: `--rd-bg`, `--rd-fg`, `--rd-muted`, `--rd-line`, `--rd-card`, `--rd-size`,
`--rd-lh`, overridden per theme in `styles.css` under `.reader[data-theme]`.

---

## Step 4. Community engagement and subscriptions

### Subscribe

`toggleSubscription(novelId)` inserts or deletes a `subscriptions` row. The button appears on the
novel landing page, after every chapter, and in the "caught up" card. The novel's
`subscriber_count` is denormalised by trigger (1.5) so listing pages never aggregate.

### Notifications on publish

`publishChapter` runs in one transaction and fans out to subscribers only on the **first** publish
of a chapter (republishing an edit does not spam):

```ts
export async function publishChapter(chapterId: string) {
  const me = await requireUser();
  const r = await db.$transaction(async (tx) => {
    const ch = await tx.chapter.findFirstOrThrow({ where: { id: chapterId, novel: { authorId: me.id } }, include: { novel: true } });
    if (!ch.title.trim() || ch.wordCount === 0) throw new PublishError('Give the chapter a title and some text first.');
    const first = !ch.publishedAt;
    await tx.chapter.update({ where: { id: chapterId }, data: { status: 'published', publishedAt: ch.publishedAt ?? new Date() } });
    const novelWentLive = ch.novel.status === 'draft';
    const novel = await tx.novel.update({ where: { id: ch.novelId }, data: { status: novelWentLive ? 'ongoing' : ch.novel.status, lastPublishedAt: new Date() } });
    let notified = 0;
    if (first) {
      const subs = await tx.subscription.findMany({ where: { novelId: novel.id, notify: true, NOT: { userId: me.id } }, select: { userId: true } });
      await tx.notification.createMany({ data: subs.map((s) => ({ userId: s.userId, type: 'new_chapter', novelId: novel.id, chapterId })) });
      notified = subs.length;
    }
    return { novel, novelWentLive, notified };
  });
  revalidatePath('/'); revalidatePath(`/novel/${r.novel.slug}`); revalidatePath(`/daily/${r.novel.updateDay ?? ''}`);
  // optional: enqueue email/push via a job table or Supabase Edge Function
  return r;
}
```

With Supabase, replace the `createMany` with a Postgres trigger on `chapters`
(`AFTER UPDATE OF status WHEN NEW.status='published' AND OLD.published_at IS NULL`) that inserts
into `notifications`, and use Realtime on `notifications` to update the bell live.

### Bell and notification page

`<AccountMenu>` fetches `count(*) FROM notifications WHERE user_id = me AND read_at IS NULL` and
shows a badge. `/notifications` lists items ("Mara Voss posted Chapter 3 of A Lesser Sun: The
clock") and marks all as read on open.

### Chapter comments

`<ChapterComments chapterId>` sits at the end of every chapter block in the reader. It lists
`chapter_comments` newest first with an *Author* badge when the commenter owns the novel, and a
form for logged-in readers. Delete is allowed for the comment's author or the novel's author.
Rate-limit `addComment` (e.g. 10/min/user) and keep the 2,000-character cap on the server.

---

## Step 5. Homepage and discovery

- `/` renders the **weekly schedule** (day tabs, today highlighted, series with `update_day = today`),
  an editor's pick, **Rising now** (score = views + 12·subscribers + 3·likes + 5·comments, 7-day
  window, materialised nightly into `novels.trend_score`), **New series**, and one rail per genre.
- `/daily/[d]` is the full schedule for a day.
- `/browse` filters by genre and sorts by trending, subscribers, recently updated, or newest.
- Badges: **UP** when `last_published_at > now() - 1 day`, **NEW** when the series is under 21 days old.

---

## Step 6. Suggested order of work

1. Run the migration (1.1–1.5) against a branch database; regenerate the Prisma client.
2. Replace `Bookmark` usages with `Subscription`; rename `Story` → `Novel` across the codebase
   (`order` → `chapterNumber`).
3. Build the reader (`/novel/[slug]/ch/[n]`) first, because it is the product; port
   `<ReaderCanvas>` from the prototype's reader route.
4. Add `author_note` to the editor and `publishChapter` notifications; verify the fan-out with two
   test accounts, as the prototype's walkthrough does.
5. Replace the v1 homepage with the schedule + rails; add `/daily/[d]`.
6. Move the v1 bookmark list on profiles to "Subscriptions".
7. Delete the v1 story and reader routes.
