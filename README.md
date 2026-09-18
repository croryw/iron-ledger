# Iron Ledger — setup

A shared gym check-in board. Installs to the iPhone home screen like a real
app, syncs live between phones, costs nothing to run.

You can be on several boards at once — different friends, different groups.
**A check-in belongs to you, not to a board:** log the gym once and every board
you're on updates. Goals, comments and nudges stay per board.

No terminal needed. Two free accounts, about 15 minutes.

---

## What you're setting up

| Piece | Who hosts it | Cost |
|---|---|---|
| The app itself (these files) | GitHub Pages | Free |
| The shared data | Supabase (Postgres + realtime) | Free tier |

Both free tiers are enormous next to what two people generate — you'd need
roughly 20,000 check-ins a day to trouble either one.

---

## Step 1 — Supabase (the database)

1. Go to **supabase.com** and sign up. Signing in with a Google account is fine.
2. **New project.** Name it `iron-ledger`, choose the region closest to you
   (`West EU (London)` if you're in the UK), and set a database password.
   Save the password somewhere — you won't need it for this, but you'll want it
   if you ever come back.
3. Wait about two minutes while it provisions.
4. In the left sidebar open **SQL Editor** → **New query**. Open
   `supabase-setup.sql` from this folder, paste the whole thing in, and press
   **Run**. It should say *Success*.

   ⚠️ That script drops any older Iron Ledger tables first. Running it on a
   project that already has data will delete that data.
5. Go to **Project Settings** (the gear) → **API Keys**. Copy two things:
   - The **API URL** — under **Data API** (older projects call it *Project URL*);
     looks like `https://abcdefgh.supabase.co`
   - The **publishable** key — starts `sb_publishable_…`

   Supabase renamed these in 2025. If your project still shows the old
   scheme, the equivalent is the **anon public** key (starting `eyJ…`) on
   the *Legacy API keys* tab — both work identically. Never use the
   **secret** key (or legacy `service_role`): it bypasses every security
   rule and must not go in a web page.

### Turn off email confirmation

Still in Supabase: **Authentication** → **Sign In / Providers** → **Email**, and
switch **Confirm email** OFF, then save.

Leave it on and every new account has to click a link in an email — and
Supabase's built-in mail service is rate-limited to a couple of messages an
hour, so in practice the email won't arrive and nobody can get in. (If you'd
rather keep confirmation on, connect your own SMTP under Project Settings →
Auth → SMTP first.)

## Step 2 — Paste those two values in

Open `config.js` in any text editor and put them between the quotes:

```js
window.IRON_LEDGER_CONFIG = {
  SUPABASE_URL:  "https://abcdefgh.supabase.co",
  SUPABASE_ANON: "sb_publishable_AbCdEf123…"
};
```

Save it. (If you skip this, the app still runs — it just says **Demo mode** and
keeps everything in your own browser, which is useful for a look around but
won't sync to anyone.)

## Step 3 — GitHub Pages (the hosting)

1. Go to **github.com** and sign up.
2. Click **New repository**. Name it `iron-ledger`, leave it **Public**,
   click **Create repository**.
3. On the empty repo page click **uploading an existing file**.
4. Drag in *everything* from this folder — `index.html`, `app.js`, `styles.css`,
   `config.js`, `sw.js`, `manifest.webmanifest`, and the whole `icons` folder.
   `index.html` must end up at the top level of the repo, not inside a subfolder.
5. Click **Commit changes**.
6. Go to **Settings** → **Pages**. Under *Source* choose **Deploy from a
   branch**, branch **main**, folder **/ (root)**, and **Save**.
7. Wait a minute or two, then refresh. GitHub shows your URL:
   `https://YOUR-USERNAME.github.io/iron-ledger/`

That URL is your app. It's served over HTTPS, which the service worker and
"Add to Home Screen" both require.

## Step 4 — Install it and invite your friend

1. Open the URL in **Safari** on your iPhone (it has to be Safari — Chrome on
   iOS can't install web apps).
2. **Share** → **Add to Home Screen**. You'll get the comet icon and it opens
   without browser chrome.
3. Open it, **Create an account** (name, email, password), then **Create** a
   board and give it a name.
4. Hit **Send the link**. Your friend opens it, makes their own account, and
   taps **Join this board**. Tell them to add it to their home screen too.

Everyone signs in, so the app knows who you are on any device — open the same
account on your phone and your laptop and it's the same you.

### More than one board

Tap **← all boards** at the top to see everything you're on, switch between
them, or start another. When you log a session it counts on all of them at
once. Each board keeps its own weekly goal and its own conversation.

---

## Changing things later

Edit the file in GitHub's web interface (click the file → the pencil icon →
**Commit changes**) and the site updates in about a minute.

**One catch:** the service worker caches the app so it works offline, so after
changing `app.js`, `styles.css` or `index.html` you must also bump the version
in `sw.js`:

```js
const CACHE = 'iron-ledger-v7';   // was v6
```

Otherwise phones keep serving the old copy.

---

## What this setup does and doesn't protect

Everyone signs in, and the database enforces the rules rather than trusting the
app. Specifically:

- You can only read a board you are a member of.
- You can only see someone's attendance if you share a board with them.
- You can only write check-ins, comments and reactions as yourself.
- You can only add or remove *yourself* from a board.

These are Postgres row-level security policies, so they hold even if somebody
opens the browser console and calls the database directly.

The remaining soft spot is the invite: anyone holding a board link can join that
board. Board links are random UUIDs and can't be guessed, but treat one like a
door key — don't post it publicly. If a link gets out, the fix is to leave that
board and make a new one.

The publishable key in `config.js` is public by design and grants nothing on its
own; every request is still checked against the policies above.

---

## Adding push notifications later

Not included here on purpose — it's a separate chunk of work and the app is
useful without it. When you want it:

1. Generate VAPID keys.
2. Store each device's push subscription in a new `push_subs` table.
3. Write a Supabase Edge Function that fires on a new `checkin` or `nudge` row
   and sends a web push to the *other* member.
4. Ask for notification permission in the app — on iOS, only after it's been
   added to the home screen; Safari won't offer it to a normal browser tab.

iOS has supported web push for home screen apps since 16.4, so this genuinely
works without an App Store listing.

---

## If something's wrong

**Page is blank** — open the URL on a desktop browser, press F12, and look at
the Console tab. Nine times out of ten it's a typo in `config.js`.

**Banner says "Not configured"** — `config.js` is empty or the values are wrong.

**"Check your email for the confirmation link"** — email confirmation is still
switched on in Supabase. Turn it off (Step 1) and create the account again.

**Your friend sees "Your boards" and no board** — they opened the bare site URL
instead of your board link. Send them the full link including the `#/b/…` part.

**"new row violates row-level security policy"** — the SQL in
`supabase-setup.sql` didn't finish. Re-run the whole file.

**Changes aren't showing up** — bump `CACHE` in `sw.js` (see above), then on the
phone delete the home screen icon and re-add it.

**"Failed to fetch" errors** — the Supabase project may have paused. Free
projects pause after a week of no activity; open the Supabase dashboard and
resume it. Daily use keeps it awake.

---

## The files

| File | What it is |
|---|---|
| `index.html` | The shell. Loads everything else. |
| `app.js` | The whole app — state, sync, rendering. |
| `styles.css` | All styling, light and dark themes. |
| `config.js` | Your two Supabase values. The only file you edit. |
| `sw.js` | Service worker: offline support and caching. |
| `manifest.webmanifest` | Makes it installable. Name, icon, colours. |
| `icons/` | App icons for the home screen. |
| `supabase-setup.sql` | Database tables and security rules. Run once. |
