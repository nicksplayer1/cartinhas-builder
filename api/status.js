import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

export default async function handler(req, res) {
  try {
    const id = req.query?.id;
    if (!id) return json(res, 400, { error: "Missing id" });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from("cartinhas")
      .select("id, paid, mp_init_point")
      .eq("id", id)
      .maybeSingle();

    if (error) return json(res, 500, { error: error.message });
    if (!data) return json(res, 404, { error: "Not found" });

    if (!data.paid) {
      return json(res, 200, { paid: false, checkout_url: data.mp_init_point || null });
    }

    const url = `${PUBLIC_BASE_URL}/api/view?id=${id}`;
    return json(res, 200, { paid: true, url });
  } catch (e) {
    return json(res, 500, { error: e?.message || String(e) });
  }
}
