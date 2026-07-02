// Netlify Serverless Function: woocommerce
// Caminho: netlify/functions/woocommerce.js

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

  let storeDomain = '';
  let consumerKey = '';
  let consumerSecret = '';
  let themeConfigStr = '';

  // Carregar credenciais dinâmicas do Supabase (tabela checkout_configs)
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      const configUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/checkout_configs?select=*`;
      const configRes = await fetch(configUrl, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (configRes.ok) {
        const configs = await configRes.json();
        configs.forEach(c => {
          if (c.key === 'checkout_theme_config') themeConfigStr = c.value;
        });

        if (themeConfigStr) {
          const themeConfig = JSON.parse(themeConfigStr);
          if (themeConfig.wooCommerceDomain) {
            storeDomain = themeConfig.wooCommerceDomain.trim();
          }
          if (themeConfig.wooCommerceConsumerKey) {
            consumerKey = themeConfig.wooCommerceConsumerKey.trim();
          }
          if (themeConfig.wooCommerceConsumerSecret) {
            consumerSecret = themeConfig.wooCommerceConsumerSecret.trim();
          }
        }
      }
    } catch (err) {
      console.error('Erro ao buscar credenciais dinâmicas do WooCommerce:', err);
    }
  }

  const action = event.queryStringParameters ? (event.queryStringParameters.action || 'products') : 'products';

  if (!storeDomain || !consumerKey || !consumerSecret) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Credenciais do WooCommerce ausentes ou não configuradas no painel.' }),
    };
  }

  const authHeader = 'Basic ' + Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const headers = {
    'Authorization': authHeader,
    'Content-Type': 'application/json'
  };

  try {
    // ----------------------------------------------------
    // AÇÃO: BUSCAR PRODUTOS
    // ----------------------------------------------------
    if (action === 'products' && event.httpMethod === 'GET') {
      const url = `https://${storeDomain}/wp-json/wc/v3/products?per_page=100`;
      console.log(`📡 Buscando produtos do WooCommerce em: ${url}`);
      
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errText = await response.text();
        return {
          statusCode: response.status,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: `Erro na API do WooCommerce: ${response.status}`, details: errText }),
        };
      }

      const products = await response.json();
      console.log(`✅ Total de produtos carregados: ${products.length}`);

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify(products),
      };
    }

    // ----------------------------------------------------
    // AÇÃO: VALIDAR CUPOM
    // ----------------------------------------------------
    if (action === 'validate_coupon' && event.httpMethod === 'GET') {
      const code = event.queryStringParameters.code;
      if (!code) {
        return {
          statusCode: 400,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'O código do cupom é obrigatório.' }),
        };
      }

      const url = `https://${storeDomain}/wp-json/wc/v3/coupons?code=${encodeURIComponent(code)}`;
      console.log(`📡 Validando cupom do WooCommerce em: ${url}`);
      
      const response = await fetch(url, { headers });

      if (!response.ok) {
        return {
          statusCode: response.status,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Erro ao consultar cupom no WooCommerce.' }),
        };
      }

      const coupons = await response.json();
      
      if (!coupons || coupons.length === 0) {
        return {
          statusCode: 404,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({ valid: false, error: 'Cupom não encontrado.' }),
        };
      }

      const coupon = coupons[0];
      
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          valid: true,
          code: coupon.code,
          amount: coupon.amount,
          discount_type: coupon.discount_type, // 'percent', 'fixed_cart', 'fixed_product'
          description: coupon.description,
          minimum_amount: coupon.minimum_amount,
          maximum_amount: coupon.maximum_amount,
          free_shipping: coupon.free_shipping
        }),
      };
    }

    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Ação inválida: ${action}` }),
    };

  } catch (error) {
    console.error('❌ Erro no processamento do WooCommerce Function:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }),
    };
  }
};
