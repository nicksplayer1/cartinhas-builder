import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

export const config = {
  runtime: "nodejs20.x",
};

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

async function readBody(req) {
  // Vercel geralmente já dá req.body pronto,
  // mas às vezes vem string (ou vazio). Vamos garantir.
  if (req.body && typeof req.body === "object") return req.body;

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return { raw: req.body };
    }
  }

  // fallback: ler stream
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const debugId = crypto.randomUUID();
  res.setHeader("x-debug-id", debugId);

  try {
    // ENV checks
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, { error: "Supabase env missing", debugId });
    }
    if (!MP_ACCESS_TOKEN) {
      return json(res, 500, { error: "MP_ACCESS_TOKEN missing", debugId });
    }
    if (!PUBLIC_BASE_URL) {
      return json(res, 500, { error: "PUBLIC_BASE_URL missing", debugId });
    }

    const body = await readBody(req);
    const { html, theme = "amor", email = "sem_email@local" } = body || {};

    if (!html || typeof html !== "string") {
      return json(res, 400, { error: "Missing html", debugId, bodyType: typeof body });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const id = crypto.randomUUID();
    const storagePath = `cartinhas/${id}/index.html`;

    // 1) upload HTML no Storage
    // usando Blob (compatível no node 18/20)
    const file = new Blob([html], { type: "text/html; charset=utf-8" });

    const up = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(storagePath, file, {
        contentType: "text/html; charset=utf-8",
        upsert: true,
        cacheControl: "no-cache",
      });

    if (up.error) {
      return json(res, 500, { error: `Storage upload error: ${up.error.message}`, debugId });
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

    const prefText = await prefRes.text();
    let prefJson = {};
    try { prefJson = JSON.parse(prefText); } catch {}

    if (!prefRes.ok) {
      return json(res, 500, {
        error: "MP preference error",
        details: prefJson || prefText,
        debugId,
      });
    }

    const init_point = prefJson.init_point || prefJson.sandbox_init_point;
    const mp_preference_id = prefJson.id;

    if (!init_point || !mp_preference_id) {
      return json(res, 500, {
        error: "MP returned no init_point/id",
        details: prefJson,
        debugId,
      });
    }

    // 3) salva no banco
    const ins = await supabase.from("cartinhas").insert({
      id,
      email,
      theme,
      storage_html_path: storagePath,
      paid: false,
      mp_preference_id,
      mp_init_point: init_point,
      mp_status: "created",
    });

    if (ins.error) {
      return json(res, 500, { error: `DB insert error: ${ins.error.message}`, debugId });
    }

    return json(res, 200, {
      id,
      checkout_url: init_point,
      debugId,
    });
  } catch (e) {
    // Aqui garante JSON mesmo se der crash em runtime
    return json(res, 500, {
      error: e?.message || String(e),
      stack: e?.stack,
      debugId,
    });
  }
}
