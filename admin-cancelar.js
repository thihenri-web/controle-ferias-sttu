import { neon } from '@neondatabase/serverless';
import { requireAdmin, sameOrigin } from '../lib/admin-auth.js';
const messages={MOTIVO_INVALIDO:'Descreva o motivo (5 a 500 caracteres).',SOLICITACAO_NAO_ENCONTRADA:'Solicitação não encontrada ou já cancelada.',CONTAGEM_INCONSISTENTE:'Contagem de vagas inconsistente. Nenhuma alteração foi salva.'};
export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({erro:'Método não permitido.'});
  if(!sameOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
  const b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  const id=Number(b.id),motivo=String(b.motivo||'').trim();
  if(!Number.isSafeInteger(id)||id<1||motivo.length<5||motivo.length>500) return res.status(400).json({erro:'Informe protocolo válido e motivo de 5 a 500 caracteres.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const rows=await sql`SELECT sttu_cancelar_ferias(${id},${motivo}) AS resultado`;
    return res.status(200).json(rows[0].resultado);
  }catch(e){
    const key=Object.keys(messages).find(k=>String(e.message).includes(k));
    if(key)return res.status(409).json({erro:messages[key],codigo:key});
    console.error('Cancelar admin:',e);return res.status(503).json({erro:'Não foi possível cancelar a solicitação.'});
  }
}
