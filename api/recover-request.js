import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM || "Cartinhas <onboarding@resend.dev>";
const OTP_SECRET = process.env.OTP_SECRET;

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
  try { return JSON.parse(raw); } catch { return null; }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function sha256Hex(str) {
  // Node 20: usa crypto do node
  const { createHash } = require("crypto");
  return createHash("sha256").update(str).digest("hex");
}

function generateCode() {
  // 6 dígitos
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendEmailResend({ to, subject, html, text }) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY missing");

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
      text,
    }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Resend error: ${r.status} ${JSON.stringify(j)}`);
  }
  return j;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(res, 500, { error: "Supabase env missing" });
  if (!OTP_SECRET) return json(res, 500, { error: "OTP_SECRET missing" });

  const body = await readJsonBody(req);
  if (body === null) return json(res, 400, { error: "Invalid JSON" });

  const email = normalizeEmail(body.email);
  if (!email.includes("@")) return json(res, 400, { error: "Invalid email" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // rate limit simples: 1 envio por minuto por email
  const now = new Date();
  const { data: existing } = await supabase.from("cartinhas_otp").select("last_sent_at").eq("email", email).maybeSingle();

  if (existing?.last_sent_at) {
    const last = new Date(existing.last_sent_at);
    const diffMs = now - last;
    if (diffMs < 60_000) {
      return json(res, 429, { error: "Aguarde 1 minuto antes de pedir outro código." });
    }
  }

  const code = generateCode();
  const expiresAt = new Date(now.getTime() + 10 * 60_000); // 10 min

  const codeHash = sha256Hex(`${OTP_SECRET}:${email}:${code}`);

  const up = await supabase.from("cartinhas_otp").upsert(
    {
      email,
      code_hash: codeHash,
      expires_at: expiresAt.toISOString(),
      attempts: 0,
      last_sent_at: now.toISOString(),
      updated_at: now.toISOString(),
    },
    { onConflict: "email" }
  );

  if (up.error) return json(res, 500, { error: up.error.message });

  // envia e-mail
  try {
    await sendEmailResend({
      to: email,
      subject: "Seu código para recuperar a Cartinha",
      text: `Seu código é: ${code} (vale por 10 minutos).`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.4">
          <h2>Recuperar sua Cartinha</h2>
          <p>Seu código é:</p>
          <div style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</div>
          <p>Ele expira em <b>10 minutos</b>.</p>
        </div>
      `,
    });
  } catch (e) {
    return json(res, 500, { error: "Falha ao enviar e-mail", details: String(e?.message || e) });
  }

  return json(res, 200, { ok: true });
}
