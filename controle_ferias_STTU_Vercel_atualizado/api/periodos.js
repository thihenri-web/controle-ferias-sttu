import { neon } from '@neondatabase/serverless';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store, max-age=0');
  if (req.method!=='GET') return res.status(405).json({erro:'Método não permitido.'});
  const ano=Number(req.query.ano);
  if (!Number.isInteger(ano)||ano<2027||ano>2100) return res.status(400).json({erro:'Ano inválido.'});
  if (!process.env.DATABASE_URL) return res.status(503).json({erro:'Banco não configurado.'});
  try {
    const sql=neon(process.env.DATABASE_URL);
    const liberacao=await sql`SELECT liberado FROM sttu_ferias_anos WHERE ano=${ano} AND liberado=TRUE`;
    if (!liberacao.length) return res.status(403).json({erro:'Ano ainda não liberado pela administração.',codigo:'ANO_BLOQUEADO'});
    const rows=await sql`
      WITH calendario AS (
        SELECT m AS mes, p AS periodo,
          CASE WHEN ${ano}::integer=2027 AND m=1 THEN DATE '2026-12-31'
               ELSE make_date(${ano}::integer,m,1)-45 END AS data_limite,
          (m NOT IN (6,12) AND (m<>2 OR p=1)) AS liberacao_padrao
        FROM generate_series(1,12) m CROSS JOIN generate_series(1,2) p
      )
      SELECT c.mes,c.periodo,COALESCE(v.ocupadas,0)::integer AS ocupadas,
        COALESCE(cfg.capacidade,10)::integer AS capacidade,
        to_char(cfg.data_inicio,'YYYY-MM-DD') AS data_inicio,
        to_char(cfg.data_fim,'YYYY-MM-DD') AS data_fim,

        (COALESCE(cfg.capacidade,10)-COALESCE(v.ocupadas,0))::integer AS restantes,
        COALESCE(cfg.liberado,c.liberacao_padrao) AS habilitado,
        to_char(c.data_limite,'YYYY-MM-DD') AS limite,
        (COALESCE(cfg.liberado,c.liberacao_padrao) AND
          (now() AT TIME ZONE 'America/Fortaleza')::date<=c.data_limite) AS aberto
      FROM calendario c
      LEFT JOIN sttu_ferias_periodos_config cfg ON cfg.ano=${ano} AND cfg.mes=c.mes AND cfg.periodo=c.periodo
      LEFT JOIN sttu_ferias_vagas v ON v.ano=${ano} AND v.mes=c.mes AND v.periodo=c.periodo
      ORDER BY c.mes,c.periodo`;
    return res.status(200).json({ano,capacidadeMaxima:30,capacidadeTotal:rows.filter(r=>r.habilitado).reduce((sum,r)=>sum+Number(r.capacidade),0),periodos:rows});
  } catch (e) {console.error('Vagas:',e);return res.status(503).json({erro:'Não foi possível consultar as vagas. Execute a migração schema_atualizacao_periodos_flexiveis.sql no Neon.'});}
}
