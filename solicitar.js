import { neon } from '@neondatabase/serverless';

const mensagens = {
  'ANO_INVALIDO': 'Ano inválido.',
  'ANO_BLOQUEADO': 'Este ano ainda não foi liberado pela administração.',
  'PERIODO_BLOQUEADO': 'Um dos períodos escolhidos não está liberado pela administração.',
  'PRAZO_ENCERRADO': 'O prazo de escolha de um dos meses terminou (45 dias de antecedência do dia 1º). Janeiro de 2027 é exceção até 31/12/2026.',
  'NOME_INVALIDO': 'Digite seu nome completo.',
  'MATRICULA_INVALIDA': 'Matrícula inválida.',
  'SERVIDOR_NAO_CADASTRADO': 'Matrícula não encontrada na relação oficial de servidores.',
  'DADOS_DIVERGENTES': 'Nome e matrícula não correspondem ao cadastro. Atualize a página e selecione novamente.',
  'PERIODOS_INVALIDOS': 'Escolha dois períodos de 15 dias em meses diferentes.',
  'JA_SOLICITADO': 'Já existe uma solicitação para esta matrícula neste ano.',
  'PERIODO_ESGOTADO': 'Uma das vagas foi preenchida. Atualize as opções e escolha outro período.'
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ erro: 'Banco de dados não configurado. Conecte o Neon à Vercel.' });
  }
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const ano = Number(b.ano), nome = String(b.nome || '').trim();
    const matricula = String(b.matricula || '').trim();
    const selecoes = b.selecoes;
    if (!Number.isInteger(ano) || ano < 2027 || ano > 2100 ||
      nome.length < 5 || nome.length > 180 || !nome.includes(' ') ||
      matricula.replace(/[^a-zA-Z0-9]/g, '').length < 3 ||
      !Array.isArray(selecoes) || selecoes.length !== 2 ||
      selecoes.some(x => !Number.isInteger(x.mes) || !Number.isInteger(x.periodo) || x.mes < 1 || x.mes > 12 || ![1,2].includes(x.periodo)) ||
      selecoes[0].mes === selecoes[1].mes) {
      return res.status(400).json({ erro: 'Preencha corretamente os dados e selecione dois períodos em meses diferentes.' });
    }
    const sql = neon(process.env.DATABASE_URL);
    const result = await sql`
      SELECT sttu_registrar_ferias(
        ${ano}, ${nome}, ${matricula},
        ${selecoes[0].mes}, ${selecoes[0].periodo},
        ${selecoes[1].mes}, ${selecoes[1].periodo}
      ) AS solicitacao
    `;
    return res.status(201).json({ sucesso: true, solicitacao: result[0].solicitacao });
  } catch (e) {
    const code = Object.keys(mensagens).find(c => String(e.message || '').includes(c));
    if (code) return res.status(['JA_SOLICITADO','PERIODO_ESGOTADO','PRAZO_ENCERRADO','ANO_BLOQUEADO','PERIODO_BLOQUEADO'].includes(code) ? 409 : 400).json({ erro: mensagens[code], codigo: code });
    console.error('Erro ao registrar férias:', e);
    return res.status(503).json({ erro: 'Não foi possível registrar a solicitação. Verifique a conexão e tente novamente.' });
  }
}
