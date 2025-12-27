import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

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

function getUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  return new URL(req.url, `${proto}://${host}`);
}

export default async function handler(req, res) {
  // ✅ Para teste no navegador
  if (req.method === "GET") {
    return json(res, 200, { ok: true, message: "mp-webhook alive. Use POST for Mercado Pago." });
  }

  // ✅ Mercado Pago envia POST
  if (req.method !== "POST") {
    // Melhor responder 200 pra não ficar gerando retries em testes estranhos
    return json(res, 200, { ok: true, ignored: true, method: req.method });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(res, 500, { error: "Supabase env missing" });
  }
  if (!MP_ACCESS_TOKEN) {
    return json(res, 500, { error: "MP_ACCESS_TOKEN missing" });
  }

  const body = await readJsonBody(req);
  if (body === null) {
    // payload inválido: responde 200 pra MP não ficar insistindo eternamente
    return json(res, 200, { ok: true, ignored: true, reason: "invalid json" });
  }

  const url = getUrl(req);

  // ✅ MP pode mandar em querystring OU body
  // Query formats comuns:
  // - ?type=payment&data.id=123
  // - ?topic=payment&id=123
  const dataId =
    url.searchParams.get("data.id") ||
    url.searchParams.get("id") ||
    body?.data?.id ||
    body?.id ||
    null;

  // Se não tem payment id, responde 200 (não quebra)
  if (!dataId) {
    return json(res, 200, { ok: true, ignored: true, reason: "no payment id" });
  }

  try {
    // 1) Buscar detalhes do pagamento no MP
    const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });

    const payment = await payRes.json().catch(() => ({}));

    if (!payRes.ok) {
      // Responde 200 pra não ficar em loop de retries
      return json(res, 200, { ok: true, ignored: true, mp_fetch_failed: true, status: payRes.status });
    }

    const status = payment.status; // approved, pending, rejected...
    const externalRef = payment.external_reference; // seu id da cartinha

    if (!externalRef) {
      return json(res, 200, { ok: true, ignored: true, reason: "no external_reference" });
    }

    const paid = status === "approved";

    // 2) Atualiza Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const upd = await supabase
      .from("cartinhas")
      .update({
        paid,
        mp_payment_id: String(payment.id),
        mp_status: status,
        paid_at: paid ? new Date().toISOString() : null,
      })
      .eq("id", externalRef);

    if (upd.error) {
      // Aqui sim faz sentido 500 (você quer saber que falhou)
      return json(res, 500, { error: `DB update error: ${upd.error.message}` });
    }

    // 3) Responde 200 pro Mercado Pago
    return json(res, 200, { ok: true });
  } catch (e) {
    // Melhor responder 200 pra evitar loop de retries infinito
    return json(res, 200, { ok: true, ignored: true, reason: e?.message || String(e) });
  }
}
