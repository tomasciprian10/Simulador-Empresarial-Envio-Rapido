/* =====================================================================
   Envío Rápido — Controlador del juego (render + animaciones + loop)
   ===================================================================== */
(function (root) {
  "use strict";

  var E = root.GameEngine;
  var state = null;
  var currentSit = null;
  var busy = false;

  // ---- helpers de DOM ----
  function $(id) { return document.getElementById(id); }
  function show(id) { $(id).classList.remove("hidden"); }
  function hide(id) { $(id).classList.add("hidden"); }
  function money(n) { return E.money(n); }

  // Tween numérico (cuenta hacia arriba/abajo) para los contadores del HUD.
  function tween(el, from, to, fmt, ms) {
    ms = ms || 700;
    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / ms);
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      var val = Math.round(from + (to - from) * eased);
      el.textContent = fmt ? fmt(val) : val;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function flash(el, positive) {
    el.classList.remove("flash-up", "flash-down");
    void el.offsetWidth; // reiniciar animación
    el.classList.add(positive ? "flash-up" : "flash-down");
  }

  // ---- HUD ----
  function renderHudFull(s) {
    $("hud-year").textContent = s.turn + " / " + s.maxTurns;
    $("hud-cash").textContent = money(s.cash);
    $("hud-debt").textContent = money(s.debt);
    $("hud-fleet").textContent = s.fleet + " 🚚";
    $("hud-demand").textContent = s.demand;
    $("hud-networth").textContent = money(s.netWorth);
    setRep(s.reputation);
    setLeverage(s.leverage);
  }

  function setRep(r) {
    $("hud-rep-fill").style.width = r + "%";
    $("hud-rep-val").textContent = r + "/100";
  }
  function setLeverage(l) {
    var pct = Math.round(l * 100);
    var bar = $("hud-lev-fill");
    bar.style.width = Math.min(100, pct) + "%";
    bar.className = "meter-fill " + (l > 0.6 ? "lev-high" : l > 0.3 ? "lev-mid" : "lev-low");
    $("hud-lev-val").textContent = pct + "%";
  }

  function animateHud(before, after) {
    tween($("hud-cash"), before.cash, after.cash, money);
    tween($("hud-networth"), before.netWorth, after.netWorth, money);
    tween($("hud-demand"), before.demand, after.demand);
    $("hud-year").textContent = after.turn + " / " + after.maxTurns;
    $("hud-debt").textContent = money(after.debt);
    $("hud-fleet").textContent = after.fleet + " 🚚";
    setRep(after.reputation);
    setLeverage(after.leverage);
    flash($("tile-cash"), after.cash >= before.cash);
    flash($("tile-networth"), after.netWorth >= before.netWorth);
  }

  // ---- Situación (decisión o evento) ----
  function renderSituation() {
    busy = false;
    currentSit = E.currentSituation(state);
    hide("result-panel");
    var card = $("situation");
    card.classList.toggle("is-event", currentSit.type === "event");

    var optsHtml = currentSit.options.map(function (o, i) {
      return '<button class="opt ' + (o.disabled ? "disabled" : "") + '" data-i="' + i + '"' +
        (o.disabled ? " disabled" : "") + '>' +
        '<span class="opt-label">' + esc(o.label) + '</span>' +
        '<span class="opt-desc">' + esc(o.desc) + '</span></button>';
    }).join("");

    card.innerHTML =
      '<div class="sit-tag">' + (currentSit.type === "event" ? "⚡ Evento" : "Decisión del año") + '</div>' +
      '<h2 class="sit-title">' + esc(currentSit.title) + '</h2>' +
      '<p class="sit-prompt">' + esc(currentSit.prompt) + '</p>' +
      '<div class="opts">' + optsHtml + '</div>';

    card.querySelectorAll(".opt:not(.disabled)").forEach(function (b) {
      b.addEventListener("click", function () {
        if (busy) return;
        choose(currentSit, currentSit.options[+b.getAttribute("data-i")]);
      });
    });
    // animación de entrada
    card.classList.remove("enter"); void card.offsetWidth; card.classList.add("enter");
  }

  // ---- Aplicar decisión ----
  function choose(sit, opt) {
    busy = true;
    var before = E.publicState(state);
    var summary = E.applyChoice(state, opt.id);
    var after = E.publicState(state);

    animateHud(before, after);
    renderResult(summary, sit, opt);

    // IA: interpretar el estado post-decisión (año recién jugado).
    var stateForAI = Object.assign({}, after, { turn: summary.turn });
    var decision = {
      type: sit.type, title: sit.title, label: opt.label,
      profit: summary.profit, revenue: summary.revenue, costs: summary.costs
    };
    renderFeedback("loading");
    root.AIFeedback.analyze(stateForAI, decision).then(function (text) {
      renderFeedback(text);
    });
  }

  function renderResult(summary, sit, opt) {
    var deltaCash = summary.deltas.cash;
    var notes = summary.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join("");
    var over = summary.over;

    $("result-panel").innerHTML =
      '<div class="res-head">' +
      '<div class="res-money ' + (summary.profit >= 0 ? "pos" : "neg") + '">' +
      'Utilidad del año: ' + (summary.profit >= 0 ? "+" : "") + money(summary.profit) + '</div>' +
      (summary.bankrupt ? '<div class="res-bankrupt">💥 QUIEBRA</div>' : "") +
      '</div>' +
      '<ul class="res-notes">' + notes + '</ul>' +
      '<div class="ai-box" id="ai-box"><div class="ai-tag">🤖 Análisis</div><div class="ai-text" id="ai-text"></div></div>' +
      '<div class="res-actions">' +
      (over
        ? '<button class="btn-primary" id="to-end">Ver resultado final →</button>'
        : '<button class="btn-primary" id="to-next">Continuar al año ' + (state.turn) + ' →</button>') +
      '</div>';

    show("result-panel");
    $("result-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });

    if (over) {
      $("to-end").addEventListener("click", showEnd);
    } else {
      $("to-next").addEventListener("click", renderSituation);
    }
  }

  function renderFeedback(text) {
    var box = $("ai-text");
    if (!box) return;
    if (text === "loading") {
      box.innerHTML = '<span class="ai-loading">Claude está analizando tu jugada…</span>';
      return;
    }
    if (!text) {
      $("ai-box").classList.add("ai-off");
      box.innerHTML = '<span class="ai-muted">Configurá Supabase + Claude (ver SETUP.md) para ver el análisis de IA acá.</span>';
      return;
    }
    box.textContent = text;
    box.classList.remove("ai-muted");
    // fade-in
    box.classList.remove("fade"); void box.offsetWidth; box.classList.add("fade");
  }

  // ---- Fin de partida ----
  function showEnd() {
    var sm = E.summary(state);
    hide("screen-play");
    show("screen-end");

    $("end-score").textContent = "0";
    tween($("end-score"), 0, sm.score, null, 1100);

    $("end-summary").innerHTML =
      '<div class="end-row"><span>Empresa de</span><strong>' + esc(sm.playerName) + '</strong></div>' +
      '<div class="end-row"><span>Años sobrevividos</span><strong>' + sm.turnsPlayed + ' / ' + E.CFG.MAX_TURNS + '</strong></div>' +
      '<div class="end-row"><span>Patrimonio neto final</span><strong>' + money(sm.netWorth) + '</strong></div>' +
      '<div class="end-row"><span>Apalancamiento promedio</span><strong>' + Math.round(sm.avgLeverage * 100) + '%</strong></div>' +
      '<div class="end-row"><span>Final</span><strong>' + (sm.bankrupt ? "💥 Quiebra" : "✅ Sobrevivió") + '</strong></div>';

    // Guardar en el leaderboard (si hay backend).
    var status = $("end-save-status");
    if (root.Leaderboard && root.Leaderboard.enabled()) {
      status.textContent = "Guardando tu puntaje…";
      root.Leaderboard.saveResult(sm, { seed: sm.seed })
        .then(function () { status.textContent = "✔ Guardado en el ranking"; return loadLeaderboard(); })
        .catch(function (e) { console.warn(e); status.textContent = "No se pudo guardar el puntaje."; });
    } else {
      status.textContent = "Ranking en la nube desactivado (configurá Supabase — ver SETUP.md).";
    }
  }

  function loadLeaderboard() {
    return root.Leaderboard.getLeaderboard(15).then(function (rows) {
      var body = rows.length ? rows.map(function (r, i) {
        var medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : (i + 1);
        return '<tr class="' + (r.player_name === state.playerName ? "me" : "") + '">' +
          '<td class="pos">' + medal + '</td>' +
          '<td>' + esc(r.player_name) + '</td>' +
          '<td class="num">' + r.score + '</td>' +
          '<td class="num">' + money(r.net_worth) + '</td>' +
          '<td>' + (r.bankrupt ? "💥" : r.turns_played + "a") + '</td></tr>';
      }).join("") : '<tr><td colspan="5" class="none">Todavía no hay puntajes. ¡Sé el primero!</td></tr>';
      $("leaderboard-body").innerHTML = body;
    });
  }

  // ---- Arranque ----
  function startGame() {
    var name = ($("player-name").value || "").trim().slice(0, 24) || "Anónimo";
    state = E.newGame({ playerName: name });
    hide("screen-start");
    hide("screen-end");
    show("screen-play");
    renderHudFull(E.publicState(state));
    renderSituation();
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  window.addEventListener("DOMContentLoaded", function () {
    $("start-btn").addEventListener("click", startGame);
    $("player-name").addEventListener("keydown", function (e) { if (e.key === "Enter") startGame(); });
    $("replay-btn").addEventListener("click", function () {
      show("screen-start"); hide("screen-end");
    });
  });
})(typeof window !== "undefined" ? window : globalThis);
