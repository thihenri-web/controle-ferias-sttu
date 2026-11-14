import { neon } from '@neondatabase/serverless';
import { requireAdmin, sameOrigin, validYear } from '../lib/admin-auth.js';
export default async function handler(req,res){
  if(!requireAdmin(req,res,'edit'))return;
  if(req.method!=='POST')return res.status(405).json({erro:'Método não permitido.'});
  if(!sameOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
  let b;
  try{b=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});}
  catch{return res.status(400).json({erro:'Dados inválidos.'});}
  const ano=Number(b.ano),liberado=b.liberado;
  if(!validYear(ano)||ano<=2027||typeof liberado!=='boolean')return res.status(400).json({erro:'Escolha um ano posterior a 2027 e seu estado.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    await sql`WITH atualizado AS (
      INSERT INTO sttu_ferias_anos (ano,liberado,atualizado_em)
      VALUES (${ano},${liberado},now())
      ON CONFLICT (ano) DO UPDATE SET liberado=EXCLUDED.liberado,atualizado_em=now()
      RETURNING ano,liberado
    )
    INSERT INTO sttu_ferias_anos_auditoria (ano,liberado)
      SELECT ano,liberado FROM atualizado`;
    return res.status(200).json({ano,liberado});
  }catch(e){console.error('Anos admin:',e);return res.status(503).json({erro:'Não foi possível atualizar a liberação.'});}
}
