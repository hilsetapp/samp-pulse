/* ═══════════════════════════════════════════════════════════════
   SAMP Пульс - живые данные, фильтры и графики.
   Один файл, ноль библиотек. Данные: открытый список open.mp
   (живой снимок прямо из браузера) + снимки истории из ветки data.
   ═══════════════════════════════════════════════════════════════ */

(() => {
  const $ = (s) => document.querySelector(s);
  const fmt = new Intl.NumberFormat("ru-RU");

  /* главный источник - папка data рядом с сайтом: тот же домен, что у страницы.
     если сайт открылся, данные тоже придут, чужие домены не нужны.
     зеркала ниже - запас, если файл открыли откуда-то ещё */
  const DATA_BASE = new URLSearchParams(location.search).get("data") || "data";
  const DATA_MIRRORS = [
    DATA_BASE,
    "https://raw.githubusercontent.com/hilsetapp/samp-pulse/data",
    "https://raw.githack.com/hilsetapp/samp-pulse/data",
  ];

  async function fromMirrors(path, json = true, ms = 8000) {
    /* номер минуты в ссылке: обходит кэш Pages, но не гоняет файлы лишний раз */
    const v = Math.floor(Date.now() / 60000);
    let lastErr = null;
    for (const base of DATA_MIRRORS) {
      try {
        return json ? await getJSON(`${base}/${path}?v=${v}`, { timeoutMs: ms }) : await getText(`${base}/${path}?v=${v}`, { timeoutMs: ms });
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("no mirrors");
  }
  const LIVE_API = "https://api.open.mp/servers";
  const PAGE = 120;
  const REFRESH_MS = 5 * 60 * 1000;

  const state = {
    startedAt: Date.now(),
    live: null,          // массив нормализованных серверов
    history: [],         // точки онлайна {t,p,s,ru,rs}
    serverHist: {},      // ip -> [{t, avg, peak}]
    meta: null,
    fetchedAt: 0,
    fallback: false,
    failed: false,
    shown: PAGE,
    filters: { q: "", lang: "all", mode: "all", ver: "all", online: true, nopass: false, fav: false, sort: "players" },
    fav: new Set(JSON.parse(localStorage.getItem("samp-pulse:fav") || "[]")),
  };

  /* ────────── утилиты ────────── */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function stripColors(name) {
    return String(name || "")
      .replace(/\{[0-9a-fA-F]{6}\}/g, "")   // {FF2A55}
      .replace(/\{[0-9a-fA-F]{1,5}\}/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  const LANGS = [
    ["ru", "🇷🇺", /russian|русск|(^|[^a-z])ru([^a-z]|$)/],
    ["en", "🇬🇧", /english|(^|[^a-z])en([^a-z]|$)/],
    ["es", "🇪🇸", /espa|spanish/],
    ["pt", "🇧🇷", /portug|brasil|brazil/],
    ["id", "🇮🇩", /indonesia|malay/],
    ["pl", "🇵🇱", /polish|polski|polska/],
    ["tr", "🇹🇷", /turkish|türk|turk/],
    ["de", "🇩🇪", /german|deutsch/],
    ["fr", "🇫🇷", /french|français/],
    ["az", "🇦🇿", /azerbaijan|azərbaycan/],
    ["ua", "🇺🇦", /ukrain|україн/],
    ["kz", "🇰🇿", /kazakh|қазақ/],
  ];

  function detectLang(la) {
    const s = String(la || "").toLowerCase();
    for (const [code, flag, re] of LANGS) if (re.test(s)) return { code, flag };
    return { code: "other", flag: "🌐" };
  }

  const MODES = [
    ["rp", "РП", /(^|[^a-z])(rp|rpg|role.?play)([^a-z]|$)|ролев/i],
    ["dm", "ДМ", /(^|[^a-z])(tdm|dm|deathmatch)([^a-z]|$)|(^|\s)дм($|\s)/i],
    ["stunt", "стант", /stunt|стант/i],
    ["drift", "дрифт", /drift|дрифт/i],
    ["race", "гонки", /race|racing|гонк/i],
    ["surv", "выживание", /zombie|survival|infection|выжив/i],
  ];

  function detectMode(gm) {
    const s = String(gm || "");
    for (const [code, label, re] of MODES) if (re.test(s)) return { code, label };
    return { code: "other", label: "другое" };
  }

  const fillPct = (s) => (s.pm > 0 ? Math.round((s.pc / s.pm) * 100) : 0);

  function normalizeRow(r) {
    const name = stripColors(r.hn) || r.ip;
    return {
      ip: r.ip, name, pc: r.pc, pm: r.pm,
      gm: stripColors(r.gm) || "-", omp: !!r.omp, vn: r.vn || "", pa: !!r.pa,
      lang: detectLang(r.la),
      /* режим ищем и в gamemode, и в названии: «B-Zone RPG» - это РП */
      mode: detectMode((r.gm || "") + " " + name),
    };
  }

  function normalizeMin(compact) {
    return compact.map((c) => normalizeRow({
      ip: c[0], hn: c[1], pc: c[2], pm: c[3], gm: c[4], la: c[5], pa: c[6], omp: c[7], vn: c[8], pr: c[9],
    }));
  }

  /* запрос с таймаутом: без него медленный API подвешивает страницу навсегда */
  async function getJSON(url, opts = {}) {
    const ms = opts.timeoutMs || 20000;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctl.signal, ...opts });
      if (!res.ok) throw new Error("http " + res.status);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function getText(url, opts = {}) {
    const ms = opts.timeoutMs || 20000;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctl.signal, ...opts });
      if (!res.ok) throw new Error("http " + res.status);
      return res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  /* ────────── загрузка данных ────────── */
  function applyLive(raw) {
    state.live = raw.map(normalizeRow);
    state.fetchedAt = Date.now();
    state.fallback = false;
  }
  function applySnapshot(min) {
    state.live = normalizeMin(min.s);
    state.fetchedAt = (min.t || 0) * 1000;
    state.fallback = true;
  }
  function renderAll() {
    updateFreshness(); renderChips(); renderTop5(); renderRows(true); renderChart();
  }

  /* два источника стартуют одновременно: живой список open.mp и сохранённый снимок.
     что ответило первым, то и на экране; живые цифры всегда имеют приоритет */
  async function loadLive() {
    const btn = $("#btn-refresh");
    btn.disabled = true;

    let liveGot = false, snapShown = false;

    const liveP = getJSON(LIVE_API, { headers: { Accept: "application/json" }, timeoutMs: 6000 })
      .then((raw) => {
        liveGot = true;
        applyLive(raw);
        state.failed = false;
        hideNotice();
        renderAll();
      })
      .catch(() => {});

    const snapP = fromMirrors("live_min.json", true, 6000)
      .then((min) => {
        if (liveGot || state.live) return;
        applySnapshot(min);
        snapShown = true;
        state.failed = false;
        renderAll();   /* цифры на экране сразу, пугать предупреждением пока нечем */
      })
      .catch(() => {});

    await Promise.allSettled([liveP, snapP]);

    if (!state.live || !state.live.length) {
      state.failed = true;
      state.fetchedAt = 0;
      showNotice("Не получилось загрузить ни живой список, ни сохранённый снимок. Так бывает, когда сеть режет api.open.mp. Нажми «Обновить» через полминуты.");
    } else if (snapShown && !liveGot) {
      /* снимок на экране, живой список молчит: честно говорим и тихо пробуем ещё */
      state.failed = false;
      showNotice("Живой список серверов не ответил, показываю последний сохранённый снимок (обновляется каждые 15 минут). Как только API ответит, цифры обновятся сами.");
      for (let attempt = 0; attempt < 2 && !liveGot; attempt++) {
        try {
          const raw2 = await getJSON(LIVE_API, { headers: { Accept: "application/json" }, timeoutMs: 10000 });
          liveGot = true;
          applyLive(raw2);
          state.failed = false;
          hideNotice();
          renderAll();
        } catch (e) { /* молча пробуем ещё раз */ }
      }
    }

    btn.disabled = false;
    renderAll();
  }

  async function loadHistory() {
    const now = new Date();
    const cur = `online-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}.jsonl`;
    const prevD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prev = `online-${prevD.getUTCFullYear()}-${String(prevD.getUTCMonth() + 1).padStart(2, "0")}.jsonl`;

    try { state.meta = await fromMirrors("meta.json"); } catch {}

    /* список файлов истории пишет сборщик: не дёргаем то, чего нет */
    const files = (state.meta && Array.isArray(state.meta.files) && state.meta.files.length)
      ? state.meta.files.slice(-2)
      : [prev, cur];

    const parse = (txt) => txt.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    let points = [];
    for (const f of files) {
      try { points = points.concat(parse(await fromMirrors(f, false))); } catch {}
    }
    points.sort((a, b) => a.t - b.t);
    /* в файлах время в секундах, в остальном коде - в миллисекундах */
    points.forEach((p) => { if (p.t < 1e12) p.t *= 1000; });
    state.history = points;

    try {
      const hist = await fromMirrors("servers.json");
      state.serverHist = {};
      for (const [ip, rec] of Object.entries(hist)) {
        const pts = (rec.b || []).map(([t, sum, n, peak]) => ({ t: t * 1000, avg: Math.round(sum / n), peak }));
        if (pts.length) state.serverHist[ip] = pts;
      }
    } catch {}
  }

  /* ────────── шапка ────────── */
  function renderChips() {
    if (!state.live) return;
    const total = state.live.reduce((a, s) => a + s.pc, 0);
    const active = state.live.filter((s) => s.pc > 0).length;
    const ru = state.live.filter((s) => s.lang.code === "ru");
    $("#c-players").textContent = fmt.format(total);
    $("#c-active").textContent = fmt.format(active);
    $("#c-ru").textContent = fmt.format(ru.reduce((a, s) => a + s.pc, 0));
    $("#lg-all-now").textContent = fmt.format(total);
    $("#lg-ru-now").textContent = fmt.format(ru.reduce((a, s) => a + s.pc, 0));
  }

  function updateFreshness() {
    const el = $("#c-fresh");
    if (!state.fetchedAt) {
      const waited = Math.round((Date.now() - (state.startedAt || Date.now())) / 1000);
      if (state.failed) {
        el.textContent = "данных нет, жми «Обновить»";
        el.classList.add("stale");
        return;
      }
      el.textContent = waited > 12 ? "нет ответа, пробую ещё…" : "загружаю список…";
      el.classList.toggle("stale", waited > 12);
      return;
    }
    const mins = Math.max(0, Math.round((Date.now() - state.fetchedAt) / 60000));
    const t = new Date(state.fetchedAt);
    const hhmm = t.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    el.textContent = state.fallback
      ? (mins < 1 ? `снимок только что` : `снимок от ${hhmm} · ${mins} мин назад`)
      : (mins < 1 ? `обновлено только что` : `обновлено ${hhmm} · ${mins} мин назад`);
    el.classList.toggle("stale", mins > 20 || state.fallback);
  }

  function hideNotice() {
    const el = $("#notice");
    if (el) el.hidden = true;
  }

  function showNotice(msg) {
    const el = $("#notice");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  /* ────────── графики (чистый SVG) ────────── */
  function niceMax(v) {
  v = Math.max(v || 1, 1);
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}
  const shortNum = (n) => (n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1).replace(".0", "") + "k" : String(n));

  function drawChart(container, points, series, opts = {}) {
    const w = Math.max(320, container.clientWidth);
    const h = container.clientHeight || opts.height || 240;
    const pad = { l: 46, r: 14, t: 14, b: 24 };
    container.innerHTML = "";

    if (points.length < 2) {
      container.innerHTML = `<div style="color:var(--dim);font-size:13px;padding:20px 8px">Данных пока мало - история копится. Загляни попозже.</div>`;
      return;
    }

    const xs = points.map((p) => p.t);
    const t0 = Math.min(...xs), t1 = Math.max(...xs);
    const ymax = niceMax(Math.max(...points.map((p) => Math.max(...series.map((s) => p[s.key] || 0)))) * 1.08) || 1;

    const X = (t) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (w - pad.l - pad.r);
    const Y = (v) => h - pad.b - (v / ymax) * (h - pad.t - pad.b);

    const parts = [`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`];

    /* сетка и подписи по Y */
    for (let i = 0; i <= 4; i++) {
      const v = (ymax / 4) * i;
      const y = Y(v).toFixed(1);
      parts.push(`<line x1="${pad.l}" x2="${w - pad.r}" y1="${y}" y2="${y}" stroke="#2e343c" stroke-width="1"/>`);
      parts.push(`<text x="${pad.l - 8}" y="${+y + 4}" fill="#97a1ac" font-size="11" text-anchor="end" font-family="monospace">${shortNum(Math.round(v))}</text>`);
    }

    /* подписи по X */
    for (let i = 0; i <= 3; i++) {
      const t = t0 + ((t1 - t0) / 3) * i;
      const x = X(t);
      const lab = new Date(t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      const anchor = i === 0 ? "start" : i === 3 ? "end" : "middle";
      parts.push(`<text x="${x}" y="${h - 6}" fill="#97a1ac" font-size="11" text-anchor="${anchor}" font-family="monospace">${lab}</text>`);
    }

    /* линии */
    for (const s of series) {
      const d = points.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p[s.key] || 0).toFixed(1)}`).join(" ");
      if (s.area) {
        const area = d + ` L${X(t1).toFixed(1)},${h - pad.b} L${X(t0).toFixed(1)},${h - pad.b} Z`;
        parts.push(`<path d="${area}" fill="${s.color}" opacity="${s.areaOpacity || 0.09}"/>`);
      }
      parts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2.2}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }

    /* слой наведения */
    parts.push(`<g id="hover-layer"></g>`);
    parts.push(`<rect id="hover-cap" x="${pad.l}" y="0" width="${w - pad.l - pad.r}" height="${h - pad.b}" fill="transparent" pointer-events="all"/>`);
    parts.push("</svg>");
    container.innerHTML = parts.join("");

    /* подсказка */
    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    container.appendChild(tip);

    const svg = container.querySelector("svg");
    const cap = container.querySelector("#hover-cap");
    const layer = container.querySelector("#hover-layer");

    cap.addEventListener("mousemove", (ev) => {
      const rect = svg.getBoundingClientRect();
      const mx = ((ev.clientX - rect.left) / rect.width) * w;
      let best = 0, bestD = Infinity;
      points.forEach((p, i) => { const d = Math.abs(X(p.t) - mx); if (d < bestD) { bestD = d; best = i; } });
      const p = points[best];
      const cx = X(p.t);
      layer.innerHTML = `<line x1="${cx}" x2="${cx}" y1="${pad.t}" y2="${h - pad.b}" stroke="#3a4149" stroke-width="1"/>`
        + series.map((s) => `<circle cx="${cx}" cy="${Y(p[s.key] || 0)}" r="3.5" fill="${s.color}"/>`).join("");
      tip.hidden = false;
      tip.style.left = (cx / w) * rect.width + "px";
      tip.style.top = (Y(Math.max(...series.map((s) => p[s.key] || 0))) / h) * rect.height + "px";
      const tm = new Date(p.t).toLocaleString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      tip.innerHTML = `${tm}<br>` + series.map((s) => `<span style="color:${s.color}">■</span> ${s.label}: <b>${fmt.format(p[s.key] || 0)}</b>`).join("<br>");
    });
    cap.addEventListener("mouseleave", () => { tip.hidden = true; layer.innerHTML = ""; });
  }

  function drawSpark(pts) {
    if (!pts || pts.length < 2) return `<span class="spark empty">нет данных</span>`;
    const w = 92, h = 26, vals = pts.map((p) => p.avg);
    const mx = Math.max(...vals, 1), mn = Math.min(...vals);
    const X = (i) => (i / (pts.length - 1)) * (w - 4) + 2;
    const Y = (v) => h - 3 - ((v - mn) / (mx - mn || 1)) * (h - 8);
    const d = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.avg).toFixed(1)}`).join(" ");
    return `<span class="spark"><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="#ffb020" stroke-width="1.6" opacity=".85"/></svg></span>`;
  }

  function renderChart() {
    const hist = state.history.slice();
    if (state.live) {
      hist.push({
        t: state.fetchedAt,
        p: state.live.reduce((a, s) => a + s.pc, 0),
        ru: state.live.filter((s) => s.lang.code === "ru").reduce((a, s) => a + s.pc, 0),
      });
    }
    const cut = Date.now() - 24 * 3600 * 1000;
    const pts = hist.filter((p) => p.t >= cut);
    drawChart($("#chart"), pts, [
      { key: "p", color: "#ffb020", label: "всего", area: true, areaOpacity: 0.10 },
      { key: "ru", color: "#33c7a0", label: "на русских", width: 1.8 },
    ], { height: 240 });

    const note = $("#chart-note");
    if (state.history.length < 8) {
      const since = state.history.length ? new Date(state.history[0].t).toLocaleDateString("ru-RU") : "сегодня";
      note.textContent = `История копится с ${since}: пока ${state.history.length} точек. Снимок раз в 15 минут, за сутки график наберёт форму.`;
    } else {
      note.textContent = `Снимок каждые 15 минут из открытого списка open.mp. Точек за сутки: ${pts.length}.`;
    }
    const foot = $("#hist-since");
    if (foot && state.history.length) foot.textContent = `История онлайна копится с ${new Date(state.history[0].t).toLocaleDateString("ru-RU")}.`;
  }

  /* ────────── топ сейчас ────────── */
  function renderTop5() {
    if (!state.live) return;
    const top = state.live.filter((s) => s.pc > 0).sort((a, b) => b.pc - a.pc).slice(0, 5);
    $("#top5").innerHTML = top.map((s, i) => {
      const pct = fillPct(s);
      const cls = pct > 90 ? "hot" : pct > 70 ? "mid" : "";
      return `<div class="t5-card" data-ip="${esc(s.ip)}">
        <span class="t5-rank">#${i + 1} СЕЙЧАС В ИГРЕ</span>
        <div class="t5-name">${s.lang.flag} ${esc(s.name)}</div>
        <div class="t5-meta"><span>${esc(s.mode.label)}</span><span>${s.omp ? "open.mp" : esc(s.vn || "SA-MP")}</span></div>
        <div class="t5-num">${fmt.format(s.pc)} <small>/ ${fmt.format(s.pm)} · ${pct}%</small></div>
        <span class="pbar"><i class="${cls}" style="width:${Math.min(100, pct)}%;display:block;height:6px"></i></span>
      </div>`;
    }).join("");
  }

  /* ────────── фильтры и таблица ────────── */
  function filtered() {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    let list = state.live || [];
    if (f.online) list = list.filter((s) => s.pc > 0);
    if (f.nopass) list = list.filter((s) => !s.pa);
    if (f.fav) list = list.filter((s) => state.fav.has(s.ip));
    if (f.lang !== "all") list = list.filter((s) => (f.lang === "other" ? !["ru", "en"].includes(s.lang.code) :
      f.lang === "en" ? ["en"].includes(s.lang.code) : s.lang.code === "ru"));
    if (f.mode !== "all") list = list.filter((s) => s.mode.code === f.mode);
    if (f.ver !== "all") list = list.filter((s) => (f.ver === "omp" ? s.omp : !s.omp));
    if (q) list = list.filter((s) => (s.name + " " + s.ip + " " + s.gm + " " + s.lang.code).toLowerCase().includes(q));

    const cmp = {
      players: (a, b) => b.pc - a.pc,
      fill: (a, b) => fillPct(b) - fillPct(a) || b.pc - a.pc,
      slots: (a, b) => b.pm - a.pm,
      name: (a, b) => a.name.localeCompare(b.name, "ru"),
    }[f.sort] || ((a, b) => b.pc - a.pc);
    return list.sort(cmp);
  }

  function rowHTML(s, i) {
    const pct = fillPct(s);
    const barCls = pct > 90 ? "hot" : pct > 70 ? "mid" : "";
    const isFav = state.fav.has(s.ip);
    const ver = s.omp ? `<span class="pill omp">open.mp</span>` : `<span class="pill">${esc(s.vn || "SA-MP")}</span>`;
    const spark = drawSpark(state.serverHist[s.ip]);
    return `<div class="row" data-ip="${esc(s.ip)}">
      <span class="r-num">${i + 1}</span>
      <div class="r-name">
        <div class="r-title">${s.pa ? '<span class="lock">🔒</span>' : ""}${esc(s.name)}</div>
        <div class="r-sub"><span class="flag">${s.lang.flag}</span>${esc(s.ip)} · ${esc(s.vn || "")}</div>
      </div>
      <span class="r-mode"><b>${esc(s.mode.label)}</b></span>
      <span class="r-ver">${ver}</span>
      <div class="r-players"><span class="n">${fmt.format(s.pc)}<small>/${fmt.format(s.pm)}</small></span>
        <span class="pbar"><i class="${barCls}" style="width:${Math.min(100, pct)}%"></i></span></div>
      <span class="r-fill">${pct}%</span>
      ${spark}
      <span class="r-acts">
        <a class="act act-play" href="samp://${esc(s.ip)}" title="Открыть в SA-MP / open.mp">Играть</a>
        <button class="act act-star ${isFav ? "fav-on" : ""}" title="В избранное" data-act="fav">★</button>
        <button class="act act-copy" title="Скопировать IP" data-act="copy">📋</button>
      </span>
    </div>`;
  }

  function renderRows(reset) {
    const list = filtered();
    if (reset) state.shown = PAGE;
    const slice = list.slice(0, state.shown);
    const box = $("#rows");
    if (!list.length) {
      box.innerHTML = "";
      $("#empty").hidden = false;
    } else {
      $("#empty").hidden = true;
      box.innerHTML = slice.map(rowHTML).join("");
    }
    $("#btn-more").hidden = state.shown >= list.length;
    const active = (state.live || []).filter((s) => s.pc > 0).length;
    $("#count").innerHTML = `<b>${fmt.format(list.length)}</b> серверов под фильтром · показано ${fmt.format(slice.length)} · всего играет <b>${fmt.format(active)}</b>`;
    const d = state.filters;
    $("#btn-reset").hidden = !(d.q || d.lang !== "all" || d.mode !== "all" || d.ver !== "all" || !d.online || d.nopass || d.fav || d.sort !== "players");
    syncURL();
  }

  /* ────────── карточка сервера ────────── */
  function openModal(ip) {
    const s = (state.live || []).find((x) => x.ip === ip);
    if (!s) return;
    const pct = fillPct(s);
    const hist = state.serverHist[ip] || [];
    const isFav = state.fav.has(ip);
    const name = esc(s.name);
    $("#modal-body").innerHTML = `
      <h3 class="m-title">${s.lang.flag} ${name}</h3>
      <div class="m-sub">${esc(s.gm)}</div>
      <div class="m-grid">
        <div class="m-cell"><div class="k">игроки</div><div class="v">${fmt.format(s.pc)} <small>/ ${fmt.format(s.pm)} · ${pct}%</small></div></div>
        <div class="m-cell"><div class="k">версия</div><div class="v" style="font-size:13px">${esc(s.omp ? "open.mp" : "SA-MP")}<br><small>${esc(s.vn || "")}</small></div></div>
        <div class="m-cell"><div class="k">режим</div><div class="v" style="font-size:14px">${esc(s.mode.label)}</div></div>
        <div class="m-cell"><div class="k">пароль</div><div class="v" style="font-size:14px">${s.pa ? "да 🔒" : "нет"}</div></div>
      </div>
      <div class="m-ip"><code>${esc(s.ip)}</code>
        <button class="act" data-act="copy">скопировать IP</button></div>
      <div class="m-chart-h">онлайн сервера (среднее и пик по часам)</div>
      <div class="chart m-chart" id="m-chart"></div>
      <div class="m-acts">
        <a class="act act-play" href="samp://${esc(s.ip)}" style="padding:10px 18px">▶ Играть</a>
        <button class="act ${isFav ? "fav-on" : ""}" data-act="fav" style="padding:10px 14px">${isFav ? "★ в избранном" : "☆ в избранное"}</button>
        <button class="act" data-act="share" style="padding:10px 14px">🔗 ссылка на сервер</button>
      </div>
      <p class="m-hint">Если кнопка «Играть» ничего не открыла - значит клиент SA-MP или лаунчер open.mp не установлен: скопируй IP и вставь в свой клиент (Favorites → Add server).</p>`;
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";

    const pts = hist.slice(-36);
    if (pts.length >= 2) {
      drawChart($("#m-chart"), pts, [
        { key: "avg", color: "#ffb020", label: "среднее", area: true, areaOpacity: 0.09 },
        { key: "peak", color: "#33c7a0", label: "пик", width: 1.6 },
      ], { height: 150 });
    } else {
      $("#m-chart").innerHTML = `<div style="color:var(--dim);font-size:13px;padding:16px 6px">По этому серверу история пока копится - загляни через сутки.</div>`;
    }

    $("#modal-body").onclick = (ev) => {
      const b = ev.target.closest("[data-act]");
      if (!b) return;
      const act = b.dataset.act;
      if (act === "copy") copyText(s.ip, "IP скопирован: " + s.ip);
      if (act === "fav") { toggleFav(s.ip); openModal(s.ip); }
      if (act === "share") copyText(location.origin + location.pathname + "#s=" + encodeURIComponent(s.ip), "Ссылка на сервер скопирована");
    };
    if (history.replaceState) history.replaceState(null, "", "#s=" + encodeURIComponent(ip));
  }

  function closeModal() {
    $("#modal").hidden = true;
    document.body.style.overflow = "";
    if (location.hash.startsWith("#s=")) history.replaceState(null, "", location.pathname + location.search);
  }

  /* ────────── избранное, буфер, тосты ────────── */
  function toggleFav(ip) {
    if (state.fav.has(ip)) state.fav.delete(ip); else state.fav.add(ip);
    localStorage.setItem("samp-pulse:fav", JSON.stringify([...state.fav]));
    renderRows(false);
  }

  function copyText(text, msg) {
    const done = () => toast(msg);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch {}
      ta.remove();
    }
  }

  let toastT = null;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.hidden = true; }, 2200);
  }

  /* ────────── URL ────────── */
  function syncURL() {
    const f = state.filters;
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.lang !== "all") p.set("lang", f.lang);
    if (f.mode !== "all") p.set("mode", f.mode);
    if (f.ver !== "all") p.set("ver", f.ver);
    if (!f.online) p.set("all", "1");
    if (f.nopass) p.set("nopass", "1");
    if (f.fav) p.set("fav", "1");
    if (f.sort !== "players") p.set("sort", f.sort);
    const qs = p.toString();
    history.replaceState(null, "", (qs ? "?" + qs : location.pathname) + location.hash);
  }

  function readURL() {
    const p = new URLSearchParams(location.search);
    const f = state.filters;
    f.q = p.get("q") || "";
    f.lang = p.get("lang") || "all";
    f.mode = p.get("mode") || "all";
    f.ver = p.get("ver") || "all";
    f.online = p.get("all") !== "1";
    f.nopass = p.get("nopass") === "1";
    f.fav = p.get("fav") === "1";
    f.sort = p.get("sort") || "players";
    $("#q").value = f.q;
    $("#f-lang").value = f.lang;
    $("#f-mode").value = f.mode;
    $("#f-ver").value = f.ver;
    $("#sort").value = f.sort;
    $("#f-online").checked = f.online;
    $("#f-nopass").checked = f.nopass;
    $("#f-fav").checked = f.fav;
  }

  /* ────────── события ────────── */
  function wire() {
    $("#q").addEventListener("input", debounce((e) => { state.filters.q = e.target.value; renderRows(true); }, 160));
    for (const [id, key] of [["#f-lang", "lang"], ["#f-mode", "mode"], ["#f-ver", "ver"], ["#sort", "sort"]]) {
      $(id).addEventListener("change", (e) => { state.filters[key] = e.target.value; renderRows(true); });
    }
    for (const [id, key] of [["#f-online", "online"], ["#f-nopass", "nopass"], ["#f-fav", "fav"]]) {
      $(id).addEventListener("change", (e) => { state.filters[key] = e.target.checked; renderRows(true); });
    }
    $("#btn-reset").onclick = () => {
      state.filters = { q: "", lang: "all", mode: "all", ver: "all", online: true, nopass: false, fav: false, sort: "players" };
      $("#q").value = ""; $("#f-lang").value = "all"; $("#f-mode").value = "all";
      $("#f-ver").value = "all"; $("#sort").value = "players";
      $("#f-online").checked = true; $("#f-nopass").checked = false; $("#f-fav").checked = false;
      renderRows(true);
    };
    $("#btn-more").onclick = () => { state.shown += PAGE; renderRows(false); };
    $("#btn-refresh").onclick = () => { loadLive(); loadHistory().then(() => { renderChart(); renderRows(false); }); };
    $("#btn-random").onclick = () => {
      const pool = (state.live || []).filter((s) => s.pc > 0);
      if (!pool.length) return;
      const s = pool[Math.floor(Math.random() * pool.length)];
      toast("🎲 " + s.name);
      openModal(s.ip);
    };

    document.addEventListener("click", (ev) => {
      const row = ev.target.closest(".row");
      const t5 = ev.target.closest(".t5-card");
      if (t5) { openModal(t5.dataset.ip); return; }
      if (!row) return;
      const act = ev.target.closest("[data-act]");
      if (act) {
        if (act.dataset.act === "fav") { toggleFav(row.dataset.ip); return; }
        if (act.dataset.act === "copy") { copyText(row.dataset.ip, "IP скопирован: " + row.dataset.ip); return; }
        return;
      }
      if (ev.target.closest("a")) return; /* «Играть» - обычная ссылка, пусть открывает клиент */
      openModal(row.dataset.ip);
    });

    $("#modal-x").onclick = closeModal;
    $("#modal-back").onclick = closeModal;
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeModal();
      if (ev.key === "/" && !/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) {
        ev.preventDefault(); $("#q").focus();
      }
    });

    window.addEventListener("resize", debounce(() => {
      renderChart();
      if (!$("#modal").hidden && location.hash.startsWith("#s=")) {
        const ip = decodeURIComponent(location.hash.slice(3));
        if (state.serverHist[ip]) openModal(ip);
      }
    }, 180));
  }

  /* ────────── старт ────────── */
  async function init() {
    readURL();
    wire();
    setInterval(updateFreshness, 15000);
    setInterval(() => loadLive(), REFRESH_MS);

    await loadHistory();
    renderChart();
    const stuck = setTimeout(() => {
      if (!state.live || !state.live.length) {
        document.querySelectorAll("#c-players, #c-active, #c-ru, #count").forEach((e) => { if (e.textContent === "…") e.textContent = "—"; });
        renderRows(false);
      }
    }, 70000);
    await loadLive();
    clearTimeout(stuck);

    if (location.hash.startsWith("#s=")) {
      const ip = decodeURIComponent(location.hash.slice(3));
      if ((state.live || []).some((s) => s.ip === ip)) openModal(ip);
    }
  }

  init();
})();
