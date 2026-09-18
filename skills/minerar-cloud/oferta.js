// Aprofunda um card específico encontrado pelo biblioteca.js: abre a página
// de detalhe do anúncio na Biblioteca de Anúncios (por ID) e devolve o texto
// completo pra quem for validar/modelar a oferta ler com calma.
//
// Uso:
//   CHROME=/opt/pw-browsers/chromium IGNORAR_TLS=1 node oferta.js \
//     --id 123456789012345 --saida /home/user/scratch/oferta-123.json

const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = { id: null, saida: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--id") args.id = argv[++i];
    else if (a === "--saida") args.saida = argv[++i];
  }
  return args;
}

function encontrarChromeWindows() {
  const candidatos = [
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["LOCALAPPDATA"] || "", "Google\\Chrome\\Application\\chrome.exe"),
  ];
  return candidatos.find((p) => p && fs.existsSync(p)) || null;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id) {
    console.error("Uso: node oferta.js --id <ID da biblioteca> --saida out.json");
    process.exit(1);
  }

  const executablePath = process.env.CHROME || encontrarChromeWindows();
  if (!executablePath) {
    throw new Error("Nenhum Chrome/Chromium encontrado. Defina a variável CHROME.");
  }

  const url = `https://www.facebook.com/ads/library/?id=${encodeURIComponent(args.id)}`;

  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: process.env.IGNORAR_TLS === "1",
  });
  const page = await context.newPage();

  let textoPagina = "";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);
    textoPagina = await page.evaluate(() => document.body.innerText);
  } finally {
    await context.close();
    await browser.close();
  }

  const resultado = { id: args.id, url, textoPagina };
  console.log(`Oferta ${args.id}: ${textoPagina.length} caracteres lidos.`);

  if (args.saida) {
    fs.mkdirSync(path.dirname(args.saida), { recursive: true });
    fs.writeFileSync(args.saida, JSON.stringify(resultado, null, 2), "utf-8");
    console.log(`Salvo em: ${args.saida}`);
  } else {
    console.log(textoPagina);
  }
})().catch((err) => {
  console.error("Erro ao abrir oferta:", err);
  process.exit(1);
});
