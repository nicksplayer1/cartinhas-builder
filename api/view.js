 import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "cartinha";

export default async function handler(req, res) {
  try {
    const id = req.query?.id;
    if (!id) {
      res.statusCode = 400;
      return res.end("Missing id");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: row, error } = await supabase
      .from("cartinhas")
      .select("paid, storage_html_path")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      res.statusCode = 500;
      return res.end(error.message);
    }
    if (!row) {
      res.statusCode = 404;
      return res.end("Not found");
    }
    if (!row.paid) {
      res.statusCode = 402;
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.end(`
        <doctype html>
        <meta charset="utf-8"/>
        <title>Pagamento pendente</title>
        <body style="font-family:system-ui;background:#0b1020;color:#fff;padding:30px">
          <h2>Pagamento pendente</h2>
          <p>Essa cartinha só abre depois que o pagamento for confirmado.</p>
        </body>
      `);
    }

    const path = row.storage_html_path;
    const dl = await supabase.storage.from(SUPABASE_BUCKET).download(path);

    if (dl.error) {
      res.statusCode = 500;
      return res.end(`Storage download error: ${dl.error.message}`);
    }

    const buf = Buffer.from(await dl.data.arrayBuffer());
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-cache");
    return res.end(buf);
  } catch (e) {
    res.statusCode = 500;
    return res.end(e?.message || String(e));
  }
}

