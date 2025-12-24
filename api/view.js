 // api/view.js
module.exports = async (req, res) => {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const BUCKET = process.env.SUPABASE_BUCKET || "cartinha";

    const id = String(req.query?.id || "");
    if (!id) return res.status(400).send("id obrigatório");
    if (!SUPABASE_URL || !KEY || !BUCKET) return res.status(500).send("env faltando");

    // checa se pagou
    const rowUrl = `${SUPABASE_URL}/rest/v1/cartinhas?select=paid,storage_html_path&id=eq.${encodeURIComponent(id)}&limit=1`;
    const rr = await fetch(rowUrl, { headers: { authorization: `Bearer ${KEY}`, apikey: KEY } });
    const rows = await rr.json().catch(() => []);
    const row = rows?.[0];

    if (!row) return res.status(404).send("não encontrado");

    if (!row.paid) {
      // página simples de "aguardando pagamento" que faz polling
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.status(200).send(`<!doctype html>
<html lang="pt-br">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pagamento pendente</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,Arial;margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#fff;padding:18px}
  .c{max-width:520px;width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:18px;padding:16px}
  .m{opacity:.8;font-size:14px;line-height:1.5}
</style>
</head>
<body>
  <div class="c">
    <h2>⏳ Aguardando confirmação do pagamento</h2>
    <p class="m">Assim que o pagamento for aprovado, a cartinha abre automaticamente.</p>
    <p class="m" id="s">Checando…</p>
  </div>
<script>
  async function tick(){
    const r = await fetch('/api/status?id=${id}');
    const j = await r.json();
    if(j && j.paid && j.view_url){
      location.href = j.view_url;
      return;
    }
    document.getElementById('s').textContent = 'Ainda pendente… (atualizando)';
  }
  setInterval(tick, 2000); tick();
</script>
</body></html>`);
    }

    const htmlPath = row.storage_html_path;
    const fileUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${htmlPath}`;

    // buscar HTML e devolver
    const fr = await fetch(fileUrl);
    const html = await fr.text();

    res.setHeader("content-type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (e) {
    return res.status(500).send(String(e?.message || e));
  }
};

