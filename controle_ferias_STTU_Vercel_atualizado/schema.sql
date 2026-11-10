-- INSTALAÇÃO COMPLETA: tabelas originais + atualização administrativa 2027
-- Execute UMA VEZ no SQL Editor do Neon associado ao projeto na Vercel.
-- Capacidade: 10 servidores por período de 15 dias. A migração ao final do
-- arquivo permite liberar/bloquear individualmente os períodos de cada mês.
-- Não executar RESET/DROP em um banco com solicitações reais.

CREATE TABLE IF NOT EXISTS sttu_ferias_vagas (
  ano INTEGER NOT NULL CHECK (ano BETWEEN 2020 AND 2100),
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  periodo INTEGER NOT NULL CHECK (periodo IN (1, 2)),
  ocupadas INTEGER NOT NULL DEFAULT 0 CHECK (ocupadas BETWEEN 0 AND 30),
  CONSTRAINT sttu_ferias_vagas_mes_permitido CHECK (mes NOT IN (6,12)),
  CONSTRAINT sttu_ferias_vagas_fevereiro_unico CHECK (mes <> 2 OR periodo = 1),
  PRIMARY KEY (ano, mes, periodo)
);

CREATE TABLE IF NOT EXISTS sttu_ferias_solicitacoes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ano INTEGER NOT NULL CHECK (ano BETWEEN 2020 AND 2100),
  nome_completo VARCHAR(180) NOT NULL,
  matricula VARCHAR(32) NOT NULL,
  mes_1 INTEGER NOT NULL CHECK (mes_1 BETWEEN 1 AND 12),
  periodo_1 INTEGER NOT NULL CHECK (periodo_1 IN (1, 2)),
  mes_2 INTEGER NOT NULL CHECK (mes_2 BETWEEN 1 AND 12),
  periodo_2 INTEGER NOT NULL CHECK (periodo_2 IN (1, 2)),
  criada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sttu_ferias_meses_distintos CHECK (mes_1 <> mes_2),
  CONSTRAINT sttu_ferias_meses_permitidos CHECK (mes_1 NOT IN (6,12) AND mes_2 NOT IN (6,12)),
  CONSTRAINT sttu_ferias_fevereiro_unico CHECK ((mes_1 <> 2 OR periodo_1 = 1) AND (mes_2 <> 2 OR periodo_2 = 1)),
  CONSTRAINT sttu_ferias_uma_por_matricula UNIQUE (ano, matricula)
);

-- Atualização segura de bancos que já possuem dados da versão anterior.
-- NOT VALID preserva dados antigos fora das novas regras, mas bloqueia novos registros.
-- Se houver solicitações antigas em junho/dezembro/fevereiro 2º período,
-- revise-as administrativamente antes de abrir a nova campanha.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sttu_ferias_meses_permitidos') THEN
    ALTER TABLE sttu_ferias_solicitacoes ADD CONSTRAINT sttu_ferias_meses_permitidos
      CHECK (mes_1 NOT IN (6,12) AND mes_2 NOT IN (6,12)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sttu_ferias_fevereiro_unico') THEN
    ALTER TABLE sttu_ferias_solicitacoes ADD CONSTRAINT sttu_ferias_fevereiro_unico
      CHECK ((mes_1 <> 2 OR periodo_1 = 1) AND (mes_2 <> 2 OR periodo_2 = 1)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sttu_ferias_vagas_mes_permitido') THEN
    ALTER TABLE sttu_ferias_vagas ADD CONSTRAINT sttu_ferias_vagas_mes_permitido
      CHECK (mes NOT IN (6,12)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sttu_ferias_vagas_fevereiro_unico') THEN
    ALTER TABLE sttu_ferias_vagas ADD CONSTRAINT sttu_ferias_vagas_fevereiro_unico
      CHECK (mes <> 2 OR periodo = 1) NOT VALID;
  END IF;
END;
$$;



-- MIGRAÇÃO DO CONTROLE DE FÉRIAS STTU 2027 (não apaga solicitações existentes)
-- Rode somente no banco de dados de produção correto, antes do novo deploy.
-- 45 dias CORRIDOS antes do 1º dia de cada mês; janeiro/2027 excepcional
-- até 31/12/2026 (inclusive), pois o período não pode começar no passado.
-- Fuso horário: America/Fortaleza (Natal-RN).

CREATE TABLE IF NOT EXISTS sttu_ferias_anos (
  ano INTEGER PRIMARY KEY CHECK (ano BETWEEN 2027 AND 2100),
  liberado BOOLEAN NOT NULL DEFAULT FALSE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO sttu_ferias_anos (ano, liberado) VALUES (2027, TRUE)
ON CONFLICT (ano) DO NOTHING;

CREATE TABLE IF NOT EXISTS sttu_ferias_auditoria (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  solicitacao_id BIGINT NOT NULL,
  ano INTEGER NOT NULL,
  nome_completo VARCHAR(180) NOT NULL,
  matricula VARCHAR(32) NOT NULL,
  mes_1 INTEGER NOT NULL,
  periodo_1 INTEGER NOT NULL,
  mes_2 INTEGER NOT NULL,
  periodo_2 INTEGER NOT NULL,
  acao VARCHAR(30) NOT NULL DEFAULT 'CANCELAMENTO',
  motivo TEXT NOT NULL,
  registrada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sttu_ferias_auditoria_ano_idx ON sttu_ferias_auditoria (ano, registrada_em DESC);

-- Não crie/edite pedidos diretamente nas tabelas: use a função transacional.
CREATE OR REPLACE FUNCTION sttu_registrar_ferias(
    p_ano INTEGER, p_nome TEXT, p_matricula TEXT,
    p_mes_1 INTEGER, p_periodo_1 INTEGER,
    p_mes_2 INTEGER, p_periodo_2 INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_nome TEXT := btrim(coalesce(p_nome, ''));
  v_matricula TEXT := upper(regexp_replace(coalesce(p_matricula, ''), '[^a-zA-Z0-9]', '', 'g'));
  v_id BIGINT;
  v_primeiro_mes INTEGER;
  v_primeiro_periodo INTEGER;
  v_segundo_mes INTEGER;
  v_segundo_periodo INTEGER;
  v_hoje DATE := (now() AT TIME ZONE 'America/Fortaleza')::date;
  v_limite_1 DATE;
  v_limite_2 DATE;
  v_liberado BOOLEAN;
BEGIN
  IF p_ano NOT BETWEEN 2027 AND 2100 THEN
    RAISE EXCEPTION 'ANO_INVALIDO';
  END IF;
  SELECT liberado INTO v_liberado FROM sttu_ferias_anos WHERE ano = p_ano FOR SHARE;
  IF v_liberado IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'ANO_BLOQUEADO';
  END IF;
  IF char_length(v_nome) < 5 OR char_length(v_nome) > 180 OR position(' ' in v_nome) = 0 THEN
    RAISE EXCEPTION 'NOME_INVALIDO';
  END IF;
  IF char_length(v_matricula) < 3 OR char_length(v_matricula) > 32 THEN
    RAISE EXCEPTION 'MATRICULA_INVALIDA';
  END IF;
  IF p_mes_1 NOT BETWEEN 1 AND 12 OR p_mes_2 NOT BETWEEN 1 AND 12
     OR p_mes_1 IN (6,12) OR p_mes_2 IN (6,12)
     OR (p_mes_1 = 2 AND p_periodo_1 <> 1)
     OR (p_mes_2 = 2 AND p_periodo_2 <> 1)
     OR p_periodo_1 NOT IN (1,2) OR p_periodo_2 NOT IN (1,2)
     OR p_mes_1 = p_mes_2 THEN
    RAISE EXCEPTION 'PERIODOS_INVALIDOS';
  END IF;

  -- Último dia em que a escolha é admitida (inclusive): primeiro dia menos 45 dias.
  v_limite_1 := make_date(p_ano, p_mes_1, 1) - 45;
  v_limite_2 := make_date(p_ano, p_mes_2, 1) - 45;
  -- Exceção exclusiva para o lançamento inicial de janeiro de 2027.
  IF p_ano = 2027 AND p_mes_1 = 1 THEN v_limite_1 := DATE '2026-12-31'; END IF;
  IF p_ano = 2027 AND p_mes_2 = 1 THEN v_limite_2 := DATE '2026-12-31'; END IF;
  IF v_hoje > v_limite_1 OR v_hoje > v_limite_2 THEN
    RAISE EXCEPTION 'PRAZO_ENCERRADO';
  END IF;

  INSERT INTO sttu_ferias_vagas (ano, mes, periodo)
    SELECT p_ano, m, p
    FROM generate_series(1,12) AS m CROSS JOIN generate_series(1,2) AS p
    WHERE m NOT IN (6,12) AND (m <> 2 OR p = 1)
    ON CONFLICT DO NOTHING;

  INSERT INTO sttu_ferias_solicitacoes
    (ano, nome_completo, matricula, mes_1, periodo_1, mes_2, periodo_2)
    VALUES (p_ano, v_nome, v_matricula, p_mes_1, p_periodo_1, p_mes_2, p_periodo_2)
    ON CONFLICT (ano, matricula) DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'JA_SOLICITADO'; END IF;

  IF p_mes_1 < p_mes_2 THEN
    v_primeiro_mes := p_mes_1; v_primeiro_periodo := p_periodo_1;
    v_segundo_mes := p_mes_2; v_segundo_periodo := p_periodo_2;
  ELSE
    v_primeiro_mes := p_mes_2; v_primeiro_periodo := p_periodo_2;
    v_segundo_mes := p_mes_1; v_segundo_periodo := p_periodo_1;
  END IF;

  UPDATE sttu_ferias_vagas SET ocupadas = ocupadas + 1
  WHERE ano = p_ano AND mes = v_primeiro_mes AND periodo = v_primeiro_periodo AND ocupadas < 10;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERIODO_ESGOTADO'; END IF;
  UPDATE sttu_ferias_vagas SET ocupadas = ocupadas + 1
  WHERE ano = p_ano AND mes = v_segundo_mes AND periodo = v_segundo_periodo AND ocupadas < 10;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERIODO_ESGOTADO'; END IF;

  RETURN jsonb_build_object(
    'id', v_id, 'ano', p_ano, 'nome', v_nome, 'matricula', v_matricula,
    'escolhas', jsonb_build_array(
      jsonb_build_object('mes',p_mes_1,'periodo',p_periodo_1),
      jsonb_build_object('mes',p_mes_2,'periodo',p_periodo_2)
    )
  );
END;
$$;

-- Cancelamento exclusivamente via área administrativa autenticada.
-- Reverte as duas vagas e registra auditoria no mesmo comando transacional.
CREATE OR REPLACE FUNCTION sttu_cancelar_ferias(p_id BIGINT, p_motivo TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_s sttu_ferias_solicitacoes%ROWTYPE;
  v_motivo TEXT := btrim(coalesce(p_motivo,''));
BEGIN
  IF char_length(v_motivo) < 5 OR char_length(v_motivo) > 500 THEN
    RAISE EXCEPTION 'MOTIVO_INVALIDO';
  END IF;
  SELECT * INTO v_s FROM sttu_ferias_solicitacoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SOLICITACAO_NAO_ENCONTRADA'; END IF;

  UPDATE sttu_ferias_vagas SET ocupadas = ocupadas - 1
  WHERE ano = v_s.ano AND mes = v_s.mes_1 AND periodo = v_s.periodo_1 AND ocupadas > 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTAGEM_INCONSISTENTE'; END IF;
  UPDATE sttu_ferias_vagas SET ocupadas = ocupadas - 1
  WHERE ano = v_s.ano AND mes = v_s.mes_2 AND periodo = v_s.periodo_2 AND ocupadas > 0;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTAGEM_INCONSISTENTE'; END IF;

  INSERT INTO sttu_ferias_auditoria
    (solicitacao_id, ano, nome_completo, matricula, mes_1, periodo_1, mes_2, periodo_2, motivo)
    VALUES (v_s.id, v_s.ano, v_s.nome_completo, v_s.matricula,
            v_s.mes_1, v_s.periodo_1, v_s.mes_2, v_s.periodo_2, v_motivo);
  DELETE FROM sttu_ferias_solicitacoes WHERE id = v_s.id;
  RETURN jsonb_build_object('id',v_s.id,'ano',v_s.ano,'cancelado',TRUE);
END;
$$;

-- Comando de verificação (opcional, rode separadamente):
-- SELECT ano, liberado FROM sttu_ferias_anos ORDER BY ano;

-- Limitação das tentativas de acesso administrativo (identificador = hash de rede).
CREATE TABLE IF NOT EXISTS sttu_ferias_login_tentativas (
  chave VARCHAR(64) PRIMARY KEY,
  tentativas INTEGER NOT NULL DEFAULT 0,
  primeira_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Histórico de liberação/bloqueio das campanhas futuras.
CREATE TABLE IF NOT EXISTS sttu_ferias_anos_auditoria (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ano INTEGER NOT NULL,
  liberado BOOLEAN NOT NULL,
  registrada_em TIMESTAMPTZ NOT NULL DEFAULT now()
);



-- ATUALIZAÇÃO DA RELAÇÃO DE SERVIDORES STTU
-- Fonte: relação enviada na conversa, mantendo a grafia publicada (incluindo
-- abreviações por corte na imagem); nome Thiago expandido conforme exemplo textual do solicitante.
-- Compatível com bancos que já têm solicitações; não exclui solicitações nem vagas.
-- Matrícula como chave única, normalizada sem ponto ou hífen para corresponder aos pedidos existentes.
CREATE TABLE IF NOT EXISTS sttu_ferias_servidores (
  matricula VARCHAR(32) PRIMARY KEY,
  matricula_exibicao VARCHAR(32) NOT NULL,
  nome_completo VARCHAR(180) NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sttu_ferias_servidores_nome_idx
  ON sttu_ferias_servidores(nome_completo);

INSERT INTO sttu_ferias_servidores (matricula,matricula_exibicao,nome_completo)
VALUES
  ('430714','43.071-4','ADRIANA GOMES DA SILVA'),
  ('430790','43.079-0','ADRIANO ANDRE GUEDES COSTA'),
  ('499919','49.991-9','ADRIANO NASCIMENTO DA FONSECA'),
  ('431516','43.151-6','AFRANIO MEDEIROS DA COSTA'),
  ('431273','43.127-3','AGRICIO BELCHIOR BANDEIRA NETT'),
  ('620955','62.095-5','AILTON ANDRADE'),
  ('621005','62.100-5','ALCINEIDE JUSTO SIQUEIRA'),
  ('625493','62.549-3','ALDREY LUIS MORAIS DA SILVA'),
  ('430803','43.080-3','ALDRIN MAGNO DANTAS SIQUEIRA'),
  ('431991','43.199-1','ALESSANDRA DORA DA SILVA COSTA'),
  ('499536','49.953-6','ALEXANDRA BARROS DO NASCIMENTO'),
  ('619477','61.947-7','ALEXANDRE MAGNO FREITAS COSMO'),
  ('430722','43.072-2','ALEX SANDRO NASCIMENTO BARBOSA'),
  ('499951','49.995-1','ALISSON EMANOEL DE OLIVEIRA FA'),
  ('430731','43.073-1','ALLAN ARAUJO DE MEDEIROS'),
  ('645450','64.545-0','ALYENE PATRICIA C B ALVES'),
  ('638021','63.802-1','ANDERSON RODRIGO DO NASCIMENTO'),
  ('430854','43.085-4','ANDRE ALVES DE OLIVEIRA'),
  ('003875','00.387-5','ANDRE CORCINO DE LIMA FILHO'),
  ('620971','62.097-1','ANDREA CASTRO GALVAO'),
  ('617105','61.710-5','ANDREZA CABRAL CAMARA NUNES'),
  ('602337','60.233-7','ANNE CAROLLINE MACEDO DE ARAUJ'),
  ('431028','43.102-8','BARBARA KALYANA DOS SANTOS GOMES ALVES'),
  ('430773','43.077-3','CARLOS EUBER DE FREITAS NEVES'),
  ('431508','43.150-8','CARLYLE CAMARA DOS SANTOS'),
  ('430846','43.084-6','CARMOZINA REGIA DE MELO DANTAS'),
  ('431010','43.101-0','CAROLINA DE CASSIA DEFENTE'),
  ('430960','43.096-0','CHIARA LUCIA DE GUSMAO GONCALVES'),
  ('628735','62.873-5','CRISTIANE DE MACEDO E SILVA'),
  ('430901','43.090-1','DANIEL ALBUQUERQUE EMERENCIANO'),
  ('600725','60.072-5','DANIELLE PEREIRA DE OLIVEIRA'),
  ('722457','72.245-7','DANILO CLAUDIO LIRA DOS SANTOS'),
  ('600903','60.090-3','DENILSON ARAUJO DA COSTA'),
  ('004171','00.417-1','EDILSON FERREIRA DOS SANTOS'),
  ('499862','49.986-2','EDINASIO COSTA SOARES'),
  ('455709','45.570-9','EDIA PAULA MAIA'),
  ('004693','00.469-3','EDSON SIQUEIRA DE LIMA'),
  ('431982','43.198-2','ELIZABETE RANYELA MORAIS DE MO'),
  ('005185','00.518-5','EVALDO FELIX FERREIRA'),
  ('600661','60.066-1','FERNANDA FREITAS DE HOLANDA'),
  ('652474','65.247-4','FRANZ BIAGGIO FULCO GAAG'),
  ('430862','43.086-2','GENALDO AZEVEDO DA TRINDADE'),
  ('003751','00.375-1','HAILSON CABRAL NASCIMENTO'),
  ('654205','65.420-5','HARLLEY CAMPOS MARQUES'),
  ('430978','43.097-8','HEITOR RODRIGUES DE LIMA'),
  ('499528','49.952-8','HEMERSON MELO DA SILVA TORQUATO'),
  ('499501','49.950-1','HERANDY DE ARAUJO CABRAL'),
  ('431494','43.149-4','HERQUILES LIMA DOS SANTOS'),
  ('430986','43.098-6','HEWERTON MOURA DA SILVA'),
  ('600345','60.034-5','ISABELA SILVA NICACIO DE BRITO'),
  ('004316','00.431-6','IVAN DE CARVALHO MEDEIROS'),
  ('621510','62.151-0','IVES SILVA DE SOUZA'),
  ('621897','62.189-7','JARDEL BEZERRA DE ANDRADE'),
  ('628263','62.826-3','JARDS MEDEIROS DE OLIVEIRA'),
  ('629197','62.919-7','JEFERSON STANLEY DA SILVA'),
  ('004821','00.482-1','JOAO BATISTA MONTEIRO DE AQUINO'),
  ('499943','49.994-3','JOAO BATISTA ROCHA FILHO'),
  ('003832','00.383-2','JOAO CLAUDIO DE OLIVEIRA DE FARIA'),
  ('430706','43.070-6','JOAO MARIA ALMEIDA DE MOURA'),
  ('432016','43.201-6','JOAO MARIA MACEDO DA ROCHA'),
  ('430820','43.082-0','JOAO PAULO DE OLIVEIRA'),
  ('622532','62.253-2','JOAO WILLAMS DA SILVA'),
  ('624314','62.431-4','JORGE LUIZ BARROS DO NASCIMENT'),
  ('621919','62.191-9','JORGE LUIZ SIQUEIRA DE OLIVEIR'),
  ('427667','42.766-7','JOSE ALBERTO FREIRE DA COSTA'),
  ('499854','49.985-4','JOSE EUDES BEZERRA'),
  ('430838','43.083-8','JOSE GONCALVES MANGABEIRA DE MEDEIROS'),
  ('624161','62.416-1','JOSE ROOSEVELT MEDEIROS JUNIOR'),
  ('600687','60.068-7','JOSEMAR DA SILVA DAMASCENO'),
  ('431524','43.152-4','JOSEMAR TAVARES CAMARA JUNIOR'),
  ('003867','00.386-7','JOSENILSON TEIXEIRA DE SOUZA'),
  ('430765','43.076-5','KASTEEN CARLOS DE AQUINO E SIL'),
  ('498254','49.825-4','KLEBER SILVESTRE LUSTOSA'),
  ('430781','43.078-1','LAILTON RIBEIRO DA COSTA'),
  ('645427','64.542-7','LEONARDO BATISTA DE S SILVA'),
  ('431222','43.122-2','LEONARDO DA SILVEIRA LUCENA'),
  ('499897','49.989-7','MADSON LIMA CAVALCANTI DE OLIV'),
  ('706655','70.665-5','MARA LUCIA BARROS DE SOUZA'),
  ('619523','61.952-3','MARCELO BATISTA DE ANDRADE'),
  ('600733','60.073-3','MARCELO FRANCA DA SILVA'),
  ('621846','62.184-6','MARCELO ZAEROSON LINS DE MEDEI'),
  ('499510','49.951-0','MARCILIO DE OLIVEIRA RODRIGUES'),
  ('681598','68.159-8','MARCIO JOSE DA SILVA'),
  ('458333','45.833-3','MARCIO JOSE SA DANTAS LUZ'),
  ('432008','43.200-8','MARIA DE LOURDES DA SILVA FILH'),
  ('431125','43.112-5','MARYANE CRISTINA LOPES PEREIRA DA ROCHA'),
  ('620921','62.092-1','MIGUEL ANGELO DE SANTANA'),
  ('623687','62.368-7','NADIJANA MARIA DAMASCENO VALLE'),
  ('602370','60.237-0','NAOMI SUASSUNA DOS SANTOS'),
  ('499498','49.949-8','NEUZELIDES PRISCILLA SILVA AND'),
  ('430811','43.081-1','NEWDEMBERG FERREIRA GALVAO'),
  ('600644','60.064-4','NEWTON DE SOUZA PEREIRA FILHO'),
  ('459909','45.990-9','PATRICIA CRISTINA CAVALCANTE'),
  ('002496','00.249-6','RAIMUNDO NONATO DE MEDEIROS NETO'),
  ('621498','62.149-8','RAPHAELLE CAVALCANTE RIBEIRO D'),
  ('622508','62.250-8','REGINA VICENCIA CRISPIM'),
  ('499927','49.992-7','RITA DE CASSIA SILVA'),
  ('001848','00.184-8','ROBSON LUIZ DE AZEVEDO'),
  ('043871','04.387-1','RODRIGO COSTA'),
  ('628255','62.825-5','RONALDO MARINHO DE SOUZA'),
  ('622575','62.257-5','RONALDO TEIXEIRA DE ARAUJO'),
  ('001376','00.137-6','ROSENBERG PEREIRA'),
  ('617121','61.712-1','SANDRA DA SILVA BEZERRIL BACEL'),
  ('431541','43.154-1','SARAH POLLYANA DIAS DOS SANTOS'),
  ('001929','00.192-9','SEVERINO FERNANDES MAIA'),
  ('633861','63.386-1','SYBELLE DE ARAUJO DANTAS'),
  ('499901','49.990-1','TALITHA LOUISE FORTUNATO BEZER'),
  ('638030','63.803-0','THALES GALVAO DE ARAUJO'),
  ('499889','49.988-9','THALLES THIAGO MEDEIROS DE SOUZA'),
  ('430757','43.075-7','THIAGO DE LIRA BEZERRA'),
  ('602752','60.275-2','THIAGO HENRIQUE FERREIRA DA SILVA'),
  ('619558','61.955-8','VANESSA GALDINO DA SILVA'),
  ('705632','70.563-2','WANDERCLEY SILVA NEVES'),
  ('623679','62.367-9','WANDRE WAGNER DA SILVA')
ON CONFLICT (matricula) DO UPDATE
SET matricula_exibicao=EXCLUDED.matricula_exibicao,
    nome_completo=EXCLUDED.nome_completo,
    ativo=TRUE,
    atualizado_em=now();

-- Aplicar nome e matrícula do cadastro também na função do banco.
CREATE OR REPLACE FUNCTION sttu_registrar_ferias(
    p_ano INTEGER, p_nome TEXT, p_matricula TEXT,
    p_mes_1 INTEGER, p_periodo_1 INTEGER,
    p_mes_2 INTEGER, p_periodo_2 INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_nome TEXT := btrim(coalesce(p_nome, ''));
  v_matricula TEXT := upper(regexp_replace(coalesce(p_matricula, ''), '[^a-zA-Z0-9]', '', 'g'));
  v_matricula_exibicao TEXT;
  v_id BIGINT;
  v_primeiro_mes INTEGER;
  v_primeiro_periodo INTEGER;
  v_segundo_mes INTEGER;
  v_segundo_periodo INTEGER;
  v_hoje DATE := (now() AT TIME ZONE 'America/Fortaleza')::date;
  v_limite_1 DATE;
  v_limite_2 DATE;
  v_liberado BOOLEAN;
BEGIN
  IF p_ano NOT BETWEEN 2027 AND 2100 THEN
    RAISE EXCEPTION 'ANO_INVALIDO';
  END IF;
  SELECT liberado INTO v_liberado FROM sttu_ferias_anos WHERE ano = p_ano FOR SHARE;
  IF v_liberado IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'ANO_BLOQUEADO';
  END IF;
  IF char_length(v_nome) < 5 OR char_length(v_nome) > 180 OR position(' ' in v_nome) = 0 THEN
    RAISE EXCEPTION 'NOME_INVALIDO';
  END IF;
  IF char_length(v_matricula) < 3 OR char_length(v_matricula) > 32 THEN
    RAISE EXCEPTION 'MATRICULA_INVALIDA';
  END IF;
  -- A relação oficial determina o nome e a matrícula.
  -- A conferência ocorre no servidor, e não apenas no navegador.
  SELECT s.nome_completo,s.matricula_exibicao INTO v_nome,v_matricula_exibicao
  FROM sttu_ferias_servidores AS s
  WHERE s.matricula=v_matricula AND s.ativo=TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SERVIDOR_NAO_CADASTRADO'; END IF;
  IF btrim(coalesce(p_nome,'')) <> v_nome THEN
    RAISE EXCEPTION 'DADOS_DIVERGENTES';
  END IF;

  IF p_mes_1 NOT BETWEEN 1 AND 12 OR p_mes_2 NOT BETWEEN 1 AND 12
     OR p_mes_1 IN (6,12) OR p_mes_2 IN (6,12)
     OR (p_mes_1 = 2 AND p_periodo_1 <> 1)
     OR (p_mes_2 = 2 AND p_periodo_2 <> 1)
     OR p_periodo_1 NOT IN (1,2) OR p_periodo_2 NOT IN (1,2)
     OR p_mes_1 = p_mes_2 THEN
    RAISE EXCEPTION 'PERIODOS_INVALIDOS';
  END IF;

  -- Último dia em que a escolha é admitida (inclusive): primeiro dia menos 45 dias.
  v_limite_1 := make_date(p_ano, p_mes_1, 1) - 45;
  v_limite_2 := make_date(p_ano, p_mes_2, 1) - 45;
  -- Exceção exclusiva para o lançamento inicial de janeiro de 2027.
  IF p_ano = 2027 AND p_mes_1 = 1 THEN v_limite_1 := DATE '2026-12-31'; END IF;
  IF p_ano = 2027 AND p_mes_2 = 1 THEN v_limite_2 := DATE '2026-12-31'; END IF;
  IF v_hoje > v_limite_1 OR v_hoje > v_limite_2 THEN
    RAISE EXCEPTION 'PRAZO_ENCERRADO';
  END IF;

  INSERT INTO sttu_ferias_vagas (ano, mes, periodo)
    SELECT p_ano, m, p
    FROM generate_series(1,12) AS m CROSS JOIN generate_series(1,2) AS p
    WHERE m NOT IN (6,12) AND (m <> 2 OR p = 1)
    ON CONFLICT DO NOTHING;

  INSERT INTO sttu_ferias_solicitacoes
    (ano, nome_completo, matricula, mes_1, periodo_1, mes_2, periodo_2)
    VALUES (p_ano, v_nome, v_matricula, p_mes_1, p_periodo_1, p_mes_2, p_periodo_2)
    ON CONFLICT (ano, matricula) DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'JA_SOLICITADO'; END IF;

  IF p_mes_1 < p_mes_2 THEN
    v_primeiro_mes := p_mes_1; v_primeiro_periodo := p_periodo_1;
    v_segundo_mes := p_mes_2; v_segundo_periodo := p_periodo_2;
  ELSE
    v_primeiro_mes := p_mes_2; v_primeiro_periodo := p_periodo_2;
    v_segundo_mes := p_mes_1; v_segundo_periodo := p_periodo_1;
  END IF;

  UPDATE sttu_ferias_vagas SET ocupadas = ocupadas + 1
  WHERE ano = p_ano AND mes = v_primeiro_mes AND periodo = v_primeiro_periodo AND ocupadas < 10;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERIODO_ESGOTADO'; END IF;
  UPDATE sttu_ferias_vagas SET ocupadas = ocupadas + 1
  WHERE ano = p_ano AND mes = v_segundo_mes AND periodo = v_segundo_periodo AND ocupadas < 10;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERIODO_ESGOTADO'; END IF;

  RETURN jsonb_build_object(
    'id', v_id, 'ano', p_ano, 'nome', v_nome, 'matricula', v_matricula_exibicao,
    'escolhas', jsonb_build_array(
      jsonb_build_object('mes',p_mes_1,'periodo',p_periodo_1),
      jsonb_build_object('mes',p_mes_2,'periodo',p_periodo_2)
    )
  );
END;
$$;

-- Conferência opcional (executar em consulta separada):
-- SELECT count(*) AS total_servidores FROM sttu_ferias_servidores WHERE ativo=TRUE;


-- ATUALIZAÇÃO DO MODELO PARA PERÍODOS FLEXÍVEIS
-- STTU · MIGRAÇÃO INCREMENTAL - PERÍODOS FLEXÍVEIS (2027 e anos seguintes)
-- Execute no Neon conectado à Vercel, na branch de produção, uma vez.
-- É idempotente: pode ser reexecutado, mas só após backup e conferência.
-- NÃO apaga servidores, solicitações, vagas ou histórico.
-- Regra conservada: 10 vagas por período, 2 escolhas em meses diferentes,
-- prazo de 45 dias antes do primeiro dia do mês (janeiro/2027: 31/12/2026).
-- OBS.: 1º e 2º períodos representam blocos de 15 dias, SEM datas definidas.

BEGIN;

-- Remover apenas restrições antigas que fixavam meses e períodos disponíveis.
-- Permanecem as restrições de capacidade, período 1/2 e meses diferentes.
ALTER TABLE sttu_ferias_vagas DROP CONSTRAINT IF EXISTS sttu_ferias_vagas_mes_permitido;
ALTER TABLE sttu_ferias_vagas DROP CONSTRAINT IF EXISTS sttu_ferias_vagas_fevereiro_unico;
ALTER TABLE sttu_ferias_solicitacoes DROP CONSTRAINT IF EXISTS sttu_ferias_meses_permitidos;
ALTER TABLE sttu_ferias_solicitacoes DROP CONSTRAINT IF EXISTS sttu_ferias_fevereiro_unico;

CREATE TABLE IF NOT EXISTS sttu_ferias_periodos_config (
  ano INTEGER NOT NULL CHECK (ano BETWEEN 2027 AND 2100),
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  periodo INTEGER NOT NULL CHECK (periodo IN (1,2)),
  liberado BOOLEAN NOT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ano,mes,periodo)
);

-- Configuração inicial de 2027: preserva os 19 períodos que já estavam abertos.
-- Os 24 períodos ficam cadastrados para poder liberar junho/dezembro/fevereiro 2º.
-- ON CONFLICT não altera escolhas administrativas já registradas.
INSERT INTO sttu_ferias_periodos_config (ano,mes,periodo,liberado)
SELECT 2027,m,p,(m NOT IN (6,12) AND (m <> 2 OR p=1))
FROM generate_series(1,12) m CROSS JOIN generate_series(1,2) p
ON CONFLICT (ano,mes,periodo) DO NOTHING;

CREATE TABLE IF NOT EXISTS sttu_ferias_periodos_auditoria (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ano INTEGER NOT NULL,
  mes INTEGER NOT NULL,
  periodo INTEGER NOT NULL,
  liberado_antes BOOLEAN NOT NULL,
  liberado_depois BOOLEAN NOT NULL,
  ocupadas_no_momento INTEGER NOT NULL DEFAULT 0,
  alterado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sttu_ferias_periodos_auditoria_idx
  ON sttu_ferias_periodos_auditoria(ano,alterado_em DESC);

-- Admin: alterna individualmente cada período e registra histórico.
-- Reservas já gravadas são mantidas quando um período é desativado.
CREATE OR REPLACE FUNCTION sttu_configurar_periodo(
  p_ano INTEGER,p_mes INTEGER,p_periodo INTEGER,p_liberado BOOLEAN
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_anterior BOOLEAN;
  v_ocupadas INTEGER;
BEGIN
  IF p_ano NOT BETWEEN 2027 AND 2100 OR p_mes NOT BETWEEN 1 AND 12
     OR p_periodo NOT IN (1,2) OR p_liberado IS NULL THEN
    RAISE EXCEPTION 'CONFIG_INVALIDA';
  END IF;
  INSERT INTO sttu_ferias_periodos_config(ano,mes,periodo,liberado)
  VALUES(p_ano,p_mes,p_periodo,
         (p_mes NOT IN (6,12) AND (p_mes<>2 OR p_periodo=1)))
  ON CONFLICT DO NOTHING;
  SELECT liberado INTO v_anterior
    FROM sttu_ferias_periodos_config
    WHERE ano=p_ano AND mes=p_mes AND periodo=p_periodo FOR UPDATE;
  SELECT COALESCE(ocupadas,0) INTO v_ocupadas
    FROM sttu_ferias_vagas
    WHERE ano=p_ano AND mes=p_mes AND periodo=p_periodo;
  v_ocupadas := COALESCE(v_ocupadas,0);
  IF v_anterior IS DISTINCT FROM p_liberado THEN
    UPDATE sttu_ferias_periodos_config
      SET liberado=p_liberado,atualizado_em=now()
      WHERE ano=p_ano AND mes=p_mes AND periodo=p_periodo;
    INSERT INTO sttu_ferias_periodos_auditoria
      (ano,mes,periodo,liberado_antes,liberado_depois,ocupadas_no_momento)
    VALUES(p_ano,p_mes,p_periodo,v_anterior,p_liberado,v_ocupadas);
  END IF;
  RETURN jsonb_build_object('ano',p_ano,'mes',p_mes,'periodo',p_periodo,
          'liberado',p_liberado,'alterado',v_anterior IS DISTINCT FROM p_liberado,
          'ocupadas',v_ocupadas);
END;
$$;

-- Servidor: nova solicitação somente em períodos autorizados pela administração.
-- Mantém todas as validações de matrícula, ano, prazo, limite e meses distintos.
CREATE OR REPLACE FUNCTION sttu_registrar_ferias(
    p_ano INTEGER, p_nome TEXT, p_matricula TEXT,
    p_mes_1 INTEGER, p_periodo_1 INTEGER,
    p_mes_2 INTEGER, p_periodo_2 INTEGER
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_nome TEXT := btrim(coalesce(p_nome, ''));
  v_matricula TEXT := upper(regexp_replace(coalesce(p_matricula, ''), '[^a-zA-Z0-9]', '', 'g'));
  v_matricula_exibicao TEXT;
  v_id BIGINT;
  v_primeiro_mes INTEGER;
  v_primeiro_periodo INTEGER;
  v_segundo_mes INTEGER;
  v_segundo_periodo INTEGER;
  v_hoje DATE := (now() AT TIME ZONE 'America/Fortaleza')::date;
  v_limite_1 DATE;
  v_limite_2 DATE;
  v_liberado BOOLEAN;
  v_config_1 BOOLEAN;
  v_config_2 BOOLEAN;
BEGIN
  IF p_ano NOT BETWEEN 2027 AND 2100 THEN RAISE EXCEPTION 'ANO_INVALIDO'; END IF;
  SELECT liberado INTO v_liberado FROM sttu_ferias_anos WHERE ano=p_ano FOR SHARE;
  IF v_liberado IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'ANO_BLOQUEADO'; END IF;
  IF char_length(v_nome)<5 OR char_length(v_nome)>180 OR position(' ' in v_nome)=0 THEN
    RAISE EXCEPTION 'NOME_INVALIDO';
  END IF;
  IF char_length(v_matricula)<3 OR char_length(v_matricula)>32 THEN
    RAISE EXCEPTION 'MATRICULA_INVALIDA';
  END IF;
  SELECT s.nome_completo,s.matricula_exibicao INTO v_nome,v_matricula_exibicao
    FROM sttu_ferias_servidores s
    WHERE s.matricula=v_matricula AND s.ativo=TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SERVIDOR_NAO_CADASTRADO'; END IF;
  IF btrim(coalesce(p_nome,''))<>v_nome THEN RAISE EXCEPTION 'DADOS_DIVERGENTES'; END IF;
  IF p_mes_1 NOT BETWEEN 1 AND 12 OR p_mes_2 NOT BETWEEN 1 AND 12
     OR p_periodo_1 NOT IN (1,2) OR p_periodo_2 NOT IN (1,2)
     OR p_mes_1=p_mes_2 THEN RAISE EXCEPTION 'PERIODOS_INVALIDOS'; END IF;

  v_limite_1 := make_date(p_ano,p_mes_1,1)-45;
  v_limite_2 := make_date(p_ano,p_mes_2,1)-45;
  IF p_ano=2027 AND p_mes_1=1 THEN v_limite_1:=DATE '2026-12-31'; END IF;
  IF p_ano=2027 AND p_mes_2=1 THEN v_limite_2:=DATE '2026-12-31'; END IF;
  IF v_hoje>v_limite_1 OR v_hoje>v_limite_2 THEN RAISE EXCEPTION 'PRAZO_ENCERRADO'; END IF;

  -- Garantir configuração de ambos os períodos; para anos futuros o padrão é 19,
  -- até a administração alterar, e o ano continua fechado até ser liberado.
  INSERT INTO sttu_ferias_periodos_config(ano,mes,periodo,liberado)
    SELECT p_ano,x.mes,x.periodo,(x.mes NOT IN (6,12) AND (x.mes<>2 OR x.periodo=1))
    FROM (VALUES (p_mes_1,p_periodo_1),(p_mes_2,p_periodo_2)) AS x(mes,periodo)
    ORDER BY x.mes,x.periodo
    ON CONFLICT DO NOTHING;

  -- Travas de leitura protegem a decisão contra alterações administrativas simultâneas.
  IF p_mes_1<p_mes_2 THEN
    v_primeiro_mes:=p_mes_1;v_primeiro_periodo:=p_periodo_1;
    v_segundo_mes:=p_mes_2;v_segundo_periodo:=p_periodo_2;
  ELSE
    v_primeiro_mes:=p_mes_2;v_primeiro_periodo:=p_periodo_2;
    v_segundo_mes:=p_mes_1;v_segundo_periodo:=p_periodo_1;
  END IF;
  SELECT liberado INTO v_config_1 FROM sttu_ferias_periodos_config
    WHERE ano=p_ano AND mes=v_primeiro_mes AND periodo=v_primeiro_periodo FOR SHARE;
  SELECT liberado INTO v_config_2 FROM sttu_ferias_periodos_config
    WHERE ano=p_ano AND mes=v_segundo_mes AND periodo=v_segundo_periodo FOR SHARE;
  IF v_config_1 IS DISTINCT FROM TRUE OR v_config_2 IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERIODO_BLOQUEADO';
  END IF;

  INSERT INTO sttu_ferias_vagas(ano,mes,periodo)
    SELECT p_ano,x.mes,x.periodo
    FROM (VALUES (p_mes_1,p_periodo_1),(p_mes_2,p_periodo_2)) AS x(mes,periodo)
    ORDER BY x.mes,x.periodo
    ON CONFLICT DO NOTHING;

  INSERT INTO sttu_ferias_solicitacoes
    (ano,nome_completo,matricula,mes_1,periodo_1,mes_2,periodo_2)
    VALUES(p_ano,v_nome,v_matricula,p_mes_1,p_periodo_1,p_mes_2,p_periodo_2)
    ON CONFLICT(ano,matricula) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'JA_SOLICITADO'; END IF;

  UPDATE sttu_ferias_vagas SET ocupadas=ocupadas+1
    WHERE ano=p_ano AND mes=v_primeiro_mes AND periodo=v_primeiro_periodo AND ocupadas<10;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERIODO_ESGOTADO'; END IF;
  UPDATE sttu_ferias_vagas SET ocupadas=ocupadas+1
    WHERE ano=p_ano AND mes=v_segundo_mes AND periodo=v_segundo_periodo AND ocupadas<10;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERIODO_ESGOTADO'; END IF;

  RETURN jsonb_build_object('id',v_id,'ano',p_ano,'nome',v_nome,
    'matricula',v_matricula_exibicao,
    'escolhas',jsonb_build_array(
      jsonb_build_object('mes',p_mes_1,'periodo',p_periodo_1),
      jsonb_build_object('mes',p_mes_2,'periodo',p_periodo_2)));
END;
$$;

COMMIT;

-- Verificações opcionais, execute em consulta SEPARADA:
-- SELECT count(*) FROM sttu_ferias_periodos_config WHERE ano=2027; -- 24
-- SELECT count(*) FROM sttu_ferias_periodos_config WHERE ano=2027 AND liberado; -- 19 (inicial)


-- ADIÇÃO FINAL: Capacidade administrativa por período
-- STTU · ATUALIZAÇÃO INCREMENTAL — CAPACIDADE DE VAGAS POR PERÍODO
-- Execute NO NEON de produção. Não remove solicitações, cadastros nem configurações.
-- Depende da estrutura de períodos flexíveis (incluída também no SQL combinado).
-- Limites: entre 1 e 30 vagas por período; zero vagas = bloquear o período.

BEGIN;

ALTER TABLE sttu_ferias_periodos_config
  ADD COLUMN IF NOT EXISTS capacidade INTEGER NOT NULL DEFAULT 10;

-- Remove a antiga faixa 1–10 quando esta migração é reaplicada sobre uma versão anterior.
ALTER TABLE sttu_ferias_periodos_config
  DROP CONSTRAINT IF EXISTS sttu_ferias_capacidade_1_a_10;

-- Também amplia a antiga restrição física da tabela de ocupações (0 a 10).
-- Sem isso, reservas acima da décima vaga seriam rejeitadas mesmo com capacidade 30.
ALTER TABLE sttu_ferias_vagas
  DROP CONSTRAINT IF EXISTS sttu_ferias_vagas_ocupadas_check;
ALTER TABLE sttu_ferias_vagas
  ADD CONSTRAINT sttu_ferias_vagas_ocupadas_check
  CHECK (ocupadas BETWEEN 0 AND 30);


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sttu_ferias_periodos_config'::regclass
      AND conname = 'sttu_ferias_capacidade_1_a_30'
  ) THEN
    ALTER TABLE sttu_ferias_periodos_config
      ADD CONSTRAINT sttu_ferias_capacidade_1_a_30
      CHECK (capacidade BETWEEN 1 AND 30);
  END IF;
END;
$$;

-- Guarda um registro de cada alteração administrativa na lotação dos períodos.
CREATE TABLE IF NOT EXISTS sttu_ferias_capacidades_auditoria (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ano INTEGER NOT NULL,
  mes INTEGER NOT NULL,
  periodo INTEGER NOT NULL,
  capacidade_antes INTEGER NOT NULL,
  capacidade_depois INTEGER NOT NULL,
  ocupadas_no_momento INTEGER NOT NULL,
  alterado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sttu_ferias_capacidades_auditoria_ano_data_idx
  ON sttu_ferias_capacidades_auditoria(ano,alterado_em DESC);

-- Alteração transacional, com bloqueio da configuração para impedir corridas
-- entre a edição administrativa e solicitações simultâneas dos servidores.
CREATE OR REPLACE FUNCTION sttu_configurar_capacidade(
  p_ano INTEGER, p_mes INTEGER, p_periodo INTEGER, p_capacidade INTEGER
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_anterior INTEGER;
  v_ocupadas INTEGER := 0;
BEGIN
  IF p_ano IS NULL OR p_ano NOT BETWEEN 2027 AND 2100
     OR p_mes IS NULL OR p_mes NOT BETWEEN 1 AND 12
     OR p_periodo IS NULL OR p_periodo NOT IN (1,2)
     OR p_capacidade IS NULL OR p_capacidade NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'CAPACIDADE_INVALIDA';
  END IF;

  INSERT INTO sttu_ferias_periodos_config(ano,mes,periodo,liberado)
  VALUES (p_ano,p_mes,p_periodo,
          (p_mes NOT IN (6,12) AND (p_mes <> 2 OR p_periodo=1)))
  ON CONFLICT (ano,mes,periodo) DO NOTHING;

  SELECT capacidade INTO v_anterior
    FROM sttu_ferias_periodos_config
    WHERE ano=p_ano AND mes=p_mes AND periodo=p_periodo
    FOR UPDATE;

  SELECT ocupadas INTO v_ocupadas
    FROM sttu_ferias_vagas
    WHERE ano=p_ano AND mes=p_mes AND periodo=p_periodo
    FOR UPDATE;
  v_ocupadas := COALESCE(v_ocupadas,0);

  IF p_capacidade < v_ocupadas THEN
    RAISE EXCEPTION 'CAPACIDADE_INFERIOR_OCUPACAO';
  END IF;
  IF v_anterior IS DISTINCT FROM p_capacidade THEN
    UPDATE sttu_ferias_periodos_config
      SET capacidade=p_capacidade,atualizado_em=now()
      WHERE ano=p_ano AND mes=p_mes AND periodo=p_periodo;
    INSERT INTO sttu_ferias_capacidades_auditoria
      (ano,mes,periodo,capacidade_antes,capacidade_depois,ocupadas_no_momento)
    VALUES (p_ano,p_mes,p_periodo,v_anterior,p_capacidade,v_ocupadas);
  END IF;

  RETURN jsonb_build_object('ano',p_ano,'mes',p_mes,'periodo',p_periodo,
    'capacidade',p_capacidade,'anterior',v_anterior,'ocupadas',v_ocupadas,
    'restantes',p_capacidade-v_ocupadas,
    'alterado',v_anterior IS DISTINCT FROM p_capacidade);
END;
$$;

-- Reinstala o registro de férias para que o limite aplicado seja o configurado
-- individualmente por mês/período, e não um número fixo de 10 vagas.
CREATE OR REPLACE FUNCTION sttu_registrar_ferias(
    p_ano INTEGER, p_nome TEXT, p_matricula TEXT,
    p_mes_1 INTEGER, p_periodo_1 INTEGER,
    p_mes_2 INTEGER, p_periodo_2 INTEGER
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_nome TEXT := btrim(coalesce(p_nome, ''));
  v_matricula TEXT := upper(regexp_replace(coalesce(p_matricula, ''), '[^a-zA-Z0-9]', '', 'g'));
  v_matricula_exibicao TEXT;
  v_id BIGINT;
  v_primeiro_mes INTEGER;
  v_primeiro_periodo INTEGER;
  v_segundo_mes INTEGER;
  v_segundo_periodo INTEGER;
  v_hoje DATE := (now() AT TIME ZONE 'America/Fortaleza')::date;
  v_limite_1 DATE;
  v_limite_2 DATE;
  v_liberado BOOLEAN;
  v_config_1 BOOLEAN;
  v_config_2 BOOLEAN;
BEGIN
  IF p_ano NOT BETWEEN 2027 AND 2100 THEN RAISE EXCEPTION 'ANO_INVALIDO'; END IF;
  SELECT liberado INTO v_liberado FROM sttu_ferias_anos WHERE ano=p_ano FOR SHARE;
  IF v_liberado IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'ANO_BLOQUEADO'; END IF;
  IF char_length(v_nome)<5 OR char_length(v_nome)>180 OR position(' ' in v_nome)=0 THEN
    RAISE EXCEPTION 'NOME_INVALIDO';
  END IF;
  IF char_length(v_matricula)<3 OR char_length(v_matricula)>32 THEN
    RAISE EXCEPTION 'MATRICULA_INVALIDA';
  END IF;
  SELECT s.nome_completo,s.matricula_exibicao INTO v_nome,v_matricula_exibicao
    FROM sttu_ferias_servidores s
    WHERE s.matricula=v_matricula AND s.ativo=TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SERVIDOR_NAO_CADASTRADO'; END IF;
  IF btrim(coalesce(p_nome,''))<>v_nome THEN RAISE EXCEPTION 'DADOS_DIVERGENTES'; END IF;
  IF p_mes_1 NOT BETWEEN 1 AND 12 OR p_mes_2 NOT BETWEEN 1 AND 12
     OR p_periodo_1 NOT IN (1,2) OR p_periodo_2 NOT IN (1,2)
     OR p_mes_1=p_mes_2 THEN RAISE EXCEPTION 'PERIODOS_INVALIDOS'; END IF;

  v_limite_1 := make_date(p_ano,p_mes_1,1)-45;
  v_limite_2 := make_date(p_ano,p_mes_2,1)-45;
  IF p_ano=2027 AND p_mes_1=1 THEN v_limite_1:=DATE '2026-12-31'; END IF;
  IF p_ano=2027 AND p_mes_2=1 THEN v_limite_2:=DATE '2026-12-31'; END IF;
  IF v_hoje>v_limite_1 OR v_hoje>v_limite_2 THEN RAISE EXCEPTION 'PRAZO_ENCERRADO'; END IF;

  -- Garantir configuração de ambos os períodos; para anos futuros o padrão é 19,
  -- até a administração alterar, e o ano continua fechado até ser liberado.
  INSERT INTO sttu_ferias_periodos_config(ano,mes,periodo,liberado)
    SELECT p_ano,x.mes,x.periodo,(x.mes NOT IN (6,12) AND (x.mes<>2 OR x.periodo=1))
    FROM (VALUES (p_mes_1,p_periodo_1),(p_mes_2,p_periodo_2)) AS x(mes,periodo)
    ORDER BY x.mes,x.periodo
    ON CONFLICT DO NOTHING;

  -- Travas de leitura protegem a decisão contra alterações administrativas simultâneas.
  IF p_mes_1<p_mes_2 THEN
    v_primeiro_mes:=p_mes_1;v_primeiro_periodo:=p_periodo_1;
    v_segundo_mes:=p_mes_2;v_segundo_periodo:=p_periodo_2;
  ELSE
    v_primeiro_mes:=p_mes_2;v_primeiro_periodo:=p_periodo_2;
    v_segundo_mes:=p_mes_1;v_segundo_periodo:=p_periodo_1;
  END IF;
  SELECT liberado INTO v_config_1 FROM sttu_ferias_periodos_config
    WHERE ano=p_ano AND mes=v_primeiro_mes AND periodo=v_primeiro_periodo FOR SHARE;
  SELECT liberado INTO v_config_2 FROM sttu_ferias_periodos_config
    WHERE ano=p_ano AND mes=v_segundo_mes AND periodo=v_segundo_periodo FOR SHARE;
  IF v_config_1 IS DISTINCT FROM TRUE OR v_config_2 IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PERIODO_BLOQUEADO';
  END IF;

  INSERT INTO sttu_ferias_vagas(ano,mes,periodo)
    SELECT p_ano,x.mes,x.periodo
    FROM (VALUES (p_mes_1,p_periodo_1),(p_mes_2,p_periodo_2)) AS x(mes,periodo)
    ORDER BY x.mes,x.periodo
    ON CONFLICT DO NOTHING;

  INSERT INTO sttu_ferias_solicitacoes
    (ano,nome_completo,matricula,mes_1,periodo_1,mes_2,periodo_2)
    VALUES(p_ano,v_nome,v_matricula,p_mes_1,p_periodo_1,p_mes_2,p_periodo_2)
    ON CONFLICT(ano,matricula) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'JA_SOLICITADO'; END IF;

  -- Proteção atômica: valida a capacidade personalizada no banco enquanto incrementa.
  -- A linha de configuração já está bloqueada FOR SHARE em ordem de mês.
  UPDATE sttu_ferias_vagas AS v SET ocupadas=v.ocupadas+1
    FROM sttu_ferias_periodos_config AS cfg
    WHERE v.ano=p_ano AND v.mes=v_primeiro_mes AND v.periodo=v_primeiro_periodo
      AND cfg.ano=v.ano AND cfg.mes=v.mes AND cfg.periodo=v.periodo
      AND cfg.liberado=TRUE AND v.ocupadas<cfg.capacidade;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERIODO_ESGOTADO'; END IF;
  UPDATE sttu_ferias_vagas AS v SET ocupadas=v.ocupadas+1
    FROM sttu_ferias_periodos_config AS cfg
    WHERE v.ano=p_ano AND v.mes=v_segundo_mes AND v.periodo=v_segundo_periodo
      AND cfg.ano=v.ano AND cfg.mes=v.mes AND cfg.periodo=v.periodo
      AND cfg.liberado=TRUE AND v.ocupadas<cfg.capacidade;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERIODO_ESGOTADO'; END IF;

  RETURN jsonb_build_object('id',v_id,'ano',p_ano,'nome',v_nome,
    'matricula',v_matricula_exibicao,
    'escolhas',jsonb_build_array(
      jsonb_build_object('mes',p_mes_1,'periodo',p_periodo_1),
      jsonb_build_object('mes',p_mes_2,'periodo',p_periodo_2)));
END;
$$;


COMMIT;

-- Consulta de verificação (execute em uma nova consulta no SQL Editor):
-- SELECT mes,periodo,capacidade,liberado FROM sttu_ferias_periodos_config
-- WHERE ano=2027 ORDER BY mes,periodo;
