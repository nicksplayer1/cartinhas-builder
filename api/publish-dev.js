import { put } from "@vercel/blob";

function getDevKey(req){
  const q = req.query?.key || req.query?.k;
  const h = req.headers["x-dev-key"];
  return (q || h || "").toString();
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-dev-key");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      route: "/api/publish-dev",
      hasBlobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      hasDevKey: Boolean(process.env.DEV_PUBLISH_KEY),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Segurança: exige chave
  const requiredKey = process.env.DEV_PUBLISH_KEY;
  if (!requiredKey) {
    return res.status(500).json({
      error: "DEV_PUBLISH_KEY não configurada. Defina esta env var para usar o modo TESTE.",
    });
  }

  const provided = getDevKey(req);
  if (provided !== requiredKey) {
    return res.status(401).json({ error: "Chave inválida para modo TESTE." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const theme = (body.theme || "tema").toString().slice(0, 40);
    const html = body.html;

    if (!html || typeof html !== "string") {
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
