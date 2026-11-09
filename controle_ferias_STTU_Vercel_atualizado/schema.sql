-- Execute UMA VEZ no SQL Editor do Neon associado ao projeto na Vercel.
-- Capacidade: 10 servidores por período de 15 dias. 19 períodos permitidos por ano:
-- janeiro-maio e julho-novembro; fevereiro apenas primeiro período (01-15).
-- Junho e dezembro indisponíveis. 1º período = 01-15; 2º = 16-30.
-- Não executar RESET/DROP em um banco com solicitações reais.

CREATE TABLE IF NOT EXISTS sttu_ferias_vagas (
  ano INTEGER NOT NULL CHECK (ano BETWEEN 2020 AND 2100),
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  periodo INTEGER NOT NULL CHECK (periodo IN (1, 2)),
  ocupadas INTEGER NOT NULL DEFAULT 0 CHECK (ocupadas BETWEEN 0 AND 10),
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

-- Executada como uma única transação pelo Postgres. A contagem não excede 10,
-- mesmo quando várias pessoas tentam reservar a mesma vaga simultaneamente.
CREATE OR REPLACE FUNCTION sttu_registrar_ferias(
    p_ano INTEGER,
    p_nome TEXT,
    p_matricula TEXT,
    p_mes_1 INTEGER,
    p_periodo_1 INTEGER,
    p_mes_2 INTEGER,
    p_periodo_2 INTEGER
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
BEGIN
  IF p_ano NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION 'ANO_INVALIDO';
  END IF;
  IF char_length(v_nome) < 5 OR char_length(v_nome) > 180 OR position(' ' in v_nome) = 0 THEN
    RAISE EXCEPTION 'NOME_INVALIDO';
  END IF;
  IF char_length(v_matricula) < 3 OR char_length(v_matricula) > 32 THEN
    RAISE EXCEPTION 'MATRICULA_INVALIDA';
  END IF;
  IF p_mes_1 NOT BETWEEN 1 AND 12 OR p_mes_2 NOT BETWEEN 1 AND 12
      OR p_mes_1 IN (6, 12) OR p_mes_2 IN (6, 12)
      OR (p_mes_1 = 2 AND p_periodo_1 <> 1)
      OR (p_mes_2 = 2 AND p_periodo_2 <> 1)
      OR p_periodo_1 NOT IN (1, 2) OR p_periodo_2 NOT IN (1, 2)
      OR p_mes_1 = p_mes_2 THEN
    RAISE EXCEPTION 'PERIODOS_INVALIDOS';
  END IF;

  INSERT INTO sttu_ferias_vagas (ano, mes, periodo)
    SELECT p_ano, mes, periodo
    FROM generate_series(1, 12) AS mes CROSS JOIN generate_series(1, 2) AS periodo
    WHERE mes NOT IN (6, 12) AND (mes <> 2 OR periodo = 1)
    ON CONFLICT DO NOTHING;

  INSERT INTO sttu_ferias_solicitacoes
    (ano, nome_completo, matricula, mes_1, periodo_1, mes_2, periodo_2)
    VALUES (p_ano, v_nome, v_matricula, p_mes_1, p_periodo_1, p_mes_2, p_periodo_2)
    ON CONFLICT (ano, matricula) DO NOTHING
    RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'JA_SOLICITADO';
  END IF;

  -- Ordem estável evita deadlocks quando duas escolhas ocorrem em ordem invertida.
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
      jsonb_build_object('mes', p_mes_1, 'periodo', p_periodo_1),
      jsonb_build_object('mes', p_mes_2, 'periodo', p_periodo_2)
    )
  );
END;
$$;

-- Consultas administrativas (somente no banco, nunca públicas):
-- SELECT * FROM sttu_ferias_solicitacoes ORDER BY criada_em DESC;
