import {neon} from '@neondatabase/serverless';
import {requireAdmin,validYear} from '../lib/admin-auth.js';
export default async function handler(req,res){
 if(!requireAdmin(req,res))return;
 if(req.method!=='GET')return res.status(405).json({erro:'Método não permitido.'});
 const ano=Number(req.query.ano??2027),busca=String(req.query.busca||'').trim().slice(0,120),funcao=String(req.query.funcao||'').trim();
 if(!validYear(ano))return res.status(400).json({erro:'Ano inválido.'});
 try{
  const sql=neon(process.env.DATABASE_URL);
  const rows=await sql`
    SELECT c.nome_completo AS nome,c.matricula_exibicao AS matricula,c.funcao_turno,
      s.id AS protocolo,s.mes_1,s.periodo_1,s.mes_2,s.periodo_2,
      to_char(s.criada_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') AS solicitada_em
    FROM sttu_ferias_servidores c LEFT JOIN sttu_ferias_solicitacoes s ON s.matricula=c.matricula AND s.ano=${ano}
    WHERE c.ativo=TRUE AND (${funcao}::text='' OR c.funcao_turno=${funcao})
      AND (${busca}::text='' OR position(lower(${busca}::text) in lower(c.nome_completo))>0
           OR (regexp_replace(${busca}::text,'[^0-9]','','g')<>'' AND position(regexp_replace(${busca}::text,'[^0-9]','','g') in c.matricula)>0)
           OR position(lower(${busca}::text) in lower(c.matricula_exibicao))>0)
    ORDER BY c.nome_completo,c.matricula_exibicao`;
  return res.status(200).json({ano,servidores:rows,total:rows.length});
 }catch(e){console.error('Admin servidores:',e);return res.status(503).json({erro:'Erro ao consultar o cadastro.'});}
}
