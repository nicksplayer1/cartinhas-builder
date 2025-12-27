import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "cartinha";

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const PRICE_CENTS = Number(process.env.PRICE_CENTS || "490");

// PUBLIC_BASE_URL é útil, mas fallback pelo host da request funciona bem (prod/preview)
const ENV_PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getBaseUrl(req) {
  if (ENV_PUBLIC_BASE_URL) return ENV_PUBLIC_BASE_URL;

  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, { error: "Supabase env missing" });
  }
  if (!MP_ACCESS_TOKEN) {
    return json(res, 500, { error: "MP_ACCESS_TOKEN missing" });
  }

  const body = await readJsonBody(req);
  if (body === null) return json(res, 400, { error: "Invalid JSON body" });

  const { html, theme = "amor", email = "sem_email@local" } = body || {};
  if (!html || typeof html !== "string") return json(res, 400, { error: "Missing html" });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const id = crypto.randomUUID();
    const storagePath = `cartinhas/${id}/index.html`;

    // 1) Upload HTML
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

    // 2) Checkout Pro (Mercado Pago)
    const baseUrl = getBaseUrl(req);
    const notificationUrl = `${baseUrl}/api/mp-webhook`;

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
        success: `${baseUrl}/?paid=1&id=${id}`,
        pending: `${baseUrl}/?paid=0&id=${id}`,
        failure: `${baseUrl}/?paid=0&id=${id}`,
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

    if (!init_point || !mp_preference_id) {
      return json(res, 500, { error: "MP response missing init_point/id", details: prefJson });
    }

    // 3) Salva no banco
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

    return json(res, 200, { id, checkout_url: init_point });
  } catch (e) {
    return json(res, 500, { error: e?.message || String(e) });
  }
}
