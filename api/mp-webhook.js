import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

function text(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(body);
}

export default async function handler(req, res) {
  try {
    // Mercado Pago pode mandar querystring ou body
    const type = req.query?.type || req.body?.type;
    const dataId = req.query?.["data.id"] || req.body?.data?.id;

    // A gente só processa pagamento
    if (type && type !== "payment") return text(res, 200, "ignored");

    if (!dataId) {
      // Mesmo sem dataId, não pode retornar 500 senão MP fica re-tentando sem parar
      return text(res, 200, "ok_no_data");
    }

    // 1) buscar pagamento no MP
    const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });

    const pay = await payRes.json().catch(() => ({}));
    if (!payRes.ok) return text(res, 200, "ok_mp_fetch_failed");

    const status = pay.status; // approved / pending / rejected
    const external_reference = pay.external_reference; // nosso id
    const payment_id = String(pay.id || dataId);

    if (!external_reference) return text(res, 200, "ok_no_reference");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (status === "approved") {
      await supabase
        .from("cartinhas")
        .update({
          paid: true,
          mp_payment_id: payment_id,
          paid_at: new Date().toISOString(),
        })
        .eq("id", external_reference);
    }

    return text(res, 200, "ok");
  } catch (e) {
    // Não pode quebrar o webhook com 500: MP vai re-tentar várias vezes.
    return text(res, 200, "ok_catch");
  }
}
