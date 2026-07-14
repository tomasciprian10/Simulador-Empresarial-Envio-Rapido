# Envío Rápido — Simulador Empresarial con IA

Simulador de decisiones empresariales donde dirigís una empresa de envíos durante **15 años**.
Cada año tomás una decisión bajo presión (expandir, endeudarte, invertir, consolidar) y, cada 3
años, un **evento** te obliga a reaccionar. Después de cada jugada, una capa de **IA (Claude)**
analiza tu decisión en contexto. Al terminar, competís en un **leaderboard compartido**.

> **Idea central:** la lógica del juego (todos los cálculos financieros) es **100% determinística
> en código**. El LLM **nunca calcula números del juego** — solo interpreta el estado ya calculado.
> Esto evita alucinaciones numéricas y hace el proyecto defendible ante un evaluador técnico.

Página estática (HTML/CSS/JS puro, sin build), consistente con "Imperio en 15 Años".

## Cómo se juega

1. Ponés el nombre de tu empresa y empezás.
2. Cada año elegís una opción. El motor calcula ingresos (entregas × precio), costos (combustible,
   sueldos, overhead, intereses), utilidad, y actualiza caja, deuda, demanda y reputación.
3. Cada 3 años irrumpe un evento (crisis de mercado, oferta de un competidor, salto del combustible,
   oportunidad con ventana de tiempo).
4. Si la caja se hace negativa, **quebrás**.
5. Al final se calcula el **score** y se guarda en el ranking.

**Fórmula del score** (patrimonio ajustado por riesgo):

```
score = max(0, patrimonioNeto) × (1 − 0.5 × apalancamientoPromedio) + añosSobrevividos × 200
```

Premia crecer sin sobre-endeudarte: dos jugadores con el mismo patrimonio, gana el que asumió
menos apalancamiento. Es tuneable (constantes al inicio de `game-engine.js`).

## Modo local vs. modo completo

- **Local (por defecto):** abrís el juego y funciona entero, pero **sin** análisis de IA ni ranking
  en la nube (ideal para probar la mecánica).
- **Completo:** con Supabase configurado, se activan el **análisis de IA** (vía Claude) y el
  **leaderboard compartido**. Ver **[SETUP.md](SETUP.md)**.

## Estructura

| Archivo | Rol |
|---|---|
| `index.html` | UI del juego (3 pantallas), carga de scripts |
| `styles.css` | Estilos + animaciones de feedback visual |
| `game-engine.js` | **Motor determinístico**: decisiones, economía, eventos, quiebra, score |
| `app.js` | Controlador: render, animaciones (contadores, flashes), loop de juego |
| `ai-feedback.js` | Llama a la Edge Function y muestra el análisis de Claude |
| `supabase-client.js` | Leaderboard: guardar/leer resultados |
| `config.js` | Credenciales públicas de Supabase (vacío = modo local) |
| `supabase/functions/ai-analysis/index.ts` | **Edge Function**: proxy seguro al LLM (key secreta) |
| `supabase/migrations/0001_init.sql` | Tabla `resultados` + políticas RLS |

## Seguridad de la API key

La key de Claude **nunca** está en el HTML/JS (el repo es público). El navegador llama a la
**Edge Function** de Supabase (autenticada con la anon key pública), y la función —que corre en el
servidor— guarda la key del LLM como variable de entorno secreta y hace la llamada real al modelo.

## Fase 2 (después de la competencia)

Multiplayer en tiempo real, cuentas/login, balanceo fino de la economía, modo torneo. **No** está
construido todavía a propósito: el riesgo era no terminar el MVP.
