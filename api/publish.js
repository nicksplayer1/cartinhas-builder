export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const { html } = req.body || {};
    if (!html || typeof html !== "string") {
      return res.status(400).json({ error: "Campo 'html' obrigatório" });
    }

    // limite simples pra não explodir com fotos gigantes
    if (html.length > 15_000_000) {
      return res.status(413).json({ error: "Arquivo muito grande (reduza fotos)." });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: "Variáveis do Supabase não configuradas na Vercel." });
    }

    const id = (globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    const path = `p/${id}/index.html`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/cartinhas/${path}`;

    const up = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${SERVICE_KEY}`,
        "apikey": SERVICE_KEY,
        "content-type": "text/html; charset=utf-8",
        "x-upsert": "false"
      },
      body: html
    });

    if (!up.ok) {
      const txt = await up.text().catch(()=> "");
      return res.status(500).json({ error: `Falha upload: ${up.status} ${txt}` });
    }

    // link público (bucket precisa ser Public)
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/cartinhas/${path}`;

    return res.status(200).json({ url: publicUrl, id });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const { html } = req.body || {};
    if (!html || typeof html !== "string") {
      return res.status(400).json({ error: "Campo 'html' obrigatório" });
    }

    // limite simples pra não explodir com fotos gigantes
    if (html.length > 15_000_000) {
      return res.status(413).json({ error: "Arquivo muito grande (reduza fotos)." });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: "Variáveis do Supabase não configuradas na Vercel." });
    }

    const id = (globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    const path = `p/${id}/index.html`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/cartinhas/${path}`;

    const up = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${SERVICE_KEY}`,
        "apikey": SERVICE_KEY,
        "content-type": "text/html; charset=utf-8",
        "x-upsert": "false"
      },
      body: html
    });

    if (!up.ok) {
      const txt = await up.text().catch(()=> "");
      return res.status(500).json({ error: `Falha upload: ${up.status} ${txt}` });
    }

    // link público (bucket precisa ser Public)
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/cartinhas/${path}`;

    return res.status(200).json({ url: publicUrl, id });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
