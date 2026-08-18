/**
 * supabase-keepalive
 *
 * Abre o app Egg Quality, faz login e confirma que o Supabase respondeu.
 * O objetivo nao e testar o app: e gerar trafego real no projeto Supabase
 * para que ele nao seja pausado por inatividade (limite de 7 dias no plano free).
 *
 * Variaveis de ambiente (cadastradas como GitHub Secrets):
 *   APP_URL        - opcional, default https://eggquality.lovable.app/login
 *   APP_EMAIL      - obrigatorio, e-mail de login
 *   APP_PASSWORD   - obrigatorio, senha de login
 *   SUPABASE_URL   - opcional, ex: https://xxxx.supabase.co  (ping REST de reforco)
 *   SUPABASE_ANON_KEY - opcional, chave anon publica         (ping REST de reforco)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'https://eggquality.lovable.app/login';
const EMAIL = process.env.APP_EMAIL;
const PASSWORD = process.env.APP_PASSWORD;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
// Trecho que identifica uma chamada ao Supabase. So mude isso se o projeto
// usar dominio customizado; tambem serve para testar o script localmente.
const PADRAO_SUPABASE = process.env.SUPABASE_HOST_PATTERN || '.supabase.';
// Opcional: caminho de um Chromium ja instalado na maquina. Util para rodar
// local sem baixar o browser. No GitHub Actions fica vazio e o Playwright
// usa o Chromium que ele mesmo instalou.
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || undefined;

const ARTIFACTS = path.join(__dirname, '..', 'artifacts');
const MAX_TENTATIVAS = 2;

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

/**
 * Reforco opcional: bate direto na REST API do Supabase.
 * Roda antes do browser, e um erro aqui nao derruba a execucao —
 * o login pelo navegador continua sendo o caminho principal.
 */
async function pingSupabase() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    log('Ping REST direto: pulado (SUPABASE_URL / SUPABASE_ANON_KEY nao configurados).');
    return null;
  }
  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/`, {
      method: 'GET',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    log(`Ping REST direto: HTTP ${res.status}`);
    return res.status;
  } catch (err) {
    log(`Ping REST direto falhou (nao critico): ${err.message}`);
    return null;
  }
}

async function tentarLogin(tentativa) {
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  const page = await context.newPage();

  // Registra toda chamada que sai para o Supabase — e essa a prova de que o banco acordou.
  const chamadasSupabase = [];
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes(PADRAO_SUPABASE)) {
      chamadasSupabase.push({ status: res.status(), url: url.split('?')[0] });
    }
  });

  try {
    log(`Tentativa ${tentativa}: abrindo ${APP_URL}`);
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const campoEmail = page.locator('input[type="email"]').first();
    const campoSenha = page.locator('input[type="password"]').first();
    const botaoEntrar = page.locator('button[type="submit"]').first();

    await campoEmail.waitFor({ state: 'visible', timeout: 30000 });
    log('Formulario de login carregado.');

    await campoEmail.fill(EMAIL);
    await campoSenha.fill(PASSWORD);
    log('Credenciais preenchidas. Enviando...');

    await Promise.all([
      page.waitForResponse((r) => r.url().includes(PADRAO_SUPABASE), { timeout: 45000 })
        .catch(() => null),
      botaoEntrar.click(),
    ]);

    // Da tempo do app trocar de rota e carregar os dados iniciais.
    await page.waitForTimeout(8000);

    const urlFinal = page.url();
    const saiuDoLogin = !/\/login\/?$/.test(urlFinal);
    log(`URL apos login: ${urlFinal}`);
    log(`Chamadas ao Supabase observadas: ${chamadasSupabase.length}`);
    chamadasSupabase.slice(0, 8).forEach((c) => log(`  ${c.status} ${c.url}`));

    fs.mkdirSync(ARTIFACTS, { recursive: true });
    await page.screenshot({
      path: path.join(ARTIFACTS, `tentativa-${tentativa}.png`),
      fullPage: false,
    });

    const autenticou = chamadasSupabase.some((c) => c.status >= 200 && c.status < 400);

    if (!autenticou) {
      throw new Error(
        'Nenhuma resposta bem-sucedida do Supabase foi observada. ' +
        'O login provavelmente falhou (credenciais alteradas?) ou o projeto ja esta pausado.'
      );
    }
    if (!saiuDoLogin) {
      throw new Error(
        `Ainda na tela de login apos o envio (${urlFinal}). Credenciais invalidas ou UI mudou.`
      );
    }

    log('OK: login concluido e Supabase respondeu.');
    return { urlFinal, chamadas: chamadasSupabase.length };
  } finally {
    await browser.close();
  }
}

(async () => {
  if (!EMAIL || !PASSWORD) {
    console.error('ERRO: os secrets APP_EMAIL e APP_PASSWORD precisam estar configurados no repositorio.');
    process.exit(1);
  }

  await pingSupabase();

  let ultimoErro;
  for (let i = 1; i <= MAX_TENTATIVAS; i++) {
    try {
      const r = await tentarLogin(i);
      log(`Keepalive concluido com sucesso (${r.chamadas} chamadas ao Supabase).`);
      process.exit(0);
    } catch (err) {
      ultimoErro = err;
      log(`Tentativa ${i} falhou: ${err.message}`);
      if (i < MAX_TENTATIVAS) {
        log('Aguardando 15s antes de tentar de novo...');
        await new Promise((r) => setTimeout(r, 15000));
      }
    }
  }

  console.error(`FALHA: o keepalive nao conseguiu acordar o Supabase. Ultimo erro: ${ultimoErro.message}`);
  process.exit(1);
})();

