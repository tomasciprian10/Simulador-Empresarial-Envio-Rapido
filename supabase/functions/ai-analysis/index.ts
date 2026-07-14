// =====================================================================
// Edge Function: ai-analysis
// ---------------------------------------------------------------------
// Proxy seguro entre el navegador y la API de Anthropic (Claude).
//
// - El cliente llama a esta función con el ESTADO YA CALCULADO por el motor
//   determinístico (game-engine.js). El LLM solo INTERPRETA esos números,
//   nunca los calcula.
// - La API key de Claude vive como secreto de la función (ANTHROPIC_API_KEY),
//   nunca llega al navegador ni al repo público.
//
// Deploy:  supabase functions deploy ai-analysis
// Secreto: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//          (opcional) supabase secrets set ANTHROPIC_MODEL=claude-opus-4-8
// =====================================================================

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
// Modelo por defecto: Claude Opus 4.8. Cambialo a claude-haiku-4-5 con
// `supabase secrets set ANTHROPIC_MODEL=claude-haiku-4-5` si querés feedback
// más rápido y barato para el loop del juego.
const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-opus-4-8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Prompt de sistema: fija el rol (analista) y el tono (breve, directo, sin relleno).
const SYSTEM_PROMPT = `Sos un analista financiero que asesora al jugador de un simulador de una empresa de envíos.
Recibís el ESTADO YA CALCULADO del jugador (caja, deuda, flota, demanda, apalancamiento, etc.) y la decisión que acaba de tomar.
Tu trabajo es INTERPRETAR esos números, no recalcularlos: explicá por qué la decisión fue buena o riesgosa en su contexto y qué podría pasar después.

Reglas estrictas:
- Español rioplatense, 2 a 4 líneas, directo y concreto. Nada de relleno motivacional ni saludos.
- No inventes números nuevos: razoná solo sobre los datos provistos. Si mencionás una cifra, que sea una de las que recibiste.
- Enfocate en riesgo, liquidez y apalancamiento. Si el apalancamiento es alto respecto a la caja, decilo y planteá un escenario ("si el mercado cae, ...").
- Respondé solo con el análisis final, sin listar tu razonamiento ni encabezados.`;

function buildUserMessage(payload: any): string {
  const s = payload?.state ?? {};
  const d = payload?.decision ?? {};
  return [
    `Año ${s.turn}/${s.maxTurns}.`,
    `Estado actual: caja $${s.cash}, deuda $${s.debt}, ${s.fleet} camionetas (capacidad ${s.capacity} entregas/año), demanda ${s.demand} entregas/año, reputación ${s.reputation}/100.`,
    `Patrimonio neto $${s.netWorth}. Apalancamiento (deuda/activos) ${s.leverage}.`,
    d.type === "event"
      ? `Acaba de ocurrir un EVENTO ("${d.title}") y el jugador eligió: "${d.label}".`
      : `El jugador tomó la decisión: "${d.label}".`,
    d.profit != null ? `Resultado del año: ingresos $${d.revenue}, costos $${d.costs}, utilidad $${d.profit}.` : "",
    s.bankrupt ? "El jugador QUEBRÓ." : "",
    "Analizá esta decisión en su contexto.",
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!ANTHROPIC_API_KEY) {
    return json({ error: "Falta configurar ANTHROPIC_API_KEY en la Edge Function." }, 500);
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Body inválido (se esperaba JSON)." }, 400);
  }
  if (!payload?.state) {
    return json({ error: "Falta 'state' en el body." }, 400);
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(payload) }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return json({ error: "Error de la API de Claude", detail: errText }, 502);
    }

    const data = await resp.json();
    // Concatenar los bloques de texto de la respuesta.
    const text = Array.isArray(data?.content)
      ? data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim()
      : "";

    return json({ analysis: text || "(sin análisis)" });
  } catch (e) {
    return json({ error: "Fallo al contactar a Claude", detail: String(e) }, 502);
  }
});
