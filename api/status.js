// api/status.js
module.exports = async (req, res) => {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");

    const id = String(req.query?.id || "");
    if (!id) return res.status(400).json({ error: "id obrigatório" });
    if (!SUPABASE_URL || !KEY || !PUBLIC_BASE_URL) return res.status(500).json({ error: "env faltando" });

    const url = `${SUPABASE_URL}/rest/v1/cartinhas?select=paid&id=eq.${encodeURIComponent(id)}&limit=1`;
    const r = await fetch(url, { headers: { authorization: `Bearer ${KEY}`, apikey: KEY } });
    const j = await r.json().catch(() => []);
    const paid = !!(j?.[0]?.paid);

    res.status(200).json({
      id,
      paid,
      view_url: paid ? `${PUBLIC_BASE_URL}/api/view?id=${id}` : null,
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
};

