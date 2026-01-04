 import { put } from "@vercel/blob";

function getKey(req) {
  // Next.js pages/api fornece req.query; em outras runtimes, fazemos parse de req.url
  const q1 = req.query?.key || req.query?.k;
  if (q1) return String(q1);

  try {
    const url = new URL(req.url, "http://localhost");
    return url.searchParams.get("key") || url.searchParams.get("k") || "";
  } catch {
    return "";
  }
}

async function readJson(req) {
  return await new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error("Body não é JSON válido"));
      }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  // CORS (para evitar problemas no browser)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-dev-key");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Healthcheck
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      route: "/api/publish-dev",
      hasDevKey: Boolean(process.env.DEV_PUBLISH_KEY),
      hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const expectedKey = String(process.env.DEV_PUBLISH_KEY || "");
    const providedKey = (getKey(req) || req.headers["x-dev-key"] || "").toString();

    if (!expectedKey) {
      return res.status(500).json({
        error: "DEV_PUBLISH_KEY não configurada nas Environment Variables.",
      });
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({
        error: "BLOB_READ_WRITE_TOKEN não configurada nas Environment Variables.",
      });
    }

    if (providedKey !== expectedKey) {
      return res.status(401).json({ error: "Chave DEV inválida." });
    }

    const body = await readJson(req);
    const theme = String(body?.theme || "tema");
    const html = body?.html;

    if (typeof html !== "string" || !html.trim()) {
      return res.status(400).json({ error: "Campo 'html' é obrigatório (string)." });
    }

    const id = `dev_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const pathname = `cartinhas/dev/${theme}/${id}.html`;

    const blob = await put(pathname, html, {
      access: "public",
      contentType: "text/html; charset=utf-8",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return res.status(200).json({ id, url: blob.url });
  } catch (e) {
    console.error("publish-dev error:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

