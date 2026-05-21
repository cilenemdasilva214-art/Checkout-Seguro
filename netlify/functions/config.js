// Netlify Serverless Function: config
// Caminho: netlify/functions/config.js

exports.handler = async (event, context) => {
  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
      body: JSON.stringify({ message: 'Successful preflight' }),
    };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Configuração do banco de dados ausente no backend.' }),
    };
  }

  const targetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/checkout_configs`;

  try {
    // GET: Buscar todas as configurações
    if (event.httpMethod === 'GET') {
      const response = await fetch(`${targetUrl}?select=*`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        // Se a tabela ainda não foi criada, retorna padrão simulado para não quebrar a UI
        console.warn('⚠️ Tabela checkout_configs não encontrada ou erro na busca. Retornando valores padrão.');
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            facebook_pixel_id: '',
            facebook_pixel_token: '',
            ads_expense: '0.00',
            table_missing: true
          })
        };
      }

      const configs = await response.json();
      const result = {
        facebook_pixel_id: '',
        facebook_pixel_token: '',
        ads_expense: '0.00'
      };

      configs.forEach(c => {
        if (c.key === 'facebook_pixel_id') result.facebook_pixel_id = c.value;
        if (c.key === 'facebook_pixel_token') result.facebook_pixel_token = c.value;
        if (c.key === 'ads_expense') result.ads_expense = c.value;
      });

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      };
    }

    // POST/PATCH: Salvar novas configurações
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');
      const { facebook_pixel_id, facebook_pixel_token, ads_expense } = data;

      const payloads = [
        { key: 'facebook_pixel_id', value: (facebook_pixel_id || '').trim() },
        { key: 'facebook_pixel_token', value: (facebook_pixel_token || '').trim() },
        { key: 'ads_expense', value: (ads_expense || '0.00').trim() }
      ];

      // Salva ou atualiza usando upsert por Postgrest REST API
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates' // Tenta dar merge no conflito de PK key
        },
        body: JSON.stringify(payloads)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erro ao salvar configs no Supabase: ${response.status} - ${errText}`);
      }

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, message: 'Configurações salvas com sucesso!' }),
      };
    }

    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método não permitido.' }),
    };

  } catch (error) {
    console.error('❌ Erro no processamento de config:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
