module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const BUCKET = process.env.SUPABASE_BUCKET || "cartinha"; // ajuste se necessário

    if (!SUPABASE_URL || !KEY) {
      return res.status(500).json({
        error: "Variáveis SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas na Vercel.",
      });
    }

    // garantir body parseado
    let body = req.body;
    if (!body) body = {};
    if (typeof body === "string") body = JSON.parse(body);

    const { html } = body || {};
    if (!html || typeof html !== "string") {
      return res.status(400).json({ error: "Campo 'html' obrigatório" });
    }

    // limite de tamanho (evita abuso)
    if (html.length > 15_000_000) {
      return res.status(413).json({ error: "Arquivo muito grande. Reduza fotos." });
    }

    const id =
      (globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    const path = `p/${id}/index.html`;

    // Upload no Supabase Storage
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;

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

    // monta a URL final (Vercel) que renderiza HTML corretamente
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const viewUrl = `${proto}://${host}/api/view?id=${encodeURIComponent(id)}`;

    return res.status(200).json({ id, url: viewUrl });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
};
