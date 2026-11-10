# STTU · Cadastro de servidores e férias 2027


## NOVO: Seleção por cadastro oficial de servidores

A tela inicial agora tem um campo pesquisável para selecionar **NOME - MATRÍCULA**, sem digitação livre. A relação de **114 servidores** foi transcrita da imagem enviada. Nomes visualmente truncados no quadro foram conservados como estão escritos; a matrícula é a chave única. O exemplo explícito do usuário de `THIAGO HENRIQUE FERREIRA DA SILVA - 60.275-2` foi usado com nome completo.

- A lista é fornecida pelo endpoint `GET /api/servidores`, a partir da tabela `sttu_ferias_servidores` no Neon.
- O servidor seleciona um único item; ambos os dados são carregados juntos.
- A função SQL verifica que a matrícula **está na relação ativa** e que o nome coincide com o cadastro. Não basta alterar o navegador para cadastrar matrícula desconhecida.
- As solicitações já registradas permanecem no banco; a atualização não as apaga.
- A área administrativa exibe a matrícula formatada para registros encontrados no cadastro.

### SQL para atualizar a instalação existente

Para atualizar o banco de produção que você já usa, execute **`schema_atualizacao_admin_e_servidores.sql`** no SQL Editor do Neon, antes de publicar os novos arquivos. Esse script inclui toda a migração administrativa anterior **e** o cadastro, pode ser executado novamente sem excluir reservas, e substitui a função de reserva para validar os servidores cadastrados. Se você já instalou a versão administrativa anterior, pode executar apenas `schema_atualizacao_servidores.sql`.

Confira a relação:

```sql
SELECT count(*) AS servidores_ativos FROM sttu_ferias_servidores WHERE ativo=TRUE;
```

O resultado esperado é **114**. Confira o endpoint `https://SEU-SITE.vercel.app/api/servidores` após o deploy. O formulário não ficará operacional sem a migração e o endpoint. Não retire a pasta `api` do nível do `index.html`.

**Proteção de dados:** nome e matrícula são exibidos aos usuários do formulário, conforme solicitado. A seleção de um nome não autentica o servidor. Antes da publicação institucional, avalie identificação individual (SSO ou confirmação vinculada ao cadastro), controle de acesso à relação e adequação às regras internas/LGPD.

---
# STTU · Controle de férias 2027 — versão com administração e travas de prazo

Este é o projeto **completo** da Vercel (HTML + funções Node.js + Neon). Ele **atualiza** o sistema que você já publicou: não é necessário criar um novo projeto Vercel ou um novo banco Neon.

## Regras aplicadas

- Início da campanha: **2027**. Inicialmente **somente 2027** aparece para o servidor.
- Anos **2028 em diante** somente aparecem após liberação na área administrativa. A restrição é verificada também no banco.
- Cada matrícula faz **uma única solicitação por ano**, com **dois períodos de 15 dias em meses diferentes**.
- **10 vagas por período**. Junho e dezembro não participam; fevereiro possui somente o período 01–15; demais meses autorizados têm períodos 01–15 e 16–30.
- Cada mês fecha para novas solicitações **a partir do dia seguinte à data-limite**. Data-limite = **dia 1º do mês menos 45 dias corridos**. O último dia de prazo ainda é permitido. As datas são calculadas no horário de **Natal/RN (America/Fortaleza)**.
- **Exceção:** janeiro/2027 pode ser escolhido até **31/12/2026**, inclusive. Não é possível fazer solicitação de janeiro após o início do próprio mês.
- A contagem de vagas e as validações de prazo e ano são feitas **no banco Neon**, mesmo se alguém tentar chamar a API manualmente.
- Administrador consulta reservas por **mês, período, nome completo ou matrícula**, exporta CSV para Excel, pode **cancelar** com motivo e devolução das duas vagas e **libera/bloqueia anos futuros**.
- Login administrativo protegido por senha na Vercel, cookie assinado com expiração em 8h e limitação de tentativas por IP.

### Prazos para férias de 2027

| Mês | Último dia para solicitar |
| --- | --- |
| Janeiro | 31/12/2026 (exceção) |
| Fevereiro | 18/12/2026 |
| Março | 15/01/2027 |
| Abril | 15/02/2027 |
| Maio | 17/03/2027 |
| Junho | Não disponível |
| Julho | 17/05/2027 |
| Agosto | 17/06/2027 |
| Setembro | 18/07/2027 |
| Outubro | 17/08/2027 |
| Novembro | 17/09/2027 |
| Dezembro | Não disponível |

**Observação:** As regras refletem a interpretação de que as inscrições encerram-se 45 dias antes do **primeiro dia do mês escolhido**, não do primeiro dia de cada período.

## Implantação no projeto já existente (ordem recomendada)

### 1. Configure duas variáveis na Vercel

No painel da Vercel, abra o projeto de férias, clique em **Settings → Environment Variables** e adicione, ambas para **Production**:

- `ADMIN_PASSWORD` — senha exclusiva com pelo menos **8 caracteres** (recomendamos 12 ou mais para maior segurança). Você escolhe a senha e não deve colocá-la no código nem enviar por mensagem.
- `ADMIN_SESSION_SECRET` — chave aleatória de **pelo menos 32 caracteres** (ideal: 64 caracteres hexadecimais gerados com gerador criptográfico). Não reutilize a senha administrativa.

Marque ambas como **Sensitive** (se essa opção estiver disponível). A variável `DATABASE_URL` já existe e **não precisa ser alterada**. Não coloque as senhas no GitHub.

### 2. Atualize o banco Neon, **sem excluir dados**

1. Acesse o Neon e abra seu projeto conectado à Vercel.
2. No menu **SQL Editor**, selecione a branch de produção (`main`/`primary`, conforme seu projeto) e a base usada pela Vercel (`neondb`, se esse for o nome).
3. Faça um backup ou snapshot antes da alteração, quando disponível em seu plano.
4. Abra o arquivo **`schema_atualizacao_admin.sql`** desta pasta em um editor de texto.
5. Copie todo o conteúdo, cole no SQL Editor e clique **Run**.
6. Confira que todos os comandos foram concluídos sem erros. O script **não apaga solicitações existentes**; apenas cria tabelas administrativas e atualiza a função de reservas.

⚠️ Como você **já criou** as tabelas básicas anteriormente, execute **`schema_atualizacao_admin.sql`**, não um script antigo. O arquivo `schema.sql` incluído aqui é uma **instalação completa** para um banco novo.

### 3. Atualize os arquivos no **mesmo repositório GitHub**

1. Descompacte o ZIP e entre na pasta com os arquivos.
2. No GitHub, vá ao repositório `controle-ferias-sttu` e entre na **mesma pasta que a Vercel utiliza como Root Directory**, possivelmente `controle_ferias_STTU_Vercel_atualizado` (dependendo de como você o configurou).
3. Substitua os arquivos existentes e adicione os novos. Faça o **Commit**. É preciso preservar corretamente a estrutura abaixo; `api` e `assets` devem ficar em minúsculas.
4. Se a Vercel já estiver conectada ao repositório, o novo commit costuma iniciar o deploy automaticamente. Se necessário, abra **Deployments → Redeploy**. Não mude o Root Directory se ele já está funcionando.

```text
[pasta configurada como Root Directory]
  index.html
  admin.html                 ← novo
  api/
    solicitar.js
    periodos.js
    anos.js                 ← novo
    admin-login.js          ← novo
    admin-dados.js          ← novo
    admin-anos.js           ← novo
    admin-cancelar.js       ← novo
    admin-auditoria.js      ← novo
  lib/
    admin-auth.js           ← novo
  assets/
    brasao-sttu.jpg         ← brasão exato enviado por você
  package.json
  vercel.json
  schema.sql
  schema_atualizacao_admin.sql
  README.md
```

**Não publique somente o ZIP nem coloque a pasta inteira dentro de outra pasta da raiz sem adaptar o Root Directory.** O `index.html` e `admin.html` devem estar no mesmo nível que `api/`.

### 4. Testes após o deploy

- `https://SEU-SITE.vercel.app/api/anos` deve retornar `{"anos":[2027]}` enquanto nenhum ano futuro estiver liberado.
- `https://SEU-SITE.vercel.app/api/periodos?ano=2027` deve retornar 19 períodos com os campos `restantes`, `limite` e `aberto`.
- `https://SEU-SITE.vercel.app/api/periodos?ano=2028` deve retornar uma mensagem de **ano não liberado** (403).
- `https://SEU-SITE.vercel.app/admin.html` deve abrir a página de login. Entre usando a senha `ADMIN_PASSWORD` configurada na Vercel.
- No painel, clique em um **mês** para listar servidores do mês, pesquise por matrícula, exporte a lista CSV e teste a liberação de 2028 **somente quando desejar abrir a campanha desse ano**.
- Teste cancelamentos de preferência em um banco de testes. Na produção, cancele apenas reservas identificadas corretamente; a exclusão é definitiva mas fica registrada no histórico administrativo e devolve as vagas.

### 5. Teste específico de prazo

O banco usa a data local de Natal-RN. Exemplo: março de 2027 pode ser solicitado até **15/01/2027**, inclusive, mas não em **16/01/2027**. Janeiro/2027 pode ser selecionado até 31/12/2026, independentemente de 45 dias. A tela pública mostra a data limite em cada mês.

## Limitações / cuidados

- A área administrativa usa **uma senha compartilhada** (modelo inicial), não contas individuais. Para uso institucional mais rigoroso, recomendamos identidade individual de administradores com permissões e trilha de autoria.
- O servidor ainda se identifica apenas por **nome e matrícula**, o que **não comprova sua identidade**. Antes de disponibilizar a todos, providencie autenticação oficial de servidores e política de proteção de dados.
- A área administrativa é uma **consulta e controle de solicitações**, não a homologação legal de férias.
- Não divulgue `DATABASE_URL`, `ADMIN_PASSWORD` nem `ADMIN_SESSION_SECRET`. Não inclua credenciais em prints e nunca as envie ao GitHub.
- Datas de encerramento são aplicadas apenas a novos registros. Reservas feitas anteriormente são preservadas para revisão administrativa.
- `?demo=1` é demonstração local. Não registra vagas no banco de produção.
