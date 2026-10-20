# PixelLift AI Image Upscaler

Responsive web app for AI image enhancement with 1x–5x output dimensions, drag-and-drop upload, preview, and download.

## Requirements
- Node.js 18 or newer
- Replicate API token (usage may be billed by Replicate)

## Run locally
1. Extract the ZIP.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env`.
5. Add your Replicate API token to `.env` as `REPLICATE_API_TOKEN=...`.
6. Run `npm start`.
7. Open `http://localhost:3000`.

## Security
- The API token is only read by the Node.js server and must never be added to frontend code.
- Do not commit `.env` to source control.
- For production, add HTTPS, request rate limiting, authentication/quotas if needed, and scheduled cleanup for generated files.
- The demo stores generated outputs under `outputs/`; set up automatic cleanup before public deployment.

## About scale settings
The app returns exact 1x–5x output dimensions. The underlying `nightmareai/real-esrgan` model supports model scales such as 2x/3x/4x. 1x runs AI enhancement then returns to original dimensions; 5x uses 4x AI enhancement and resizes to exact 5x dimensions. So 1x and 5x are not native model scales. Image quality varies; no tool can guarantee perfect results for every image.

## Supported uploads
JPG/JPEG, PNG, WebP, TIFF. EPS/AI/PDF and video files are not image inputs for this app.
