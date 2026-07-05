// Netlify Serverless Function: orders
// Caminho: netlify/functions/orders.js

exports.handler = async (event, context) => {
  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
          'Access-Control-Allow-Methods': 'GET, DELETE, PATCH, OPTIONS',
        },
      body: JSON.stringify({ message: 'Successful preflight' }),
    };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'DELETE' && event.httpMethod !== 'PATCH') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método não permitido. Use GET, DELETE ou PATCH.' }),
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
  // 1. DELETE
  if (event.httpMethod === 'DELETE') {
    const idToDelete = event.queryStringParameters ? event.queryStringParameters.id : null;
    if (!idToDelete) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'ID é obrigatório para exclusão' }),
      };
    }
    
    const targetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/card_checkout_test_raw?id=eq.${idToDelete}`;
    
    try {
      const response = await fetch(targetUrl, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        }
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erro ao deletar pedido no Supabase: ${response.status} - ${errText}`);
      }

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ success: true, message: 'Deletado com sucesso' }),
      };
    } catch (error) {
      console.error('❌ Erro no DELETE de orders:', error);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: error.message }),
      };
    }
  }

  // 2. PATCH (Update order)
  if (event.httpMethod === 'PATCH') {
    const idToUpdate = event.queryStringParameters ? event.queryStringParameters.id : null;
    if (!idToUpdate) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'ID é obrigatório para atualização' }),
      };
    }
    
    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch (e) {
      return {
        statusCode: 400,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Body inválido (esperado JSON)' }),
      };
    }

    const targetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/card_checkout_test_raw?id=eq.${idToUpdate}`;
    
    try {
      const response = await fetch(targetUrl, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Erro ao atualizar pedido no Supabase: ${response.status} - ${errText}`);
      }

      const updatedData = await response.json();

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ success: true, data: updatedData }),
      };
    } catch (error) {
      console.error('❌ Erro no PATCH de orders:', error);
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: error.message }),
      };
    }
  }

  // Obter parâmetros da query string (limites, etc.) para o GET
  const id = event.queryStringParameters ? event.queryStringParameters.id : null;
  const limit = (event.queryStringParameters && event.queryStringParameters.limit) || '1000';
  const isThirdParty = event.queryStringParameters && event.queryStringParameters.third_party === 'true';

  // Detectar o domínio de onde partiu a requisição (através do Host header seguro)
  // SECURITY PATCH: Não confiar cegamente no Referer para isolamento de dados
  let requestDomain = event.headers.host || '';
  if (requestDomain.includes('netlify.app')) requestDomain = ''; // Ignora subdomínio padrão da Netlify para forçar o custom domain
  
  // Se houver um domínio configurado no Netlify (CHECKOUT_DOMAIN), use ele, senão use o host detectado
  const siteDomain = process.env.CHECKOUT_DOMAIN || requestDomain || '';

  let domainFilter = '';
  if (siteDomain && siteDomain !== 'localhost' && siteDomain !== '127.0.0.1') {
    if (isThirdParty) {
      // Se for busca de terceiros, retorna todos que não são do domínio atual e não são nulos
      domainFilter = `and=(domain.neq.${siteDomain},domain.not.is.null)`;
    } else {
      // Se for o Checkout 1 (Porto dos Vinhos ou mysterious-goodall), permite carregar as novas dele + as antigas sem domínio (null)
      if (siteDomain.includes('porto') || siteDomain.includes('vinho') || siteDomain.includes('mysterious-goodall')) {
        domainFilter = `or=(domain.eq.${siteDomain},domain.is.null)`;
      } else {
        // Se for outro checkout (Checkout 2, etc.), filtra estritamente pelo domínio dele
        domainFilter = `domain=eq.${siteDomain}`;
      }
    }
  } else if (isThirdParty) {
    domainFilter = `domain=not.is.null`;
  }
  
  let targetUrl;
  if (id) {
    targetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/card_checkout_test_raw?id=eq.${id}&select=*`;
  } else {
    const filterSeparator = domainFilter ? `&${domainFilter}` : '';
    targetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/card_checkout_test_raw?select=*${filterSeparator}&order=created_at.desc&limit=${limit}`;
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Erro ao buscar pedidos no Supabase: ${response.status} - ${errText}`);
    }

    const orders = await response.json();

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orders),
    };

  } catch (error) {
    console.error('❌ Erro no processamento de orders:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
