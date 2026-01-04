import { handleUpload } from "@vercel/blob/client";

async function readJsonBody(req) {
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
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-vercel-signature, x-vercel-blob-signature"
  );

  // Healthcheck
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      route: "/api/upload",
      hasToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    });
  }

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = await readJsonBody(req);

    const jsonResponse = await handleUpload({
      request: req,
      body,
      token: process.env.BLOB_READ_WRITE_TOKEN,

      onBeforeGenerateToken: async (pathname /*, clientPayload */) => {
        // Regras por pasta (precisa bater com o "folder" do seu index):
        // - cartinhas/videos/...           => apenas vídeo
        // - cartinhas/bo-evidencias/...    => foto/áudio/vídeo
        // - cartinhas/pedido-oficial/...   => foto/áudio/vídeo
        // - cartinhas/contrato-amor/...    => foto/áudio/vídeo  ✅ (NOVO)
        const inFolder = (folder) =>
          pathname.includes(`/${folder}/`) || pathname.startsWith(`cartinhas/${folder}/`);

        const isVideoFolder = inFolder("videos");
        const isBoFolder = inFolder("bo-evidencias");
        const isPedidoOficialFolder = inFolder("pedido-oficial");
        const isContratoAmorFolder = inFolder("contrato-amor");

        if (isVideoFolder) {
          return {
            maximumSizeInBytes: 25 * 1024 * 1024, // 25MB
            allowedContentTypes: [
              "video/mp4",
              "video/webm",
              "video/quicktime",
              "video/x-m4v",
            ],
          };
        }

        // Pastas que aceitam mídia completa (imagem/áudio/vídeo)
        if (isBoFolder || isPedidoOficialFolder || isContratoAmorFolder) {
          return {
            maximumSizeInBytes: 25 * 1024 * 1024, // 25MB
            allowedContentTypes: [
              // imagens
              "image/png",
              "image/jpeg",
              "image/jpg",
              "image/webp",
              "image/gif",
              "image/avif",
              "image/heic",
              "image/heif",

              // áudios
              "audio/mpeg",
              "audio/mp3",
              "audio/wav",
              "audio/ogg",
              "audio/webm",
              "audio/aac",
              "audio/mp4",

              // vídeos
              "video/mp4",
              "video/webm",
              "video/quicktime",
              "video/x-m4v",
            ],
          };
        }

        // Qualquer outra pasta: bloqueia por segurança
        return {
          maximumSizeInBytes: 1,
          allowedContentTypes: [],
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
