import { neon } from '@neondatabase/serverless';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(req.method!=='GET')return res.status(405).json({erro:'Método não permitido.'});
  const ano=Number(req.query.ano),matricula=String(req.query.matricula||'').replace(/\D/g,'');
  if(!Number.isInteger(ano)||ano<2027||ano>2100)return res.status(400).json({erro:'Ano inválido.'});
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco não configurado.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const liberado=await sql`SELECT liberado FROM sttu_ferias_anos WHERE ano=${ano} AND liberado=TRUE`;
    if(!liberado.length)return res.status(403).json({erro:'Ano ainda não liberado pela administração.',codigo:'ANO_BLOQUEADO'});
    let grupo=null;
    if(matricula){
      const c=await sql`SELECT funcao_turno FROM sttu_ferias_servidores WHERE matricula=${matricula} AND ativo=TRUE`;
      if(!c.length)return res.status(400).json({erro:'Servidor não localizado no cadastro.'});
      grupo=c[0].funcao_turno;
    }
    const rows=await sql`
      WITH calendario AS(
        SELECT m AS mes,p AS periodo,
          CASE WHEN ${ano}::integer=2027 AND m=1 THEN DATE '2026-12-31'
               ELSE make_date(${ano}::integer,m,1)-45 END AS data_limite,
          (m NOT IN(6,12) AND(m<>2 OR p=1)) AS liberacao_padrao
        FROM generate_series(1,12) m CROSS JOIN generate_series(1,2) p
      ),ocupacoes AS(
        SELECT z.mes,z.periodo,
          COUNT(*)::integer AS total,
          COUNT(*) FILTER (WHERE COALESCE(s.funcao_turno,c.funcao_turno)='Insp Chefe')::integer AS chefes,
          COUNT(*) FILTER (WHERE COALESCE(s.funcao_turno,c.funcao_turno) IS DISTINCT FROM 'Insp Chefe')::integer AS normais
        FROM sttu_ferias_solicitacoes s
        LEFT JOIN sttu_ferias_servidores c ON c.matricula=s.matricula
        CROSS JOIN LATERAL(VALUES(s.mes_1,s.periodo_1),(s.mes_2,s.periodo_2)) z(mes,periodo)
        WHERE s.ano=${ano} GROUP BY z.mes,z.periodo
      )
      SELECT x.mes,x.periodo,COALESCE(o.total,0)::integer AS ocupadas,
        COALESCE(o.chefes,0)::integer AS chefes,
        COALESCE(o.normais,0)::integer AS normais,
        COALESCE(cfg.capacidade,10)::integer AS capacidade,
        GREATEST(0,COALESCE(cfg.capacidade,10)-COALESCE(o.normais,0))::integer AS restantes,
        COALESCE(cfg.liberado,x.liberacao_padrao) AS habilitado,
        to_char(x.data_limite,'YYYY-MM-DD') AS limite,
        (COALESCE(cfg.liberado,x.liberacao_padrao)
            AND (now() AT TIME ZONE 'America/Fortaleza')::date<=x.data_limite) AS aberto,
        CASE WHEN ${grupo}::text IS NULL THEN NULL
             ELSE sttu_cota_permite(${ano},x.mes,x.periodo,${grupo},TRUE) END AS cota_disponivel,
        CASE WHEN ${grupo}::text IS NULL THEN NULL
             ELSE sttu_cota_permite(${ano},x.mes,x.periodo,${grupo},TRUE)
                   AND (${grupo}::text='Insp Chefe'
                     OR COALESCE(o.normais,0)<COALESCE(cfg.capacidade,10)) END AS disponivel_funcao
      FROM calendario x
      LEFT JOIN sttu_ferias_periodos_config cfg ON cfg.ano=${ano} AND cfg.mes=x.mes AND cfg.periodo=x.periodo
      LEFT JOIN ocupacoes o ON o.mes=x.mes AND o.periodo=x.periodo
      ORDER BY x.mes,x.periodo`;
    return res.status(200).json({ano,grupo,capacidadeMaxima:30,
      capacidadeTotal:rows.filter(r=>r.habilitado).reduce((s,r)=>s+Number(r.capacidade),0),periodos:rows});
  }catch(e){console.error('Períodos:',e);return res.status(503).json({erro:'Falha ao consultar vagas por Função/Turno. Verifique a migração no Neon.'});}
}
