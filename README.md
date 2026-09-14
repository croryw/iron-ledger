# Iron Ledger — setup

A shared gym check-in board for two or three people. Installs to the iPhone
home screen like a real app, syncs live between phones, costs nothing to run.

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
5. Go to **Project Settings** (the gear) → **API Keys**. Copy two things:
   - The **API URL** — under **Data API** (older projects call it *Project URL*);
     looks like `https://abcdefgh.supabase.co`
   - The **publishable** key — starts `sb_publishable_…`

   Supabase renamed these in 2025. If your project still shows the old
   scheme, the equivalent is the **anon public** key (starting `eyJ…`) on
   the *Legacy API keys* tab — both work identically. Never use the
   **secret** key (or legacy `service_role`): it bypasses every security
   rule and must not go in a web page.

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
2. **Share** → **Add to Home Screen**. You'll get the barbell icon and it opens
   without browser chrome.
3. Open it, type your name, **Start a board**.
4. Hit **Send the link** and send it to your friend. They open it, type their
   name, and they're on. Tell them to add it to their home screen too.

That link is the board. Anyone who has it is on it, so don't post it publicly.

---

## Changing things later

Edit the file in GitHub's web interface (click the file → the pencil icon →
**Commit changes**) and the site updates in about a minute.

**One catch:** the service worker caches the app so it works offline, so after
changing `app.js`, `styles.css` or `index.html` you must also bump the version
in `sw.js`:

```js
const CACHE = 'iron-ledger-v2';   // was v1
```

Otherwise phones keep serving the old copy.

---

## What this setup does and doesn't protect

There's no login, by design — asking your friend to make an account is the
fastest way to never get them on the board. Security is the secret link: whoever
holds it can read and write that board.

Practically, for two people logging gym visits, that's fine. Be aware that:

- The Supabase publishable key sits in `config.js`, which is public. That's
  what it's for, but it means someone who found your site could in principle read the
  boards in your project. Don't put anything private in here.
- Anyone you send the link to keeps access until you delete the board.

**If you ever want it properly locked down**, the upgrade is Supabase
*anonymous sign-in* plus row-level policies keyed to a `room_members` table, so
the database enforces membership rather than trusting the link. It's maybe an
hour of work and doesn't change the user experience at all — nobody types a
password either way.

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

**Banner says "Demo mode"** — `config.js` is empty or the values are wrong.

**Your friend sees an empty board** — they opened the bare site URL instead of
your board link. Send them the full link including the `#/b/…` part.

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
| `supabase-setup.sql` | Database tables and rules. Run once. |
