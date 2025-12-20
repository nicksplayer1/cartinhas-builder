 module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  try {
    // Garantir body parseado
    let body = req.body;
    if (!body) body = {};
    if (typeof body === "string") body = JSON.parse(body);

    const { html } = body || {};
    if (!html || typeof html !== "string") {
      return res.status(400).json({ error: "Campo 'html' obrigatório" });
    }

    // Limite de tamanho (evita abuso/fotos gigantes)
    if (html.length > 15_000_000) {
      return res.status(413).json({ error: "Arquivo muito grande. Reduza as fotos." });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !KEY) {
      return res.status(500).json({
        error: "Variáveis SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas na Vercel."
      });
    }

    const id =
      (globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    const path = `p/${id}/index.html`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/cartinhas/${path}`;

    const up = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${KEY}`,
        apikey: KEY,
        "content-type": "text/html; charset=utf-8",
        "x-upsert": "false",
      },
      body: html,
    });

    if (!up.ok) {
      const txt = await up.text().catch(() => "");
      return res.status(500).json({ error: `Falha upload: ${up.status} ${txt}` });
    }

    // bucket precisa ser PUBLIC
    const url = `${SUPABASE_URL}/storage/v1/object/public/cartinhas/${path}`;

    return res.status(200).json({ url });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
};

