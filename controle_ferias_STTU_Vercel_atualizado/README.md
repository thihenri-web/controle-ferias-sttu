# Atualização de datas administrativas — STTU 2027

**ATUALIZAÇÃO DO PROJETO EXISTENTE.** Os dois novos arquivos importantes são `schema_atualizacao_datas_periodos.sql` e `api/admin-datas.js`.

Leia `README_ATUALIZACAO_DATAS.txt` para a ordem segura de publicação (Neon → GitHub → Vercel).

A administração pode agora cadastrar, editar e limpar as datas de cada período de 15 dias. As datas são opcionais: sem cadastro, o site exibe **Datas a definir**. A inclusão ou alteração preserva solicitações anteriores e registra histórico. O prazo de 45 dias permanece contado desde o dia 1º do mês.

O rodapé das duas páginas mostra **Desenvolvido por THIAGO HENRIQUE FERREIRA DA SILVA**.

---

# STTU — Controle de férias 2027 · Períodos e vagas administráveis

Projeto para **Vercel + Neon**, com o cadastro existente de 114 servidores. Este pacote é uma **atualização do projeto atual**, não requer criação de outro projeto, banco ou senha.

## O que mudou

**Regra atualizada:** o administrador pode configurar **de 1 a 30 vagas em cada período**. Todos os períodos começam com **10 vagas por padrão**. Não é permitido reduzir abaixo da quantidade já ocupada. O ajuste é independente por mês, período e ano.

- As telas dos servidores **não mostram mais datas fixas de início/fim**. Os cards mostram apenas **1º período** e **2º período**, cada um com **15 dias** e datas a definir.
- Saiu a numeração decorativa dos meses (`01 / 12`, `03 / 12` etc.).
- A área administrativa mostra **todos os 12 meses**, com botão **Liberar/Bloquear** e campo **Limite de vagas** para cada um dos dois períodos mensais. O administrador pode reduzir 10 para 8 ou aumentar até 30.
- A administração pode, por exemplo, liberar **junho · 1º período**, bloquear **maio · 2º período** e definir **janeiro · 1º período com 8 vagas**. A quantidade de períodos liberados e de vagas é recalculada automaticamente.
- Ao bloquear um período, o sistema impede **novas escolhas** nele, **sem cancelar os pedidos antigos**. A alteração fica registrada em tabela de auditoria do Neon.
- A configuração é **por ano**. Os anos futuros só aparecem aos servidores quando liberados na administração.
- A regra de **45 dias de antecedência do primeiro dia do mês** continua ativa. Exceção: janeiro de 2027 até 31/12/2026. Essa regra é independente das datas específicas dos 15 dias, que ainda serão definidas.
- A capacidade inicial é **10 vagas por período**, editável de **1 a 30**, **dois períodos obrigatórios em meses diferentes**, matrícula pré-cadastrada, uma solicitação por matrícula/ano e consulta administrativa por mês/servidor.

**Situação inicial de 2027:** 19 períodos liberados (10 vagas cada), com junho e dezembro sem períodos, e fevereiro com apenas o 1º. Esses são **padrões iniciais editáveis** pelo administrador, não restrições fixas.

- O sistema **não aceita uma capacidade menor que a ocupação atual**. Um período com 7 solicitações pode ser ajustado para qualquer número de 7 a 30 vagas; para menos de 7, é preciso cancelar solicitações antes.
- O registro de reserva respeita a capacidade personalizada **diretamente no Neon**, incluindo solicitações simultâneas. A migração também amplia a antiga restrição de ocupação da tabela `sttu_ferias_vagas` (antes limitada fisicamente a 10) para 30.
- Ajustes de capacidade ficam registrados em **Histórico administrativo**.

## ATUALIZAÇÃO DO SEU SISTEMA JÁ PUBLICADO — ORDEM EXATA

### 1. Neon — executar APENAS o novo SQL combinado

1. Entre em https://console.neon.tech/ e abra o projeto conectado à Vercel.
2. Abra **SQL Editor**, branch **main** e banco **neondb** (confira os nomes no seu projeto).
3. Faça um backup / branch de segurança se já houver solicitações reais.
4. Abra no Bloco de Notas **`schema_atualizacao_periodos_e_vagas.sql`** (neste pacote). Esse SQL já contém a atualização dos períodos flexíveis e a nova função de capacidade, independentemente de você já ter executado a migração anterior.
5. Copie todo o código, cole em uma **nova consulta** no Neon e clique **Run**.
6. Confira que os comandos terminaram sem erros.

**Não rode novamente** `schema.sql`, `schema_atualizacao_admin_e_servidores.sql`, `schema_atualizacao_periodos_flexiveis.sql` nem a lista antiga de servidores. O arquivo `schema_atualizacao_capacidades.sql` é uma alternativa menor para quem JÁ executou a migração anterior; você não precisa executá-lo junto ao combinado. Os 114 servidores e as vagas já cadastradas são preservados.

Verificação opcional no SQL Editor (consulta nova, separada):

```sql
SELECT mes, periodo, liberado, capacidade
FROM sttu_ferias_periodos_config
WHERE ano = 2027
ORDER BY mes, periodo;
```

Devem retornar **24 linhas** (12 meses × 2 períodos), com `capacidade = 10` inicialmente em todos os períodos; os 19 liberados inicialmente podem mudar pela administração. O total pode mudar quando o administrador fizer alterações.

### 2. GitHub — substituir os arquivos do projeto existente

1. Extraia o ZIP no Windows.
2. No GitHub, entre no repositório atual `controle-ferias-sttu`.
3. Abra a pasta configurada como **Root Directory** da Vercel (nas configurações anteriores: `controle_ferias_STTU_Vercel_atualizado`).
4. Envie **o conteúdo** da pasta extraída (não envie o ZIP nem crie outra subpasta), preservando `index.html`, `admin.html`, `api/`, `lib/`, `assets/` no mesmo nível.
5. Confirme **Commit changes**. Observe se foi criado o arquivo novo **`api/admin-periodos.js`** e **`api/admin-capacidade.js`**. A pasta `api` deve ser minúscula.

### 3. Vercel — publicar

1. Abra o projeto existente em https://vercel.com/dashboard.
2. Na aba **Deployments**, confira a nova implantação da branch principal e o status **Ready**.
3. Se não houver nova implantação, abra os detalhes e verifique a origem GitHub. Não altere o Root Directory se o site já funciona.
4. **Não é preciso cadastrar senhas novamente**: `DATABASE_URL`, `ADMIN_PASSWORD` e `ADMIN_SESSION_SECRET` já estão configuradas para Production.

### 4. Verificação funcional

1. Acesse `https://SEU-SITE.vercel.app/admin.html` e entre com a senha administrativa atual (não é necessário trocar senhas).
2. Confira a nova seção **Disponibilidade dos períodos por mês**. Ela deve mostrar 12 meses × 2 períodos.
3. Teste, por exemplo, a liberação do **1º período de junho** e confirme a mudança. Observe o total de períodos liberados passar de 19 para 20. Se não quiser manter, bloqueie novamente para retornar a 19.
4. Na área administrativa, altere **janeiro · 1º período de 10 para 8** e confirme no painel que aparecem 8 vagas e na página do servidor também. Caso tenha feito teste, restaure o limite para 10. Você também pode testar aumentar para 20, até o máximo de 30. Se o período tiver mais de 8 solicitações, o sistema deverá impedir a redução.
5. Na página dos servidores, atualize a página e confirme que junho responde ao comando administrativo. As datas específicas e a numeração `01 / 12` não devem aparecer.
6. Teste a busca por um servidor cadastrado. Evite gravar pedidos fictícios na produção.

## Arquivos principais

- `index.html` — página dos servidores com calendário sem datas específicas.
- `admin.html` — área administrativa e controles individuais de períodos.
- `api/periodos.js` — disponibilidades e capacidade calculadas do banco.
- `api/admin-dados.js` — dados de consulta e configuração para administração.
- `api/admin-periodos.js` — alteração autenticada de cada período.
- `api/admin-capacidade.js` — alteração autenticada da lotação por período, com validação transacional.
- `api/solicitar.js` — recebe solicitações e usa validações do banco.
- `schema_atualizacao_periodos_e_vagas.sql` — **migração combinada recomendada para esta atualização**.
- `schema_atualizacao_capacidades.sql` — migração apenas de capacidade, se os períodos flexíveis já estiverem implementados.
- `schema.sql` — estrutura completa para **banco novo**, não use no banco existente.

## Observações

- A escolha continua exigindo dois **meses diferentes**, mesmo que um mesmo mês tenha dois períodos liberados.
- O bloqueio de um período com solicitações existentes impede novas escolhas, mas não devolve vagas. Para devolver vagas, é necessário um cancelamento administrativo da solicitação específica, conforme o sistema atual.
- Os saldos de vagas e o bloqueio dos períodos são validados **também no Neon**, não apenas no HTML.
- O calendário **não define datas específicas** de início e fim do gozo dos 15 dias. O prazo administrativo dos 45 dias foi preservado conforme solicitado anteriormente.
- Nome e matrícula não comprovam identidade; antes do uso institucional amplo, é recomendado autenticar os servidores e adotar práticas de proteção de dados pessoais.
- A conexão com seu Neon/Vercel de produção não pode ser testada pelo pacote local; faça os testes descritos depois da publicação.
