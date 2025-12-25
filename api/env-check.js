export default function handler(req, res) {
  res.status(200).json({
    hasMpToken: Boolean(process.env.MP_ACCESS_TOKEN),
    mpTokenPrefix: process.env.MP_ACCESS_TOKEN
      ? process.env.MP_ACCESS_TOKEN.slice(0, 8)
      : null,
    node: process.version,
  });
}
