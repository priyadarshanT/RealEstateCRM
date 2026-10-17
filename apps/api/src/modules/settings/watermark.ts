import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

// Watermark rendering (Global Configuration › General › Watermark), done on the server with local libraries:
// sharp for images, pdf-lib for PDFs. No outside service.

export interface WatermarkStyle {
  kind: 'text' | 'logo';
  text: string;
  /** 5–80 (percent). */
  opacity: number;
  position: 'center' | 'tiled' | 'bottom_right' | 'top_left';
  /** PNG of the company logo (kind = logo). */
  logo?: Buffer;
}

export const WATERMARK_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Image with the watermark drawn over it (same format). */
export async function watermarkImage(body: Buffer, mimeType: string, style: WatermarkStyle): Promise<Buffer> {
  const img = sharp(body, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  // EXIF orientations 5–8 swap width and height once the image is turned upright.
  const turned = (meta.orientation ?? 1) >= 5;
  const width = (turned ? meta.height : meta.width) ?? 1000;
  const height = (turned ? meta.width : meta.height) ?? 1000;
  const overlay = Buffer.from(await overlaySvg(width, height, style));
  const out = img.composite([{ input: overlay, top: 0, left: 0 }]);
  if (mimeType === 'image/png') return out.png().toBuffer();
  if (mimeType === 'image/webp') return out.webp().toBuffer();
  return out.jpeg({ quality: 90 }).toBuffer();
}

/** SVG the size of the image with the text or logo at the chosen place. */
async function overlaySvg(width: number, height: number, style: WatermarkStyle): Promise<string> {
  const alpha = style.opacity / 100;
  const short = Math.min(width, height);
  let mark: (x: number, y: number, anchor: 'start' | 'middle' | 'end', rotate?: number) => string;
  let markWidth: number;
  let markHeight: number;
  if (style.kind === 'logo' && style.logo) {
    const logoW = Math.round(short * (style.position === 'tiled' ? 0.18 : 0.28));
    const resized = await sharp(style.logo).resize({ width: logoW }).png().toBuffer();
    const h = (await sharp(resized).metadata()).height ?? logoW;
    const href = `data:image/png;base64,${resized.toString('base64')}`;
    markWidth = logoW;
    markHeight = h;
    mark = (x, y, anchor, rotate = 0) => {
      const left = anchor === 'middle' ? x - logoW / 2 : anchor === 'end' ? x - logoW : x;
      return `<image href="${href}" x="${left}" y="${y - h}" width="${logoW}" height="${h}" opacity="${alpha}" transform="rotate(${rotate} ${x} ${y - h / 2})"/>`;
    };
  } else {
    const size = Math.max(14, Math.round(short * (style.position === 'tiled' ? 0.045 : 0.06)));
    markWidth = size * 0.6 * style.text.length;
    markHeight = size;
    mark = (x, y, anchor, rotate = 0) =>
      `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="#ffffff" fill-opacity="${alpha}" stroke="#000000" stroke-opacity="${alpha * 0.6}" stroke-width="${Math.max(1, size / 18)}" transform="rotate(${rotate} ${x} ${y})">${esc(style.text)}</text>`;
  }
  const pad = Math.round(short * 0.04);
  let body: string;
  if (style.position === 'center') body = mark(width / 2, height / 2 + markHeight / 2, 'middle');
  else if (style.position === 'top_left') body = mark(pad, pad + markHeight, 'start');
  else if (style.position === 'bottom_right') body = mark(width - pad, height - pad, 'end');
  else {
    const stepX = Math.max(markWidth * 1.6, width / 4);
    const stepY = Math.max(markHeight * 4, height / 5);
    const marks: string[] = [];
    for (let y = stepY / 2; y < height + stepY; y += stepY) for (let x = stepX / 2; x < width + stepX; x += stepX) marks.push(mark(x, y, 'middle', -30));
    body = marks.join('');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;
}

/** PDF with the watermark on every page. */
export async function watermarkPdf(body: Buffer, style: WatermarkStyle): Promise<Buffer> {
  const pdf = await PDFDocument.load(body, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = style.kind === 'logo' && style.logo ? await pdf.embedPng(await sharp(style.logo).png().toBuffer()) : undefined;
  const opacity = style.opacity / 100;
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const short = Math.min(width, height);
    const tiled = style.position === 'tiled';
    const draw = (cx: number, cy: number, rotate: number) => {
      if (logo) {
        const w = short * (tiled ? 0.18 : 0.28);
        const h = (logo.height / logo.width) * w;
        page.drawImage(logo, { x: cx - w / 2, y: cy - h / 2, width: w, height: h, opacity, rotate: degrees(rotate) });
        return;
      }
      const size = Math.max(10, short * (tiled ? 0.04 : 0.06));
      const w = font.widthOfTextAtSize(style.text, size);
      page.drawText(style.text, { x: cx - w / 2, y: cy - size / 3, size, font, color: rgb(0.45, 0.45, 0.45), opacity, rotate: degrees(rotate) });
    };
    const pad = short * 0.06;
    if (style.position === 'center') draw(width / 2, height / 2, 0);
    else if (style.position === 'top_left') draw(pad + short * 0.15, height - pad, 0);
    else if (style.position === 'bottom_right') draw(width - pad - short * 0.15, pad, 0);
    else for (let y = height / 8; y < height; y += height / 4) for (let x = width / 6; x < width; x += width / 3) draw(x, y, 30);
  }
  return Buffer.from(await pdf.save());
}
