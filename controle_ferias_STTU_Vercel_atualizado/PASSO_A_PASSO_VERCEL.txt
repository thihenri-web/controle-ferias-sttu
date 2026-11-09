# Controle de férias · STTU | implantação na Vercel

## Funcionalidades e regras

- Brasão da Fiscalização de Mobilidade da STTU enviado pelo solicitante, incorporado como `assets/brasao-sttu.jpg`.
- Identificação: nome completo e matrícula funcional.
- Cada servidor solicita **dois períodos de 15 dias corridos em meses diferentes**.
- 1º período: **01–15**; 2º período: **16–30** (em meses com 31 dias, o dia 31 fica fora dessas janelas).
- **Junho e dezembro** não aparecem na seleção, e **fevereiro** oferece apenas **01–15**.
- Janeiro, março, abril, maio, julho, agosto, setembro, outubro e novembro oferecem ambos os períodos.
- São **19 períodos por ano**, com **10 vagas por período**: **190 vagas de período por ano**. Uma solicitação usa duas vagas de período.
- Disponibilidade atualizada a cada 30 segundos na tela de seleção; a reserva final é transacional no Postgres.
- Uma solicitação por matrícula e por ano; comprovante e protocolo para impressão.

## Publicação recomendada: GitHub + Vercel + Neon

**Não envie o ZIP diretamente para o Vercel.** Descompacte e envie o conteúdo desta pasta, preservando as subpastas `api/` e `assets/`.

1. Em `https://github.com/new`, crie o repositório `controle-ferias-sttu` (preferencialmente **privado** por se tratar de uso institucional).
2. No repositório, em **Add file → Upload files**, envie **o conteúdo** desta pasta: `index.html`, `package.json`, `vercel.json`, `schema.sql`, `README.md`, `api/`, `assets/`. Não envie `.env` nem credenciais. Confirme o commit.
3. Em `https://vercel.com/new`, clique em **Add New → Project**, escolha **Import Git Repository** e selecione o repositório.
4. Em **Configure Project**, escolha **Framework Preset = Other**. Em **Root Directory**, use `./` quando o `index.html` estiver na raiz do repositório. Deixe as opções de Build/Output padrão e clique em **Deploy**.
5. No painel do projeto da Vercel, vá a **Storage / Marketplace → Neon Postgres → Install / Connect** e associe ao projeto **Production**. A integração costuma criar `DATABASE_URL` automaticamente. Confirme em **Settings → Environment Variables**.
6. No Neon, abra o **SQL Editor** da base do projeto e execute integralmente o conteúdo de `schema.sql`. Se o banco já tiver registros, **NÃO** apague tabelas; o script é idempotente e preserva os registros antigos.
7. Na Vercel, abra **Deployments** e faça **Redeploy** caso tenha configurado o banco após o primeiro deploy.
8. Abra `https://SEU-PROJETO.vercel.app` **sem** `?demo=1`. Cadastre uma matrícula fictícia em ambiente de testes, solicite dois períodos em meses diferentes e confira a contagem das vagas em outro navegador.

## Já tenho projeto publicado na Vercel

- Se o projeto existente estiver conectado a esse repositório do GitHub, substitua os arquivos existentes com a nova versão e faça **Commit changes**. Isso gera automaticamente um novo deploy de produção.
- Execute novamente `schema.sql` **na mesma base conectada** para atualizar regras na função `sttu_registrar_ferias`, preservando pedidos já salvos.
- Não altere `DATABASE_URL` e não exclua o banco para atualizar o site.
- Se sua publicação foi feita pela CLI em vez do GitHub, dentro da pasta extraída use `npx vercel --prod` e escolha vincular ao **projeto já existente**.

## Testar aparência sem banco

- Pode abrir `controle_ferias_STTU_demo_atualizado.html` (arquivo entregue separadamente) no navegador ou acessar o site com `?demo=1`.
- **Modo demonstração usa o armazenamento local de cada navegador e não deve ser distribuído aos servidores como sistema oficial.**

## Cuidados institucionais

- Nome e matrícula, isoladamente, **não autenticam a identidade**. Antes de uso institucional, é recomendável implementar autenticação, permissões de administrador, conformidade com LGPD, aprovação, cancelamento e auditoria.
- A implementação registra solicitações, não concede férias. A limitação de vagas impede sobrelotação, mas não certifica a identidade do solicitante.
- Se o banco antigo tiver solicitações em junho/dezembro ou no segundo período de fevereiro, elas continuam preservadas e **exigem revisão administrativa**, pois não aparecem no novo calendário.
- Cuidado com testes na base real: matrículas fictícias também consomem vagas. Ideal testar antes num banco separado.

## Estrutura

```
index.html
api/periodos.js
api/solicitar.js
assets/brasao-sttu.jpg
schema.sql
package.json
vercel.json
README.md
```
