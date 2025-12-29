 module.exports = async function handler(req, res) {
  // CORS básico
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) return res.status(500).json({ error: "Missing BLOB_READ_WRITE_TOKEN env var" });

    // Import dinâmico funciona mesmo se o projeto estiver em CommonJS
    const { handleUpload } = await import("@vercel/blob/client");

    const jsonResponse = await handleUpload({
      request: req,
      body: req.body,
      token,

      onBeforeGenerateToken: async () => ({
        maximumSizeInBytes: 25 * 1024 * 1024, // 25MB
        allowedContentTypes: ["video/mp4", "video/webm", "video/quicktime"],
      }),

      onUploadCompleted: async ({ blob }) => {
        console.log("Upload completo:", blob?.url);
      },
    });

    return res.status(200).json(jsonResponse);
  } catch (e) {
    console.error("upload error:", e);
    return res.status(400).json({ error: e?.message || String(e) });
  }
};

