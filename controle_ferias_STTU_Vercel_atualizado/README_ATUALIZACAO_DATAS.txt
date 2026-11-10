STTU — CONTROLE DE FÉRIAS 2027
ATUALIZAÇÃO: DATAS ADMINISTRATIVAS E CRÉDITO DE DESENVOLVIMENTO

Esta versão foi preparada para o projeto Vercel já existente e para o banco Neon já configurado.
NÃO crie outro projeto ou outro banco. NÃO execute novamente os SQLs antigos.

O QUE MUDOU
- Área administrativa > Períodos e limite de vagas por mês: cada 1º e 2º período tem campo de DATA DE INÍCIO e DATA DE FIM.
- Selecionar o início no mês correspondente preenche automaticamente o fim (15 dias corridos, incluindo o início).
- Botões Salvar datas e Limpar datas. Se ainda não houver datas, a página dos servidores exibe “Datas a definir”.
- Datas salvas aparecem no calendário, nas escolhas e no comprovante de solicitação.
- Alterações e remoções são registradas no histórico administrativo.
- Rodapé nas páginas inicial e administrativa: Desenvolvido por THIAGO HENRIQUE FERREIRA DA SILVA.
- Continuam válidos: 114 servidores, capacidade de 1 a 30 (padrão 10), liberação individual de períodos, dois períodos em meses diferentes, bloqueio de novos anos e antecedência de 45 dias do primeiro dia do mês, com exceção de janeiro/2027.

ORDEM EXATA
1. NEON: entre em console.neon.tech > seu projeto > SQL Editor, na branch de produção e banco neondb.
   Antes de executar, faça uma cópia de segurança.
   Abra o arquivo `schema_atualizacao_datas_periodos.sql` (também está neste ZIP) num editor de texto,
   selecione tudo e cole no SQL Editor. Clique Run / Correr e confirme que concluiu sem erros.
   O SQL cria duas colunas de datas, histórico e função de gravação. É incremental, sem apagar inscrições.

2. GITHUB: abra o repositório `thihenri-web/controle-ferias-sttu`.
   Entre em `controle_ferias_STTU_Vercel_atualizado`, a pasta já configurada como Root Directory na Vercel.
   Carregue os ARQUIVOS E SUBPASTAS contidos na pasta `controle_ferias_STTU_Vercel_atualizado`
   deste ZIP para esse mesmo caminho no GitHub. Confirme o commit. NÃO envie o ZIP fechado,
   não crie subpasta extra e não envie arquivos soltos na raiz do repositório.
   Confira `admin.html`, `index.html`, `api/admin-datas.js`, `api/periodos.js`, `api/admin-dados.js`,
   `api/admin-auditoria.js` e `schema_atualizacao_datas_periodos.sql`.

3. VERCEL: acesse Deployments e confirme que o commit atualizado tem status Ready em Production.
   Não altere DATABASE_URL, ADMIN_PASSWORD nem ADMIN_SESSION_SECRET.

4. TESTE: abra a página /admin.html, faça login e vá em “Períodos e limite de vagas por mês”.
   Em Março / 1º período, escolha por exemplo 01/03/2027 (fim automático 15/03/2027),
   clique “Salvar datas” e confirme a mensagem. Abra a página principal,
   selecione um servidor e veja Março / 1º período: 01/03/2027 a 15/03/2027.
   Depois, se for só um teste, use “Limpar datas” no painel para voltar a “Datas a definir”.
   Limpar as datas NÃO remove solicitações nem vagas.

ATENÇÃO À REGRA DE PRAZO
A antecedência de 45 dias permanece calculada desde o PRIMEIRO DIA DO MÊS,
mesmo após o cadastro da data de início efetiva do período. Janeiro de 2027 mantém a exceção.
Se quiser mudar a contagem para a data real, será outra alteração de regra a solicitar.

ATENÇÃO AOS COMPROVANTES
O comprovante recém-emitido apresenta as datas que constarem no calendário naquele momento.
Datas podem ser alteradas pela administração depois; confira sempre a versão vigente no sistema.
