import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://cartinhas-builder.vercel.app").replace(/\/+$/, "");

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!token) {
    res.statusCode = 400;
    return res.end("Missing token");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from("cartinhas")
    .select("id")
    .eq("recovery_token", token)
    .single();

  if (error || !data?.id) {
    res.statusCode = 404;
    return res.end("Invalid token");
  }

  const viewUrl = `${PUBLIC_BASE_URL}/api/view?id=${data.id}`;
  res.statusCode = 302;
  res.setHeader("Location", viewUrl);
  res.end();
}
