require("dotenv").config();
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 15);
const ROOT = __dirname;
const UPLOADS = path.join(ROOT, "uploads");
const OUTPUTS = path.join(ROOT, "outputs");

async function ensureDirs() {
  await fs.mkdir(UPLOADS, { recursive: true });
  await fs.mkdir(OUTPUTS, { recursive: true });
}
ensureDirs();

app.use(express.static(path.join(ROOT, "public")));
app.use("/outputs", express.static(OUTPUTS, {
  setHeaders(res) { res.setHeader("Cache-Control", "no-store"); }
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/tiff"];
    cb(allowed.includes(file.mimetype) ? null : new Error("Use JPG, PNG, WebP, or TIFF images."), allowed.includes(file.mimetype));
  }
});

async function callReplicate(imageDataUrl, scale) {
  if (!process.env.REPLICATE_API_TOKEN) {
    const e = new Error("Server API key is missing. Add REPLICATE_API_TOKEN to your .env file.");
    e.status = 503; throw e;
  }
  const response = await fetch("https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
      "Prefer": "wait=60"
    },
    body: JSON.stringify({ input: { image: imageDataUrl, scale, face_enhance: false } })
  });
  let prediction;
  try { prediction = await response.json(); } catch { prediction = {}; }
  if (!response.ok) {
    throw new Error(prediction.detail || prediction.error || `AI provider error (${response.status})`);
  }
  // Prefer-wait can still return a running prediction, so poll until it completes.
  let tries = 0;
  while (prediction.status === "starting" || prediction.status === "processing") {
    if (++tries > 40) throw new Error("AI processing timed out. Please try a smaller image.");
    await new Promise(r => setTimeout(r, 1500));
    const poll = await fetch(prediction.urls?.get, {
      headers: { "Authorization": `Bearer ${process.env.REPLICATE_API_TOKEN}` }
    });
    prediction = await poll.json();
    if (!poll.ok) throw new Error(prediction.detail || "Could not check AI processing status.");
  }
  if (prediction.status !== "succeeded") {
    throw new Error(prediction.error || "AI upscaling failed. Please try another image.");
  }
  const output = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!output || typeof output !== "string") throw new Error("AI provider returned no image.");
  const imageResponse = await fetch(output);
  if (!imageResponse.ok) throw new Error("Could not download the processed image.");
  return Buffer.from(await imageResponse.arrayBuffer());
}

app.post("/api/upscale", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Please choose an image first." });
    const multiplier = Number(req.body.multiplier);
    if (![1, 2, 3, 4, 5].includes(multiplier)) {
      return res.status(400).json({ error: "Choose a scale from 1x to 5x." });
    }

    const metadata = await sharp(req.file.buffer, { limitInputPixels: 100000000 }).metadata();
    if (!metadata.width || !metadata.height) return res.status(400).json({ error: "This image could not be read." });

    // The AI model natively supports 2x/3x/4x. For 1x and 5x, enhance at 4x
    // then resize to the requested dimensions. This keeps exact output dimensions,
    // but 1x is an enhancement at original size and 5x includes a final resize.
    const aiScale = multiplier === 1 ? 2 : (multiplier === 5 ? 4 : multiplier);
    const inputMime = req.file.mimetype === "image/png" ? "image/png" :
      req.file.mimetype === "image/webp" ? "image/webp" :
      req.file.mimetype === "image/tiff" ? "image/tiff" : "image/jpeg";
    const dataUrl = `data:${inputMime};base64,${req.file.buffer.toString("base64")}`;
    const aiBuffer = await callReplicate(dataUrl, aiScale);

    const targetWidth = Math.min(Math.round(metadata.width * multiplier), 16000);
    const targetHeight = Math.min(Math.round(metadata.height * multiplier), 16000);
    const ext = (req.body.format === "png" || inputMime === "image/png") ? "png" : "jpg";
    let pipeline = sharp(aiBuffer).resize(targetWidth, targetHeight, { fit: "fill", kernel: sharp.kernel.lanczos3 });
    pipeline = ext === "png" ? pipeline.png({ compressionLevel: 8 }) : pipeline.jpeg({ quality: 94, mozjpeg: true });
    const result = await pipeline.toBuffer();
    const id = crypto.randomUUID();
    const filename = `${id}.${ext}`;
    await fs.writeFile(path.join(OUTPUTS, filename), result);
    res.json({
      ok: true,
      url: `/outputs/${filename}`,
      filename: `upscaled-${multiplier}x.${ext}`,
      original: { width: metadata.width, height: metadata.height },
      output: { width: targetWidth, height: targetHeight },
      multiplier,
      note: multiplier === 1
        ? "AI-enhanced at original dimensions."
        : multiplier === 5
          ? "AI-enhanced then resized to exact 5x dimensions."
          : `AI-enhanced using ${multiplier}x model scale.`
    });
  } catch (err) {
    const message = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
      ? `Image is too large. Maximum size is ${MAX_MB} MB.`
      : (err.message || "Something went wrong.");
    res.status(err.status || 500).json({ error: message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use((err, _req, res, _next) => res.status(400).json({ error: err.message || "Upload failed." }));

app.listen(PORT, () => console.log(`AI Image Upscaler running at http://localhost:${PORT}`));