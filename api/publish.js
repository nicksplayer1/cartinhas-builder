 import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "cartinha";

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// TEM que ser só o domínio, sem / no final
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");

// 490 = R$4,90
const PRICE_CENTS = Number(process.env.PRICE_CENTS || "490");

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

// Body parser robusto (Vercel Node Function)
async function readJsonBody(req) {
  // se já veio objeto
  if (req.body && typeof req.body === "object") return req.body;

  // se veio string
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }

  // senão, lê do stream
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export default async function handler(req, res) {
  // CORS básico (não atrapalha same-origin)
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization");
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });

  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  try {
    // Valida envs
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, { error: "Supabase env missing" });
    }
    if (!MP_ACCESS_TOKEN) {
      return json(res, 500, { error: "MP_ACCESS_TOKEN missing" });
    }
    if (!PUBLIC_BASE_URL) {
      return json(res, 500, { error: "PUBLIC_BASE_URL missing" });
    }
    if (!Number.isFinite(PRICE_CENTS) || PRICE_CENTS <= 0) {
      return json(res, 500, { error: "PRICE_CENTS invalid" });
    }

    const body = await readJsonBody(req);
    const { html, theme = "amor", email = "sem_email@local" } = body || {};

    if (!html || typeof html !== "string") {
      return json(res, 400, { error: "Missing html" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const id = crypto.randomUUID?.() || crypto.randomBytes(16).toString("hex");
    const storagePath = `cartinhas/${id}/index.html`;

    // 1) Upload HTML no Storage
    const up = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(storagePath, Buffer.from(html, "utf8"), {
        contentType: "text/html; charset=utf-8",
        upsert: true,
        cacheControl: "no-cache",
      });

    if (up.error) {
      return json(res, 500, { error: `Storage upload error: ${up.error.message}` });
    }

    // 2) Cria checkout (Checkout Pro)
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
      // aqui volta JSON (se o MP negar token etc você vai ver o motivo)
      return json(res, 500, { error: "MP preference error", details: prefJson });
    }

    const init_point = prefJson.init_point || prefJson.sandbox_init_point;
    const mp_preference_id = prefJson.id;

    if (!init_point || !mp_preference_id) {
      return json(res, 500, { error: "MP returned no init_point/preference id", details: prefJson });
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
      mp_status: "created",
    });

    if (ins.error) {
      return json(res, 500, { error: `DB insert error: ${ins.error.message}` });
    }

    return json(res, 200, { id, checkout_url: init_point });
  } catch (e) {
    // garante JSON mesmo em crash inesperado
    return json(res, 500, { error: e?.message || String(e) });
  }
}

