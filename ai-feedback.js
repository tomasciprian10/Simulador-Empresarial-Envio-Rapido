/* =====================================================================
   Envío Rápido — Capa de IA (interpretación, no cálculo)
   ---------------------------------------------------------------------
   Llama a la Edge Function `ai-analysis` de Supabase, que a su vez llama a
   Claude con la key secreta. Le mandamos el estado YA CALCULADO por el motor
   y la decisión tomada; recibimos un análisis breve en texto.

   Si Supabase no está configurado, devuelve null (el juego sigue sin IA).
   ===================================================================== */
(function (root) {
  "use strict";

  var AIFeedback = {
    // Devuelve una promesa con el texto del análisis, o null si no hay backend.
    analyze: function (publicState, decision) {
      var LB = root.Leaderboard;
      if (!LB || !LB.enabled()) return Promise.resolve(null);
      var sb = LB.client();

      return sb.functions
        .invoke("ai-analysis", { body: { state: publicState, decision: decision } })
        .then(function (res) {
          if (res.error) throw res.error;
          var data = res.data || {};
          if (data.error) throw new Error(data.error);
          return data.analysis || null;
        })
        .catch(function (e) {
          console.warn("ai-analysis falló:", e);
          return null; // no romper el juego si la IA falla
        });
    }
  };

  root.AIFeedback = AIFeedback;
})(typeof window !== "undefined" ? window : globalThis);
