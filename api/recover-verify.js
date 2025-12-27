import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
  const { createHash } = require("crypto");
  return createHash("sha256").update(str).digest("hex");
}

function getBaseUrl(req) {
  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(res, 500, { error: "Supabase env missing" });
  if (!OTP_SECRET) return json(res, 500, { error: "OTP_SECRET missing" });

  const body = await readJsonBody(req);
  if (body === null) return json(res, 400, { error: "Invalid JSON" });

  const email = normalizeEmail(body.email);
  const code = String(body.code || "").trim();

  if (!email.includes("@")) return json(res, 400, { error: "Invalid email" });
  if (!/^\d{6}$/.test(code)) return json(res, 400, { error: "Invalid code" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: otp, error: otpErr } = await supabase
    .from("cartinhas_otp")
    .select("code_hash, expires_at, attempts")
    .eq("email", email)
    .maybeSingle();

  if (otpErr) return json(res, 500, { error: otpErr.message });
  if (!otp) return json(res, 400, { error: "Código não encontrado. Peça um novo." });

  if (otp.attempts >= 5) return json(res, 429, { error: "Muitas tentativas. Peça um novo código." });

  const expires = new Date(otp.expires_at);
  if (Date.now() > expires.getTime()) return json(res, 400, { error: "Código expirou. Peça um novo." });

  const expected = sha256Hex(`${OTP_SECRET}:${email}:${code}`);
  if (expected !== otp.code_hash) {
    await supabase.from("cartinhas_otp").update({ attempts: otp.attempts + 1, updated_at: new Date().toISOString() }).eq("email", email);
    return json(res, 400, { error: "Código inválido." });
  }

  // opcional: invalida o código após uso
  await supabase.from("cartinhas_otp").update({ expires_at: new Date(0).toISOString(), updated_at: new Date().toISOString() }).eq("email", email);

  // busca cartinhas pagas desse email (últimas 10)
  const { data: rows, error: rowsErr } = await supabase
    .from("cartinhas")
    .select("id, theme, paid, mp_status, created_at")
    .eq("email", email)
    .or("paid.eq.true,mp_status.eq.approved")
    .order("created_at", { ascending: false })
    .limit(10);

  if (rowsErr) return json(res, 500, { error: rowsErr.message });

  const baseUrl = getBaseUrl(req);
  const items = (rows || []).map((r) => ({
    id: r.id,
    theme: r.theme,
    created_at: r.created_at,
    link: `${baseUrl}/api/view?id=${r.id}`,
  }));

  return json(res, 200, { ok: true, items });
}
