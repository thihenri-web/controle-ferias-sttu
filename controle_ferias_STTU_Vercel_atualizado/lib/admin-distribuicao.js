import { neon } from '@neondatabase/serverless';
import { requireAdmin, sameOrigin, validYear } from './admin-auth.js';

const GROUPS=['Manhã','Adm','Insp','Noite','COTT','Tarde','Corujão'];
export default async function handleDistribution(req,res){
  if(!requireAdmin(req,res,'edit'))return;
  if(req.method!=='POST')return res.status(405).json({erro:'Método não permitido.'});
  if(!sameOrigin(req))return res.status(403).json({erro:'Origem inválida.'});
  let b;
  try{b=typeof req.body==='string'?JSON.parse(req.body):req.body||{};}
  catch{return res.status(400).json({erro:'Dados inválidos.'});}
  const ano=Number(b.ano),mes=Number(b.mes);
  const emLote=Array.isArray(b.distribuicoes);
  // Compatibilidade: o envio de um período por vez continua válido para clientes anteriores.
  const entradas=emLote?b.distribuicoes:[b];
  const formatada=entradas.map(x=>({
    periodo:Number(x.periodo),capacidade:Number(x.capacidade),cotas:x.cotas
  }));
  if(!validYear(ano)||!Number.isInteger(mes)||mes<1||mes>12 ||
    (emLote&&(formatada.length!==2||formatada[0].periodo!==1||formatada[1].periodo!==2)) ||
    (!emLote&&formatada.length!==1) ||
    !formatada.every(x=>
      [1,2].includes(x.periodo)&&Number.isInteger(x.capacidade)&&x.capacidade>=1&&x.capacidade<=30&&
      x.cotas&&typeof x.cotas==='object'&&!Array.isArray(x.cotas)&&
      Object.keys(x.cotas).length===GROUPS.length&&
      GROUPS.every(g=>Number.isInteger(x.cotas[g])&&x.cotas[g]>=0&&x.cotas[g]<=30)))
    return res.status(400).json({erro:'Informe as sete cotas de 0 a 30 e a capacidade de 1 a 30 para cada período.'});
  for(const x of formatada){
    const soma=GROUPS.reduce((a,g)=>a+x.cotas[g],0);
    if(soma!==x.capacidade)
      return res.status(409).json({codigo:'SOMA_COTAS_DIFERENTE_CAPACIDADE',erro:`O ${x.periodo}º período soma ${soma} cotas, mas a capacidade é ${x.capacidade} vagas.`});
  }
  if(!process.env.DATABASE_URL)return res.status(503).json({erro:'Banco não configurado.'});
  try{
    const sql=neon(process.env.DATABASE_URL);
    const queries=formatada.map(x=>sql`SELECT public.sttu_salvar_distribuicao_periodo(${ano},${mes},${x.periodo},${x.capacidade},${JSON.stringify(x.cotas)}::jsonb) AS resultado`);
    if(emLote){
      // Neon executa as duas funções em uma transação: rollback integral se uma falhar.
      const results=await sql.transaction(queries);
      return res.status(200).json({sucesso:true,ano,mes,periodos:results.map(r=>r[0]?.resultado)});
    }
    const rows=await queries[0];
    return res.status(200).json(rows[0].resultado);
  }catch(e){
    const msg=String(e.message||'');
    if(msg.includes('SOMA_COTAS_DIFERENTE_CAPACIDADE'))return res.status(409).json({erro:'A soma das vagas por função deve ser igual à capacidade do período.'});
    if(msg.includes('COTA_INFERIOR_OCUPACAO'))return res.status(409).json({erro:'Distribuição incompatível com as solicitações existentes, inclusive a vaga flutuante Tarde/Corujão.'});
    if(msg.includes('CAPACIDADE_INFERIOR_OCUPACAO'))return res.status(409).json({erro:'O período já tem mais reservas normais que a nova capacidade.'});
    if(msg.includes('DISTRIBUICAO_INVALIDA'))return res.status(400).json({erro:'A distribuição informada é inválida.'});
    console.error('Distribuição STTU:',e);
    return res.status(503).json({erro:'Não foi possível salvar. Verifique a atualização SQL no Neon.'});
  }
}
