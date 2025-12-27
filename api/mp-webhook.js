import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

// parse básico do body (Vercel às vezes entrega string)
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (req.body && typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return { raw: req.body }; }
  }
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
    });
  });
}

export default async function handler(req, res) {
  try {
    // Aceita GET só pra você testar no navegador
    if (req.method === "GET") {
      return json(res, 200, { ok: true, message: "mp-webhook alive (use POST for real webhook)" });
    }

    if (req.method !== "POST") {
      return json(res, 200, { ok: true, ignored: true, method: req.method });
      // (responder 200 evita retries/chatice em testes)
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Supabase env missing");
      return json(res, 500, { error: "Supabase env missing" });
    }
    if (!MP_ACCESS_TOKEN) {
      console.error("MP_ACCESS_TOKEN missing");
      return json(res, 500, { error: "MP_ACCESS_TOKEN missing" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // MP pode mandar dados no querystring ou no body
    const body = await readBody(req);
    const url = new URL(req.url, `https://${req.headers.host}`);

    // formatos comuns:
    // - ?type=payment&data.id=123
    // - ?topic=payment&id=123
    const type = url.searchParams.get("type") || url.searchParams.get("topic") || body?.type;
    const dataId =
      url.searchParams.get("data.id") ||
      url.searchParams.get("id") ||
      body?.data?.id ||
      body?.id;

    console.log("Webhook received:", { method: req.method, type, dataId, bodyPreview: body?.action || body?.type });

    // Se não tiver payment id, responde 200 pra não quebrar
    if (!dataId) return json(res, 200, { ok: true, ignored: true, reason: "no payment id" });

    // Busca detalhes do pagamento
    const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });

    const payment = await payRes.json().catch(() => ({}));
    if (!payRes.ok) {
      console.error("MP payment fetch failed:", payRes.status, payment);
      // aqui você pode escolher 200 (não retry) ou 500 (retry). Eu deixo 200 pra não travar.
      return json(res, 200, { ok: false, mp_fetch_failed: true, status: payRes.status });
    }

    const status = payment.status; // approved, pending, rejected...
    const externalRef = payment.external_reference; // DEVE ser seu id (você setou isso na preference)

    console.log("Payment:", { id: payment.id, status, externalRef });

    if (!externalRef) {
      return json(res, 200, { ok: true, ignored: true, reason: "no external_reference" });
    }

    // marca como pago apenas se approved
    const paid = status === "approved";

    const upd = await supabase
      .from("cartinhas")
      .update({
        paid,
        mp_payment_id: String(payment.id),
        paid_at: paid ? new Date().toISOString() : null,
        mp_status: status,
      })
      .eq("id", externalRef);

    if (upd.error) {
      console.error("DB update error:", upd.error);
      return json(res, 500, { error: `DB update error: ${upd.error.message}` });
    }

    return json(res, 200, { ok: true });
  } catch (e) {
    console.error("Webhook fatal:", e);
    return json(res, 500, { error: e?.message || String(e) });
  }
}
