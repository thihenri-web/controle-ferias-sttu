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
