-- Simulador Empresarial "Envío Rápido" — esquema inicial de Supabase.
-- Fase 1 (MVP): leaderboard compartido con guardado anónimo (nombre simple, sin cuentas).
--
-- Cómo aplicarlo:
--   A) Dashboard → SQL Editor → pegar este archivo → Run.
--   B) CLI:       supabase db push
--
-- La Edge Function ai-analysis se despliega aparte (ver SETUP.md); no vive en esta tabla.

-- ---------------------------------------------------------------------------
-- Tabla de resultados (una fila por partida terminada)
-- ---------------------------------------------------------------------------
create table if not exists public.resultados (
  id            uuid primary key default gen_random_uuid(),
  player_name   text not null check (char_length(player_name) between 1 and 24),
  score         integer not null check (score >= 0),
  net_worth     integer,
  turns_played  integer,
  bankrupt      boolean default false,
  avg_leverage  numeric,
  seed          bigint,
  details       jsonb,                 -- decisiones clave / snapshot para mostrar
  created_at    timestamptz not null default now()
);

-- Índice para ordenar el leaderboard rápido.
create index if not exists resultados_score_idx on public.resultados (score desc, created_at asc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Fase 1: sin cuentas. Cualquiera (rol anónimo) puede LEER el leaderboard y
-- AGREGAR su resultado. Nadie puede editar ni borrar resultados ajenos.
-- (En fase 2, cuando haya login, se puede endurecer con auth.uid().)
-- ---------------------------------------------------------------------------
alter table public.resultados enable row level security;

drop policy if exists "resultados_select" on public.resultados;
create policy "resultados_select" on public.resultados
  for select to anon, authenticated using (true);

drop policy if exists "resultados_insert" on public.resultados;
create policy "resultados_insert" on public.resultados
  for insert to anon, authenticated with check (
    char_length(player_name) between 1 and 24 and score >= 0
  );

-- Sin políticas de UPDATE/DELETE ⇒ nadie puede modificar ni borrar (más seguro).
