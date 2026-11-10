-- STTU · SQL ÚNICO — PERÍODOS FLEXÍVEIS + CAPACIDADE DE VAGAS
-- Para Neon já existente: execute APENAS este arquivo, uma vez, após backup.
-- Reexecutável em caso de dúvidas: não remove cadastros nem solicitações.
-- Inclui a migração dos períodos flexíveis, mesmo que já tenha sido executada.
-- Não execute este arquivo e os SQLs individuais em sequência.

BEGIN;
-- STTU · MIGRAÇÃO INCREMENTAL - PERÍODOS FLEXÍVEIS (2027 e anos seguintes)
-- Execute no Neon conectado à Vercel, na branch de produção, uma vez.
-- É idempotente: pode ser reexecutado, mas só após backup e conferência.
-- NÃO apaga servidores, solicitações, vagas ou histórico.
-- Regra conservada: 10 vagas por período, 2 escolhas em meses diferentes,
-- prazo de 45 dias antes do primeiro dia do mês (janeiro/2027: 31/12/2026).
-- OBS.: 1º e 2º períodos representam blocos de 15 dias, SEM datas definidas.



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


-- STTU · ATUALIZAÇÃO INCREMENTAL — CAPACIDADE DE VAGAS POR PERÍODO
-- Execute NO NEON de produção. Não remove solicitações, cadastros nem configurações.
-- Depende da estrutura de períodos flexíveis (incluída também no SQL combinado).
-- Limites: entre 1 e 30 vagas por período; zero vagas = bloquear o período.



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
