// Netlify Serverless Function: orders
// Caminho: netlify/functions/orders.js

exports.handler = async (event, context) => {
  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
      },
      body: JSON.stringify({ message: 'Successful preflight' }),
    };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'DELETE') {
    return {
      statusCode: 405,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Método não permitido. Use GET ou DELETE.' }),
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

  // Obter parâmetros da query string (limites, etc.)
  const id = event.queryStringParameters ? event.queryStringParameters.id : null;
  const limit = (event.queryStringParameters && event.queryStringParameters.limit) || '1000';

  // Detectar o domínio de onde partiu a requisição (através do referer)
  const referer = event.headers.referer || event.headers.referrer || '';
  let requestDomain = '';
  if (referer) {
    try {
      const refUrl = new URL(referer);
      requestDomain = refUrl.hostname;
    } catch (e) {
      console.warn('⚠️ Falha ao fazer parse do referer:', e.message);
    }
  }

  // Se houver um domínio configurado no Netlify (CHECKOUT_DOMAIN), use ele, senão use o hostname detectado
  const siteDomain = process.env.CHECKOUT_DOMAIN || requestDomain || '';

  let domainFilter = '';
  if (siteDomain && siteDomain !== 'localhost' && siteDomain !== '127.0.0.1') {
    // Se for o Checkout 1 (Porto dos Vinhos ou mysterious-goodall), permite carregar as novas dele + as antigas sem domínio (null)
    if (siteDomain.includes('porto') || siteDomain.includes('vinho') || siteDomain.includes('mysterious-goodall')) {
      domainFilter = `or=(domain.eq.${siteDomain},domain.is.null)`;
    } else {
      // Se for outro checkout (Checkout 2, etc.), filtra estritamente pelo domínio dele
      domainFilter = `domain=eq.${siteDomain}`;
    }
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
