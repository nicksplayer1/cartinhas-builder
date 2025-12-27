 import { createClient } from "@supabase/supabase-js";
import { createHash, randomInt } from "node:crypto";

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

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

function getBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

async function sendEmail(to, subject, html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [to],
      subject,
      html,
    }),
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Resend error (${r.status}): ${JSON.stringify(j)}`);
  }
  return j;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(res, 500, { error: "Supabase env missing" });
  if (!RESEND_API_KEY || !OTP_SECRET) return json(res, 500, { error: "Resend/OTP env missing" });

  const body = await readJsonBody(req);
  if (body === null) return json(res, 400, { error: "Invalid JSON" });

  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return json(res, 400, { error: "Invalid email" });

  // gera OTP 6 dígitos
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const code_hash = sha256(`${code}:${OTP_SECRET}`);
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // upsert por email
  const up = await supabase
    .from("recover_otps")
    .upsert({ email, code_hash, expires_at, attempts: 0 }, { onConflict: "email" });

  if (up.error) return json(res, 500, { error: up.error.message });

  const baseUrl = getBaseUrl(req);
  const recoverUrl = `${baseUrl}/recover.html?email=${encodeURIComponent(email)}`;

  // manda e-mail
  await sendEmail(
    email,
    "Código de recuperação da sua cartinha",
    `
      <div style="font-family:Arial,sans-serif;line-height:1.5">
        <h2>Seu código de recuperação</h2>
        <p>Use este código (válido por <b>10 minutos</b>):</p>
        <p style="font-size:24px;letter-spacing:2px"><b>${code}</b></p>
        <p>Abra a página de recuperação:</p>
        <p><a href="${recoverUrl}">${recoverUrl}</a></p>
      </div>
    `
  );

  // não revela se existe compra ou não — melhor segurança
  return json(res, 200, { ok: true });
}

