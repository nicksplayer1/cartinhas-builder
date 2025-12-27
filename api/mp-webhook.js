import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://cartinhas-builder.vercel.app").replace(/\/+$/, "");
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM; // ex: "Cartinhas <contato@seudominio.com>"

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
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

function makeRecoveryToken() {
  // token curto e amigável (não depende de lib)
  return (crypto.randomUUID().replace(/-/g, "")).slice(0, 12);
}

async function sendEmailResend({ to, subject, html }) {
  if (!RESEND_API_KEY || !MAIL_FROM) return { skipped: true, reason: "email env missing" };

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to,
      subject,
      html,
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend error: ${r.status} ${JSON.stringify(data)}`);
  return data;
}

export default async function handler(req, res) {
  try {
    // GET só pra testar no navegador
    if (req.method === "GET") {
      return json(res, 200, { ok: true, message: "mp-webhook alive (use POST for real webhook)" });
    }

    // Mercado Pago envia POST
    if (req.method !== "POST") {
      // devolver 200 evita retries chatos
      return json(res, 200, { ok: true, ignored: true, method: req.method });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, { error: "Supabase env missing" });
    }
    if (!MP_ACCESS_TOKEN) {
      return json(res, 500, { error: "MP_ACCESS_TOKEN missing" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await readBody(req);
    const url = new URL(req.url, `https://${req.headers.host}`);

    const type = url.searchParams.get("type") || url.searchParams.get("topic") || body?.type;
    const dataId =
      url.searchParams.get("data.id") ||
      url.searchParams.get("id") ||
      body?.data?.id ||
      body?.id;

    // Sem payment id => não faz nada
    if (!dataId) return json(res, 200, { ok: true, ignored: true, reason: "no payment id" });

    // Busca detalhes do pagamento
    const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });

    const payment = await payRes.json().catch(() => ({}));
    if (!payRes.ok) {
      // 200 pra não ficar forçando retries infinitos
      return json(res, 200, { ok: false, mp_fetch_failed: true, status: payRes.status });
    }

    const status = payment.status; // approved, pending, rejected...
    const externalRef = payment.external_reference; // seu id da cartinha (uuid)

    if (!externalRef) return json(res, 200, { ok: true, ignored: true, reason: "no external_reference" });

    const paid = status === "approved";

    // Atualiza status sempre (pra você ver pending/rejected etc)
    const upd = await supabase
      .from("cartinhas")
      .update({
        paid,
        mp_payment_id: String(payment.id),
        mp_status: status,
        paid_at: paid ? new Date().toISOString() : null,
      })
      .eq("id", externalRef);

    if (upd.error) return json(res, 500, { error: `DB update error: ${upd.error.message}` });

    // Só envia link se approved
    if (!paid) return json(res, 200, { ok: true, status });

    // Busca dados da cartinha (email e se já enviou)
    const { data: row, error: selErr } = await supabase
      .from("cartinhas")
      .select("id,email,view_url,recovery_token,email_sent_at")
      .eq("id", externalRef)
      .single();

    if (selErr) return json(res, 200, { ok: true, status, warning: "could not load row" });

    // Gera view_url e token se não existirem
    const viewUrl = row.view_url || `${PUBLIC_BASE_URL}/api/view?id=${row.id}`;
    const token = row.recovery_token || makeRecoveryToken();

    // Salva view_url/token caso ainda não tenha
    if (!row.view_url || !row.recovery_token) {
      await supabase
        .from("cartinhas")
        .update({ view_url: viewUrl, recovery_token: token })
        .eq("id", row.id);
    }

    // Se não tem email, encerra (link já existe)
    if (!row.email) return json(res, 200, { ok: true, status, sent: false, reason: "no email" });

    // Evita mandar email repetido
    if (row.email_sent_at) return json(res, 200, { ok: true, status, sent: false, reason: "already sent" });

    // Link de recuperação “bonitinho” (sem UUID)
    const recoveryUrl = `${PUBLIC_BASE_URL}/api/recover?token=${token}`;

    // Envia email
    await sendEmailResend({
      to: row.email,
      subject: "Sua cartinha está pronta 💌",
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.4">
          <h2>Sua cartinha está pronta! 💌</h2>
          <p>Aqui está o link para abrir sua cartinha:</p>
          <p><a href="${viewUrl}">${viewUrl}</a></p>
          <p>Se você perder esse link, use este aqui para recuperar:</p>
          <p><a href="${recoveryUrl}">${recoveryUrl}</a></p>
          <p style="color:#666;font-size:12px">Guarde este e-mail 💛</p>
        </div>
      `,
    });

    // Marca como enviado
    await supabase
      .from("cartinhas")
      .update({ email_sent_at: new Date().toISOString() })
      .eq("id", row.id);

    return json(res, 200, { ok: true, status, sent: true });
  } catch (e) {
    return json(res, 500, { error: e?.message || String(e) });
  }
}
