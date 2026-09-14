/* ============================================================
   Iron Ledger
   A shared gym check-in board for two or three people.

   Design rules this file is built around:
     1. Answering your partner outranks logging yourself.
     2. The unit of value is the pair, not the individual.
     3. Streaks count weeks you hit your goal; rest weeks never
        break them. No loss-aversion, no shaming copy.
     4. The invite is the product. At one member, nothing else
        on screen matters.
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

  var cfg = window.IRON_LEDGER_CONFIG || {};
  var ONLINE = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON && window.supabase);

  /* Local storage is namespaced per database. A board created in demo
     mode lives under a different prefix from one on your Supabase
     project, so switching sync on can never leave the app pointing at
     a board that isn't there (and two projects never collide). */
  var NS = "il." + (ONLINE
    ? String(cfg.SUPABASE_URL).replace(/[^a-z0-9]/gi, "").slice(-10)
    : "demo") + ".";

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
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
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
  /* A tap should feel like it did something. Sparks thrown from the
     element that was pressed, plus a nudge of haptics where the
     platform offers any (iOS Safari does not, so the animation has
     to carry it). */
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
        if (i % 3 === 0) {          // a few confetti flecks among the dots
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

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ============================================================
     Data layer. Two interchangeable stores: Supabase when it is
     configured, localStorage when it is not, so the app is
     openable and playable before anyone signs up for anything.
     ============================================================ */

  var store = ONLINE ? supabaseStore() : localStore();

  function supabaseStore() {
    var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON, {
      realtime: { params: { eventsPerSecond: 4 } }
    });
    function rows(t) { return sb.from(t); }
    function unwrap(res) { if (res.error) throw res.error; return res.data; }

    return {
      online: true,
      createRoom: function (roomName) {
        return rows("rooms").insert({ name: roomName }).select().single().then(unwrap);
      },
      fetchAll: function (roomId) {
        return Promise.all([
          rows("rooms").select("*").eq("id", roomId).maybeSingle(),
          rows("members").select("*").eq("room_id", roomId).order("created_at"),
          rows("checkins").select("*").eq("room_id", roomId),
          rows("replies").select("*").eq("room_id", roomId).order("created_at"),
          rows("rest_weeks").select("*").eq("room_id", roomId),
          rows("events").select("*").eq("room_id", roomId).order("created_at", { ascending: false }).limit(40)
        ]).then(function (r) {
          return {
            room: unwrap(r[0]), members: unwrap(r[1]), checkins: unwrap(r[2]),
            replies: unwrap(r[3]), rest: unwrap(r[4]), events: unwrap(r[5])
          };
        });
      },
      addMember: function (roomId, m) {
        return rows("members").insert({
          room_id: roomId, name: m.name, color: m.color, goal: m.goal
        }).select().single().then(unwrap);
      },
      patchMember: function (id, patch) { return rows("members").update(patch).eq("id", id).then(unwrap); },
      addCheckin: function (roomId, memberId, day) {
        return rows("checkins").insert({ room_id: roomId, member_id: memberId, day: day }).then(function (r) {
          if (r.error && r.error.code !== "23505") throw r.error;  // ignore duplicate
        });
      },
      delCheckin: function (id) { return rows("checkins").delete().eq("id", id).then(unwrap); },
      addReply: function (roomId, checkinId, memberId, r) {
        return rows("replies").insert({
          room_id: roomId, checkin_id: checkinId, member_id: memberId,
          emoji: r.emoji || null, body: r.body || null
        }).then(function (res) { if (res.error && res.error.code !== "23505") throw res.error; });
      },
      delReply: function (id) { return rows("replies").delete().eq("id", id).then(unwrap); },
      setRest: function (roomId, memberId, week, on) {
        return on
          ? rows("rest_weeks").insert({ room_id: roomId, member_id: memberId, week: week })
              .then(function (r) { if (r.error && r.error.code !== "23505") throw r.error; })
          : rows("rest_weeks").delete().eq("member_id", memberId).eq("week", week).then(unwrap);
      },
      addEvent: function (roomId, memberId, kind, targetId, body) {
        return rows("events").insert({
          room_id: roomId, member_id: memberId, kind: kind, target_id: targetId || null, body: body || null
        }).then(unwrap);
      },
      subscribe: function (roomId, cb) {
        var ch = sb.channel("board:" + roomId);
        ["members", "checkins", "replies", "rest_weeks", "events", "rooms"].forEach(function (t) {
          ch.on("postgres_changes",
            { event: "*", schema: "public", table: t, filter: t === "rooms" ? "id=eq." + roomId : "room_id=eq." + roomId },
            cb);
        });
        ch.subscribe();
        return function () { sb.removeChannel(ch); };
      }
    };
  }

  function localStore() {
    function key(roomId) { return NS + "local." + roomId; }
    function read(roomId) {
      try { return JSON.parse(lsGet(key(roomId))) || blank(roomId); } catch (e) { return blank(roomId); }
    }
    function blank(roomId) {
      // room stays null for an id this browser has never stored, so an
      // unknown board behaves the same here as it does against Supabase.
      return { room: null, members: [], checkins: [], replies: [], rest: [], events: [] };
    }
    function write(roomId, d) { lsSet(key(roomId), JSON.stringify(d)); return d; }
    function edit(roomId, fn) { var d = read(roomId); fn(d); write(roomId, d); return Promise.resolve(); }
    var now = function () { return new Date().toISOString(); };

    return {
      online: false,
      createRoom: function (roomName) {
        var r = { id: uuid(), name: roomName };
        write(r.id, { room: r, members: [], checkins: [], replies: [], rest: [], events: [] });
        return Promise.resolve(r);
      },
      fetchAll: function (roomId) { return Promise.resolve(read(roomId)); },
      addMember: function (roomId, m) {
        var mem = { id: uuid(), room_id: roomId, name: m.name, color: m.color, goal: m.goal,
                    nudges_on: true, created_at: now() };
        return edit(roomId, function (d) { d.members.push(mem); }).then(function () { return mem; });
      },
      patchMember: function (id, patch) {
        var roomId = App.roomId;
        return edit(roomId, function (d) {
          d.members.forEach(function (m) { if (m.id === id) Object.keys(patch).forEach(function (k) { m[k] = patch[k]; }); });
        });
      },
      addCheckin: function (roomId, memberId, day) {
        return edit(roomId, function (d) {
          if (d.checkins.some(function (c) { return c.member_id === memberId && c.day === day; })) return;
          d.checkins.push({ id: uuid(), room_id: roomId, member_id: memberId, day: day, created_at: now() });
        });
      },
      delCheckin: function (id) {
        return edit(App.roomId, function (d) {
          d.checkins = d.checkins.filter(function (c) { return c.id !== id; });
          d.replies = d.replies.filter(function (r) { return r.checkin_id !== id; });
        });
      },
      addReply: function (roomId, checkinId, memberId, r) {
        return edit(roomId, function (d) {
          if (r.emoji && d.replies.some(function (x) {
            return x.checkin_id === checkinId && x.member_id === memberId && x.emoji === r.emoji;
          })) return;
          d.replies.push({ id: uuid(), room_id: roomId, checkin_id: checkinId, member_id: memberId,
                           emoji: r.emoji || null, body: r.body || null, created_at: now() });
        });
      },
      delReply: function (id) {
        return edit(App.roomId, function (d) { d.replies = d.replies.filter(function (r) { return r.id !== id; }); });
      },
      setRest: function (roomId, memberId, week, on) {
        return edit(roomId, function (d) {
          d.rest = d.rest.filter(function (x) { return !(x.member_id === memberId && x.week === week); });
          if (on) d.rest.push({ id: uuid(), room_id: roomId, member_id: memberId, week: week });
        });
      },
      addEvent: function (roomId, memberId, kind, targetId, body) {
        return edit(roomId, function (d) {
          d.events.unshift({ id: uuid(), room_id: roomId, member_id: memberId, kind: kind,
                             target_id: targetId || null, body: body || null, created_at: now() });
          d.events = d.events.slice(0, 40);
        });
      },
      subscribe: function () { return function () {}; }
    };
  }

  /* ============================================================
     App state
     ============================================================ */

  var App = {
    roomId: null,
    meId: null,
    data: null,
    loading: true,
    error: null,
    notice: null,
    justChecked: false,
    unsub: null
  };
  var root = $("root");

  function routeRoom() {
    var m = /#\/b\/([0-9a-fA-F-]{8,})/.exec(location.hash || "");
    return m ? m[1] : null;
  }
  function me() { return App.data ? byId(App.data.members, App.meId) : null; }
  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function others() {
    return App.data.members.filter(function (m) { return m.id !== App.meId; });
  }

  /* ---------------- derived stats ---------------- */

  function daysOf(memberId) {
    var s = {};
    App.data.checkins.forEach(function (c) { if (c.member_id === memberId) s[String(c.day).slice(0, 10)] = c; });
    return s;
  }
  function isResting(memberId, weekKey) {
    return App.data.rest.some(function (r) {
      return r.member_id === memberId && String(r.week).slice(0, 10) === weekKey;
    });
  }
  function stats(m) {
    var days = daysOf(m.id);
    var wk = weekKeys(weekStart(new Date()));
    var thisWeek = wk.filter(function (k) { return days[k]; }).length;
    var goal = Math.max(1, m.goal || 4);

    var weeks = {};
    Object.keys(days).forEach(function (k) {
      var w = dkey(weekStart(fromKey(k)));
      weeks[w] = (weeks[w] || 0) + 1;
    });

    // Streak: consecutive weeks hit. A rest week holds the streak
    // without adding to it. The current week never breaks it.
    var streak = 0, cur = weekStart(new Date()), i = 0, first = true;
    while (i < 200) {
      var wkey = dkey(cur);
      var hit = (weeks[wkey] || 0) >= goal;
      var rest = isResting(m.id, wkey);
      if (hit) streak++;
      else if (rest) { /* holds */ }
      else if (!first) break;
      first = false;
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - 7);
      i++;
    }

    var last = null;
    Object.keys(days).forEach(function (k) { if (!last || k > last) last = k; });

    return {
      goal: goal,
      thisWeek: thisWeek,
      total: Object.keys(days).length,
      streak: streak,
      resting: isResting(m.id, dkey(weekStart(new Date()))),
      last: last,
      since: last ? dayDiff(last, today()) : null
    };
  }
  function pairStats() {
    var ms = App.data.members;
    var sum = 0, goal = 0;
    ms.forEach(function (m) { var s = stats(m); sum += s.thisWeek; goal += s.goal; });

    // Weeks where everyone hit their goal (or was resting).
    var allWeeks = {};
    App.data.checkins.forEach(function (c) { allWeeks[dkey(weekStart(fromKey(String(c.day).slice(0, 10))))] = 1; });
    var together = 0, thisW = dkey(weekStart(new Date()));
    Object.keys(allWeeks).forEach(function (w) {
      if (!ms.length) return;
      var ok = ms.every(function (m) {
        if (isResting(m.id, w)) return true;
        var days = daysOf(m.id);
        var n = weekKeys(fromKey(w)).filter(function (k) { return days[k]; }).length;
        return n >= Math.max(1, m.goal || 4);
      });
      if (ok && w !== thisW) together++;
      else if (ok && w === thisW) together++;
    });
    return { sum: sum, goal: Math.max(1, goal), together: together };
  }
  function repliesFor(checkinId) {
    return App.data.replies.filter(function (r) { return r.checkin_id === checkinId; });
  }
  /* Every recent check-in by someone else that I have not answered. */
  function waitingOnMe() {
    if (!App.meId) return [];
    var t = today();
    return App.data.checkins
      .filter(function (c) {
        if (c.member_id === App.meId) return false;
        var d = String(c.day).slice(0, 10);
        if (dayDiff(d, t) > ANSWER_WINDOW_DAYS) return false;
        return !repliesFor(c.id).some(function (r) { return r.member_id === App.meId; });
      })
      .sort(function (a, b) { return String(b.day).localeCompare(String(a.day)); });
  }

  /* ============================================================
     Loading + realtime
     ============================================================ */

  function forgetBoard(id) {
    if (!id) return;
    lsDel(NS + "me." + id);
    if (lsGet(NS + "lastRoom") === id) lsDel(NS + "lastRoom");
  }
  function goHome(notice) {
    forgetBoard(App.roomId);
    App.roomId = null; App.meId = null; App.data = null;
    App.error = null; App.loading = false;
    App.notice = notice || null;
    // replaceState, not location.replace: dropping the fragment with
    // the latter can reload the document in some browsers, which would
    // throw away the message we are about to show.
    try {
      if (window.history && history.replaceState) {
        history.replaceState(null, "", location.pathname + location.search);
      } else if (location.hash) {
        location.hash = "";
      }
    } catch (e) {}
    render();
  }

  function load() {
    if (!App.roomId) { App.loading = false; return render(); }
    return store.fetchAll(App.roomId).then(function (d) {
      if (!d.room) {
        // Pointing at a board this database has never heard of. Rather
        // than dead-ending, forget it and offer a fresh start.
        return goHome("That board isn't on your database \u2014 it was probably "
          + "created before you switched sync on. Start a fresh one below.");
      }
      App.data = d;
      App.loading = false;
      App.error = null;
      if (App.meId && !byId(App.data.members, App.meId)) App.meId = null;
      render();
    }).catch(function (e) {
      App.loading = false;
      App.error = (e && e.message) || "Couldn't reach the board.";
      render();
    });
  }
  var reloadTimer = null;
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 300);
  }
  function watch() {
    if (App.unsub) App.unsub();
    App.unsub = App.roomId ? store.subscribe(App.roomId, scheduleReload) : null;
  }

  function act(promise) {
    return Promise.resolve(promise).then(load).catch(function (e) {
      toast((e && e.message) || "That didn't save — try again");
    });
  }

  /* ============================================================
     Actions
     ============================================================ */

  var actions = {
    create: function () {
      var nameEl = $("yourname");
      var name = (nameEl && nameEl.value || "").trim();
      if (!name) { toast("Type your name first"); if (nameEl) nameEl.focus(); return; }
      store.createRoom("Our board").then(function (room) {
        return store.addMember(room.id, { name: name.slice(0, 24), color: 0, goal: 4 }).then(function (m) {
          lsSet(NS + "me." + room.id, m.id);
          lsSet(NS + "lastRoom", room.id);
          store.addEvent(room.id, m.id, "join");
          App.roomId = room.id;
          App.meId = m.id;
          location.hash = "#/b/" + room.id;
          watch();
          return load();
        });
      }).catch(function (e) { toast((e && e.message) || "Couldn't create the board"); });
    },
    reopen: function (el) {
      location.hash = "#/b/" + el.getAttribute("data-id");
    },
    pick: function (el) {
      App.meId = el.getAttribute("data-id");
      lsSet(NS + "me." + App.roomId, App.meId);
      lsSet(NS + "lastRoom", App.roomId);
      render();
    },
    join: function () {
      var el = $("joinname");
      var name = (el && el.value || "").trim();
      if (!name) { toast("Type your name first"); if (el) el.focus(); return; }

      // Same name as someone already here? That's them on another
      // device, not a second person. Pick them instead of duplicating.
      var already = App.data.members.filter(function (m) {
        return String(m.name).trim().toLowerCase() === name.toLowerCase();
      })[0];
      if (already) {
        App.meId = already.id;
        lsSet(NS + "me." + App.roomId, already.id);
        lsSet(NS + "lastRoom", App.roomId);
        toast("Welcome back, " + already.name);
        render();
        return;
      }

      var color = App.data.members.length % PC.length;
      store.addMember(App.roomId, { name: name.slice(0, 24), color: color, goal: 4 }).then(function (m) {
        App.meId = m.id;
        lsSet(NS + "me." + App.roomId, m.id);
        lsSet(NS + "lastRoom", App.roomId);
        return store.addEvent(App.roomId, m.id, "join").then(load);
      }).catch(function (e) { toast((e && e.message) || "Couldn't join"); });
    },
    forget: function () { goHome(null); },
    notme: function () {
      lsDel(NS + "me." + App.roomId);
      App.meId = null;
      render();
    },
    checkin: function (el) {
      if (!App.meId) return;
      if (el && el.classList) {
        el.classList.remove("pop");
        void el.offsetWidth;            // restart the animation
        el.classList.add("pop");
        el.textContent = "Nice one!";
        el.disabled = true;
        burst(el);
      }
      buzz(18);
      App.justChecked = true;
      // Let the squash-and-spring play out before the panel flips.
      setTimeout(function () { act(store.addCheckin(App.roomId, App.meId, today())); }, 380);
    },
    undo: function () {
      var c = App.data.checkins.filter(function (x) {
        return x.member_id === App.meId && String(x.day).slice(0, 10) === today();
      })[0];
      if (c) act(store.delCheckin(c.id));
    },
    react: function (el) {
      if (!App.meId) return;
      var cid = el.getAttribute("data-id"), em = el.getAttribute("data-em");
      var existing = repliesFor(cid).filter(function (r) {
        return r.member_id === App.meId && r.emoji === em;
      })[0];
      if (!existing) { burst(el, 7); buzz(12); }
      act(existing ? store.delReply(existing.id) : store.addReply(App.roomId, cid, App.meId, { emoji: em }));
    },
    say: function (el) {
      if (!App.meId) return;
      var cid = el.getAttribute("data-id");
      var input = $(el.getAttribute("data-input") || ("say-" + cid));
      var body = (input && input.value || "").trim();
      if (!body) { if (input) input.focus(); return; }
      input.value = "";
      act(store.addReply(App.roomId, cid, App.meId, { body: body.slice(0, 140) }));
    },
    goal: function (el) {
      var d = +el.getAttribute("data-d");
      var m = me(); if (!m) return;
      act(store.patchMember(m.id, { goal: Math.min(7, Math.max(1, (m.goal || 4) + d)) }));
    },
    rest: function () {
      var m = me(); if (!m) return;
      var w = dkey(weekStart(new Date()));
      act(store.setRest(App.roomId, m.id, w, !isResting(m.id, w)));
    },
    nudges: function () {
      var m = me(); if (!m) return;
      act(store.patchMember(m.id, { nudges_on: !m.nudges_on }));
    },
    rename: function () {
      var m = me(); if (!m) return;
      var v = window.prompt("Your name on the board", m.name);
      if (v === null) return;
      v = v.trim(); if (!v) return;
      act(store.patchMember(m.id, { name: v.slice(0, 24) }));
    },
    nudge: function (el) {
      if (!App.meId) return;
      var to = el.getAttribute("data-id");
      act(store.addEvent(App.roomId, App.meId, "nudge", to,
        NUDGES[Math.floor(Math.random() * NUDGES.length)]));
      toast("Sent");
    },
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
    return location.origin + location.pathname + "#/b/" + App.roomId;
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Link copied"); },
        function () { window.prompt("Copy this link", text); });
    } else {
      window.prompt("Copy this link", text);
    }
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
    if (t.id === "yourname") { ev.preventDefault(); actions.create(); }
    else if (t.id === "joinname") { ev.preventDefault(); actions.join(); }
    else if (t.closest(".sayrow")) {
      var btn = t.closest(".sayrow").querySelector('[data-act="say"]');
      if (btn) { ev.preventDefault(); actions.say(btn); }
    }
  });

  /* ============================================================
     Render
     ============================================================ */

  function render() {
    // Keep whatever the person is typing across re-renders (realtime
    // updates can land mid-sentence).
    var a = document.activeElement;
    var keep = a && a.tagName === "INPUT" && a.id
      ? { id: a.id, value: a.value, pos: a.selectionStart } : null;

    root.innerHTML = '<div class="wrap">' + view() + "</div>";
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

  function masthead(right) {
    return '<header class="mast"><div class="mark"><span class="comet" aria-hidden="true"></span><h1>Iron Ledger</h1></div>'
      + '<div class="when">' + (right || "") + "</div></header>" + modeBanner();
  }

  function view() {
    if (App.loading) return masthead("") + '<div class="boot">Loading your board…</div>';

    var h = "";

    // ---------- no board yet: create one ----------
    if (!App.roomId) {
      var last = lsGet(NS + "lastRoom");
      h += masthead("");
      if (App.notice) h += '<div class="banner warn">' + esc(App.notice) + "</div>";
      h += '<section class="panel">'
        + '<h2 class="headline">Two people, one board, one tap a day.</h2>'
        + '<p class="sub">You log a gym visit. Your friend sees it and says something. '
        + 'That second part is the whole point — the app just makes it take three seconds.</p>'
        + '<div class="field"><input id="yourname" type="text" maxlength="24" placeholder="Your name" autocomplete="given-name" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="go">'
        + '<button class="btn" data-act="create">Start a board</button></div>'
        + '<div class="note">No account, no email. You get a link to send to one person.</div>'
        + "</section>";
      if (last) {
        h += '<div class="banner">You already have a board on this device. '
          + '<button class="linkish" data-act="reopen" data-id="' + esc(last) + '">Open it</button></div>';
      }
      return h;
    }

    if (App.error) {
      return masthead("") + '<div class="banner warn">' + esc(App.error) + "</div>"
        + '<div class="field"><button class="btn ghost" data-act="forget">Start a new board</button></div>';
    }
    if (!App.data) return masthead("") + '<div class="boot">Loading…</div>';

    var wkS = weekStart(new Date());
    var wk = weekKeys(wkS);
    var td = today();
    var range = fromKey(wk[0]).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      + " – " + fromKey(wk[6]).toLocaleDateString(undefined, { month: "short", day: "numeric" });

    h += masthead("week of " + esc(range));

    // ---------- who are you ----------
    if (!App.meId) {
      h += '<section class="panel">'
        + '<div class="eyebrow">Welcome to the board</div>'
        + '<h2 class="headline">Who are you?</h2>';
      if (App.data.members.length) {
        h += '<div class="chips">';
        App.data.members.forEach(function (m) {
          h += '<button class="chip" data-act="pick" data-id="' + m.id + '">'
            + '<span class="dot" style="background:' + PC[m.color % PC.length] + '"></span>'
            + esc(m.name) + "</button>";
        });
        h += "</div>"
          + '<div class="note">Tap your own name. Do that once on each phone or '
          + "computer you use \u2014 your history follows you.</div>";
      }
      var first = !App.data.members.length;
      h += '<div class="field"><input id="joinname" type="text" maxlength="24" placeholder="'
        + (first ? "Your name" : "add someone new") + '" autocomplete="given-name" '
        + 'autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="go">'
        + '<button class="btn' + (first ? "" : " ghost") + '" data-act="join">'
        + (first ? "Join" : "Add") + "</button></div>"
        + (first ? '<div class="note">No account, no password.</div>' : "")
        + "</section>";
      return h;
    }

    var mine = me();
    var waiting = waitingOnMe();
    var wentToday = App.data.checkins.some(function (c) {
      return c.member_id === App.meId && String(c.day).slice(0, 10) === td;
    });

    // ---------- 1. alone on the board: nothing else matters ----------
    if (App.data.members.length < 2) {
      h += '<section class="panel invite">'
        + '<div class="eyebrow">One thing left to do</div>'
        + '<h2 class="headline">This only works with someone else on it.</h2>'
        + '<p class="sub">Send the link to the person you want to keep you honest. '
        + "They tap it, type their name, and they're in — no account, no download.</p>"
        + '<div class="field"><button class="btn" data-act="share">Send the link</button>'
        + '<button class="btn ghost" data-act="copy">Copy</button></div>'
        + '<div class="linkbox"><code>' + esc(boardUrl()) + "</code></div>"
        + "</section>";
    }

    // ---------- 2. someone is waiting on you ----------
    if (waiting.length) {
      var c0 = waiting[0];
      var who = byId(App.data.members, c0.member_id);
      var d0 = String(c0.day).slice(0, 10);
      var whenWord = d0 === td ? "went today" : d0 === dkey(new Date(Date.now() - 86400000))
        ? "went yesterday" : "went " + fromKey(d0).toLocaleDateString(undefined, { weekday: "long" });
      h += '<section class="panel ask" style="--pc:' + PC[who.color % PC.length] + '">'
        + '<div class="eyebrow">' + (waiting.length > 1 ? waiting.length + " waiting on you" : "Waiting on you") + "</div>"
        + '<h2 class="headline">' + esc(who.name) + " " + whenWord + ". Say something.</h2>"
        + rxRow(c0.id)
        + sayRow(c0.id, "Nice one, " + who.name.split(" ")[0] + "…", "ask")
        + "</section>";
    }

    // ---------- 3. your own check-in ----------
    var ms = stats(mine);
    if (wentToday) {
      h += '<section class="panel done' + (App.justChecked ? " celebrate" : "") + '">'
        + '<div class="doneline">'
        + '<span class="tick" aria-hidden="true">✓</span>'
        + '<h2 class="headline" style="margin-right:auto">You went today</h2>'
        + '<button class="btn ghost tiny" data-act="undo">Undo</button></div>'
        + '<div class="sub">' + ms.thisWeek + " of " + ms.goal + " this week"
        + (ms.thisWeek >= ms.goal ? " — goal hit." : " — " + (ms.goal - ms.thisWeek) + " to go.")
        + "</div></section>";
    } else {
      h += '<section class="panel">'
        + '<div class="eyebrow">' + esc(mine.name) + " · " + ms.thisWeek + "/" + ms.goal + " this week"
        + (ms.resting ? ' · <span class="resting">resting</span>' : "") + "</div>"
        + '<button class="bigbtn" data-act="checkin">I went today</button>'
        + "</section>";
    }

    // ---------- 4. the pair ----------
    if (App.data.members.length > 1) {
      var ps = pairStats();
      var names = App.data.members.map(function (m) { return m.name; });
      h += '<section class="pair"><div class="top">'
        + '<div class="score">' + ps.sum + " <small>of " + ps.goal + " sessions this week</small></div>"
        + '<div class="note">' + esc(names.join(" + ")) + "</div></div>"
        + '<div class="bar">' + App.data.members.map(function (m) {
            var s = stats(m);
            return '<i style="width:' + (Math.min(s.thisWeek, s.goal) / ps.goal * 100) + "%;background:"
              + PC[m.color % PC.length] + '"></i>';
          }).join("") + "</div>"
        + '<div class="pairfoot">'
        + '<span class="note">' + (ps.together > 0
            ? "<b>" + ps.together + "</b> week" + (ps.together === 1 ? "" : "s") + " you both hit it"
            : "no week you both hit it \u2014 yet") + "</span>"
        + '<span class="note">' + (waiting.length
            ? "<b>" + waiting.length + "</b> waiting on you"
            : "Nothing waiting on you") + "</span>"
        + "</div></section>";
    }

    // ---------- 5. people ----------
    h += '<section class="sect"><div class="sect-head"><h2>The week so far</h2></div>';
    h += '<div class="people">';
    App.data.members.forEach(function (m) {
      var s = stats(m), col = PC[m.color % PC.length];
      var pct = Math.min(100, Math.round(s.thisWeek / s.goal * 100));
      h += '<article class="card' + (m.id === App.meId ? " me" : "") + '" style="--pc:' + col + '">'
        + '<div class="who"><span class="dot" style="background:' + col + '"></span>'
        + '<span class="nm">' + esc(m.name) + "</span>"
        + (m.id === App.meId ? '<span class="youtag">you</span>' : "")
        + (s.resting ? '<span class="resting">rest week</span>' : "")
        + "</div>"
        + '<div class="ringrow"><div class="ring" style="--pct:' + pct + '" role="img" aria-label="'
        + s.thisWeek + " of " + s.goal + ' sessions this week"><i>' + s.thisWeek
        + "<span>/" + s.goal + "</span></i></div>"
        + '<div class="facts">'
        + '<div class="fact">' + (s.streak > 0
            ? '<b class="flame">' + s.streak + "</b> week" + (s.streak === 1 ? "" : "s")
              + " in a row " + (s.streak > 1 ? "🔥" : "")
            : "<b>—</b> no streak yet") + "</div>"
        + '<div class="fact">' + (s.last === null ? "no sessions yet"
            : s.since === 0 ? "went today"
            : s.since === 1 ? "went yesterday"
            : '<span class="' + (s.since >= 4 ? "stale" : "") + '">' + s.since + " days ago</span>")
        + "</div>"
        + '<div class="fact note">' + s.total + " all time</div>"
        + "</div></div>"
        + '<div class="cardfoot">';
      if (m.id === App.meId) {
        h += '<span class="note">Goal</span>'
          + '<span class="step"><button data-act="goal" data-d="-1" aria-label="Lower weekly goal">−</button>'
          + "<span>" + s.goal + "×</span>"
          + '<button data-act="goal" data-d="1" aria-label="Raise weekly goal">+</button></span>'
          + '<button class="btn ghost tiny" data-act="rest">' + (s.resting ? "End rest week" : "Rest week") + "</button>"
          + '<button class="btn ghost tiny" data-act="rename">Rename</button>'
          + '<button class="btn ghost tiny" data-act="nudges">Nudges ' + (m.nudges_on === false ? "off" : "on") + "</button>";
      } else {
        h += canNudge(m)
          ? '<button class="btn ghost tiny" data-act="nudge" data-id="' + m.id + '">Nudge</button>'
          : '<span class="note">' + (m.nudges_on === false ? "Nudges off" : "Nothing to nag about") + "</span>";
      }
      h += "</div></article>";
    });
    h += "</div></section>";

    // ---------- 6. week grid ----------
    h += '<section class="sect"><div class="sect-head"><h2>This week</h2><span class="note">Mon – Sun</span></div>'
      + '<div class="gridwrap"><table class="week"><thead><tr><th class="rowname"></th>';
    wk.forEach(function (k, i) {
      h += "<th" + (k === td ? ' class="today"' : "") + ">" + DAYS[i] + "<br>" + fromKey(k).getDate() + "</th>";
    });
    h += "<th></th></tr></thead><tbody>";
    App.data.members.forEach(function (m) {
      var col = PC[m.color % PC.length], days = daysOf(m.id), s = stats(m);
      h += '<tr><th class="rowname" style="color:' + col + '">' + esc(m.name) + "</th>";
      wk.forEach(function (k) {
        var on = !!days[k], fut = k > td;
        h += "<td" + (k === td ? ' class="col-today"' : "") + '><div class="mk '
          + (on ? "on" : (fut ? "fut" : "")) + '" style="--pc:' + col + '">' + (on ? "✓" : "") + "</div></td>";
      });
      h += '<td class="tally">' + s.thisWeek + "/" + s.goal + "</td></tr>";
    });
    h += "</tbody></table></div></section>";

    // ---------- 7. the thread ----------
    h += '<section class="sect"><div class="sect-head"><h2>The thread</h2></div>' + thread(waiting) + "</section>";

    // ---------- footer ----------
    h += '<div class="footer">'
      + '<button class="linkish" data-act="copy">Copy board link</button>'
      + '<button class="linkish" data-act="notme">Not ' + esc(mine.name) + "?</button>"
      + "</div>";
    return h;
  }

  function canNudge(m) {
    if (m.nudges_on === false) return false;
    var s = stats(m);
    if (s.resting) return false;
    if (s.since !== null && s.since < 2) return false;
    var cutoff = Date.now() - NUDGE_COOLDOWN_H * 3600000;
    return !App.data.events.some(function (e) {
      return e.kind === "nudge" && e.member_id === App.meId && e.target_id === m.id
        && new Date(e.created_at).getTime() > cutoff;
    });
  }

  function rxRow(checkinId) {
    var rs = repliesFor(checkinId);
    var h = '<div class="rx">';
    RX.forEach(function (em) {
      var list = rs.filter(function (r) { return r.emoji === em; });
      var mineR = list.some(function (r) { return r.member_id === App.meId; });
      h += '<button data-act="react" data-id="' + checkinId + '" data-em="' + em + '"'
        + (mineR ? ' class="mine"' : "") + ' aria-label="React ' + em + '">' + em
        + (list.length ? '<span class="n">' + list.length + "</span>" : "") + "</button>";
    });
    return h + "</div>";
  }
  function sayRow(checkinId, placeholder, prefix) {
    var inputId = (prefix || "say") + "-" + checkinId;
    return '<div class="sayrow"><input id="' + inputId + '" type="text" maxlength="140" '
      + 'placeholder="' + esc(placeholder) + '" autocomplete="off" '
      + 'autocapitalize="sentences" enterkeyhint="send">'
      + '<button class="btn" data-act="say" data-id="' + checkinId + '" '
      + 'data-input="' + inputId + '">Send</button></div>';
  }
  function textReplies(checkinId) {
    var rs = repliesFor(checkinId).filter(function (r) { return r.body; });
    if (!rs.length) return "";
    return '<div class="replies">' + rs.map(function (r) {
      var m = byId(App.data.members, r.member_id);
      return '<div class="reply"><b>' + esc(m ? m.name : "someone") + "</b> " + esc(r.body) + "</div>";
    }).join("") + "</div>";
  }

  function thread(waiting) {
    var waitingIds = {};
    waiting.forEach(function (c) { waitingIds[c.id] = 1; });

    var items = [];
    App.data.checkins.forEach(function (c) {
      items.push({ ts: new Date(c.created_at || String(c.day).slice(0, 10)).getTime(), kind: "c", c: c });
    });
    App.data.events.forEach(function (e) {
      items.push({ ts: new Date(e.created_at).getTime(), kind: "e", e: e });
    });
    items.sort(function (a, b) { return b.ts - a.ts; });
    items = items.slice(0, 12);

    if (!items.length) {
      return '<div class="empty">Nothing here yet. The first check-in sets the pace.</div>';
    }

    return '<div class="thread">' + items.map(function (it) {
      if (it.kind === "c") {
        var c = it.c, m = byId(App.data.members, c.member_id);
        if (!m) return "";
        var col = PC[m.color % PC.length];
        var d = String(c.day).slice(0, 10);
        return '<div class="item' + (waitingIds[c.id] ? " unanswered" : "") + '" style="--pc:' + col + '">'
          + '<div class="av">' + esc(initials(m.name)) + "</div><div class=\"body\">"
          + '<div class="line"><b>' + esc(m.name) + "</b> went to the gym</div>"
          + '<div class="meta">'
          + esc(fromKey(d).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }))
          + (c.created_at ? " · " + ago(c.created_at) : "") + "</div>"
          + textReplies(c.id)
          + rxRow(c.id)
          + (m.id !== App.meId && waitingIds[c.id] ? sayRow(c.id, "Say something…") : "")
          + "</div></div>";
      }
      var e = it.e, from = byId(App.data.members, e.member_id);
      if (!from) return "";
      if (e.kind === "nudge") {
        var to = byId(App.data.members, e.target_id);
        return '<div class="item sys"><div class="av" style="background:var(--accent);color:var(--accent-ink)">→</div>'
          + '<div class="body"><div class="line"><b>' + esc(from.name) + "</b> to <b>"
          + esc(to ? to.name : "someone") + "</b> — " + esc(e.body || "your move") + "</div>"
          + '<div class="meta">' + ago(e.created_at) + "</div></div></div>";
      }
      return '<div class="item sys"><div class="av" style="background:var(--muted)">'
        + esc(initials(from.name)) + "</div><div class=\"body\">"
        + '<div class="line"><b>' + esc(from.name) + "</b> joined the board</div>"
        + '<div class="meta">' + ago(e.created_at) + "</div></div></div>";
    }).join("") + "</div>";
  }

  function modeBanner() {
    if (store.online) return "";
    return '<div class="banner warn"><b>Demo mode.</b> Nothing is synced — this board lives in this '
      + "browser only, and your friend will see an empty one. Add your two Supabase values to "
      + "<code>config.js</code> to turn sync on.</div>";
  }

  /* ============================================================
     Boot
     ============================================================ */

  window.addEventListener("hashchange", function () {
    var r = routeRoom();
    if (r === App.roomId) return;
    App.roomId = r;
    App.meId = r ? lsGet(NS + "me." + r) : null;
    App.data = null;
    App.loading = !!r;
    render();
    watch();
    load();
  });

  // Installed from the home screen, the app opens at start_url with no
  // hash. Send it straight back to the board this device already knows.
  if (!routeRoom()) {
    var lastRoom = lsGet(NS + "lastRoom");
    if (lastRoom && lsGet(NS + "me." + lastRoom)) {
      location.replace(location.pathname + location.search + "#/b/" + lastRoom);
    }
  }

  App.roomId = routeRoom();
  App.meId = App.roomId ? lsGet(NS + "me." + App.roomId) : null;
  App.loading = !!App.roomId;
  render();
  watch();
  load();

  // Day can roll over while the app sits open on a phone.
  var bootDay = today();
  setInterval(function () {
    if (today() !== bootDay) { bootDay = today(); render(); }
  }, 60000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && App.roomId) load();
  });
})();
