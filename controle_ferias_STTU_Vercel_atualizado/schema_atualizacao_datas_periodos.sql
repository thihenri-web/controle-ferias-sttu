-- STTU · atualização incremental: cadastro administrativo de datas por período
-- Execute apenas após backup no Neon já configurado.
-- Não altera solicitações, matrículas, vagas ou configurações atuais de capacidade.
-- Cada período tem 15 dias corridos, contando a data inicial como o 1º dia.
BEGIN;

ALTER TABLE public.sttu_ferias_periodos_config
  ADD COLUMN IF NOT EXISTS data_inicio DATE,
  ADD COLUMN IF NOT EXISTS data_fim DATE;

-- As duas datas são opcionais em conjunto. Com data definida, o período dura
-- exatamente 15 dias e começa dentro do mês de referência escolhido.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sttu_ferias_periodos_config'::regclass
      AND conname = 'sttu_ferias_datas_15_dias'
  ) THEN
    ALTER TABLE public.sttu_ferias_periodos_config
      ADD CONSTRAINT sttu_ferias_datas_15_dias CHECK (
        (data_inicio IS NULL AND data_fim IS NULL)
        OR (
          data_inicio IS NOT NULL AND data_fim IS NOT NULL
          AND data_fim = data_inicio + 14
          AND EXTRACT(YEAR FROM data_inicio)::integer = ano
          AND EXTRACT(MONTH FROM data_inicio)::integer = mes
        )
      );
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.sttu_ferias_datas_auditoria (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ano INTEGER NOT NULL,
  mes INTEGER NOT NULL,
  periodo INTEGER NOT NULL,
  inicio_antes DATE,
  fim_antes DATE,
  inicio_depois DATE,
  fim_depois DATE,
  alterado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sttu_ferias_datas_auditoria_ano_idx
  ON public.sttu_ferias_datas_auditoria(ano,alterado_em DESC);

-- Bloqueio transacional e auditoria da edição; NULL/NULL volta a "A definir".
CREATE OR REPLACE FUNCTION public.sttu_configurar_datas_periodo(
  p_ano INTEGER, p_mes INTEGER, p_periodo INTEGER,
  p_inicio DATE, p_fim DATE
) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  v_inicio DATE;
  v_fim DATE;
  v_alterado BOOLEAN;
BEGIN
  IF p_ano NOT BETWEEN 2027 AND 2100
     OR p_mes NOT BETWEEN 1 AND 12
     OR p_periodo NOT IN (1,2) THEN
    RAISE EXCEPTION 'PERIODO_INVALIDO';
  END IF;
  IF (p_inicio IS NULL) IS DISTINCT FROM (p_fim IS NULL) THEN
    RAISE EXCEPTION 'DATAS_INCOMPLETAS';
  END IF;
  IF p_inicio IS NOT NULL AND (
    EXTRACT(YEAR FROM p_inicio)::integer <> p_ano OR
    EXTRACT(MONTH FROM p_inicio)::integer <> p_mes OR
    p_fim <> p_inicio + 14
  ) THEN
    RAISE EXCEPTION 'DATAS_INVALIDAS';
  END IF;

  INSERT INTO public.sttu_ferias_periodos_config(ano,mes,periodo,liberado)
  VALUES(p_ano,p_mes,p_periodo,
      (p_mes NOT IN (6,12) AND (p_mes<>2 OR p_periodo=1)))
  ON CONFLICT (ano,mes,periodo) DO NOTHING;

  SELECT data_inicio,data_fim INTO v_inicio,v_fim
  FROM public.sttu_ferias_periodos_config
  WHERE ano=p_ano AND mes=p_mes AND periodo=p_periodo
  FOR UPDATE;

  v_alterado := v_inicio IS DISTINCT FROM p_inicio
            OR v_fim IS DISTINCT FROM p_fim;
  IF v_alterado THEN
    UPDATE public.sttu_ferias_periodos_config
      SET data_inicio=p_inicio, data_fim=p_fim, atualizado_em=now()
      WHERE ano=p_ano AND mes=p_mes AND periodo=p_periodo;
    INSERT INTO public.sttu_ferias_datas_auditoria
      (ano,mes,periodo,inicio_antes,fim_antes,inicio_depois,fim_depois)
    VALUES(p_ano,p_mes,p_periodo,v_inicio,v_fim,p_inicio,p_fim);
  END IF;

  RETURN jsonb_build_object(
    'ano',p_ano,'mes',p_mes,'periodo',p_periodo,
    'data_inicio',p_inicio,'data_fim',p_fim,'alterado',v_alterado
  );
END;
$$;
COMMIT;

-- Verificação opcional, em consulta separada:
-- SELECT ano,mes,periodo,capacidade,liberado,data_inicio,data_fim
-- FROM sttu_ferias_periodos_config WHERE ano=2027 ORDER BY mes,periodo;
