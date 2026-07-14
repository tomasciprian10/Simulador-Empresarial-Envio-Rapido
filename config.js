// Configuración de Supabase para el frontend.
//
// Pegá acá los dos valores de tu proyecto (Dashboard → Project Settings → API):
//   - Project URL           -> url
//   - anon / public API key  -> anonKey
//
// La "anon key" es PÚBLICA y es seguro dejarla en el código del front: no da
// acceso a nada por sí sola, todo está protegido por las políticas RLS de la
// base. NO uses acá la "service_role" ni la API key del LLM.
//
// La key de Claude NUNCA va acá: vive como secreto de la Edge Function (ver SETUP.md).
//
// Si estos campos quedan vacíos, el juego funciona igual pero sin leaderboard
// en la nube ni análisis de IA (modo local de práctica).
window.SUPABASE_CONFIG = {
  url: "",
  anonKey: ""
};
