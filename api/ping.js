module.exports = (req, res) => {
  res.status(200).json({ ok: true, where: "api/ping.js" });
};
