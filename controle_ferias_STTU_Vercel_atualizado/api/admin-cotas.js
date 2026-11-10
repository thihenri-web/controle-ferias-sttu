import { neon } from '@neondatabase/serverless';
import { requireAdmin, sameOrigin, validYear } from '../lib/admin-auth.js';
const GROUPS=['Manhã','Adm','Insp','Noite','COTT','Tarde','Corujão'];
export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({erro:'Método não permitido.'});
  if(!sameOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
  const b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  const ano=Number(b.ano),mes=Number(b.mes),periodo=Number(b.periodo),limite=Number(b.limite),funcao=String(b.funcao||'');
  if(!validYear(ano)||!Number.isInteger(mes)||mes<1||mes>12||![1,2].includes(periodo)
    ||!GROUPS.includes(funcao)||!Number.isInteger(limite)||limite<0||limite>30)
    return res.status(400).json({erro:'Informe mês, período, Função/Turno e cota de 0 a 30 válidos.'});
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco não configurado.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const rows=await sql`SELECT sttu_configurar_cota(${ano},${mes},${periodo},${funcao},${limite}) AS resultado`;
    return res.status(200).json(rows[0].resultado);
  }catch(e){
    if(String(e.message||'').includes('COTA_INFERIOR_OCUPACAO'))
      return res.status(409).json({codigo:'COTA_INFERIOR_OCUPACAO',erro:'Há solicitações que ultrapassariam a nova cota. Mantenha o limite atual ou cancele os pedidos correspondentes.'});
    if(String(e.message||'').includes('COTA_INVALIDA'))return res.status(400).json({erro:'Cota inválida.'});
    console.error('Alterar cota:',e);return res.status(503).json({erro:'Não foi possível atualizar o limite da Função/Turno.'});
  }
}
