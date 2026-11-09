import { neon } from '@neondatabase/serverless';

const mensagens = {
  'ANO_INVALIDO': 'Ano inválido.',
  'NOME_INVALIDO': 'Digite seu nome completo.',
  'MATRICULA_INVALIDA': 'Matrícula inválida.',
  'PERIODOS_INVALIDOS': 'Escolha dois períodos de 15 dias em meses diferentes. Junho e dezembro estão indisponíveis; fevereiro só permite o 1º período.',
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
    if (!Number.isInteger(ano) || ano < 2020 || ano > 2100 ||
      nome.length < 5 || nome.length > 180 || !nome.includes(' ') ||
      matricula.replace(/[^a-zA-Z0-9]/g, '').length < 3 ||
      !Array.isArray(selecoes) || selecoes.length !== 2 ||
      selecoes.some(x => !Number.isInteger(x.mes) || !Number.isInteger(x.periodo) || x.mes < 1 || x.mes > 12 || [6,12].includes(x.mes) || (x.mes === 2 && x.periodo !== 1) || ![1,2].includes(x.periodo)) ||
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
    if (code) return res.status(['JA_SOLICITADO','PERIODO_ESGOTADO'].includes(code) ? 409 : 400).json({ erro: mensagens[code], codigo: code });
    console.error('Erro ao registrar férias:', e);
    return res.status(503).json({ erro: 'Não foi possível registrar a solicitação. Verifique a conexão e tente novamente.' });
  }
}
