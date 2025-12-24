/* api/publish.js (Vercel Serverless Function - CommonJS) */
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "cartinha";

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const PRICE_CENTS = Number(process.env.PRICE_CENTS || "490"); // 490 = R$ 4,90

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function readBody(req) {
  // Em Vercel geralmente req.body já vem parseado, mas às vezes vem string.
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  try {
    // 1) valida env
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return sendJson(res, 500, { error: "Supabase env missing" });
    }
    if (!MP_ACCESS_TOKEN) {
      return sendJson(res, 500, { error: "MP_ACCESS_TOKEN missing" });
    }
    if (!PUBLIC_BASE_URL) {
      return sendJson(res, 500, { error: "PUBLIC_BASE_URL missing" });
    }
    if (!Number.isFinite(PRICE_CENTS) || PRICE_CENTS <= 0) {
      return sendJson(res, 500, { error: "PRICE_CENTS invalid" });
    }

    // 2) lê body
    const body = readBody(req);
    const { html, theme = "amor", email = "sem_email@local" } = body || {};
    if (!html || typeof html !== "string") {
      return sendJson(res, 400, { error: "Missing html" });
    }

    // 3) supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 4) cria id e faz upload do HTML
    const id = (globalThis.crypto && globalThis.crypto.randomUUID)
      ? globalThis.crypto.randomUUID()
      : crypto.randomUUID();

    const storagePath = `cartinhas/${id}/index.html`;

    const up = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(storagePath, Buffer.from(html, "utf-8"), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
        cacheControl: "no-cache",
      });

    if (up.error) {
      return sendJson(res, 500, { error: `Storage upload error: ${up.error.message}` });
    }

    // 5) cria preference do Mercado Pago (Checkout Pro)
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
        Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preferencePayload),
    });

    const prefJson = await prefRes.json().catch(() => null);

    if (!prefRes.ok) {
      // log ajuda MUITO a debugar no painel da Vercel
      console.error("MP preference error:", prefRes.status, prefJson);
      return sendJson(res, 500, {
        error: "MP preference error",
        status: prefRes.status,
        details: prefJson || {},
      });
    }

    const initPoint = prefJson.init_point; // produção
    const mpPreferenceId = prefJson.id;

    if (!initPoint || !mpPreferenceId) {
      console.error("MP returned unexpected payload:", prefJson);
      return sendJson(res, 500, { error: "MP payload missing init_point/id" });
    }

    // 6) salva no banco
    const ins = await supabase.from("cartinhas").insert({
      id,
      email,
      theme,
      storage_html_path: storagePath,
      paid: false,
      mp_preference_id: mpPreferenceId,
      mp_init_point: initPoint,
      mp_status: "created",
    });

    if (ins.error) {
      console.error("DB insert error:", ins.error);
      return sendJson(res, 500, { error: `DB insert error: ${ins.error.message}` });
    }

    // 7) retorna checkout url pro front abrir
    return sendJson(res, 200, {
      id,
      checkout_url: initPoint,
    });
  } catch (e) {
    console.error("publish.js crash:", e);
    return sendJson(res, 500, { error: e?.message || String(e) });
  }
};
