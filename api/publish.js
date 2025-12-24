 import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "cartinha";

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const PRICE_CENTS = Number(process.env.PRICE_CENTS || "490"); // 490 = R$4,90

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, { error: "Supabase env missing" });
    }
    if (!MP_ACCESS_TOKEN) {
      return json(res, 500, { error: "MP_ACCESS_TOKEN missing" });
    }
    if (!PUBLIC_BASE_URL) {
      return json(res, 500, { error: "PUBLIC_BASE_URL missing" });
    }

    const { html, theme = "amor", email = "sem_email@local" } = req.body || {};
    if (!html || typeof html !== "string") return json(res, 400, { error: "Missing html" });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const id = crypto.randomUUID();
    const storagePath = `cartinhas/${id}/index.html`;

    // 1) upload HTML
    const up = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(storagePath, Buffer.from(html, "utf-8"), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
        cacheControl: "no-cache",
      });

    if (up.error) {
      return json(res, 500, { error: `Storage upload error: ${up.error.message}` });
    }

    // 2) cria checkout (Checkout Pro)
    const notificationUrl = `${PUBLIC_BASE_URL}/api/mp-webhook`;

    const preferencePayload = {
      items: [
        {
          title: `Cartinha (${theme})`,
          quantity: 1,
          currency_id: "BRL",
          unit_price: PRICE_CENTS / 100,
        },
      ],
      notification_url: notificationUrl,
      external_reference: id,
      back_urls: {
        success: `${PUBLIC_BASE_URL}/?paid=1&id=${id}`,
        pending: `${PUBLIC_BASE_URL}/?paid=0&id=${id}`,
        failure: `${PUBLIC_BASE_URL}/?paid=0&id=${id}`,
      },
      auto_return: "approved",
    };

    const prefRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(preferencePayload),
    });

    const prefJson = await prefRes.json().catch(() => ({}));
    if (!prefRes.ok) {
      return json(res, 500, { error: "MP preference error", details: prefJson });
    }

    const init_point = prefJson.init_point || prefJson.sandbox_init_point;
    const mp_preference_id = prefJson.id;

    // 3) salva no banco
    const ins = await supabase.from("cartinhas").insert({
      id,
      email,
      theme,
      storage_html_path: storagePath,
      paid: false,
      mp_preference_id,
      mp_init_point: init_point,
    });

    if (ins.error) {
      return json(res, 500, { error: `DB insert error: ${ins.error.message}` });
    }

    return json(res, 200, {
      id,
      checkout_url: init_point,
    });
  } catch (e) {
    return json(res, 500, { error: e?.message || String(e) });
  }
}

