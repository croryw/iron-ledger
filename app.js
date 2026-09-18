/* ============================================================
   Iron Ledger  —  v2

   Design rules this file is built around:
     1. Answering your partner outranks logging yourself.
     2. The unit of value is the group, not the individual.
     3. Streaks count weeks you hit your goal; rest weeks never
        break them. No loss-aversion, no shaming copy.
     4. A check-in belongs to YOU, not to a board. Log the gym
        once and every board you're on sees it.
     5. What people SAY about a check-in stays on the board it
        was said on. Shared attendance, separate conversations.
   ============================================================ */
(function () {
  "use strict";

  /* ---------------- constants ---------------- */

  var PC = ["var(--p1)", "var(--p2)", "var(--p3)", "var(--p4)", "var(--p5)"];
  var RX = ["💪", "🔥", "👏", "🫡", "👀"];
  var DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var NUDGES = [
    "I'll go if you go",
    "no pressure — just saying the gym exists",
    "fancy one today?",
    "your move",
    "thinking of you and your squat rack",
    "shall we?"
  ];
  var NUDGE_COOLDOWN_H = 20;
  var ANSWER_WINDOW_DAYS = 4;
  var HISTORY_DAYS = 400;

  var cfg = window.IRON_LEDGER_CONFIG || {};
  var CONFIGURED = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON && window.supabase);
  var sb = CONFIGURED
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON, {
        auth: { persistSession: true, autoRefreshToken: true },
        realtime: { params: { eventsPerSecond: 4 } }
      })
    : null;

  /* ---------------- small helpers ---------------- */

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function dkey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function fromKey(k) { var a = String(k).slice(0, 10).split("-"); return new Date(+a[0], +a[1] - 1, +a[2]); }
  function today() { return dkey(new Date()); }
  function daysAgoKey(n) { var d = new Date(); d.setDate(d.getDate() - n); return dkey(d); }
  function weekStart(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function weekKeys(s) {
    var out = [], i;
    for (i = 0; i < 7; i++) out.push(dkey(new Date(s.getFullYear(), s.getMonth(), s.getDate() + i)));
    return out;
  }
  function dayDiff(a, b) { return Math.round((fromKey(b) - fromKey(a)) / 86400000); }
  function initials(n) { return String(n).trim().slice(0, 2).toUpperCase(); }
  function ago(ts) {
    var m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    var d = Math.floor(h / 24);
    return d === 1 ? "yesterday" : d + "d ago";
  }
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 2800);
  }
  function burst(el, count) {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      var r = el.getBoundingClientRect();
      var layer = document.createElement("div");
      layer.className = "sparks";
      layer.style.left = (r.left + r.width / 2) + "px";
      layer.style.top = (r.top + r.height / 2) + "px";
      var cols = ["--p1", "--p2", "--p3", "--p4", "--p5", "--accent", "--accent-2", "--good"];
      var n = count || 18;
      for (var i = 0; i < n; i++) {
        var s = document.createElement("i");
        var a = Math.PI * 2 * (i / n) + (Math.random() - 0.5) * 0.4;
        var d = (count ? 34 : 70) + Math.random() * (count ? 26 : 80);
        s.style.setProperty("--dx", (Math.cos(a) * d).toFixed(1) + "px");
        s.style.setProperty("--dy", (Math.sin(a) * d * 0.85).toFixed(1) + "px");
        s.style.setProperty("--rot", (Math.random() * 360 | 0) + "deg");
        s.style.background = "var(" + cols[i % cols.length] + ")";
        s.style.animationDelay = (Math.random() * 70 | 0) + "ms";
        if (i % 3 === 0) {
          s.style.borderRadius = "3px";
          s.style.width = "9px"; s.style.height = "13px";
          s.style.margin = "-6px 0 0 -4.5px";
        }
        layer.appendChild(s);
      }
      document.body.appendChild(layer);
      setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, 1000);
    } catch (e) {}
  }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }
  function unwrap(res) { if (res.error) throw res.error; return res.data; }

  /* ============================================================
     State
     ============================================================ */

  var App = {
    booted: false,
    user: null,          // auth user
    profile: null,       // { id, name }
    myBoards: [],        // [{ board_id, goal, boards:{id,name} }]
    route: { name: "boards", boardId: null },
    d: null,             // loaded board data
    loading: true,
    error: null,
    notice: null,
    authMode: "in",      // "in" | "up"
    authBusy: false,
    authMsg: null,
    openComment: null,   // checkin id whose comment box is open
    showTable: false,    // the numbers-instead-of-charts view
    openItem: null,      // a collapsed thread row the reader opened
    justChecked: false,
    unsub: null
  };
  var root = $("root");

  function parseRoute() {
    var m = /#\/b\/([0-9a-fA-F-]{8,})/.exec(location.hash || "");
    if (m) return { name: "board", boardId: m[1] };
    if (/#\/me/.test(location.hash || "")) return { name: "me", boardId: null };
    return { name: "boards", boardId: null };
  }
  function go(hash) {
    if ((location.hash || "") === hash) return;
    location.hash = hash;
  }
  function uid() { return App.user ? App.user.id : null; }

  /* ============================================================
     Loading
     ============================================================ */

  function loadMyBoards() {
    return sb.from("board_members")
      .select("board_id, goal, boards(id,name)")
      .eq("user_id", uid())
      .then(unwrap)
      .then(function (rows) {
        App.myBoards = (rows || []).filter(function (r) { return r.boards; });
        return App.myBoards;
      });
  }

  function loadBoardsScreen() {
    var since = daysAgoKey(HISTORY_DAYS);
    return loadMyBoards().then(function (rows) {
      var ids = rows.map(function (r) { return r.board_id; });
      return Promise.all([
        ids.length
          ? sb.from("board_members").select("board_id, user_id, profiles(name)").in("board_id", ids).then(unwrap)
          : Promise.resolve([]),
        sb.from("checkins").select("*").eq("user_id", uid()).gte("day", since).then(unwrap)
      ]).then(function (r) {
        App.d = { rosters: r[0] || [], myCheckins: r[1] || [] };
      });
    });
  }

  /* The private log. These two tables are readable only by their
     owner, so there is no board in this query at all. */
  function loadMeScreen() {
    var since = daysAgoKey(HISTORY_DAYS);
    return Promise.all([
      loadMyBoards(),
      sb.from("meals").select("*").eq("user_id", uid()).gte("day", since).order("day").then(unwrap),
      sb.from("weights").select("*").eq("user_id", uid()).gte("day", since).order("day").then(unwrap)
    ]).then(function (r) {
      App.d = { meals: r[1] || [], weights: r[2] || [] };
    });
  }

  function loadBoard(boardId) {
    var since = daysAgoKey(HISTORY_DAYS);
    return Promise.all([
      sb.from("boards").select("*").eq("id", boardId).maybeSingle().then(unwrap),
      sb.from("board_members").select("*, profiles(id,name)").eq("board_id", boardId)
        .order("joined_at").then(unwrap)
    ]).then(function (r) {
      var board = r[0], members = r[1] || [];
      if (!board) return { missing: true };
      var mine = members.filter(function (m) { return m.user_id === uid(); })[0];
      if (!mine) return { board: board, members: [], isMember: false };

      var userIds = members.map(function (m) { return m.user_id; });
      return Promise.all([
        sb.from("checkins").select("*").in("user_id", userIds).gte("day", since).then(unwrap),
        sb.from("rest_weeks").select("*").in("user_id", userIds).then(unwrap),
        sb.from("comments").select("*").eq("board_id", boardId).order("created_at").then(unwrap),
        sb.from("reactions").select("*").eq("board_id", boardId).then(unwrap),
        sb.from("events").select("*").eq("board_id", boardId)
          .order("created_at", { ascending: false }).limit(40).then(unwrap)
      ]).then(function (x) {
        return {
          board: board, members: members, isMember: true, me: mine,
          checkins: x[0] || [], rest: x[1] || [], comments: x[2] || [],
          reactions: x[3] || [], events: x[4] || []
        };
      });
    });
  }

  function load() {
    if (!App.user) { App.loading = false; return render(); }
    App.loading = true;
    var r = App.route;
    var job = r.name === "board"
      ? loadMyBoards().then(function () { return loadBoard(r.boardId); }).then(function (d) {
          if (d.missing) {
            App.d = null;
            App.error = "That board doesn't exist. The link may be wrong, or it was deleted.";
          } else { App.d = d; App.error = null; }
        })
      : r.name === "me"
        ? loadMeScreen().then(function () { App.error = null; })
        : loadBoardsScreen().then(function () { App.error = null; });

    return job.then(function () {
      App.loading = false;
      render();
    }).catch(function (e) {
      App.loading = false;
      App.error = (e && e.message) || "Couldn't reach the database.";
      render();
    });
  }

  var reloadTimer = null;
  function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 300); }

  function watch() {
    if (App.unsub) { App.unsub(); App.unsub = null; }
    if (!App.user) return;
    var ch = sb.channel("il:" + (App.route.boardId || "boards") + ":" + uid());
    // Board-scoped tables filter server-side; the person-scoped ones
    // rely on row-level security to deliver only what we may see.
    ["comments", "reactions", "events", "board_members"].forEach(function (t) {
      ch.on("postgres_changes",
        App.route.boardId
          ? { event: "*", schema: "public", table: t, filter: "board_id=eq." + App.route.boardId }
          : { event: "*", schema: "public", table: t },
        scheduleReload);
    });
    ["checkins", "rest_weeks", "meals", "weights"].forEach(function (t) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, scheduleReload);
    });
    ch.subscribe();
    App.unsub = function () { sb.removeChannel(ch); };
  }

  function act(promise) {
    return Promise.resolve(promise).then(load).catch(function (e) {
      toast((e && e.message) || "That didn't save — try again");
    });
  }

  /* ============================================================
     Derived numbers
     ============================================================ */

  function daysOf(userId) {
    var s = {};
    (App.d.checkins || []).forEach(function (c) {
      if (c.user_id === userId) s[String(c.day).slice(0, 10)] = c;
    });
    return s;
  }
  function isResting(userId, weekKey) {
    return (App.d.rest || []).some(function (r) {
      return r.user_id === userId && String(r.week).slice(0, 10) === weekKey;
    });
  }
  function stats(m) {
    var days = daysOf(m.user_id);
    var wk = weekKeys(weekStart(new Date()));
    var thisWeek = wk.filter(function (k) { return days[k]; }).length;
    var goal = Math.max(1, m.goal || 3);

    var weeks = {};
    Object.keys(days).forEach(function (k) {
      var w = dkey(weekStart(fromKey(k)));
      weeks[w] = (weeks[w] || 0) + 1;
    });

    var streak = 0, cur = weekStart(new Date()), i = 0, first = true;
    while (i < 200) {
      var wkey = dkey(cur);
      var hit = (weeks[wkey] || 0) >= goal;
      var rest = isResting(m.user_id, wkey);
      if (hit) streak++;
      else if (rest) { /* holds */ }
      else if (!first) break;
      first = false;
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - 7);
      i++;
    }

    // A softer run that still means something on the weeks you fell
    // short: consecutive weeks with at least one session in them.
    var showed = 0, c2 = weekStart(new Date()), j = 0, f2 = true;
    while (j < 200) {
      var k2 = dkey(c2);
      if ((weeks[k2] || 0) > 0 || isResting(m.user_id, k2)) showed++;
      else if (!f2) break;
      f2 = false;
      c2 = new Date(c2.getFullYear(), c2.getMonth(), c2.getDate() - 7);
      j++;
    }
    var best = 0;
    Object.keys(weeks).forEach(function (w) { if (weeks[w] > best) best = weeks[w]; });

    var last = null;
    Object.keys(days).forEach(function (k) { if (!last || k > last) last = k; });

    return {
      goal: goal, thisWeek: thisWeek, total: Object.keys(days).length, streak: streak,
      showed: showed, best: best,
      resting: isResting(m.user_id, dkey(weekStart(new Date()))),
      last: last, since: last ? dayDiff(last, today()) : null
    };
  }
  function groupStats() {
    var ms = App.d.members, sum = 0, goal = 0;
    ms.forEach(function (m) { var s = stats(m); sum += s.thisWeek; goal += s.goal; });
    var allWeeks = {};
    (App.d.checkins || []).forEach(function (c) {
      allWeeks[dkey(weekStart(fromKey(String(c.day).slice(0, 10))))] = 1;
    });
    var together = 0;
    Object.keys(allWeeks).forEach(function (w) {
      if (!ms.length) return;
      var ok = ms.every(function (m) {
        if (isResting(m.user_id, w)) return true;
        var days = daysOf(m.user_id);
        var n = weekKeys(fromKey(w)).filter(function (k) { return days[k]; }).length;
        return n >= Math.max(1, m.goal || 3);
      });
      if (ok) together++;
    });
    return { sum: sum, goal: Math.max(1, goal), together: together };
  }
  function nameOf(userId) {
    var m = (App.d.members || []).filter(function (x) { return x.user_id === userId; })[0];
    return m && m.profiles ? m.profiles.name : "someone";
  }
  function memberOf(userId) {
    return (App.d.members || []).filter(function (x) { return x.user_id === userId; })[0];
  }
  function reactionsFor(cid) {
    return (App.d.reactions || []).filter(function (r) { return r.checkin_id === cid; });
  }
  function commentsFor(cid) {
    return (App.d.comments || []).filter(function (c) { return c.checkin_id === cid; });
  }
  function waitingOnMe() {
    if (!App.d || !App.d.isMember) return [];
    var t = today();
    return (App.d.checkins || [])
      .filter(function (c) {
        if (c.user_id === uid()) return false;
        var d = String(c.day).slice(0, 10);
        if (dayDiff(d, t) > ANSWER_WINDOW_DAYS) return false;
        var answered = reactionsFor(c.id).some(function (r) { return r.user_id === uid(); })
          || commentsFor(c.id).some(function (x) { return x.user_id === uid(); });
        return !answered;
      })
      .sort(function (a, b) { return String(b.day).localeCompare(String(a.day)); });
  }

  /* ============================================================
     Actions
     ============================================================ */

  var actions = {
    /* ---- account ---- */
    authmode: function (el) {
      App.authMode = el.getAttribute("data-mode");
      App.authMsg = null;
      render();
    },
    signin: function () {
      var email = ($("email") || {}).value, pw = ($("password") || {}).value;
      var name = ($("yourname") || {}).value;
      if (!email || !pw) { toast("Email and password, please"); return; }
      App.authBusy = true; App.authMsg = null; render();

      var p = App.authMode === "up"
        ? sb.auth.signUp({
            email: email.trim(), password: pw,
            options: { data: { name: (name || "").trim() || email.split("@")[0] } }
          })
        : sb.auth.signInWithPassword({ email: email.trim(), password: pw });

      p.then(function (res) {
        App.authBusy = false;
        if (res.error) {
          App.authMsg = res.error.message;
          // "already registered" almost always means they meant to sign in.
          if (/already registered|already exists/i.test(res.error.message)) {
            App.authMode = "in";
            App.authMsg = "That email already has an account — sign in instead.";
          }
          render();
          return;
        }
        if (!res.data.session) {
          // Email confirmation is switched on for this project.
          App.authMsg = "Account made. Check your email for the confirmation link "
            + "— or switch off \"Confirm email\" in Supabase → Authentication → Sign In / Providers.";
          render();
          return;
        }
        // onAuthStateChange takes it from here.
      }, function (e) {
        App.authBusy = false;
        App.authMsg = (e && e.message) || "That didn't work";
        render();
      });
    },
    signout: function () {
      sb.auth.signOut().then(function () {
        App.user = null; App.profile = null; App.myBoards = []; App.d = null;
        App.authMode = "in";          // come back to the sign-in form, not sign-up
        App.authMsg = null;
        App.authBusy = false;
        go("#/boards");
        render();
      });
    },

    /* ---- boards ---- */
    newboard: function () {
      var el = $("boardname");
      var name = (el && el.value || "").trim() || "Our board";
      sb.from("boards").insert({ name: name.slice(0, 40), created_by: uid() })
        .select().single().then(unwrap)
        .then(function (b) {
          return sb.from("board_members")
            .insert({ board_id: b.id, user_id: uid(), goal: 3, color: 0 }).then(function (r) {
              if (r.error) throw r.error;
              return sb.from("events").insert({ board_id: b.id, user_id: uid(), kind: "join" });
            }).then(function () { return b; });
        })
        .then(function (b) { go("#/b/" + b.id); })
        .catch(function (e) { toast((e && e.message) || "Couldn't create that board"); });
    },
    openboard: function (el) { go("#/b/" + el.getAttribute("data-id")); },
    boards: function () { go("#/boards"); },
    joinboard: function () {
      var bid = App.route.boardId;
      var color = 0;
      sb.from("board_members").insert({ board_id: bid, user_id: uid(), goal: 3, color: color })
        .then(function (r) { if (r.error) throw r.error; })
        .then(function () { return sb.from("events").insert({ board_id: bid, user_id: uid(), kind: "join" }); })
        .then(load)
        .catch(function (e) { toast((e && e.message) || "Couldn't join"); });
    },
    leaveboard: function () {
      if (!window.confirm("Leave this board? Your gym history stays with you — you just drop off this group.")) return;
      sb.from("board_members").delete().eq("board_id", App.route.boardId).eq("user_id", uid())
        .then(function () { go("#/boards"); load(); })
        .catch(function (e) { toast((e && e.message) || "Couldn't leave"); });
    },

    /* ---- attendance ---- */
    checkin: function (el) {
      if (el && el.classList) {
        el.classList.remove("pop");
        void el.offsetWidth;
        el.classList.add("pop");
        el.textContent = "Nice one!";
        el.disabled = true;
        burst(el);
      }
      buzz(18);
      App.justChecked = true;
      setTimeout(function () {
        act(sb.from("checkins").insert({ user_id: uid(), day: today() }).then(function (r) {
          if (r.error && r.error.code !== "23505") throw r.error;
        }));
      }, 380);
    },
    undo: function () {
      act(sb.from("checkins").delete().eq("user_id", uid()).eq("day", today()));
    },
    toggleday: function (el) {
      var day = el.getAttribute("data-day");
      var have = (App.d.checkins || []).some(function (c) {
        return c.user_id === uid() && String(c.day).slice(0, 10) === day;
      });
      if (!have) { burst(el, 8); buzz(12); }
      act(have
        ? sb.from("checkins").delete().eq("user_id", uid()).eq("day", day)
        : sb.from("checkins").insert({ user_id: uid(), day: day }).then(function (r) {
            if (r.error && r.error.code !== "23505") throw r.error;
          }));
    },
    expand: function (el) {
      var id = el.getAttribute("data-id");
      App.openItem = App.openItem === id ? null : id;
      render();
    },
    rest: function () {
      var w = dkey(weekStart(new Date()));
      var on = isResting(uid(), w);
      act(on
        ? sb.from("rest_weeks").delete().eq("user_id", uid()).eq("week", w)
        : sb.from("rest_weeks").insert({ user_id: uid(), week: w }).then(function (r) {
            if (r.error && r.error.code !== "23505") throw r.error;
          }));
    },

    /* ---- talking to each other ---- */
    react: function (el) {
      var cid = el.getAttribute("data-id"), em = el.getAttribute("data-em");
      var mineR = reactionsFor(cid).filter(function (r) {
        return r.user_id === uid() && r.emoji === em;
      })[0];
      if (!mineR) { burst(el, 7); buzz(12); }
      act(mineR
        ? sb.from("reactions").delete().eq("id", mineR.id)
        : sb.from("reactions").insert({
            board_id: App.route.boardId, checkin_id: cid, user_id: uid(), emoji: em
          }).then(function (r) { if (r.error && r.error.code !== "23505") throw r.error; }));
    },
    opencomment: function (el) {
      var cid = el.getAttribute("data-id");
      App.openComment = App.openComment === cid ? null : cid;
      render();
      var box = $((App.openComment ? "c-" + App.openComment : ""));
      if (box) box.focus();
    },
    comment: function (el) {
      var cid = el.getAttribute("data-id");
      var input = $(el.getAttribute("data-input") || ("c-" + cid));
      var body = (input && input.value || "").trim();
      if (!body) { if (input) input.focus(); return; }
      input.value = "";
      App.openComment = null;
      act(sb.from("comments").insert({
        board_id: App.route.boardId, checkin_id: cid, user_id: uid(), body: body.slice(0, 280)
      }));
    },
    delcomment: function (el) {
      act(sb.from("comments").delete().eq("id", el.getAttribute("data-id")));
    },
    nudge: function (el) {
      var to = el.getAttribute("data-id");
      act(sb.from("events").insert({
        board_id: App.route.boardId, user_id: uid(), kind: "nudge", target_user_id: to,
        body: NUDGES[Math.floor(Math.random() * NUDGES.length)]
      }));
      toast("Sent");
    },

    /* ---- your settings on this board ---- */
    goal: function (el) {
      var d = +el.getAttribute("data-d");
      var m = App.d.me;
      act(sb.from("board_members")
        .update({ goal: Math.min(7, Math.max(1, (m.goal || 4) + d)) })
        .eq("board_id", App.route.boardId).eq("user_id", uid()));
    },
    nudges: function () {
      var m = App.d.me;
      act(sb.from("board_members").update({ nudges_on: !m.nudges_on })
        .eq("board_id", App.route.boardId).eq("user_id", uid()));
    },
    rename: function () {
      var v = window.prompt("Your name", App.profile ? App.profile.name : "");
      if (v === null) return;
      v = v.trim(); if (!v) return;
      act(sb.from("profiles").update({ name: v.slice(0, 24) }).eq("id", uid())
        .then(function () { if (App.profile) App.profile.name = v.slice(0, 24); }));
    },

    /* ---- the private log ---- */
    me: function () { go("#/me"); },
    meal: function (el) {
      var d = +el.getAttribute("data-d");
      var row = todaysMeals();
      var next = Math.max(0, (row ? row.count : 0) + d);
      if (d > 0) { burst(el, 7); buzz(12); }
      act(row
        ? sb.from("meals").update({ count: next, updated_at: new Date().toISOString() }).eq("id", row.id)
        : sb.from("meals").insert({ user_id: uid(), day: today(), count: next }));
    },
    mealgoal: function (el) {
      var d = +el.getAttribute("data-d");
      var g = Math.min(10, Math.max(1, mealGoal() + d));
      act(sb.from("profiles").update({ meal_goal: g }).eq("id", uid())
        .then(function () { if (App.profile) App.profile.meal_goal = g; }));
    },
    unit: function () {
      var u = weightUnit() === "kg" ? "lb" : "kg";
      act(sb.from("profiles").update({ weight_unit: u }).eq("id", uid())
        .then(function () { if (App.profile) App.profile.weight_unit = u; }));
    },
    weigh: function () {
      var el = $("weightin");
      var v = parseFloat((el && el.value || "").replace(",", "."));
      if (!v || v <= 0) { toast("Enter a number first"); if (el) el.focus(); return; }
      var kg = weightUnit() === "lb" ? v / 2.2046226 : v;
      if (kg < 20 || kg > 400) { toast("That doesn't look right — check the units"); return; }
      kg = Math.round(kg * 100) / 100;
      var row = todaysWeight();
      if (el) el.value = "";
      act(row
        ? sb.from("weights").update({ kg: kg }).eq("id", row.id)
        : sb.from("weights").insert({ user_id: uid(), day: today(), kg: kg }));
    },
    unweigh: function (el) {
      act(sb.from("weights").delete().eq("id", el.getAttribute("data-id")));
    },
    table: function () { App.showTable = !App.showTable; render(); },

    /* ---- sharing ---- */
    share: function () {
      var url = boardUrl();
      if (navigator.share) {
        navigator.share({ title: "Iron Ledger", text: "Keep me honest about the gym?", url: url })
          .catch(function () {});
        return;
      }
      copy(url);
    },
    copy: function () { copy(boardUrl()); }
  };

  function boardUrl() {
    return location.origin + location.pathname + "#/b/" + App.route.boardId;
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast("Link copied"); },
        function () { window.prompt("Copy this link", text); });
    } else { window.prompt("Copy this link", text); }
  }

  root.addEventListener("click", function (ev) {
    var el = ev.target.closest("[data-act]");
    if (!el) return;
    var fn = actions[el.getAttribute("data-act")];
    if (fn) { ev.preventDefault(); fn(el); }
  });
  root.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    var t = ev.target;
    if (!t || t.tagName !== "INPUT") return;
    var row = t.closest(".sayrow");
    if (row) {
      var btn = row.querySelector("[data-act]");
      if (btn) { ev.preventDefault(); actions[btn.getAttribute("data-act")](btn); }
      return;
    }
    if (t.id === "boardname") { ev.preventDefault(); actions.newboard(); }
    else if (t.id === "email" || t.id === "password" || t.id === "yourname") {
      ev.preventDefault(); actions.signin();
    }
  });

  /* ============================================================
     Render
     ============================================================ */

  function render() {
    var a = document.activeElement;
    var keep = a && a.tagName === "INPUT" && a.id
      ? { id: a.id, value: a.value, pos: a.selectionStart } : null;

    root.innerHTML = '<div class="wrap">' + view() + "</div>" + navBar();
    App.justChecked = false;
    App.notice = null;

    if (keep) {
      var el = $(keep.id);
      if (el) {
        el.value = keep.value;
        try { el.setSelectionRange(keep.pos, keep.pos); } catch (e) {}
        el.focus();
      }
    }
  }

  /* Three destinations deserve three tabs, not links buried under
     four screens of scrolling. */
  function navBar() {
    if (!CONFIGURED || !App.booted || !App.user) return "";
    var r = App.route.name;
    var boardId = App.route.boardId
      || (App.myBoards.length === 1 ? App.myBoards[0].board_id : null);
    var h = '<nav class="tabs" aria-label="Sections">'
      + '<button class="tab' + (r === "boards" ? " on" : "") + '" data-act="boards">Boards</button>';
    if (boardId) {
      // The middle tab wears the board's own name — "Boards" and
      // "Board" side by side was a coin toss.
      var bm = App.myBoards.filter(function (x) { return x.board_id === boardId; })[0];
      var nm = (bm && bm.boards && bm.boards.name) || (App.d && App.d.board && App.d.board.name) || "Board";
      if (nm.length > 14) nm = nm.slice(0, 13).replace(/\s+$/, "") + "…";
      h += '<button class="tab' + (r === "board" ? " on" : "") + '" data-act="openboard" '
        + 'data-id="' + boardId + '">' + esc(nm) + "</button>";
    }
    h += '<button class="tab' + (r === "me" ? " on" : "") + '" data-act="me">My log</button>';
    return h + "</nav>";
  }

  function whoTag() {
    return App.profile ? '<span class="who-name">' + esc(App.profile.name) + "</span>" : "";
  }
  function masthead(right) {
    return '<header class="mast"><div class="mark"><span class="comet" aria-hidden="true"></span>'
      + "<h1>Iron Ledger</h1></div>"
      + '<div class="when">' + (right || "") + "</div></header>";
  }

  function view() {
    if (!CONFIGURED) {
      return masthead("") + '<div class="banner warn"><b>Not configured.</b> Add your Supabase '
        + "API URL and publishable key to <code>config.js</code>, then reload.</div>";
    }
    if (!App.booted) return masthead("") + '<div class="boot">Starting up…</div>';
    if (!App.user) return authView();
    if (App.loading && !App.d) return masthead("") + '<div class="boot">Loading…</div>';
    if (App.error) {
      return masthead("") + '<div class="banner warn">' + esc(App.error) + "</div>"
        + '<div class="field"><button class="btn ghost" data-act="boards">Back to your boards</button></div>';
    }
    if (App.route.name === "board") return boardView();
    if (App.route.name === "me") return meView();
    return boardsView();
  }

  /* ---------- signed out ---------- */

  function authView() {
    var up = App.authMode === "up";
    var h = masthead("");
    h += '<section class="panel">'
      + '<h2 class="headline">' + (up ? "Make an account" : "Welcome back") + "</h2>"
      + '<p class="sub">One account covers every board you\'re on. Log the gym once and '
      + "all of them update.</p>";
    if (App.authMsg) h += '<div class="banner warn">' + esc(App.authMsg) + "</div>";
    if (up) {
      h += '<div class="field"><input id="yourname" type="text" maxlength="24" placeholder="Your name" '
        + 'autocomplete="name" autocapitalize="words" autocorrect="off" spellcheck="false"></div>';
    }
    h += '<div class="field"><input id="email" type="email" placeholder="Email" '
      + 'autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false" '
      + 'inputmode="email" enterkeyhint="next"></div>'
      + '<div class="field"><input id="password" type="password" placeholder="Password" '
      + 'autocomplete="' + (up ? "new-password" : "current-password") + '" enterkeyhint="go"></div>'
      + '<div class="field"><button class="btn" data-act="signin"' + (App.authBusy ? " disabled" : "") + '>'
      + (App.authBusy ? "One moment…" : (up ? "Create account" : "Sign in")) + "</button></div>"
      + '<div class="note">' + (up
        ? 'Already have one? <button class="linkish" data-act="authmode" data-mode="in">Sign in</button>'
        : 'New here? <button class="linkish" data-act="authmode" data-mode="up">Create an account</button>')
      + "</div></section>";
    return h;
  }

  /* ---------- your boards ---------- */

  function boardsView() {
    var h = masthead(whoTag());
    var rosters = (App.d && App.d.rosters) || [];
    var mine = (App.d && App.d.myCheckins) || [];
    var wk = weekKeys(weekStart(new Date()));
    var set = {}; mine.forEach(function (c) { set[String(c.day).slice(0, 10)] = 1; });
    var thisWeek = wk.filter(function (k) { return set[k]; }).length;
    var wentToday = !!set[today()];

    h += '<section class="panel' + (wentToday ? " done" : "") + '">'
      + '<div class="eyebrow">' + thisWeek + " session" + (thisWeek === 1 ? "" : "s") + " this week</div>"
      + (wentToday
          ? '<div class="doneline"><span class="tick" aria-hidden="true">✓</span>'
            + '<h2 class="headline" style="margin-right:auto">You went today</h2>'
            + '<button class="btn ghost tiny" data-act="undo">Undo</button></div>'
            + '<div class="sub">Counted on every board you\'re on.</div>'
          : '<button class="bigbtn" data-act="checkin">I went today</button>')
      + "</section>";

    h += '<section class="sect"><div class="sect-head"><h2>Your boards</h2></div>';
    if (!App.myBoards.length) {
      h += '<div class="empty">No boards yet. Make one below, or open an invite link '
        + "someone sent you.</div>";
    } else {
      h += '<div class="boardlist">';
      App.myBoards.forEach(function (r, i) {
        var people = rosters.filter(function (x) { return x.board_id === r.board_id; });
        var names = people.map(function (x) { return x.profiles ? x.profiles.name : "?"; });
        h += '<button class="boardcard" data-act="openboard" data-id="' + r.board_id + '" '
          + 'style="--pc:' + PC[i % PC.length] + '">'
          + '<span class="bname">' + esc(r.boards.name) + "</span>"
          + '<span class="bmeta">' + esc(names.join(" · ") || "just you")
          + " · goal " + (r.goal || 4) + "×</span></button>";
      });
      h += "</div>";
    }
    h += "</section>";

    h += '<section class="panel">'
      + '<div class="eyebrow">Start another</div>'
      + '<div class="field"><input id="boardname" type="text" maxlength="40" '
      + 'placeholder="Board name — e.g. Sam &amp; me" autocapitalize="words" enterkeyhint="go">'
      + '<button class="btn" data-act="newboard">Create</button></div>'
      + '<div class="note">Different friends, different boards. Your attendance is shared '
      + "across all of them; goals and chat are per board.</div></section>";

    h += '<section class="panel quiet">'
      + '<div class="eyebrow">Just for you</div>'
      + '<h2 class="headline">Meals and weight</h2>'
      + '<p class="sub">A private log — meals you\'ve eaten today, and your weight if you '
      + "want to track it. Nobody on any board can see either one.</p>"
      + '<div class="field"><button class="btn ghost" data-act="me">Open your log</button></div>'
      + "</section>";

    h += '<div class="footer"><span>Signed in as ' + esc(App.profile ? App.profile.name : "") + "</span>"
      + '<button class="linkish" data-act="signout">Sign out</button></div>';
    return h;
  }

  /* ---------- one board ---------- */

  function boardView() {
    var d = App.d;
    if (!d) return masthead("") + '<div class="boot">Loading…</div>';

    if (!d.isMember) {
      return masthead("")
        + '<section class="panel invite">'
        + '<div class="eyebrow">You\'ve been invited</div>'
        + '<h2 class="headline">' + esc(d.board.name) + "</h2>"
        + '<p class="sub">Join and your gym history comes with you — including anything '
        + "you've already logged on other boards.</p>"
        + '<div class="field"><button class="btn" data-act="joinboard">Join this board</button>'
        + '<button class="btn ghost" data-act="boards">Not now</button></div></section>';
    }

    var wkS = weekStart(new Date());
    var wk = weekKeys(wkS);
    var td = today();
    var range = fromKey(wk[0]).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      + " – " + fromKey(wk[6]).toLocaleDateString(undefined, { month: "short", day: "numeric" });

    var h = masthead("week of " + esc(range));

    // board switcher
    h += '<div class="switcher"><button class="linkish" data-act="boards">← all boards</button>'
      + '<span class="bnow">' + esc(d.board.name) + "</span></div>";

    var waiting = waitingOnMe();
    var wentToday = (d.checkins || []).some(function (c) {
      return c.user_id === uid() && String(c.day).slice(0, 10) === td;
    });

    if (d.members.length < 2) {
      h += '<section class="panel invite">'
        + '<div class="eyebrow">One thing left to do</div>'
        + '<h2 class="headline">This only works with someone else on it.</h2>'
        + '<p class="sub">Send the link. They make an account, tap join, and they\'re on.</p>'
        + '<div class="field"><button class="btn" data-act="share">Send the link</button>'
        + '<button class="btn ghost" data-act="copy">Copy</button></div>'
        + '<div class="linkbox"><code>' + esc(boardUrl()) + "</code></div></section>";
    }

    if (waiting.length) {
      var c0 = waiting[0];
      var who = memberOf(c0.user_id);
      var d0 = String(c0.day).slice(0, 10);
      var whenWord = d0 === td ? "went today"
        : d0 === daysAgoKey(1) ? "went yesterday"
        : "went " + fromKey(d0).toLocaleDateString(undefined, { weekday: "long" });
      h += '<section class="panel ask" style="--pc:' + PC[(who ? who.color : 0) % PC.length] + '">'
        + '<div class="eyebrow">' + (waiting.length > 1 ? waiting.length + " waiting on you" : "Waiting on you") + "</div>"
        + '<h2 class="headline">' + esc(nameOf(c0.user_id)) + " " + whenWord + ". Say something.</h2>"
        + rxRow(c0.id)
        + sayRow(c0.id, "Nice one, " + nameOf(c0.user_id).split(" ")[0] + "…", "ask", "comment")
        + "</section>";
    }

    var ms = stats(d.me);
    if (wentToday) {
      h += '<section class="panel done' + (App.justChecked ? " celebrate" : "") + '">'
        + '<div class="doneline"><span class="tick" aria-hidden="true">✓</span>'
        + '<h2 class="headline" style="margin-right:auto">You went today</h2>'
        + '<button class="btn ghost tiny" data-act="undo">Undo</button></div>'
        + '<div class="sub">' + ms.thisWeek + " of " + ms.goal + " this week"
        + (ms.thisWeek >= ms.goal ? " — goal hit." : " — " + (ms.goal - ms.thisWeek) + " to go.")
        + (App.myBoards.length === 2 ? " Counted on both your boards."
           : App.myBoards.length > 2 ? " Counted on all " + App.myBoards.length + " of your boards." : "")
        + "</div></section>";
    } else {
      h += '<section class="panel">'
        + '<div class="eyebrow">' + esc(App.profile ? App.profile.name : "you") + " · "
        + ms.thisWeek + "/" + ms.goal + " this week"
        + (ms.resting ? ' · <span class="resting">resting</span>' : "") + "</div>"
        + '<button class="bigbtn" data-act="checkin">I went today</button></section>';
    }

    if (d.members.length > 1) {
      var gs = groupStats();
      h += '<section class="pair"><div class="top">'
        + '<div class="score">' + gs.sum + " <small>of " + gs.goal + " sessions this week</small></div>"
        + '<div class="note">' + esc(d.members.map(function (m) { return m.profiles.name; }).join(" + "))
        + "</div></div>"
        + '<div class="bar">' + d.members.map(function (m) {
            var s = stats(m);
            return '<i style="width:' + (Math.min(s.thisWeek, s.goal) / gs.goal * 100)
              + "%;background:" + PC[m.color % PC.length] + '"></i>';
          }).join("") + "</div>"
        + '<div class="pairfoot">'
        + '<span class="note">' + (gs.together > 0
            ? "<b>" + gs.together + "</b> week" + (gs.together === 1 ? "" : "s") + " everyone hit it"
            : "no week everyone hit it — yet") + "</span>"
        + "</div></section>";
    }

    h += '<section class="sect"><div class="sect-head"><h2>The week so far</h2></div><div class="people">';
    d.members.forEach(function (m) {
      var s = stats(m), col = PC[m.color % PC.length];
      var isMe = m.user_id === uid();
      var pct = Math.min(100, Math.round(s.thisWeek / s.goal * 100));
      h += '<article class="card' + (isMe ? " me" : "") + '" style="--pc:' + col + '">'
        + '<div class="who"><span class="dot" style="background:' + col + '"></span>'
        + '<span class="nm">' + esc(m.profiles.name) + "</span>"
        + (isMe ? '<span class="youtag">you</span>' : "")
        + (s.resting ? '<span class="resting">rest week</span>' : "")
        + "</div>"
        + '<div class="ringrow"><div class="ring" style="--pct:' + pct + '" role="img" aria-label="'
        + s.thisWeek + " of " + s.goal + ' sessions this week"><i>' + s.thisWeek
        + "<span>/" + s.goal + "</span></i></div><div class=\"facts\">"
        + '<div class="fact">' + (s.streak > 0
            ? '<b class="flame">' + s.streak + "</b> week" + (s.streak === 1 ? "" : "s")
              + " hitting " + s.goal + " " + (s.streak > 1 ? "🔥" : "")
            : s.showed > 0
              ? '<b>' + s.showed + "</b> week" + (s.showed === 1 ? "" : "s") + " running"
              : "<b>—</b> nothing logged yet") + "</div>"
        + '<div class="fact">' + (s.last === null ? "no sessions yet"
            : s.since === 0 ? "went today"
            : s.since === 1 ? "went yesterday"
            : '<span class="' + (s.since >= 4 ? "stale" : "") + '">' + s.since + " days ago</span>")
        + "</div>"
        + '<div class="fact note">' + s.total + " all time</div></div></div>"
        + '<div class="cardfoot">';
      if (isMe) {
        h += '<span class="note">Goal</span>'
          + '<span class="step"><button data-act="goal" data-d="-1" aria-label="Lower weekly goal">−</button>'
          + "<span>" + s.goal + "×</span>"
          + '<button data-act="goal" data-d="1" aria-label="Raise weekly goal">+</button></span>'
          + '<button class="btn ghost tiny" data-act="rest">' + (s.resting ? "End rest week" : "Rest week") + "</button>"
          + '<button class="btn ghost tiny" data-act="nudges">Nudges ' + (m.nudges_on === false ? "off" : "on") + "</button>";
      } else {
        h += canNudge(m)
          ? '<button class="btn ghost tiny" data-act="nudge" data-id="' + m.user_id + '">Nudge</button>'
          : '<span class="note">' + (m.nudges_on === false ? "Nudges off" : "Nothing to nag about") + "</span>";
      }
      h += "</div></article>";
    });
    h += "</div></section>";

    h += '<section class="sect"><div class="sect-head"><h2>This week</h2><span class="note">Mon – Sun</span></div>'
      + '<div class="gridwrap"><table class="week"><thead><tr><th class="rowname"></th>';
    wk.forEach(function (k, i) {
      h += "<th" + (k === td ? ' class="today"' : "") + ">" + DAYS[i] + "<br>" + fromKey(k).getDate() + "</th>";
    });
    h += "<th></th></tr></thead><tbody>";
    d.members.forEach(function (m) {
      var col = PC[m.color % PC.length], days = daysOf(m.user_id), s = stats(m);
      h += '<tr><th class="rowname" style="color:' + col + '">' + esc(m.profiles.name) + "</th>";
      var isMine = m.user_id === uid();
      wk.forEach(function (k) {
        var on = !!days[k], fut = k > td;
        var cls = "mk " + (on ? "on" : (fut ? "fut" : ""));
        var inner = on ? "✓" : "";
        h += "<td" + (k === td ? ' class="col-today"' : "") + ">"
          + (isMine && !fut
              ? '<button class="' + cls + ' tap" style="--pc:' + col + '" data-act="toggleday" '
                + 'data-day="' + k + '" aria-label="' + (on ? "Remove" : "Add") + " session on "
                + esc(fromKey(k).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }))
                + '">' + inner + "</button>"
              : '<div class="' + cls + '" style="--pc:' + col + '">' + inner + "</div>")
          + "</td>";
      });
      h += '<td class="tally">' + s.thisWeek + "/" + s.goal + "</td></tr>";
    });
    h += "</tbody></table>"
      + '<div class="note gridhint">Tap any day on your own row to add or remove a session.</div>'
      + "</div></section>";

    h += '<section class="sect"><div class="sect-head"><h2>The thread</h2></div>' + thread(waiting) + "</section>";

    h += '<div class="footer">'
      + '<button class="linkish" data-act="copy">Copy board link</button>'
      + '<button class="linkish" data-act="rename">Change your name</button>'
      + '<button class="linkish" data-act="leaveboard">Leave board</button>'
      + "</div>";
    return h;
  }

  function canNudge(m) {
    if (m.nudges_on === false) return false;
    var s = stats(m);
    if (s.resting) return false;
    if (s.since !== null && s.since < 2) return false;
    var cutoff = Date.now() - NUDGE_COOLDOWN_H * 3600000;
    return !(App.d.events || []).some(function (e) {
      return e.kind === "nudge" && e.user_id === uid() && e.target_user_id === m.user_id
        && new Date(e.created_at).getTime() > cutoff;
    });
  }

  function rxRow(cid) {
    var rs = reactionsFor(cid);
    var h = '<div class="rx">';
    RX.forEach(function (em) {
      var list = rs.filter(function (r) { return r.emoji === em; });
      var mineR = list.some(function (r) { return r.user_id === uid(); });
      h += '<button data-act="react" data-id="' + cid + '" data-em="' + em + '"'
        + (mineR ? ' class="mine"' : "") + ' aria-label="React ' + em + '">' + em
        + (list.length ? '<span class="n">' + list.length + "</span>" : "") + "</button>";
    });
    h += '<button class="cbtn" data-act="opencomment" data-id="' + cid + '" '
      + 'aria-label="Write a comment">💬 <span class="n">comment</span></button>';
    return h + "</div>";
  }
  function sayRow(cid, placeholder, prefix, actName) {
    var inputId = (prefix || "c") + "-" + cid;
    return '<div class="sayrow"><input id="' + inputId + '" type="text" maxlength="280" '
      + 'placeholder="' + esc(placeholder) + '" autocomplete="off" autocapitalize="sentences" '
      + 'enterkeyhint="send">'
      + '<button class="btn" data-act="' + (actName || "comment") + '" data-id="' + cid + '" '
      + 'data-input="' + inputId + '">Send</button></div>';
  }
  function commentList(cid) {
    var cs = commentsFor(cid);
    if (!cs.length) return "";
    return '<div class="replies">' + cs.map(function (c) {
      return '<div class="reply"><b>' + esc(nameOf(c.user_id)) + "</b> " + esc(c.body)
        + (c.user_id === uid()
            ? ' <button class="linkish tinyx" data-act="delcomment" data-id="' + c.id + '">delete</button>'
            : "")
        + "</div>";
    }).join("") + "</div>";
  }

  function weekLabel(wkey) {
    var thisW = dkey(weekStart(new Date()));
    var d = fromKey(thisW);
    var lastW = dkey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7));
    if (wkey === thisW) return "This week";
    if (wkey === lastW) return "Last week";
    return "Week of " + fromKey(wkey).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  /* The thread used to be a wall: every check-in a full card with a
     row of chips. Now only what needs an answer — or what you opened —
     is a card; the rest is one line. */
  function thread(waiting) {
    var waitingIds = {};
    waiting.forEach(function (c) { waitingIds[c.id] = 1; });

    var items = [];
    (App.d.checkins || []).forEach(function (c) {
      var day = String(c.day).slice(0, 10);
      items.push({ ts: new Date(c.created_at || day).getTime(), day: day, kind: "c", c: c });
    });
    (App.d.events || []).forEach(function (e) {
      items.push({ ts: new Date(e.created_at).getTime(),
                   day: String(e.created_at).slice(0, 10), kind: "e", e: e });
    });
    items.sort(function (a, b) { return b.ts - a.ts; });
    if (!items.length) return '<div class="empty">Nothing here yet. Someone has to go first.</div>';

    var order = [], byWeek = {};
    items.forEach(function (it) {
      var w = dkey(weekStart(fromKey(it.day)));
      if (!byWeek[w]) { byWeek[w] = []; order.push(w); }
      byWeek[w].push(it);
    });
    order = order.slice(0, 5);

    return order.map(function (w) {
      return '<div class="tgroup"><div class="tglabel">' + esc(weekLabel(w)) + "</div>"
        + byWeek[w].map(function (it) { return threadItem(it, waitingIds); }).join("")
        + "</div>";
    }).join("");
  }

  function threadItem(it, waitingIds) {
    if (it.kind === "e") {
      var e = it.e;
      var text = e.kind === "nudge"
        ? "<b>" + esc(nameOf(e.user_id)) + "</b> nudged <b>" + esc(nameOf(e.target_user_id))
          + "</b> — " + esc(e.body || "your move")
        : "<b>" + esc(nameOf(e.user_id)) + "</b> joined the board";
      return '<div class="trow sys"><span class="tname">' + text + "</span>"
        + '<span class="tday">' + esc(ago(e.created_at)) + "</span></div>";
    }

    var c = it.c, m = memberOf(c.user_id);
    if (!m) return "";
    var col = PC[m.color % PC.length];
    var day = it.day;
    var mine = c.user_id === uid();
    var open = !!waitingIds[c.id] || App.openItem === c.id;
    var rs = reactionsFor(c.id), cs = commentsFor(c.id);
    var dd = fromKey(day);
    var dayShort = DAYS[(dd.getDay() + 6) % 7] + " " + dd.getDate();

    if (!open) {
      var bits = "";
      if (rs.length) bits += '<span class="tb">' + esc(rs[0].emoji)
        + (rs.length > 1 ? " " + rs.length : "") + "</span>";
      if (cs.length) bits += '<span class="tb">💬 ' + cs.length + "</span>";
      return '<button class="trow" data-act="expand" data-id="' + c.id + '" style="--pc:' + col + '">'
        + '<span class="tdot"></span>'
        + '<span class="tname">' + esc(m.profiles.name) + (mine ? " (you)" : "") + "</span>"
        + '<span class="tday">' + esc(dayShort) + "</span>"
        + '<span class="tmeta">' + bits + "</span></button>";
    }

    return '<div class="item' + (waitingIds[c.id] ? " unanswered" : "") + '" style="--pc:' + col + '">'
      + '<div class="av">' + esc(initials(m.profiles.name)) + '</div><div class="body">'
      + '<div class="line"><b>' + esc(m.profiles.name) + "</b> went to the gym</div>"
      + '<div class="meta">'
      + esc(fromKey(day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }))
      + (c.created_at ? " · " + ago(c.created_at) : "") + "</div>"
      + commentList(c.id)
      + rxRow(c.id)
      + (App.openComment === c.id || waitingIds[c.id]
          ? sayRow(c.id, "Say something…", "c", "comment") : "")
      + (App.openItem === c.id && !waitingIds[c.id]
          ? '<button class="linkish" data-act="expand" data-id="' + c.id + '">close</button>' : "")
      + "</div></div>";
  }


  /* ============================================================
     The private log — meals and weight

     Nothing here is shared. The database policies allow only the
     owner to read these rows, so this page can't leak to a board
     even by mistake.
     ============================================================ */

  function mealGoal() {
    return Math.min(10, Math.max(1, (App.profile && App.profile.meal_goal) || 4));
  }
  function weightUnit() {
    return (App.profile && App.profile.weight_unit) === "lb" ? "lb" : "kg";
  }
  function toUnit(kg) { return weightUnit() === "lb" ? kg * 2.2046226 : kg; }
  function fmtW(kg, dp) { return toUnit(kg).toFixed(dp == null ? 1 : dp); }
  function mealRows() { return (App.d && App.d.meals) || []; }
  function weightRows() { return (App.d && App.d.weights) || []; }
  function todaysMeals() {
    return mealRows().filter(function (m) { return String(m.day).slice(0, 10) === today(); })[0];
  }
  function todaysWeight() {
    return weightRows().filter(function (w) { return String(w.day).slice(0, 10) === today(); })[0];
  }
  function lastDays(n) {
    var out = [], i;
    for (i = n - 1; i >= 0; i--) out.push(daysAgoKey(i));
    return out;
  }

  /* ---------- charts ----------
     One series each, so no legend: the heading names it. Thin
     marks, solid hairline grid, a label only on the endpoint, and
     a hover layer. Every chart has a table twin behind "Show the
     numbers". */

  function lineChart(pts, unit) {
    var W = 320, H = 152, L = 40, R = 14, T = 14, B = 26;
    var pw = W - L - R, ph = H - T - B;
    var ys = pts.map(function (p) { return p.y; });
    var min = Math.min.apply(null, ys), max = Math.max.apply(null, ys);
    var pad = Math.max(0.3, (max - min) * 0.2);
    var lo = min - pad, hi = max + pad;
    if (hi - lo < 0.6) { var mid = (hi + lo) / 2; lo = mid - 0.3; hi = mid + 0.3; }
    var X = function (i) { return L + (pts.length === 1 ? pw / 2 : pw * i / (pts.length - 1)); };
    var Y = function (v) { return T + ph - ph * (v - lo) / (hi - lo); };

    var g = "";
    [0, 0.5, 1].forEach(function (f) {
      var v = lo + (hi - lo) * f, y = Y(v);
      g += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R)
        + '" y2="' + y.toFixed(1) + '" class="grid"/>'
        + '<text x="' + (L - 7) + '" y="' + (y + 3.5).toFixed(1) + '" class="ax ax-y">'
        + v.toFixed(1) + "</text>";
    });

    var d = pts.map(function (p, i) {
      return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p.y).toFixed(1);
    }).join(" ");

    var lastI = pts.length - 1;
    var lx = X(lastI), ly = Y(pts[lastI].y);
    var labelAnchor = "end", labelX = lx - 7;
    if (lastI === 0) { labelAnchor = "middle"; labelX = lx; }

    var hits = pts.map(function (p, i) {
      var band = pts.length > 1 ? pw / (pts.length - 1) : pw;
      var x = Math.max(L, X(i) - band / 2);
      var w = Math.min(band, W - R - x);
      return '<rect class="hit" x="' + x.toFixed(1) + '" y="' + T + '" width="' + w.toFixed(1)
        + '" height="' + ph + '" tabindex="0" data-fx="' + X(i).toFixed(1)
        + '" data-fy="' + Y(p.y).toFixed(1) + '" data-tip="'
        + esc(fromKey(p.x).toLocaleDateString(undefined, { day: "numeric", month: "short" })
              + " · " + p.y.toFixed(1) + " " + unit) + '"/>';
    }).join("");

    return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" '
      + 'aria-label="Your weight over time">'
      + g
      + '<text x="' + L + '" y="' + (H - 7) + '" class="ax">'
      + esc(fromKey(pts[0].x).toLocaleDateString(undefined, { day: "numeric", month: "short" })) + "</text>"
      + '<text x="' + (W - R) + '" y="' + (H - 7) + '" class="ax" text-anchor="end">'
      + esc(fromKey(pts[lastI].x).toLocaleDateString(undefined, { day: "numeric", month: "short" })) + "</text>"
      + '<line class="cross" x1="0" y1="' + T + '" x2="0" y2="' + (T + ph) + '" style="display:none"/>'
      + '<path d="' + d + '" class="series"/>'
      + '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="4" class="end"/>'
      + '<text x="' + labelX.toFixed(1) + '" y="' + (ly - 10).toFixed(1)
      + '" class="endlabel" text-anchor="' + labelAnchor + '">'
      + pts[lastI].y.toFixed(1) + " " + unit + "</text>"
      + '<circle class="focus" r="4" style="display:none"/>'
      + hits
      + "</svg>";
  }

  function barChart(days, goal) {
    var W = 320, H = 138, L = 22, R = 10, T = 14, B = 24;
    var pw = W - L - R, ph = H - T - B;
    var vals = days.map(function (d) { return d.y; });
    var hi = Math.max(goal + 1, Math.max.apply(null, vals) + 1, 3);
    var band = pw / days.length;
    var bw = Math.max(4, band - 3);            // the 3px leaves the surface gap
    var Y = function (v) { return T + ph - ph * (v / hi); };
    var base = T + ph;

    var g = "";
    [0, Math.round(hi / 2), hi].forEach(function (v) {
      var y = Y(v);
      g += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="'
        + y.toFixed(1) + '" class="grid"/>'
        + '<text x="' + (L - 6) + '" y="' + (y + 3.5).toFixed(1) + '" class="ax ax-y">' + v + "</text>";
    });

    var bars = days.map(function (d, i) {
      var x = L + band * i + (band - bw) / 2;
      if (!d.y) return "";
      var y = Y(d.y), h = base - y, r = Math.min(4, bw / 2, h);
      return '<path class="bar" d="M' + x.toFixed(1) + " " + base
        + "L" + x.toFixed(1) + " " + (y + r).toFixed(1)
        + "Q" + x.toFixed(1) + " " + y.toFixed(1) + " " + (x + r).toFixed(1) + " " + y.toFixed(1)
        + "L" + (x + bw - r).toFixed(1) + " " + y.toFixed(1)
        + "Q" + (x + bw).toFixed(1) + " " + y.toFixed(1) + " " + (x + bw).toFixed(1) + " " + (y + r).toFixed(1)
        + "L" + (x + bw).toFixed(1) + " " + base + 'Z"/>';
    }).join("");

    var gy = Y(goal);
    var target = '<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - R) + '" y2="'
      + gy.toFixed(1) + '" class="target"/>'
      + '<text x="' + (W - R) + '" y="' + (gy - 5).toFixed(1)
      + '" class="ax" text-anchor="end">target ' + goal + "</text>";

    var labels = days.map(function (d, i) {
      if (i % 7 !== 0 && i !== days.length - 1) return "";
      var x = L + band * i + band / 2;
      return '<text x="' + x.toFixed(1) + '" y="' + (H - 6) + '" class="ax" text-anchor="middle">'
        + fromKey(d.x).getDate() + "</text>";
    }).join("");

    var hits = days.map(function (d, i) {
      return '<rect class="hit" x="' + (L + band * i).toFixed(1) + '" y="' + T + '" width="'
        + band.toFixed(1) + '" height="' + ph + '" tabindex="0" data-tip="'
        + esc(fromKey(d.x).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })
              + " · " + d.y + " meal" + (d.y === 1 ? "" : "s")) + '"/>';
    }).join("");

    return '<svg class="chart bars" viewBox="0 0 ' + W + " " + H + '" role="img" '
      + 'aria-label="Meals logged per day over the last three weeks">'
      + g + bars + target + labels + hits + "</svg>";
  }

  /* one shared hover layer for every chart */
  function chartTip() {
    var t = $("charttip");
    if (!t) {
      t = document.createElement("div");
      t.id = "charttip";
      document.body.appendChild(t);
    }
    return t;
  }
  function showTipFor(el, clientX, clientY) {
    var t = chartTip();
    t.textContent = el.getAttribute("data-tip");
    t.classList.add("show");
    var w = t.offsetWidth || 120;
    var x = Math.min(Math.max(clientX, w / 2 + 8), window.innerWidth - w / 2 - 8);
    t.style.left = x + "px";
    t.style.top = Math.max(34, clientY - 16) + "px";
    var svg = el.closest("svg");
    if (!svg) return;
    var focus = svg.querySelector(".focus"), cross = svg.querySelector(".cross");
    var fx = el.getAttribute("data-fx"), fy = el.getAttribute("data-fy");
    if (focus && fx) {
      focus.setAttribute("cx", fx); focus.setAttribute("cy", fy);
      focus.style.display = "";
    }
    if (cross && fx) {
      cross.setAttribute("x1", fx); cross.setAttribute("x2", fx);
      cross.style.display = "";
    }
  }
  function hideTip() {
    var t = $("charttip");
    if (t) t.classList.remove("show");
    Array.prototype.forEach.call(root.querySelectorAll(".focus,.cross"), function (n) {
      n.style.display = "none";
    });
  }
  root.addEventListener("pointermove", function (ev) {
    var el = ev.target.closest ? ev.target.closest("[data-tip]") : null;
    if (!el) { hideTip(); return; }
    showTipFor(el, ev.clientX, ev.clientY);
  });
  root.addEventListener("pointerleave", hideTip, true);
  root.addEventListener("focusin", function (ev) {
    var el = ev.target.closest ? ev.target.closest("[data-tip]") : null;
    if (!el) return;
    var r = el.getBoundingClientRect();
    showTipFor(el, r.left + r.width / 2, r.top);
  });
  root.addEventListener("focusout", hideTip);

  /* ---------- the page ---------- */

  function meView() {
    var h = masthead(whoTag());
    h += '<div class="switcher"><button class="linkish" data-act="boards">← all boards</button>'
      + '<span class="bnow">Your log</span></div>';
    h += '<div class="banner private">🔒 Only you can see this page. Meals and weight are '
      + "never shown on a board.</div>";

    /* ----- meals today ----- */
    var goal = mealGoal();
    var row = todaysMeals();
    var n = row ? row.count : 0;
    var pips = "";
    var shown = Math.max(goal, n);
    for (var i = 0; i < shown; i++) {
      pips += '<span class="pip' + (i < n ? " on" : "") + (i >= goal ? " extra" : "") + '"></span>';
    }
    h += '<section class="panel' + (n >= goal ? " done" : "") + '">'
      + '<div class="eyebrow">Meals today</div>'
      + '<div class="pips">' + pips + "</div>"
      + '<div class="mealrow">'
      + '<button class="bigbtn slim" data-act="meal" data-d="1">+ Meal</button>'
      + '<button class="btn ghost" data-act="meal" data-d="-1" aria-label="Remove a meal">−</button>'
      + "</div>"
      + '<div class="sub">' + (n === 0 ? "Nothing logged yet today."
          : n < goal ? n + " of " + goal + " — " + (goal - n) + " to go."
          : n === goal ? n + " of " + goal + " — target hit. 🎯"
          : n + " of " + goal + " — over target, good.") + "</div>"
      + '<div class="cardfoot"><span class="note">Daily target</span>'
      + '<span class="step"><button data-act="mealgoal" data-d="-1" aria-label="Lower daily meal target">−</button>'
      + "<span>" + goal + "</span>"
      + '<button data-act="mealgoal" data-d="1" aria-label="Raise daily meal target">+</button></span>'
      + "</div></section>";

    /* ----- weight ----- */
    var ws = weightRows().slice().sort(function (a, b) {
      return String(a.day).localeCompare(String(b.day));
    });
    var unit = weightUnit();
    var latest = ws.length ? ws[ws.length - 1] : null;
    h += '<section class="panel">'
      + '<div class="eyebrow">Weight <span class="opt">optional</span></div>';
    if (latest) {
      var cutoff = daysAgoKey(28);
      var earlier = ws.filter(function (w) { return String(w.day).slice(0, 10) <= cutoff; });
      var ref = earlier.length ? earlier[earlier.length - 1] : ws[0];
      var delta = latest.kg - ref.kg;
      var deltaU = toUnit(latest.kg) - toUnit(ref.kg);
      h += '<div class="hero">' + fmtW(latest.kg) + '<small>' + unit + "</small></div>"
        + '<div class="sub">' + (ws.length > 1 && ref !== latest
            ? (Math.abs(deltaU) < 0.05 ? "level over the last four weeks"
               : (deltaU > 0 ? "up " : "down ") + Math.abs(deltaU).toFixed(1) + " " + unit
                 + " over the last four weeks")
            : "first entry — a line appears once you've logged a few")
        + " · last logged "
        + esc(fromKey(String(latest.day).slice(0, 10))
              .toLocaleDateString(undefined, { day: "numeric", month: "short" })) + "</div>";
    } else {
      h += '<div class="sub">Nothing logged yet. Entirely optional — the app works fine '
        + "without it.</div>";
    }
    h += '<div class="sayrow weighrow"><input id="weightin" type="text" inputmode="decimal" '
      + 'placeholder="Today\'s weight in ' + unit + '" autocomplete="off" enterkeyhint="done">'
      + '<button class="btn" data-act="weigh">Save</button>'
      + '<button class="btn ghost tiny" data-act="unit" aria-label="Switch units">'
      + (unit === "kg" ? "→ lb" : "→ kg") + "</button></div>";
    h += "</section>";

    /* ----- the pictures ----- */
    var mealDays = lastDays(21).map(function (k) {
      var m = mealRows().filter(function (x) { return String(x.day).slice(0, 10) === k; })[0];
      return { x: k, y: m ? m.count : 0 };
    });
    var anyMeals = mealDays.some(function (d) { return d.y > 0; });

    h += '<section class="sect"><div class="sect-head"><h2>The last three weeks</h2>'
      + '<button class="linkish" data-act="table">' + (App.showTable ? "Show the charts" : "Show the numbers")
      + "</button></div>";

    if (App.showTable) {
      h += '<div class="gridwrap"><table class="week numbers"><thead><tr>'
        + "<th>Day</th><th>Meals</th><th>Weight</th></tr></thead><tbody>";
      lastDays(21).slice().reverse().forEach(function (k) {
        var m = mealRows().filter(function (x) { return String(x.day).slice(0, 10) === k; })[0];
        var w = ws.filter(function (x) { return String(x.day).slice(0, 10) === k; })[0];
        h += "<tr><th>" + esc(fromKey(k).toLocaleDateString(undefined,
              { weekday: "short", day: "numeric", month: "short" })) + "</th>"
          + "<td>" + (m && m.count ? m.count : "—") + "</td>"
          + "<td>" + (w ? fmtW(w.kg) + " " + unit
              + ' <button class="linkish tinyx" data-act="unweigh" data-id="' + w.id + '">delete</button>'
              : "—") + "</td></tr>";
      });
      h += "</tbody></table></div>";
    } else {
      h += '<div class="chartcard"><div class="chead">Meals per day</div>'
        + (anyMeals ? barChart(mealDays, goal)
           : '<div class="empty">Nothing logged yet. Tap <b>+ Meal</b> above and this fills in.</div>')
        + "</div>";
      h += '<div class="chartcard"><div class="chead">Weight, ' + unit + "</div>"
        + (ws.length >= 2
            ? lineChart(ws.map(function (w) {
                return { x: String(w.day).slice(0, 10), y: toUnit(w.kg) };
              }), unit)
            : '<div class="empty">' + (ws.length === 1
                ? "One entry so far — log a couple more and the trend line appears."
                : "No entries yet.") + "</div>")
        + "</div>";
    }
    h += "</section>";

    h += '<div class="footer"><button class="linkish" data-act="boards">← all boards</button>'
      + '<span>Private to you</span></div>';
    return h;
  }

  /* ============================================================
     Boot
     ============================================================ */

  function ensureProfile() {
    return sb.from("profiles").select("*").eq("id", uid()).maybeSingle().then(unwrap)
      .then(function (p) {
        if (p) { App.profile = p; return p; }
        var nm = (App.user.user_metadata && App.user.user_metadata.name)
          || (App.user.email || "you").split("@")[0];
        return sb.from("profiles").insert({ id: uid(), name: nm }).select().single().then(unwrap)
          .then(function (np) { App.profile = np; return np; });
      });
  }

  function onSignedIn() {
    return ensureProfile().then(function () {
      watch();
      return load();
    }).catch(function (e) {
      App.error = (e && e.message) || "Couldn't load your account.";
      App.loading = false;
      render();
    });
  }

  window.addEventListener("hashchange", function () {
    var r = parseRoute();
    if (r.name === App.route.name && r.boardId === App.route.boardId) return;
    App.route = r;
    App.d = null;
    App.error = null;
    App.openComment = null;
    App.openItem = null;
    render();
    watch();
    if (App.user) load();
  });

  App.route = parseRoute();

  if (!CONFIGURED) {
    App.booted = true;
    render();
  } else {
    render();
    sb.auth.getSession().then(function (res) {
      App.booted = true;
      App.user = (res.data && res.data.session && res.data.session.user) || null;
      if (App.user) onSignedIn(); else { App.loading = false; render(); }
    });

    sb.auth.onAuthStateChange(function (event, session) {
      var next = session ? session.user : null;
      var was = App.user ? App.user.id : null;
      App.user = next;
      App.booted = true;
      if (next && next.id !== was) { App.authBusy = false; App.authMsg = null; onSignedIn(); }
      else if (!next) { App.d = null; App.loading = false; watch(); render(); }
    });
  }

  var bootDay = today();
  setInterval(function () {
    if (today() !== bootDay) { bootDay = today(); render(); }
  }, 60000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && App.user) load();
  });
})();
