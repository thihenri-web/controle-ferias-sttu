import { neon } from '@neondatabase/serverless';
import { requireAdmin, sameOrigin, validYear } from '../lib/admin-auth.js';

export default async function handler(req,res){
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({erro:'Método não permitido.'});
  if(!sameOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
  let b;
  try{b=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});}catch{return res.status(400).json({erro:'Dados inválidos.'});}
  const ano=Number(b.ano),mes=Number(b.mes),periodo=Number(b.periodo),liberado=b.liberado;
  if(!validYear(ano)||!Number.isInteger(mes)||mes<1||mes>12||![1,2].includes(periodo))
    return res.status(400).json({erro:'Informe ano, mês e período válidos.'});
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco não configurado.'});
  if(b.acao==='datas'){
    const inicio=(b.data_inicio===''||b.data_inicio==null)?null:b.data_inicio;
    const fim=(b.data_fim===''||b.data_fim==null)?null:b.data_fim;
    const parseISO=value=>{
      if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
      const d=new Date(value+'T00:00:00Z');
      return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value?d:null;
    };
    if((inicio===null)!==(fim===null))return res.status(400).json({erro:'Preencha as duas datas ou limpe as duas para deixar a definir.'});
    if(inicio!==null){
      const start=parseISO(inicio),end=parseISO(fim);
      if(!start||!end||start.getUTCFullYear()!==ano||start.getUTCMonth()+1!==mes||
         Math.round((end-start)/86400000)!==14)
        return res.status(400).json({erro:'Informe 15 dias consecutivos, com início no mês de referência e término permitido no mês seguinte.'});
    }
    try{
      const sql=neon(process.env.DATABASE_URL);
      const rows=await sql`SELECT sttu_configurar_datas_periodo(${ano},${mes},${periodo},${inicio}::date,${fim}::date) AS resultado`;
      return res.status(200).json(rows[0].resultado);
    }catch(e){
      const msg=String(e.message||'');
      if(msg.includes('DATAS_SOBREPOSICAO_MAIOR_7')||msg.includes('DATAS_SOBREPOSICAO_MAIOR_5')||msg.includes('DATAS_SOBREPOSTAS'))return res.status(409).json({erro:'Limite de sobreposição excedido: são permitidos até 7 dias em comum entre períodos de férias, inclusive entre meses distintos.'});
      if(msg.includes('DATAS_15_DIAS_MES')||msg.includes('DATAS_PREENCHIMENTO_INCOMPLETO')||msg.includes('DATAS_INVALIDAS'))
        return res.status(400).json({erro:'Datas inválidas: o início deve estar no mês escolhido e o fim deve ser 14 dias depois, podendo cair no mês seguinte.'});
      console.error('Datas do período:',e);
      return res.status(503).json({erro:'Não foi possível salvar as datas. Confira se executou a nova migração no Neon.'});
    }
  }
  if(typeof liberado!=='boolean')return res.status(400).json({erro:'Informe a liberação do período.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const rows=await sql`SELECT sttu_configurar_periodo(${ano},${mes},${periodo},${liberado}) AS resultado`;
    return res.status(200).json(rows[0].resultado);
  }catch(e){console.error('Configuração do período:',e);return res.status(503).json({erro:'Não foi possível alterar o período. Confira a migração no Neon.'});}
}
