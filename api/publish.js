// api/publish.js
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  try {
    // ---- Body parse
    let body = req.body;
    if (!body) body = {};
    if (typeof body === "string") body = JSON.parse(body);

    const html = body.html;
    const theme = String(body.theme || "amor");
    const email = String(body.email || "").trim().toLowerCase();
    const images = Array.isArray(body.images) ? body.images : [];

    if (!html || typeof html !== "string") {
      return res.status(400).json({ error: "Campo 'html' obrigatório" });
    }

    // ---- Env
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const BUCKET = process.env.SUPABASE_BUCKET || "cartinha";

    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN; // Access Token (SECRETO)
    const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
    const PRICE_CENTS = Number(process.env.PRICE_CENTS || process.env.PRICE_BASE_URL || 490);

    if (!SUPABASE_URL || !KEY || !BUCKET) {
      return res.status(500).json({ error: "Supabase envs faltando (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_BUCKET)" });
    }
    if (!MP_ACCESS_TOKEN) {
      return res.status(500).json({ error: "MP_ACCESS_TOKEN não configurado na Vercel" });
    }
    if (!PUBLIC_BASE_URL) {
      return res.status(500).json({ error: "PUBLIC_BASE_URL não configurado na Vercel (ex: https://cartinhas-builder.vercel.app)" });
    }
    if (!Number.isFinite(PRICE_CENTS) || PRICE_CENTS <= 0) {
      return res.status(500).json({ error: "PRICE_CENTS inválido (ex: 490)" });
    }

    // ---- ID
    const id =
      (globalThis.crypto?.randomUUID?.() ||
        `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    // ---- Helpers
    const safeName = (name) => String(name || "img").replace(/[^\w.\-]+/g, "_");
    const publicObjectUrl = (path) =>
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;

    // ---- Upload HTML + images to Storage
    const basePath = `p/${id}`;
    const htmlPath = `${basePath}/index.html`;

    // upload images and rewrite html paths
    let finalHtml = html;

    for (const img of images) {
      const name = safeName(img.name);
      const dataUrl = String(img.dataUrl || "");

      // Accept only data URLs
      const m = dataUrl.match(/^data:(.+?);base64,(.+)$/);
      if (!m) continue;

      const mime = m[1];
      const b64 = m[2];
      const buf = Buffer.from(b64, "base64");

      const imgPath = `${basePath}/imagens/${name}`;
      const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${imgPath}`;

      const up = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${KEY}`,
          apikey: KEY,
          "content-type": mime,
          "x-upsert": "true",
        },
        body: buf,
      });

      if (!up.ok) {
        const txt = await up.text().catch(() => "");
        return res.status(500).json({ error: `Falha upload imagem: ${up.status} ${txt}` });
      }

      // rewrite ./imagens/<name> -> full public URL
      const from = `./imagens/${name}`;
      const to = publicObjectUrl(imgPath);
      finalHtml = finalHtml.split(from).join(to);
    }

    // upload html
    const uploadHtmlUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${htmlPath}`;
    const upHtml = await fetch(uploadHtmlUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${KEY}`,
        apikey: KEY,
        "content-type": "text/html; charset=utf-8",
        "x-upsert": "true",
      },
      body: finalHtml,
    });

    if (!upHtml.ok) {
      const txt = await upHtml.text().catch(() => "");
      return res.status(500).json({ error: `Falha upload HTML: ${upHtml.status} ${txt}` });
    }

    // ---- Insert row in DB
    const rest = `${SUPABASE_URL}/rest/v1/cartinhas`;
    const ins = await fetch(rest, {
      method: "POST",
      headers: {
        authorization: `Bearer ${KEY}`,
        apikey: KEY,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({
        id,
        email: email || "sem_email@local",
        theme,
        storage_html_path: htmlPath,
        storage_cover_path: images?.[0]?.name ? `${basePath}/imagens/${safeName(images[0].name)}` : null,
        paid: false,
        mp_preference_id: null,
      }),
    });

    if (!ins.ok) {
      const txt = await ins.text().catch(() => "");
      return res.status(500).json({ error: `Falha DB insert: ${ins.status} ${txt}` });
    }

    // ---- Create Mercado Pago preference
    const unitPrice = Math.round(PRICE_CENTS) / 100;

    const prefPayload = {
      items: [
        {
          title: "Cartinha Digital",
          quantity: 1,
          unit_price: unitPrice,
          currency_id: "BRL",
        },
      ],
      external_reference: id,
      notification_url: `${PUBLIC_BASE_URL}/api/mp-webhook`,
      back_urls: {
        success: `${PUBLIC_BASE_URL}/?paid=success&id=${id}`,
        pending: `${PUBLIC_BASE_URL}/?paid=pending&id=${id}`,
        failure: `${PUBLIC_BASE_URL}/?paid=failure&id=${id}`,
      },
      auto_return: "approved",
    };

    const mpPref = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(prefPayload),
    });

    const prefJson = await mpPref.json().catch(() => ({}));
    if (!mpPref.ok) {
      return res.status(500).json({ error: `MP preference falhou: ${mpPref.status} ${JSON.stringify(prefJson)}` });
    }

    const prefId = prefJson.id;
    const initPoint = prefJson.init_point || prefJson.sandbox_init_point;

    if (!prefId || !initPoint) {
      return res.status(500).json({ error: "MP não retornou init_point/id" });
    }

    // save preference id
    const upd = await fetch(`${rest}?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${KEY}`,
        apikey: KEY,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({ mp_preference_id: prefId }),
    });

    if (!upd.ok) {
      const txt = await upd.text().catch(() => "");
      return res.status(500).json({ error: `Falha DB update pref: ${upd.status} ${txt}` });
    }

    return res.status(200).json({
      id,
      checkout_url: initPoint,
      view_url: `${PUBLIC_BASE_URL}/api/view?id=${id}`, // só vai funcionar depois de paid=true
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
};
