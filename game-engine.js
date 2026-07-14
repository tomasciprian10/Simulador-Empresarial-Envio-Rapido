/* =====================================================================
   Envío Rápido — Motor de juego DETERMINÍSTICO
   ---------------------------------------------------------------------
   Simulás una empresa de envíos durante 15 años. Cada año tomás una
   decisión (y cada 3 años irrumpe un evento). Toda la economía se calcula
   acá, en código: ingresos, costos, deuda, intereses, demanda, reputación,
   quiebra y score final.

   REGLA DE ORO: la IA NUNCA calcula estos números. El LLM solo interpreta
   el estado que este motor ya calculó. Así evitamos alucinaciones numéricas
   y el rigor es defendible.

   Funciona en el navegador (window.GameEngine) y en Node (module.exports),
   para poder testear el motor de forma aislada.
   ===================================================================== */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------
  // Constantes económicas (TUNEABLES — el balanceo fino es fase 2).
  // ------------------------------------------------------------------
  var CFG = {
    MAX_TURNS: 15,            // años de simulación
    START_CASH: 50000,        // caja inicial ($)
    START_FLEET: 2,           // camionetas iniciales
    START_DEMAND: 2000,       // entregas/año que el mercado te pide al inicio

    VEHICLE_COST: 18000,      // costo de comprar 1 camioneta
    VEHICLE_RESIDUAL: 0.6,    // valor de reventa (fracción del costo) -> patrimonio
    VEHICLE_CAPACITY: 1200,   // entregas/año que hace 1 camioneta

    PRICE_PER_DELIVERY: 16,   // ingreso por entrega
    FUELMAINT_PER_VEHICLE: 4000, // combustible + mantenimiento por camioneta/año
    SALARY_PER_VEHICLE: 6000, // sueldo del chofer por camioneta/año
    FIXED_OVERHEAD: 8000,     // gastos fijos/año (oficina, admin)
    INTEREST_RATE: 0.12,      // interés anual sobre la deuda

    MARKETING_COST: 6000,     // costo de una campaña
    MARKETING_DEMAND: 500,    // +demanda que deja una campaña
    MARKETING_REP: 8,         // +reputación que deja una campaña

    REPAY_CHUNK: 12000,       // cuánto amortizás al "consolidar"
    BASE_DEMAND_GROWTH: 0.04, // crecimiento orgánico de la demanda/año

    EVENT_EVERY: 3,           // cada cuántos turnos irrumpe un evento
    RISK_WEIGHT: 0.5,         // peso del apalancamiento en el score
    SURVIVE_BONUS: 200        // puntos por cada año sobrevivido
  };

  // ------------------------------------------------------------------
  // PRNG determinístico (mulberry32) — misma semilla => misma partida.
  // ------------------------------------------------------------------
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function round(x) { return Math.round(x); }

  // ------------------------------------------------------------------
  // Estado de la partida.
  // ------------------------------------------------------------------
  function newGame(opts) {
    opts = opts || {};
    var seed = opts.seed != null ? opts.seed : (Date.now() & 0xffffffff);
    return {
      seed: seed,
      _rand: mulberry32(seed),
      turn: 1,
      maxTurns: CFG.MAX_TURNS,
      playerName: opts.playerName || "Anónimo",

      cash: CFG.START_CASH,
      fleet: CFG.START_FLEET,
      debt: 0,
      demand: CFG.START_DEMAND,
      reputation: 50,          // 0..100

      pendingDemandBoost: 0,   // efecto de marketing que entra el próximo año
      demandModifier: 1,       // modificador temporal por eventos (1 = normal)
      costModifier: 1,         // modificador temporal de costos por eventos

      over: false,
      bankrupt: false,
      history: [],             // snapshot por turno (para score y gráficos)
      log: []                  // mensajes legibles de lo que pasó
    };
  }

  // Patrimonio neto = caja + valor de flota (residual) - deuda.
  function netWorth(s) {
    return round(s.cash + s.fleet * CFG.VEHICLE_COST * CFG.VEHICLE_RESIDUAL - s.debt);
  }

  // Activos totales (para el ratio de apalancamiento).
  function assets(s) {
    return Math.max(1, s.cash + s.fleet * CFG.VEHICLE_COST * CFG.VEHICLE_RESIDUAL);
  }
  function leverage(s) { return clamp(s.debt / assets(s), 0, 1); }

  // ------------------------------------------------------------------
  // ¿Qué enfrenta el jugador este turno? Decisión normal o evento.
  // Devuelve { type, title, prompt, options:[{id,label,desc}] }.
  // Las opciones son deterministas dado el estado; los ids se resuelven
  // en applyChoice().
  // ------------------------------------------------------------------
  function isEventTurn(s) {
    return s.turn > 1 && s.turn % CFG.EVENT_EVERY === 0;
  }

  function currentSituation(s) {
    if (s.over) return null;
    if (isEventTurn(s)) return pickEvent(s);
    return standardDecision(s);
  }

  function standardDecision(s) {
    var opts = [];
    var vc = CFG.VEHICLE_COST;

    opts.push({
      id: "expand_debt",
      label: "Expandir con deuda",
      desc: "Comprás 1 camioneta financiada (+" + money(vc) + " de deuda, +capacidad)."
    });
    opts.push({
      id: "expand_cash",
      label: "Expandir con caja",
      desc: s.cash >= vc
        ? "Comprás 1 camioneta al contado (-" + money(vc) + " de caja, +capacidad)."
        : "No tenés caja suficiente (necesitás " + money(vc) + ").",
      disabled: s.cash < vc
    });
    opts.push({
      id: "marketing",
      label: "Campaña de marketing",
      desc: s.cash >= CFG.MARKETING_COST
        ? "Invertís " + money(CFG.MARKETING_COST) + ": sube la demanda y la reputación."
        : "No tenés caja para la campaña (" + money(CFG.MARKETING_COST) + ").",
      disabled: s.cash < CFG.MARKETING_COST
    });
    opts.push({
      id: "consolidate",
      label: s.debt > 0 ? "Consolidar (pagar deuda)" : "Consolidar (reservar caja)",
      desc: s.debt > 0
        ? "Amortizás hasta " + money(CFG.REPAY_CHUNK) + " de deuda para bajar intereses."
        : "Año conservador: no expandís y cuidás la caja."
    });

    return {
      type: "decision",
      title: "Año " + s.turn + " · Decisión estratégica",
      prompt: "Tenés " + money(s.cash) + " en caja, " + s.fleet + " camionetas y " +
              money(s.debt) + " de deuda. ¿Qué hacés este año?",
      options: opts
    };
  }

  // ------------------------------------------------------------------
  // Eventos aleatorios (mecanismo central de engagement).
  // ------------------------------------------------------------------
  var EVENTS = [
    {
      key: "crisis",
      title: "📉 Crisis de mercado",
      prompt: "La economía se enfría: la demanda de envíos cae fuerte este año. ¿Cómo reaccionás?",
      options: [
        { id: "crisis_cut", label: "Recortar costos", desc: "Vendés 1 camioneta para hacer caja (-capacidad, +liquidez)." },
        { id: "crisis_hold", label: "Aguantar", desc: "No tocás nada y absorbés el golpe de demanda." },
        { id: "crisis_borrow", label: "Endeudarte para sostener", desc: "Tomás deuda para no achicarte y salir fuerte después." }
      ]
    },
    {
      key: "buyout",
      title: "🤝 Oferta de un competidor",
      prompt: "Un competidor quiere quedarse con parte de tu operación y ofrece pagar por ello. ¿Aceptás?",
      options: [
        { id: "buyout_sell", label: "Vender parte", desc: "Recibís caja a cambio de ceder camionetas y algo de reputación." },
        { id: "buyout_reject", label: "Rechazar", desc: "Seguís independiente; ganás reputación de marca fuerte." }
      ]
    },
    {
      key: "fuel",
      title: "⛽ Salto en el combustible",
      prompt: "El precio del combustible se dispara: tus costos suben este año. ¿Qué hacés?",
      options: [
        { id: "fuel_pass", label: "Trasladar al precio", desc: "Subís tarifas: protegés margen pero perdés algo de demanda." },
        { id: "fuel_absorb", label: "Absorber el costo", desc: "Mantenés precios: cuidás la demanda pero te comés el sobrecosto." }
      ]
    },
    {
      key: "opportunity",
      title: "🚀 Oportunidad con ventana",
      prompt: "Aparece un contrato grande que dispara tu demanda, pero hay que invertir YA para tomarlo.",
      options: [
        { id: "opp_take_cash", label: "Invertir con caja", desc: "Pagás con caja y capturás un salto de demanda sostenido.", },
        { id: "opp_take_debt", label: "Invertir con deuda", desc: "Financiás la inversión: mismo upside, pero sumás apalancamiento." },
        { id: "opp_skip", label: "Dejarla pasar", desc: "No arriesgás caja; la oportunidad se va a otro." }
      ]
    }
  ];

  function pickEvent(s) {
    var idx = Math.floor(s._rand() * EVENTS.length);
    var ev = EVENTS[idx];
    s._activeEvent = ev.key;
    // Disponibilidad según estado (ej. no podés vender si tenés 1 sola camioneta).
    var options = ev.options.map(function (o) {
      var disabled = false, desc = o.desc;
      if (o.id === "crisis_cut" && s.fleet <= 1) { disabled = true; desc = "No podés vender: te quedarías sin flota."; }
      if ((o.id === "opp_take_cash") && s.cash < 15000) { disabled = true; desc = "No tenés caja suficiente (" + money(15000) + ")."; }
      return { id: o.id, label: o.label, desc: desc, disabled: disabled };
    });
    return { type: "event", eventKey: ev.key, title: ev.title, prompt: ev.prompt, options: options };
  }

  // ------------------------------------------------------------------
  // Aplicar la decisión del jugador y correr el año.
  // Devuelve un resumen del turno: { before, after, deltas, log, situation }.
  // ------------------------------------------------------------------
  function applyChoice(s, optionId) {
    if (s.over) throw new Error("La partida ya terminó.");
    var before = snapshot(s);
    var notes = [];

    switch (optionId) {
      // ---- Decisiones estándar ----
      case "expand_debt":
        s.fleet += 1; s.debt += CFG.VEHICLE_COST;
        notes.push("Compraste 1 camioneta financiada.");
        break;
      case "expand_cash":
        if (s.cash < CFG.VEHICLE_COST) throw new Error("Caja insuficiente.");
        s.fleet += 1; s.cash -= CFG.VEHICLE_COST;
        notes.push("Compraste 1 camioneta al contado.");
        break;
      case "marketing":
        if (s.cash < CFG.MARKETING_COST) throw new Error("Caja insuficiente.");
        s.cash -= CFG.MARKETING_COST;
        s.pendingDemandBoost += CFG.MARKETING_DEMAND;
        s.reputation = clamp(s.reputation + CFG.MARKETING_REP, 0, 100);
        notes.push("Lanzaste una campaña de marketing.");
        break;
      case "consolidate":
        if (s.debt > 0) {
          var pay = Math.min(s.debt, CFG.REPAY_CHUNK, s.cash);
          s.debt -= pay; s.cash -= pay;
          notes.push("Amortizaste " + money(pay) + " de deuda.");
        } else {
          notes.push("Año conservador: cuidaste la caja.");
        }
        break;

      // ---- Eventos ----
      case "crisis_cut":
        if (s.fleet > 1) { s.fleet -= 1; s.cash += round(CFG.VEHICLE_COST * CFG.VEHICLE_RESIDUAL); notes.push("Vendiste 1 camioneta para hacer caja."); }
        s.demandModifier = 0.7; notes.push("La demanda cae 30% este año.");
        break;
      case "crisis_hold":
        s.demandModifier = 0.7; notes.push("Aguantaste; la demanda cae 30% este año.");
        break;
      case "crisis_borrow":
        s.debt += 15000; s.cash += 15000; s.demandModifier = 0.7;
        notes.push("Tomaste " + money(15000) + " de deuda para sostener la operación.");
        break;

      case "buyout_sell":
        var sell = Math.min(1, s.fleet - 1);
        if (sell > 0) { s.fleet -= sell; s.cash += round(CFG.VEHICLE_COST * 0.9); }
        s.reputation = clamp(s.reputation - 6, 0, 100);
        notes.push("Vendiste parte de la operación al competidor.");
        break;
      case "buyout_reject":
        s.reputation = clamp(s.reputation + 6, 0, 100);
        notes.push("Rechazaste la oferta; tu marca se fortalece.");
        break;

      case "fuel_pass":
        s.costModifier = 1.4; s.demandModifier = 0.9;
        notes.push("Subiste tarifas: +costos de combustible, pero perdés algo de demanda.");
        break;
      case "fuel_absorb":
        s.costModifier = 1.4;
        notes.push("Absorbiste el sobrecosto de combustible este año.");
        break;

      case "opp_take_cash":
        if (s.cash < 15000) throw new Error("Caja insuficiente.");
        s.cash -= 15000; s.pendingDemandBoost += 900; s.reputation = clamp(s.reputation + 5, 0, 100);
        notes.push("Tomaste la oportunidad con caja: salto de demanda sostenido.");
        break;
      case "opp_take_debt":
        s.debt += 15000; s.pendingDemandBoost += 900; s.reputation = clamp(s.reputation + 5, 0, 100);
        notes.push("Tomaste la oportunidad con deuda: mismo upside, más apalancamiento.");
        break;
      case "opp_skip":
        notes.push("Dejaste pasar la oportunidad.");
        break;

      default:
        throw new Error("Opción desconocida: " + optionId);
    }

    // --- Correr el año (economía determinística) ---
    var yr = runYear(s);
    notes = notes.concat(yr.notes);

    // --- Reset de modificadores temporales de eventos ---
    s.demandModifier = 1;
    s.costModifier = 1;

    // --- Registrar historia y avanzar ---
    var after = snapshot(s);
    after.netWorth = netWorth(s);
    after.leverage = +leverage(s).toFixed(3);
    s.history.push(after);
    s.log.push({ turn: s.turn, notes: notes });

    var summary = {
      turn: s.turn,
      before: before,
      after: after,
      deltas: {
        cash: after.cash - before.cash,
        debt: after.debt - before.debt,
        demand: after.demand - before.demand,
        reputation: after.reputation - before.reputation,
        netWorth: after.netWorth - (before.netWorth != null ? before.netWorth : netWorthOf(before))
      },
      profit: yr.profit,
      revenue: yr.revenue,
      costs: yr.costs,
      deliveries: yr.deliveries,
      notes: notes,
      bankrupt: s.bankrupt
    };

    // Quiebra o fin de juego.
    if (s.cash < 0) {
      s.over = true; s.bankrupt = true;
      notes.push("¡QUIEBRA! Te quedaste sin caja en el año " + s.turn + ".");
    } else if (s.turn >= s.maxTurns) {
      s.over = true;
      notes.push("Llegaste al año " + s.maxTurns + ". Fin de la simulación.");
    } else {
      s.turn += 1;
    }

    summary.over = s.over;
    summary.bankrupt = s.bankrupt; // reflejar el estado DESPUÉS del chequeo de quiebra
    summary.nextSituation = s.over ? null : currentSituation(s);
    return summary;
  }

  // Economía de un año: ingresos, costos, utilidad, actualización de estado.
  function runYear(s) {
    var notes = [];
    var capacity = s.fleet * CFG.VEHICLE_CAPACITY;
    var effectiveDemand = Math.max(0, round(s.demand * s.demandModifier));
    var deliveries = Math.min(capacity, effectiveDemand);

    var revenue = deliveries * CFG.PRICE_PER_DELIVERY;
    var opCost = (s.fleet * (CFG.FUELMAINT_PER_VEHICLE + CFG.SALARY_PER_VEHICLE) + CFG.FIXED_OVERHEAD) * s.costModifier;
    var interest = s.debt * CFG.INTEREST_RATE;
    var costs = round(opCost + interest);
    var profit = round(revenue - costs);

    s.cash = round(s.cash + profit);

    // Reputación: buen servicio (capacidad cubre demanda) sube; demanda insatisfecha baja.
    if (capacity >= effectiveDemand) s.reputation = clamp(s.reputation + 3, 0, 100);
    else s.reputation = clamp(s.reputation - 6, 0, 100);

    // Demanda del próximo año: crecimiento orgánico + reputación + marketing pendiente.
    var repEffect = (s.reputation - 50) / 1000; // ±0.05 máx
    var growth = CFG.BASE_DEMAND_GROWTH + repEffect;
    s.demand = round(s.demand * (1 + growth) + s.pendingDemandBoost);
    s.pendingDemandBoost = 0;

    notes.push("Entregas: " + deliveries + " / capacidad " + capacity +
               " · Ingresos " + money(revenue) + " · Costos " + money(costs) +
               " · Utilidad " + money(profit) + ".");
    if (deliveries < effectiveDemand) notes.push("Perdiste " + (effectiveDemand - deliveries) + " entregas por falta de capacidad.");

    return { revenue: revenue, costs: costs, profit: profit, deliveries: deliveries, notes: notes };
  }

  // ------------------------------------------------------------------
  // Score final: patrimonio neto ajustado por apalancamiento promedio,
  // más un bonus por años sobrevividos. Explicable y comparable.
  //   score = max(0, netWorth) * (1 - RISK_WEIGHT * avgLeverage)
  //           + añosSobrevividos * SURVIVE_BONUS
  // ------------------------------------------------------------------
  function score(s) {
    var nw = netWorth(s);
    var levs = s.history.map(function (h) { return h.leverage || 0; });
    var avgLev = levs.length ? levs.reduce(function (a, b) { return a + b; }, 0) / levs.length : 0;
    var riskAdj = clamp(1 - CFG.RISK_WEIGHT * avgLev, 0.5, 1);
    var survived = s.history.length; // años jugados
    return round(Math.max(0, nw) * riskAdj + survived * CFG.SURVIVE_BONUS);
  }

  function summary(s) {
    return {
      playerName: s.playerName,
      turnsPlayed: s.history.length,
      bankrupt: s.bankrupt,
      finalCash: s.cash,
      finalFleet: s.fleet,
      finalDebt: s.debt,
      netWorth: netWorth(s),
      avgLeverage: +(s.history.reduce(function (a, h) { return a + (h.leverage || 0); }, 0) / Math.max(1, s.history.length)).toFixed(3),
      score: score(s),
      seed: s.seed
    };
  }

  // Estado "público" del jugador — esto es lo que se le manda a la IA para interpretar.
  function publicState(s) {
    return {
      turn: s.turn,
      maxTurns: s.maxTurns,
      cash: s.cash,
      fleet: s.fleet,
      capacity: s.fleet * CFG.VEHICLE_CAPACITY,
      debt: s.debt,
      demand: s.demand,
      reputation: s.reputation,
      netWorth: netWorth(s),
      leverage: +leverage(s).toFixed(3),
      over: s.over,
      bankrupt: s.bankrupt
    };
  }

  // ---- helpers ----
  function snapshot(s) {
    return { turn: s.turn, cash: s.cash, fleet: s.fleet, debt: s.debt, demand: s.demand, reputation: s.reputation, netWorth: netWorth(s) };
  }
  function netWorthOf(snap) {
    return round(snap.cash + snap.fleet * CFG.VEHICLE_COST * CFG.VEHICLE_RESIDUAL - snap.debt);
  }
  function money(n) {
    return "$" + Math.round(n).toLocaleString("es-AR");
  }

  var GameEngine = {
    CFG: CFG,
    newGame: newGame,
    currentSituation: currentSituation,
    applyChoice: applyChoice,
    publicState: publicState,
    netWorth: netWorth,
    leverage: leverage,
    score: score,
    summary: summary,
    money: money
  };

  // Export dual: navegador + Node.
  root.GameEngine = GameEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = GameEngine;

})(typeof window !== "undefined" ? window : globalThis);
