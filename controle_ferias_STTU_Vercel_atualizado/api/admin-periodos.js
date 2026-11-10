import { neon } from '@neondatabase/serverless';
import { requireAdmin, sameOrigin, validYear } from '../lib/admin-auth.js';

export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({erro:'Método não permitido.'});
  if(!sameOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
  let b;
  try{b=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});}catch{return res.status(400).json({erro:'Dados inválidos.'});}
  const ano=Number(b.ano),mes=Number(b.mes),periodo=Number(b.periodo),liberado=b.liberado;
  if(!validYear(ano)||!Number.isInteger(mes)||mes<1||mes>12||![1,2].includes(periodo)||typeof liberado!=='boolean')
    return res.status(400).json({erro:'Informe ano, mês, período e liberação válidos.'});
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco não configurado.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const rows=await sql`SELECT sttu_configurar_periodo(${ano},${mes},${periodo},${liberado}) AS resultado`;
    return res.status(200).json(rows[0].resultado);
  }catch(e){console.error('Configuração do período:',e);return res.status(503).json({erro:'Não foi possível alterar o período. Confira a migração no Neon.'});}
}
