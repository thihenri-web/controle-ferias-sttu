# STTU — Controle de férias 2027 | Função/Turno

Atualização para o projeto **já existente** na Vercel, vinculado ao GitHub e ao banco Neon. **Não crie outro projeto**.

## O que mudou

- Cadastro oficial atualizado com **114 servidores**, seus nomes como estão no PDF, matrículas no formato **00.000-0** e coluna **Função/Turno**.
- Grupos: **Manhã, Adm, Insp, Noite, COTT, Tarde, Corujão e Insp Chefe**.
- Ao selecionar o nome, o sistema associa automaticamente o servidor à Função/Turno cadastrada no Neon. Não há campo livre para escolher a função.
- Cada mês e período possui uma **cota específica para cada grupo**, administrável de **0 a 30**. A capacidade GERAL do período continua ajustável entre **1 e 30**, inicialmente **10** vagas normais.
- Distribuição inicial para o primeiro período: Manhã 2, Adm 2, Insp 2, Noite 1, COTT 1, Tarde 2 e Corujão 0 = **10**.
- Distribuição inicial para o segundo período: Manhã 2, Adm 2, Insp 2, Noite 1, COTT 1, Tarde 1 e Corujão 1 = **10**.
- **Flutuante Tarde / Corujão:** em cada mês, são possíveis os arranjos 1º período **Tarde 2 + Corujão 0** / 2º **Tarde 1 + Corujão 1** ou o inverso de uma vaga: 1º **Tarde 1 + Corujão 1** / 2º **Tarde 2 + Corujão 0**. O arranjo permitido é definido pela ocupação real: o primeiro pedido válido pode mover a vaga, desde que nenhum pedido anterior fique incompatível. As cotas-bases modificadas no painel também são respeitadas.
- **Insp Chefe:** não tem cota e pode entrar **além da capacidade GERAL**, sem reduzir o saldo de vagas normais. Exemplo: 10 vagas normais ocupadas + 1 Insp Chefe = 11 solicitações, mas 0 vagas normais livres. A exceção é de lotação; exigências de ano, prazo e dois meses diferentes foram mantidas.
- Se a cota específica do grupo não permitir mais reservas, a tela mostra exatamente **“Limite por Função/Turno excedido”** e bloqueia a escolha. A mesma regra é revalidada transacionalmente no Neon.
- Nova área administrativa em abas: **Servidores** (primeira), **Consulta mensal**, **Vagas por Função/Turno**, **Períodos e vagas**, **Liberação de anos** e **Histórico**.
- Consulta mensal permite filtrar e exportar. Histórico inclui alteração de cotas. Cadastros existentes não são excluídos.
- Permanecem: 2 períodos de 15 dias em meses diferentes; datas específicas ainda não definidas; prazo de 45 dias antes do primeiro dia do mês, exceção janeiro/2027; anos seguintes bloqueados até liberação; períodos disponíveis administráveis; vagas gerais de 1 a 30.

## ORDEM PARA ATUALIZAR — NEON → GITHUB → VERCEL

### 1 — Neon (faça PRIMEIRO)

1. Abra https://console.neon.tech/ e o banco de produção já conectado ao site (anteriormente: branch `main`, banco `neondb`).
2. **Faça um backup ou crie uma branch de segurança antes da atualização.** Se houver solicitações reais, verifique especialmente as vagas ocupadas.
3. No SQL Editor, abra uma consulta nova, cole o conteúdo do arquivo fornecido **SEPARADAMENTE** `STTU_2027_MIGRACAO_FUNCOES_TURNOS.sql` e clique **Run** uma única vez.
4. Verifique se todos os comandos tiveram sucesso. O script é incremental: atualiza nomes/Função/Turno, cria as cotas e troca as funções de reserva, cancelamento e capacidade; não apaga reservas.
5. Execute em nova consulta:

```sql
SELECT funcao_turno, COUNT(*) AS servidores
FROM sttu_ferias_servidores
WHERE ativo=TRUE
GROUP BY funcao_turno ORDER BY funcao_turno;
```

Resultado esperado: Adm=29, Manhã=23, Insp=18, Tarde=15, Noite=12, COTT=9, Corujão=5, Insp Chefe=3 (114 no total).

Para conferir as cotas de janeiro:

```sql
SELECT periodo,funcao_turno,limite
FROM sttu_ferias_cotas_funcao
WHERE ano=2027 AND mes=1
ORDER BY periodo,funcao_turno;
```

### 2 — GitHub

1. Descompacte **`STTU_2027_FUNCOES_TURNOS_VERCEL.zip`**.
2. Abra o repositório **`controle-ferias-sttu`** e entre na mesma pasta configurada como **Root Directory** na Vercel (anteriormente `controle_ferias_STTU_Vercel_atualizado`).
3. Faça **Add file → Upload files** e envie **os arquivos e pastas de dentro** do ZIP, não o ZIP fechado nem uma nova pasta externa. Confirme `index.html`, `admin.html`, `api/`, `lib/`, `assets/`, `package.json`, `vercel.json` no mesmo nível.
4. Confirme em **Commit changes**. A pasta `api` deve estar em letras minúsculas.
5. **Não envie o arquivo SQL ao GitHub:** ele contém nomes e matrículas. Execute-o somente no Neon. Se o repositório estiver público, considere torná-lo privado e revisar arquivos SQL antigos já armazenados nele.

### 3 — Vercel

1. Abra o projeto existente `controle-ferias` em https://vercel.com/dashboard, aba **Deployments**.
2. Confira a implantação gerada pelo último commit e o status **Ready**.
3. Não altere as variáveis `DATABASE_URL`, `ADMIN_PASSWORD` e `ADMIN_SESSION_SECRET` já cadastradas.
4. Acesse `https://SEU-DOMINIO.vercel.app/admin.html` e entre com a senha atual.
5. Confira as abas: **Servidores**, depois **Vagas por Função/Turno** para janeiro e depois **Consulta mensal**.

## Testes recomendados (antes da abertura para os servidores)

- Na aba Servidores, confira que Thiago Henrique Ferreira da Silva aparece como **60.275-2 · Insp**; verifique também um servidor de Corujão e um de Insp Chefe.
- Na aba Vagas por Função/Turno, verifique Tarde = 2/1 e Corujão = 0/1 nos dois períodos de janeiro, antes de qualquer solicitação.
- Teste uma alteração reversível numa cota que ainda não tenha ocupação; verifique que o sistema retorna o valor anterior depois de restaurá-lo.
- Para testar a mudança dinâmica entre Tarde/Corujão, use preferencialmente uma branch de teste do Neon; não grave matrículas fictícias no banco de produção.
- Na página dos servidores, quando uma Função/Turno atingir seu limite, confirme a mensagem **“Limite por Função/Turno excedido”**. O banco também rejeita diretamente com o código `LIMITE_FUNCAO_TURNO`.
- Verifique que um Insp Chefe continua elegível quando as 10 vagas normais estão ocupadas, desde que o período esteja liberado e dentro do prazo.

## Avisos

O **controle da interface** e a **estrutura dos arquivos JavaScript** foram testados com dados simulados. Este pacote **não foi conectado nem executado no seu Neon de produção**. A migração SQL e as operações reais devem ser verificadas por você após publicação; faça backup.

**Proteção de dados:** a relação contém nomes e matrículas de pessoas e não deve circular desnecessariamente. Selecionar nome/matrícula não comprova identidade; recomenda-se autenticação individual antes da utilização institucional. Não coloque senhas nem a `DATABASE_URL` no GitHub.
