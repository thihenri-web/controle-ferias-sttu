import { neon } from '@neondatabase/serverless';
import { requireAdmin,validYear } from '../lib/admin-auth.js';
export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  if(req.method!=='GET')return res.status(405).json({erro:'Método não permitido.'});
  const ano=Number(req.query.ano??2027);
  if(!validYear(ano))return res.status(400).json({erro:'Ano inválido.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const rows=await sql`SELECT solicitacao_id,ano,nome_completo,matricula,mes_1,periodo_1,mes_2,periodo_2,motivo,
      to_char(registrada_em AT TIME ZONE 'America/Fortaleza','DD/MM/YYYY HH24:MI') AS registrada_em
      FROM sttu_ferias_auditoria a WHERE ano=${ano} ORDER BY a.registrada_em DESC LIMIT 500`;
    return res.status(200).json({registros:rows});
  }catch(e){console.error('Auditoria admin:',e);return res.status(503).json({erro:'Não foi possível consultar cancelamentos.'});}
}
