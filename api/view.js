module.exports = async (req, res) => {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const BUCKET = process.env.SUPABASE_BUCKET || "cartinha"; // ajuste se seu bucket tiver outro nome

    if (!SUPABASE_URL || !KEY) {
      return res.status(500).send("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas.");
    }

    const id = (req.query && req.query.id) ? String(req.query.id) : "";
    if (!id || id.length > 120 || !/^[a-zA-Z0-9\-_]+$/.test(id)) {
      return res.status(400).send("ID inválido.");
    }

    const path = `p/${id}/index.html`;
    const downloadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`;

    const r = await fetch(downloadUrl, {
      method: "GET",
      headers: {
        authorization: `Bearer ${KEY}`,
        apikey: KEY,
      },
    });

    if (!r.ok) {
      if (r.status === 404) return res.status(404).send("Cartinha não encontrada.");
      const txt = await r.text().catch(() => "");
      return res.status(500).send(`Erro ao buscar cartinha: ${r.status} ${txt}`);
    }

    const html = await r.text();

    // MUITO IMPORTANTE: força o navegador a renderizar como página
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).send(String(e?.message || e));
  }
};
