import path from "path";
import fs from "fs";

export default async function handler(req, res) {
  const { token } = req.query;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const filePath = path.join(process.cwd(), "files", "manifestation-guide.pdf");

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=manifestation-guide.pdf");

  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);
}
