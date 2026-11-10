import { neon } from '@neondatabase/serverless';
import { requireAdmin, sameOrigin, validYear } from '../lib/admin-auth.js';

function parseDay(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const [year,month,day]=value.split('-').map(Number);
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day)return null;
  return {date,year,month};
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  if(!requireAdmin(req,res))return;
  if(req.method!=='POST')return res.status(405).json({erro:'Método não permitido.'});
  if(!sameOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
  let body;
  try{body=typeof req.body==='string'?JSON.parse(req.body):(req.body||{});}catch{
    return res.status(400).json({erro:'Dados inválidos.'});
  }
  const ano=Number(body.ano),mes=Number(body.mes),periodo=Number(body.periodo);
  if(!validYear(ano)||!Number.isInteger(mes)||mes<1||mes>12||![1,2].includes(periodo)){
    return res.status(400).json({erro:'Ano, mês ou período inválidos.'});
  }
  const inicio=body.data_inicio??null,fim=body.data_fim??null;
  if((inicio===null)!==(fim===null))return res.status(400).json({erro:'Informe ambas as datas ou deixe ambas vazias.'});
  if(inicio!==null){
    const s=parseDay(inicio),e=parseDay(fim);
    if(!s||!e||s.year!==ano||s.month!==mes||e.date.getTime()-s.date.getTime()!==14*86400000)
      return res.status(400).json({erro:'O início deve estar no mês selecionado e as datas devem compreender exatamente 15 dias corridos.'});
  }
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco não configurado.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const rows=await sql`SELECT public.sttu_configurar_datas_periodo(
      ${ano},${mes},${periodo},${inicio}::date,${fim}::date
    ) AS resultado`;
    return res.status(200).json(rows[0].resultado);
  }catch(e){
    console.error('Configurar datas:',e);
    return res.status(503).json({erro:'Não foi possível salvar as datas. Confira se a atualização SQL foi executada no Neon.'});
  }
}
