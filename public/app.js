// LunchMatch frontend. Plain JS, no build step. All user content is inserted via textContent.

const TIME_SLOTS = ["11:30", "12:00", "12:30", "13:00", "13:30"];
const FOODS = ["Anything", "Italian", "Asian", "Burger", "Healthy"];
const PLACES = ["Canteen", "Nearby restaurant", "Takeaway"];
const REFRESH_MS = 30_000;

const $ = (sel) => document.querySelector(sel);
const state = { user: null, board: null, food: "Anything", authMode: "login", openJoin: null };

// ---------- helpers ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new Error("Can't reach LunchMatch. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Something went wrong. Please try again.");
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}

function showError(el, msg) {
  el.textContent = msg || "";
  el.hidden = !msg;
}

async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

const dayLabel = (date) => (date === state.board?.today ? "Today" : date === state.board?.tomorrow ? "Tomorrow" : date);
const names = (list) => list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;

// ---------- auth ----------

function setAuthMode(mode) {
  state.authMode = mode;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  $("#auth-submit").textContent = mode === "login" ? "Sign in" : "Create account";
  $("#auth-form").password.autocomplete = mode === "login" ? "current-password" : "new-password";
  showError($("#auth-error"), "");
}

document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setAuthMode(t.dataset.mode)));

$("#auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email || !password) return showError($("#auth-error"), "Please enter your email and password.");
  if (state.authMode === "register" && password.length < 8) return showError($("#auth-error"), "Password must be at least 8 characters.");
  await busy($("#auth-submit"), "…", async () => {
    try {
      const { user } = await api("POST", state.authMode === "login" ? "/api/login" : "/api/register", { email, password });
      form.reset();
      enterApp(user);
    } catch (err) {
      showError($("#auth-error"), err.message);
      if (err.status === 409) setTimeout(() => { setAuthMode("login"); showError($("#auth-error"), err.message); form.email.value = email; }, 0);
    }
  });
});

$("#logout").addEventListener("click", async () => {
  await api("POST", "/api/logout").catch(() => {});
  state.user = null;
  state.board = null;
  showScreen("auth");
});

function showScreen(name) {
  $("#boot").hidden = true;
  $("#auth").hidden = name !== "auth";
  $("#app").hidden = name !== "app";
}

function enterApp(user) {
  state.user = user;
  $("#me").textContent = user.name;
  showScreen("app");
  loadBoard();
}

// ---------- board ----------

async function loadBoard({ quiet = false } = {}) {
  try {
    const q = state.food && state.food !== "Anything" ? `?food=${encodeURIComponent(state.food)}` : "";
    state.board = await api("GET", `/api/board${q}`);
    render();
    $("#updated").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch (err) {
    if (err.status === 401) return showScreen("auth");
    if (!quiet) {
      $("#open").replaceChildren(h("div", { class: "card empty" },
        h("p", {}, err.message), h("button", { class: "btn", onclick: () => loadBoard() }, "Try again")));
    }
  }
}

function render() {
  const b = state.board;

  // Your lunch plans (confirmed arrangements)
  $("#mine-section").hidden = b.mine.length === 0;
  $("#mine").replaceChildren(...b.mine.map(mineCard));

  // Food filter: known foods plus anything currently offered
  const foods = ["Anything", ...new Set([...FOODS.slice(1), ...b.foods])];
  if (!foods.includes(state.food)) foods.push(state.food);
  $("#food-filter").replaceChildren(...foods.map((f) =>
    h("button", { type: "button", class: "chip", "aria-pressed": String(state.food === f),
      onclick: () => { state.food = f; loadBoard(); } }, f === "Anything" ? "All" : f)));
  $("#food-filter").hidden = b.totalOpen === 0;

  // Open lunches
  if (b.open.length) {
    $("#open").replaceChildren(...b.open.map(openCard));
  } else if (b.totalOpen === 0) {
    $("#open").replaceChildren(h("div", { class: "card empty" },
      h("div", { class: "emoji" }, "🍽️"),
      h("p", {}, h("strong", {}, "No open lunches right now.")),
      h("p", { class: "muted" }, "Offer one above — colleagues can join with one tap.")));
  } else {
    $("#open").replaceChildren(h("div", { class: "card empty" },
      h("p", {}, h("strong", {}, `No lunches with “${state.food}” right now.`)),
      h("p", { class: "muted" }, `${b.totalOpen} other lunch${b.totalOpen === 1 ? " is" : "es are"} open.`),
      h("div", { class: "actions", style: "justify-content:center" },
        h("button", { class: "btn", onclick: () => { state.food = "Anything"; loadBoard(); } }, "Show all"),
        h("button", { class: "btn primary", onclick: () => openOffer(state.food) }, `Offer ${state.food}`))));
  }
}

function lunchHeader(e) {
  return [
    h("div", { class: "lunch-head" }, h("span", { class: "lunch-time" }, e.time), h("span", { class: "lunch-day" }, dayLabel(e.date))),
    h("div", { class: "lunch-what" }, `${e.food} · ${e.place}`),
  ];
}

function mineCard(e) {
  const isCreator = e.creator.userId === state.user.id;
  const others = [e.creator, ...e.participants].filter((p) => p.userId !== state.user.id);
  const summary = others.length
    ? h("p", {}, "🎉 You're having lunch with ", h("strong", {}, names(others.map((p) => p.name))), ".")
    : h("p", { class: "muted" }, "⏳ Waiting for colleagues to join. You'll get an email when someone does.");

  const people = h("div", { class: "people" }, h("ul", {},
    h("li", {}, `${e.creator.name}${isCreator ? " (you)" : ""} — organiser`, e.comment ? h("span", { class: "muted" }, `: “${e.comment}”`) : null),
    e.participants.map((p) => h("li", {}, `${p.name}${p.userId === state.user.id ? " (you)" : ""}`,
      p.comment ? h("span", { class: "muted" }, `: “${p.comment}”`) : null))));

  const contact = others.length ? h("p", { class: "small muted" }, "Contact: ", others.map((p, i) =>
    [i ? ", " : "", h("a", { href: `mailto:${p.email}` }, p.email)])) : null;

  const action = isCreator
    ? h("button", { class: "btn danger small", onclick: (ev) => cancelLunch(e, ev.target) }, "Cancel lunch")
    : h("button", { class: "btn danger small", onclick: (ev) => leaveLunch(e, ev.target) }, "Leave");

  return h("article", { class: "card mine" }, lunchHeader(e), summary, people, contact, h("div", { class: "actions" }, action));
}

function openCard(e) {
  const going = e.participants.length;
  const expanded = state.openJoin === e.id;
  const body = [
    ...lunchHeader(e),
    h("div", { class: "muted small" }, `by ${e.creator.name}${going ? ` · ${going} joined` : ""}`),
    e.comment ? h("p", { class: "lunch-comment" }, `“${e.comment}”`) : null,
  ];
  if (!expanded) {
    body.push(h("div", { class: "actions" },
      h("button", { class: "btn primary", onclick: () => { state.openJoin = e.id; render(); $(`#join-${e.id}`)?.focus(); } }, "Join")));
  } else {
    const input = h("input", { id: `join-${e.id}`, maxlength: "280", placeholder: "Comment (optional), e.g. I'll be 5 min late" });
    const btn = h("button", { class: "btn primary", type: "submit" }, "Confirm");
    body.push(h("form", { class: "actions", onsubmit: (ev) => { ev.preventDefault(); joinLunch(e, input.value, btn); } },
      input, btn, h("button", { class: "btn ghost", type: "button", onclick: () => { state.openJoin = null; render(); } }, "Cancel")));
  }
  return h("article", { class: "card" }, body);
}

async function joinLunch(e, comment, btn) {
  await busy(btn, "Joining…", async () => {
    try {
      const res = await api("POST", `/api/entries/${e.id}/join`, { comment });
      state.openJoin = null;
      toast(res.notified ? `You're in! ${e.creator.name} has been notified.` : "You're in!");
      await loadBoard();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast(err.message);
      loadBoard({ quiet: true });
    }
  });
}

async function leaveLunch(e, btn) {
  if (!confirm(`Leave the ${e.time} lunch with ${e.creator.name}?`)) return;
  await busy(btn, "…", async () => {
    try { await api("DELETE", `/api/entries/${e.id}/join`); toast("You left the lunch."); }
    catch (err) { toast(err.message); }
    await loadBoard();
  });
}

async function cancelLunch(e, btn) {
  const msg = e.participants.length ? `Cancel this lunch? ${names(e.participants.map((p) => p.name))} will no longer see it.` : "Cancel this lunch?";
  if (!confirm(msg)) return;
  await busy(btn, "…", async () => {
    try { await api("DELETE", `/api/entries/${e.id}`); toast("Lunch cancelled."); }
    catch (err) { toast(err.message); }
    await loadBoard();
  });
}

// ---------- offer a lunch ----------

const offer = { day: "today", time: null, food: "Anything", place: "Canteen" };

/** Chip group with an optional "Other" free-text field. */
function chipGroup(group, options, { other, disabled = () => false } = {}) {
  const box = document.querySelector(`[data-group="${group}"]`);
  const custom = !options.includes(offer[group]) && offer[group];
  const chips = options.map((o) => h("button", {
    type: "button", class: "chip", "aria-pressed": String(offer[group] === o), disabled: disabled(o),
    onclick: () => { offer[group] = o; renderOffer(); },
  }, o));
  if (other) {
    const input = h("input", { class: "chip-input", placeholder: other.placeholder, type: other.type || "text",
      maxlength: other.max, value: custom || "", "aria-label": other.placeholder });
    input.addEventListener("input", () => {
      offer[group] = input.value.trim() || null;
      box.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
    });
    chips.push(input);
  }
  box.replaceChildren(...chips);
}

const slotPassed = (slot) => offer.day === "today" && state.board && slot < state.board.now;

function renderOffer() {
  chipGroup("day", ["today", "tomorrow"]);
  document.querySelectorAll('[data-group="day"] .chip').forEach((c) => (c.textContent = c.textContent === "today" ? "Today" : "Tomorrow"));
  if (offer.time && TIME_SLOTS.includes(offer.time) && slotPassed(offer.time)) offer.time = null;
  chipGroup("time", TIME_SLOTS, { other: { placeholder: "Other time", type: "time" }, disabled: slotPassed });
  chipGroup("food", FOODS, { other: { placeholder: "Something else", max: 40 } });
  chipGroup("place", PLACES, { other: { placeholder: "Other place", max: 60 } });
}

function openOffer(food) {
  const now = state.board?.now ?? "00:00";
  const nextSlot = TIME_SLOTS.find((s) => s >= now);
  Object.assign(offer, { day: nextSlot ? "today" : "tomorrow", time: nextSlot ?? TIME_SLOTS[1],
    food: typeof food === "string" && food !== "Anything" ? food : "Anything", place: "Canteen" });
  $("#offer-form").comment.value = "";
  showError($("#offer-error"), "");
  renderOffer();
  $("#offer").showModal();
}

$("#offer-btn").addEventListener("click", () => openOffer());
$("#offer [data-close]").addEventListener("click", () => $("#offer").close());

$("#offer-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!offer.time) return showError($("#offer-error"), "Pick a time.");
  await busy($("#offer-submit"), "Posting…", async () => {
    try {
      await api("POST", "/api/entries", { day: offer.day, time: offer.time, food: offer.food, place: offer.place,
        comment: $("#offer-form").comment.value });
      $("#offer").close();
      toast("Lunch posted! Colleagues can join now.");
      await loadBoard();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      showError($("#offer-error"), err.message);
    }
  });
});

// ---------- boot ----------

setInterval(() => { if (state.user && !document.hidden && !state.openJoin) loadBoard({ quiet: true }); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (state.user && !document.hidden) loadBoard({ quiet: true }); });

$("#demo-btn").addEventListener("click", () => busy($("#demo-btn"), "Signing in…", async () => {
  try { enterApp((await api("POST", "/api/demo-login")).user); }
  catch (err) { showError($("#auth-error"), err.message); }
}));

api("GET", "/api/me")
  .then(({ user, demo }) => { $("#demo-box").hidden = !demo; user ? enterApp(user) : showScreen("auth"); })
  .catch(() => showScreen("auth"));
