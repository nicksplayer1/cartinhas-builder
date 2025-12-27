import { createHmac } from "node:crypto";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM || "Cartinhas <onboarding@resend.dev>";
const OTP_SECRET = process.env.OTP_SECRET;

// janela do código: 5 minutos
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

// HOTP padrão (HMAC-SHA1) + truncagem dinâmica
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

function otpForEmailNow(email) {
  // segredo por email: HMAC(OTP_SECRET, email)
  const perEmailSecret = createHmac("sha256", OTP_SECRET).update(email).digest();
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  const num = hotp(perEmailSecret, counter) % (10 ** DIGITS);
  return String(num).padStart(DIGITS, "0");
}

async function sendWithResend({ to, subject, html }) {
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
    throw new Error(`Resend failed (${r.status}): ${JSON.stringify(j)}`);
  }
  return j;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

    if (!RESEND_API_KEY) return json(res, 500, { error: "RESEND_API_KEY missing" });
    if (!OTP_SECRET) return json(res, 500, { error: "OTP_SECRET missing" });

    const body = await readJson(req);
    if (body === null) return json(res, 400, { error: "Invalid JSON" });

    const email = normalizeEmail(body.email);
    if (!email || !email.includes("@")) return json(res, 400, { error: "Invalid email" });

    const code = otpForEmailNow(email);

    await sendWithResend({
      to: email,
      subject: "Seu código para recuperar a cartinha",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5">
          <h2>Recuperar link da cartinha</h2>
          <p>Seu código é:</p>
          <div style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</div>
          <p>Ele expira em ~5 minutos.</p>
        </div>
      `,
    });

    return json(res, 200, { ok: true });
  } catch (e) {
    return json(res, 500, { error: e?.message || String(e) });
  }
}
