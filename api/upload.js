import { handleUpload } from "@vercel/blob/client";

export default async function handler(req, res) {
  // CORS básico (ajuda se você testar em domínio diferente)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    // IMPORTANTE:
    // - o token admin (BLOB_READ_WRITE_TOKEN) fica SÓ no server (env var)
    // - handleUpload gera tokens temporários pro browser enviar o arquivo direto pro Blob
    const jsonResponse = await handleUpload({
      request: req,
      body: req.body,
      token: process.env.BLOB_READ_WRITE_TOKEN,

      onBeforeGenerateToken: async (pathname) => {
        return {
          // 25MB
          maximumSizeInBytes: 25 * 1024 * 1024,
          // formatos comuns (mp4/webm/mov)
          allowedContentTypes: ["video/mp4", "video/webm", "video/quicktime"],
          // opcional: pode validar pathname/nome aqui também
        };
      },

      onUploadCompleted: async ({ blob }) => {
        // Aqui você poderia salvar em DB se quisesse.
        // Para o teu caso, não precisa — você vai usar blob.url no HTML da cartinha.
        console.log("Upload completo:", blob?.url);
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (e) {
    console.error("upload error:", e);
    return res.status(400).json({ error: e?.message || String(e) });
  }
}
