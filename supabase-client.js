/* =====================================================================
   Envío Rápido — Cliente de Supabase (leaderboard)
   ---------------------------------------------------------------------
   Guarda el resultado de una partida y lee el ranking. Usa la librería
   supabase-js (cargada por CDN en index.html) y la config de config.js.

   Si Supabase no está configurado (config vacía), expone stubs que dejan
   el juego funcionando en modo local sin romper nada.
   ===================================================================== */
(function (root) {
  "use strict";

  var cfg = root.SUPABASE_CONFIG || {};
  var lib = root.supabase; // UMD de @supabase/supabase-js
  var SB = (cfg.url && cfg.anonKey && lib && lib.createClient)
    ? lib.createClient(cfg.url, cfg.anonKey)
    : null;

  var Leaderboard = {
    // ¿Hay backend configurado?
    enabled: function () { return !!SB; },

    // Cliente crudo (lo usa ai-feedback.js para invocar la Edge Function).
    client: function () { return SB; },

    // Guarda el resultado de una partida terminada.
    // summary viene de GameEngine.summary(state).
    saveResult: function (summary, details) {
      if (!SB) return Promise.resolve({ skipped: true });
      var row = {
        player_name: (summary.playerName || "Anónimo").slice(0, 24),
        score: summary.score,
        net_worth: summary.netWorth,
        turns_played: summary.turnsPlayed,
        bankrupt: !!summary.bankrupt,
        avg_leverage: summary.avgLeverage,
        seed: summary.seed,
        details: details || null
      };
      return SB.from("resultados").insert(row).then(function (res) {
        if (res.error) throw res.error;
        return { ok: true };
      });
    },

    // Trae el top N del ranking (por score desc).
    getLeaderboard: function (limit) {
      if (!SB) return Promise.resolve([]);
      return SB.from("resultados")
        .select("player_name, score, net_worth, turns_played, bankrupt, created_at")
        .order("score", { ascending: false })
        .order("created_at", { ascending: true })
        .limit(limit || 20)
        .then(function (res) {
          if (res.error) throw res.error;
          return res.data || [];
        });
    }
  };

  root.Leaderboard = Leaderboard;
})(typeof window !== "undefined" ? window : globalThis);
