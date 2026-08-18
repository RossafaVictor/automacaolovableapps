# automacaolovableapps

Rotina agendada que faz login no [Egg Quality](https://eggquality.lovable.app) duas vezes por
semana para que o projeto Supabase **não seja pausado por inatividade**.

No plano free, o Supabase pausa projetos que ficam **7 dias sem receber requisições**. Abrir a
tela de login não basta — ela é estática e não conversa com o banco. Só o login efetivo dispara
chamadas ao Supabase. Por isso a rotina faz o login de verdade, num Chromium headless.

## Como funciona

| | |
|---|---|
| **Quando roda** | Segunda e quinta, 06:00 (horário de Brasília) |
| **Intervalo máximo** | 4 dias — folga confortável contra o limite de 7 |
| **Duração** | ~1 a 2 minutos por execução |
| **Custo** | ~16 min/mês da cota de 2.000 min do plano free |

A cada execução o script:

1. Abre `https://eggquality.lovable.app/login` num Chromium headless
2. Preenche e-mail e senha (lidos dos Secrets, nunca do código)
3. Clica em **Entrar** e espera a resposta do Supabase
4. Confirma que saiu da tela de login **e** que o Supabase respondeu com sucesso
5. Grava a data em `logs/ultima-execucao.txt` e commita

Se qualquer etapa falhar, a Action falha, o GitHub te manda um e-mail e um screenshot do momento
do erro fica anexado à execução por 5 dias.

## Configuração

### 1. Repositório

Já está tudo aqui, na branch `main`. Nada a fazer neste passo.

### 2. Cadastrar os Secrets  ← **você precisa fazer isto**

Em **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Obrigatório | Valor |
|---|---|---|
| `APP_EMAIL` | sim | E-mail de login no Egg Quality |
| `APP_PASSWORD` | sim | Senha desse usuário |
| `SUPABASE_URL` | não | `https://xxxxx.supabase.co` — ativa um ping REST extra |
| `SUPABASE_ANON_KEY` | não | Chave `anon` do projeto — idem |

Os dois últimos são um reforço: batem direto na API do Supabase antes de abrir o navegador. Se o
login pela interface quebrar um dia (mudança de layout, por exemplo), esse ping sozinho já
mantém o projeto acordado. Vale a pena configurar.

Se quiser apontar para outra URL, crie a *variable* (não secret) `APP_URL`.

### 3. Testar antes de confiar

Vá em **Actions → Supabase Keepalive → Run workflow**. A execução manual usa exatamente o mesmo
caminho da agendada. Se ficar verde, está pronto.

> O cron do GitHub só começa a valer depois que o workflow está na branch padrão. A primeira
> execução agendada pode atrasar alguns minutos — em horários de pico o GitHub enfileira jobs
> agendados.

## Rodando na sua máquina

```bash
npm install
npx playwright install chromium
APP_EMAIL="seu@email.com" APP_PASSWORD="sua-senha" npm run keepalive
```

Se já tiver um Chromium instalado, aponte `CHROMIUM_PATH=/caminho/do/chrome` e pule o
`playwright install`.

## Manutenção

**Se o login do app mudar de layout**, ajuste os seletores em `scripts/keepalive.js`. Hoje ele usa
`input[type="email"]`, `input[type="password"]` e `button[type="submit"]` — genéricos de propósito,
resistem a mudanças de texto e de CSS.

**Se você trocar a senha do usuário**, atualize o secret `APP_PASSWORD` no mesmo dia. Sem isso a
rotina falha silenciosamente até você reparar no e-mail do GitHub.

**Use um usuário dedicado.** O ideal é criar no Egg Quality um usuário só para esta rotina, com
permissão mínima de leitura, em vez de usar a conta de administrador. Se o secret vazar algum dia,
o estrago é muito menor.

**Workflows agendados são desativados após 60 dias sem atividade no repositório** — por isso o
job commita `logs/ultima-execucao.txt` a cada execução bem-sucedida. Não remova esse passo.

