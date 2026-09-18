// Minerador em lote da Biblioteca de Anúncios da Meta, feito para rodar num
// sandbox Linux (cloud). Diferente do navegador.js local (Chrome do Windows,
// uma keyword de cada vez, dump bruto pra leitura manual), este script:
//   - roda várias keywords em paralelo (limite --paralelo)
//   - separa o texto da página em "cards" usando o marcador
//     "Identificação da biblioteca:" (mesmo marcador que o skill "minerar"
//     local já usa pra filtrar manualmente)
//   - salva um JSON estruturado, não só texto bruto
//
// Uso:
//   CHROME=/opt/pw-browsers/chromium IGNORAR_TLS=1 node biblioteca.js \
//     --pais BR --paralelo 2 --saida /home/user/scratch/bib.json "keyword 1" "keyword 2"
//
// Variáveis de ambiente:
//   CHROME       caminho do executável do Chromium (obrigatório no sandbox;
//                se ausente, tenta o Chrome do Windows como o navegador.js local)
//   IGNORAR_TLS  se "1", ignora erro de certificado (proxy do sandbox que
//                reassina TLS)

const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = { pais: "BR", paralelo: 2, saida: null, keywords: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pais") args.pais = argv[++i];
    else if (a === "--paralelo") args.paralelo = parseInt(argv[++i], 10);
    else if (a === "--saida") args.saida = argv[++i];
    else args.keywords.push(a);
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

function montarUrlBiblioteca(keyword, pais) {
  const params = new URLSearchParams({
    active_status: "active",
    ad_type: "all",
    country: pais,
    q: `"${keyword}"`,
    search_type: "keyword_unordered",
    media_type: "all",
  });
  return `https://www.facebook.com/ads/library/?${params.toString()}`;
}

// Separa o texto bruto da página em cards usando o marcador que a Meta
// repete por anúncio. Cada card também costuma ter "Patrocinado" e o texto
// do anúncio antes do marcador de ID.
function extrairCards(textoPagina) {
  const MARCADOR = /Identifica[cç][aã]o da biblioteca:\s*(\d+)/gi;
  const cards = [];
  let match;
  let ultimoIndice = 0;
  const indices = [];
  while ((match = MARCADOR.exec(textoPagina)) !== null) {
    indices.push({ id: match[1], fim: MARCADOR.lastIndex });
  }
  indices.forEach((item, i) => {
    const inicioBloco = i === 0 ? 0 : indices[i - 1].fim;
    const bloco = textoPagina.slice(inicioBloco, item.fim);
    const precoMatch = bloco.match(/(R\$\s?\d+[\.,]?\d*|US\$\s?\d+[\.,]?\d*|\$\s?\d+[\.,]?\d*)/);
    cards.push({
      id: item.id,
      preco: precoMatch ? precoMatch[0].trim() : null,
      trechoTexto: bloco.trim().slice(-600), // últimos ~600 chars antes do ID: normalmente é o corpo do anúncio
    });
  });
  return cards;
}

async function minerarKeyword(browser, keyword, pais) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: process.env.IGNORAR_TLS === "1",
  });
  const page = await context.newPage();
  const url = montarUrlBiblioteca(keyword, pais);

  let textoPagina = "";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(4000);
    textoPagina = await page.evaluate(() => document.body.innerText);
  } finally {
    await context.close();
  }

  const cards = extrairCards(textoPagina);
  return { keyword, pais, url, cardsLidos: cards.length, cards };
}

// Pool de concorrência simples: no máximo `limite` promessas em voo por vez.
async function executarComLimite(itens, limite, fn) {
  const resultados = [];
  let indice = 0;
  async function worker() {
    while (indice < itens.length) {
      const meu = indice++;
      resultados[meu] = await fn(itens[meu]);
    }
  }
  const workers = Array.from({ length: Math.min(limite, itens.length) }, worker);
  await Promise.all(workers);
  return resultados;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.keywords.length === 0) {
    console.error('Uso: node biblioteca.js --pais BR --paralelo 2 --saida out.json "keyword 1" "keyword 2"');
    process.exit(1);
  }

  const executablePath = process.env.CHROME || encontrarChromeWindows();
  if (!executablePath) {
    throw new Error("Nenhum Chrome/Chromium encontrado. Defina a variável CHROME.");
  }

  const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const launchOptions = { executablePath, headless: true };
  if (proxyServer) launchOptions.proxy = { server: proxyServer };

  const browser = await chromium.launch(launchOptions);

  const resultados = await executarComLimite(args.keywords, args.paralelo, (kw) =>
    minerarKeyword(browser, kw, args.pais).catch((err) => ({
      keyword: kw,
      pais: args.pais,
      erro: String(err && err.message ? err.message : err),
      cardsLidos: 0,
      cards: [],
    }))
  );

  await browser.close();

  for (const r of resultados) {
    console.log(
      `keyword="${r.keyword}" pais=${r.pais} resultados=${r.cardsLidos} cards_lidos=${r.cardsLidos}` +
        (r.erro ? ` erro=${r.erro}` : "")
    );
  }

  if (args.saida) {
    fs.mkdirSync(path.dirname(args.saida), { recursive: true });
    fs.writeFileSync(args.saida, JSON.stringify(resultados, null, 2), "utf-8");
    console.log(`\nSalvo em: ${args.saida}`);
  }
})().catch((err) => {
  console.error("Erro na mineração:", err);
  process.exit(1);
});
