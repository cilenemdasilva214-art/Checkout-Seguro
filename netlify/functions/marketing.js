// Netlify Serverless Function: marketing
// Caminho: netlify/functions/marketing.js

exports.handler = async (event, context) => {
  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      },
      body: JSON.stringify({ message: 'Successful preflight' }),
    };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Configuração do banco de dados ausente no backend.' }),
    };
  }

  const configTargetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/checkout_configs`;

  // === AUTENTICAÇÃO ===
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  
  if (!token) {
    return { statusCode: 401, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Não autorizado.' }) };
  }
  
  const authResponse = await fetch(`${configTargetUrl}?select=*&key=eq.admin_session_token`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
  });
  const authRows = await authResponse.json();
  const dbToken = (authRows && authRows.length > 0) ? authRows[0].value : null;
  
  if (!dbToken || dbToken !== token) {
    return { statusCode: 401, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Sessão inválida ou expirada.' }) };
  }
  // ====================

  const baseUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/checkout_marketing`;

  try {
    // ----------------------------------------------------
    // GET: BUSCAR DADOS DE MARKETING
    // ----------------------------------------------------
    if (event.httpMethod === 'GET') {
      const type = event.queryStringParameters.type;
      const id = event.queryStringParameters.id;
      
      let targetUrl = `${baseUrl}?select=*`;
      
      if (id) {
        targetUrl += `&id=eq.${id}`;
      } else if (type) {
        targetUrl += `&type=eq.${type}`;
      }
      
      // Ordena por data de criação decrescente
      targetUrl += `&order=created_at.desc`;

      console.log(`📡 Buscando dados de marketing em: ${targetUrl}`);

      const response = await fetch(targetUrl, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erro ao buscar dados no Supabase: ${response.status} - ${errText}`);
      }

      const items = await response.json();
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
      };
    }

    // ----------------------------------------------------
    // POST: CRIAR OU ATUALIZAR ITEM DE MARKETING (UPSERT)
    // ----------------------------------------------------
    if (event.httpMethod === 'POST') {
      const data = JSON.parse(event.body || '{}');
      const { id, type, key, value } = data;

      if (!type || !key || !value) {
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Os campos type, key e value são obrigatórios.' }),
        };
      }

      const payload = {
        type: type,
        key: key,
        value: value,
        updated_at: new Date().toISOString()
      };

      // Se o ID for fornecido, realiza upsert ou atualização
      if (id) {
        payload.id = id;
      }

      console.log(`📡 Gravando dados de marketing (${type}:${key}) no Supabase...`);

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates' // Efetua Upsert se houver conflito de PK
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erro ao gravar dados no Supabase: ${response.status} - ${errText}`);
      }

      const result = await response.json();
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, message: 'Dados gravados com sucesso!', data: result }),
      };
    }

    // ----------------------------------------------------
    // DELETE: EXCLUIR ITEM DE MARKETING
    // ----------------------------------------------------
    if (event.httpMethod === 'DELETE') {
      const id = event.queryStringParameters.id;

      if (!id) {
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'O parâmetro id é obrigatório para exclusão.' }),
        };
      }

      const targetUrl = `${baseUrl}?id=eq.${id}`;
      console.log(`📡 Deletando dados de marketing (${id}) no Supabase: ${targetUrl}`);

      const response = await fetch(targetUrl, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erro ao deletar dados no Supabase: ${response.status} - ${errText}`);
      }

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, message: 'Item excluído com sucesso!' }),
      };
    }

    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método não permitido.' }),
    };

  } catch (error) {
    console.error('❌ Erro no processamento de marketing serverless:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
