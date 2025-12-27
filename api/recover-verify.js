 import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OTP_SECRET = process.env.OTP_SECRET;
const ENV_PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");

// mesma config do recover-request
const STEP_SECONDS = 300;
const DIGITS = 6;

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getBaseUrl(req) {
  if (ENV_PUBLIC_BASE_URL) return ENV_PUBLIC_BASE_URL;
  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function hotp(secretBuf, counter) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secretBuf).update(b).digest();
  const o = h[h.length - 1] & 0xf;
  const code =
    ((h[o] & 0x7f) << 24) |
    ((h[o + 1] & 0xff) << 16) |
    ((h[o + 2] & 0xff) << 8) |
    (h[o + 3] & 0xff);
  return code;
}

function otpForEmailAtCounter(email, counter) {
  const perEmailSecret = createHmac("sha256", OTP_SECRET).update(email).digest();
  const num = hotp(perEmailSecret, counter) % (10 ** DIGITS);
  return String(num).padStart(DIGITS, "0");
}

function verifyOtp(email, code) {
  const nowCounter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  const c = String(code || "").trim();

  // aceita janela -1, 0, +1 (skew)
  for (const delta of [-1, 0, 1]) {
    const expected = otpForEmailAtCounter(email, nowCounter + delta);
    if (expected === c) return true;
  }
  return false;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(res, 500, { error: "Supabase env missing" });
    }
    if (!OTP_SECRET) return json(res, 500, { error: "OTP_SECRET missing" });

    const body = await readJson(req);
    if (body === null) return json(res, 400, { error: "Invalid JSON" });

    const email = normalizeEmail(body.email);
    const code = String(body.code || "").trim();

    if (!email || !email.includes("@")) return json(res, 400, { error: "Invalid email" });
    if (!code || code.length !== 6) return json(res, 400, { error: "Invalid code" });

    if (!verifyOtp(email, code)) {
      return json(res, 401, { error: "Invalid or expired code" });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // pega cartinhas pagas desse email
    const { data, error } = await supabase
      .from("cartinhas")
      .select("id, theme, paid, paid_at, mp_status")
      .eq("email", email)
      .eq("paid", true)
      .limit(20);

    if (error) return json(res, 500, { error: `DB error: ${error.message}` });

    const baseUrl = getBaseUrl(req);
    const links = (data || []).map((r) => ({
      id: r.id,
      theme: r.theme,
      paid_at: r.paid_at,
      mp_status: r.mp_status,
      url: `${baseUrl}/api/view?id=${encodeURIComponent(r.id)}`,
    }));

    return json(res, 200, { ok: true, links });
  } catch (e) {
    return json(res, 500, { error: e?.message || String(e) });
  }
}

