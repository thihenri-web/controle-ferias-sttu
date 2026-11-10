import { neon } from '@neondatabase/serverless';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='GET')return res.status(405).json({erro:'Método não permitido.'});
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco de dados não configurado.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const servidores=await sql`
      SELECT nome_completo AS nome, matricula_exibicao AS matricula
      FROM sttu_ferias_servidores
      WHERE ativo=TRUE
      ORDER BY nome_completo, matricula_exibicao`;
    return res.status(200).json({servidores});
  }catch(e){
    console.error('Erro ao consultar cadastro:',e);
    return res.status(503).json({erro:'Não foi possível consultar a relação de servidores. Verifique se a atualização SQL foi executada.'});
  }
}
