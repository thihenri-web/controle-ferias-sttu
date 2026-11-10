import { neon } from '@neondatabase/serverless';
import { requireAdmin, sameOrigin, validYear } from '../lib/admin-auth.js';

const messages={
  CAPACIDADE_INVALIDA:'Informe de 1 a 30 vagas por período.',
  CAPACIDADE_INFERIOR_OCUPACAO:'Não é possível definir menos vagas do que as solicitações já registradas. Cancele uma solicitação antes de reduzir esse limite.'
};
export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({erro:'Método não permitido.'});
  if(!sameOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
  let b;
  try{b=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});}catch{return res.status(400).json({erro:'Dados inválidos.'});}
  const ano=Number(b.ano),mes=Number(b.mes),periodo=Number(b.periodo),capacidade=Number(b.capacidade);
  if(!validYear(ano)||!Number.isInteger(mes)||mes<1||mes>12||![1,2].includes(periodo)||
      !Number.isInteger(capacidade)||capacidade<1||capacidade>30)
    return res.status(400).json({erro:'Informe ano, mês, período e capacidade de 1 a 30 válidos.'});
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco não configurado.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const rows=await sql`SELECT sttu_configurar_capacidade(${ano},${mes},${periodo},${capacidade}) AS resultado`;
    return res.status(200).json(rows[0].resultado);
  }catch(e){
    const code=Object.keys(messages).find(k=>String(e.message||'').includes(k));
    if(code)return res.status(409).json({erro:messages[code],codigo:code});
    console.error('Atualizar capacidade:',e);
    return res.status(503).json({erro:'Falha ao salvar o limite de vagas. Confira a migração SQL no Neon.'});
  }
}
