// api/mp-webhook.js
module.exports = async (req, res) => {
  try {
    // MP manda GET ou POST dependendo do caso
    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!MP_ACCESS_TOKEN || !SUPABASE_URL || !KEY) {
      return res.status(500).send("missing env");
    }

    let paymentId = null;

    // formato novo: { type: "payment", data: { id: "123" } }
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") body = JSON.parse(body);

      if (body?.data?.id) paymentId = String(body.data.id);
      if (!paymentId && body?.id) paymentId = String(body.id);
    }

    // formato antigo via query: ?topic=payment&id=123
    if (!paymentId) {
      const q = req.query || {};
      if (q.id) paymentId = String(q.id);
      if (q["data.id"]) paymentId = String(q["data.id"]);
    }

    if (!paymentId) {
      // responde 200 pra não ficar tentando sem parar
      return res.status(200).json({ ok: true, ignored: true });
    }

    // busca pagamento
    const pr = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });

    const pj = await pr.json().catch(() => ({}));
    if (!pr.ok) {
      return res.status(200).json({ ok: true, mp_fetch_failed: true }); // não derruba webhook
    }

    const status = pj.status; // approved, pending, rejected...
    const orderId = pj.external_reference;

    if (!orderId) return res.status(200).json({ ok: true, no_external_reference: true });

    if (status === "approved") {
      // marca pago
      const rest = `${SUPABASE_URL}/rest/v1/cartinhas?id=eq.${encodeURIComponent(orderId)}`;
      await fetch(rest, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${KEY}`,
          apikey: KEY,
          "content-type": "application/json",
          prefer: "return=minimal",
        },
        body: JSON.stringify({ paid: true }),
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // webhook nunca deve ficar retornando 500 toda hora
    return res.status(200).json({ ok: true, error: String(e?.message || e) });
  }
};

