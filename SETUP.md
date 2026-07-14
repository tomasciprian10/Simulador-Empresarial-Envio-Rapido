# Setup — activar IA + leaderboard (Supabase)

El juego funciona en **modo local** apenas abrís `index.html`. Para activar el **análisis de IA**
(Claude) y el **ranking compartido**, seguí estos pasos. Ya tenés un proyecto de Supabase creado.

Necesitás: una **API key de Anthropic** (https://console.anthropic.com → API Keys) y la **Supabase
CLI** para desplegar la Edge Function (https://supabase.com/docs/guides/cli).

---

## 1. Crear la tabla del leaderboard

Dashboard de Supabase → **SQL Editor** → **New query** → pegá el contenido de
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) → **Run**.

Crea la tabla `resultados` con RLS: cualquiera puede leer el ranking y agregar su resultado, nadie
puede editar/borrar resultados ajenos.

---

## 2. Pegar las credenciales públicas en el front

Dashboard → **Project Settings → API**. Copiá **Project URL** y la **anon / public** key
(NO la `service_role`). Pegalas en [`config.js`](config.js):

```js
window.SUPABASE_CONFIG = {
  url: "https://TU-PROYECTO.supabase.co",
  anonKey: "eyJhbGciOi...."   // la anon/public
};
```

> La anon key es **pública** y segura de exponer: todo está protegido por RLS. La key de Claude
> **no** va acá.

---

## 3. Desplegar la Edge Function y guardar la key de Claude

Desde la carpeta del proyecto, con la Supabase CLI:

```bash
# Vincular tu proyecto (una sola vez)
supabase link --project-ref TU_PROJECT_REF

# Guardar la key de Claude como SECRETO (nunca llega al navegador)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-tu-key-aca

# (opcional) elegir el modelo. Por defecto usa claude-opus-4-8.
# Para feedback más rápido y barato en el loop del juego:
supabase secrets set ANTHROPIC_MODEL=claude-haiku-4-5

# Desplegar la función
supabase functions deploy ai-analysis
```

La función queda en `https://TU-PROYECTO.supabase.co/functions/v1/ai-analysis`. El cliente la
invoca automáticamente con `supabase.functions.invoke("ai-analysis", ...)` (le manda la anon key
en el header, que Supabase valida por vos).

**Probarla aislada** (antes de conectar el juego), con un estado de ejemplo:

```bash
curl -i -X POST "https://TU-PROYECTO.supabase.co/functions/v1/ai-analysis" \
  -H "Authorization: Bearer TU_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"state":{"turn":4,"maxTurns":15,"cash":8000,"debt":54000,"fleet":5,"capacity":6000,"demand":2600,"reputation":58,"netWorth":-2000,"leverage":0.71,"bankrupt":false},"decision":{"type":"decision","label":"Expandir con deuda","profit":-3000,"revenue":41600,"costs":44600}}'
```

Debería devolver `{"analysis":"..."}` con 2–4 líneas de análisis.

---

## 4. Servir la página

Con Supabase conviene servir por **http** (no `file://`). Local:

```bash
python3 -m http.server 3000
# abrí http://localhost:3000
```

En producción funciona igual con GitHub Pages o cualquier hosting estático.

---

## Orden sugerido para esta noche (del spec)

1. **Motor + eventos** — ya está y validado (los eventos disparan y la economía cierra).
2. **Tabla `resultados`** — paso 1 acá; probala con datos de prueba.
3. **Edge Function `ai-analysis`** — paso 3; probala aislada con el `curl` de arriba (así el riesgo
   de la key se resuelve temprano).
4. **Conectar el front a la IA** — ya está cableado (`ai-feedback.js`); con la función desplegada,
   el análisis aparece solo después de cada decisión.
5. **Animaciones** — ya están (contadores, flashes de sube/baja, entrada de cards).
6. **Leaderboard** — ya está; aparece al terminar la partida.

---

## Ajustes rápidos

- **Balancear la dificultad:** editá las constantes `CFG` al inicio de `game-engine.js` (interés de
  la deuda, crecimiento de demanda, costos, etc.). Es lo que el spec dejó para fase 2.
- **Modelo de IA:** `supabase secrets set ANTHROPIC_MODEL=...` y volvé a hacer `functions deploy`.
- **Confirmación de email / cuentas:** no aplica en fase 1 (guardado anónimo con nombre simple).
