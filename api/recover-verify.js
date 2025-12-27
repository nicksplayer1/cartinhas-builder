 import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

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

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
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

  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim();

  if (!email || !email.includes("@")) return json(res, 400, { error: "Invalid email" });
  if (!/^\d{6}$/.test(code)) return json(res, 400, { error: "Invalid code" });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: otpRow, error: otpErr } = await supabase
    .from("recover_otps")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (otpErr) return json(res, 500, { error: otpErr.message });
  if (!otpRow) return json(res, 401, { error: "Invalid/expired code" });

  const now = Date.now();
  const exp = new Date(otpRow.expires_at).getTime();
  if (!exp || exp < now) return json(res, 401, { error: "Invalid/expired code" });

  const code_hash = sha256(`${code}:${OTP_SECRET}`);
  if (code_hash !== otpRow.code_hash) {
    // incrementa attempts (opcional)
    await supabase.from("recover_otps").update({ attempts: (otpRow.attempts || 0) + 1 }).eq("email", email);
    return json(res, 401, { error: "Invalid/expired code" });
  }

  // válido: busca cartinhas PAGAS deste email
  const { data: rows, error: rowsErr } = await supabase
    .from("cartinhas")
    .select("id, theme, paid, paid_at, mp_status")
    .eq("email", email)
    .eq("paid", true)
    .order("paid_at", { ascending: false })
    .limit(20);

  if (rowsErr) return json(res, 500, { error: rowsErr.message });

  const baseUrl = getBaseUrl(req);

  const links = (rows || []).map((r) => ({
    id: r.id,
    theme: r.theme,
    paid_at: r.paid_at,
    mp_status: r.mp_status,
    url: `${baseUrl}/api/view?id=${encodeURIComponent(r.id)}`,
  }));

  return json(res, 200, { ok: true, links });
}

