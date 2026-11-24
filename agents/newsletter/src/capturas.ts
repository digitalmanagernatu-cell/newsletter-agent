import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export interface Capturas { escritorio: Buffer; movil: Buffer }

/** Capturas de escritorio (600 px) y móvil (375 px). Usa el Chromium del sistema o PLAYWRIGHT_EXECUTABLE_PATH. */
export async function capturar(html: string, escala = 1): Promise<Capturas> {
  const { chromium } = require('playwright');
  const navegador = await chromium.launch(
    process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {},
  );
  try {
    const foto = async (ancho: number) => {
      const p = await navegador.newPage({ viewport: { width: ancho, height: 900 }, deviceScaleFactor: escala });
      await p.setContent(html, { waitUntil: 'networkidle', timeout: 45_000 });
      const buf = await p.screenshot({ fullPage: true, type: 'png' });
      await p.close();
      return buf as Buffer;
    };
    return { escritorio: await foto(680), movil: await foto(375) };
  } finally {
    await navegador.close();
  }
}
