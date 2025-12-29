import { handleUpload } from "@vercel/blob/client";

async function readJsonBody(req) {
  // Vercel Node functions às vezes não populam req.body como você espera.
  // Então a gente lê o stream e faz JSON.parse na mão.
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
  // CORS (ok para seu caso)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Healthcheck no browser
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      route: "/api/upload",
      hasToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    });
  }

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const body = await readJsonBody(req);

    const jsonResponse = await handleUpload({
      request: req,
      body,
      token: process.env.BLOB_READ_WRITE_TOKEN,

      onBeforeGenerateToken: async (pathname) => {
        return {
          maximumSizeInBytes: 25 * 1024 * 1024, // 25MB
          allowedContentTypes: ["video/mp4", "video/webm", "video/quicktime"],
        };
      },

      onUploadCompleted: async ({ blob }) => {
        console.log("Upload completo:", blob?.url);
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (e) {
    console.error("upload error:", e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
