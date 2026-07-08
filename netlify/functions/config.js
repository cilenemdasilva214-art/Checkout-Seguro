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
  const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Configuração do banco de dados ausente no backend.' }),
    };
  }

  const targetUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/checkout_configs`;

  // === AUTENTICAÇÃO ===
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  let isAuthenticated = false;
  
  if (token) {
    const authResponse = await fetch(`${targetUrl}?select=*&key=eq.admin_session_token`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    const authRows = await authResponse.json();
    const dbToken = (authRows && authRows.length > 0) ? authRows[0].value : null;
    
    if (dbToken && dbToken === token) {
      isAuthenticated = true;
    }
  }

  // POST requires authentication
  if (event.httpMethod === 'POST' && !isAuthenticated) {
    return { statusCode: 401, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Sessão inválida ou expirada.' }) };
  }
  // ====================

  try {
    // GET: Buscar configurações
    if (event.httpMethod === 'GET') {
      const response = await fetch(`${targetUrl}?select=*`, {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn('⚠️ Tabela checkout_configs não encontrada ou erro na busca. Retornando valores padrão.');
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            facebook_pixel_id: '',
            facebook_pixel_token: '',
            ads_expense: '0.00',
            shipping_standard_name: 'Frete PAC',
            shipping_standard_time: '3 dias para entrega',
            shipping_standard_price: '15.00',
            shipping_express_name: 'Frete Expresso',
            shipping_express_time: 'de 3 a 5 dias',
            shipping_express_price: '25.00',
            discount_pix_percent: '10',
            checkout_theme_config: '',
            table_missing: true
          })
        };
      }

      const configs = await response.json();
      const result = {
        facebook_pixel_id: '',
        facebook_pixel_token: '',
        facebook_pixels: '[]',
        ads_expense: '0.00',
        shipping_standard_name: 'Frete PAC',
        shipping_standard_time: '3 dias para entrega',
        shipping_standard_price: '15.00',
        shipping_express_name: 'Frete Expresso',
        shipping_express_time: 'de 3 a 5 dias',
        shipping_express_price: '25.00',
        discount_pix_percent: '10',
        checkout_theme_config: '',
        checkout_page_title: 'Checkout Seguro',
        checkout_wa_store_name: 'Nome da Loja',
        checkout_wa_msg_confirmed_v2: '',
        checkout_wa_msg_shipped_v2: '',
        checkout_wa_msg_pix_v2: '',
        checkout_wa_msg_card_v2: '',
        active_gateway: 'paguex'
      };

      if (isAuthenticated) {
        result.admin_username = 'admin';
        result.admin_password = '123456789';
        result.paguex_public_key = '';
        result.paguex_secret_key = '';
        result.hypercash_public_key = '';
        result.hypercash_secret_key = '';
        result.payshark_public_key = '';
        result.payshark_secret_key = '';
        result.payshark_v2_api_key = '';
        result.payshark_v2_webhook_secret = '';
        result.pagueflex_api_key = '';
        result.pagueflex_transfer_key = '';
        result.pagueflex_webhook_secret = '';
      }
 
      configs.forEach(c => {
        if (c.key === 'facebook_pixel_id') result.facebook_pixel_id = c.value;
        if (c.key === 'facebook_pixel_token') result.facebook_pixel_token = c.value;
        if (c.key === 'facebook_pixels') result.facebook_pixels = c.value;
        if (c.key === 'ads_expense') result.ads_expense = c.value;
        if (c.key === 'shipping_standard_name') result.shipping_standard_name = c.value;
        if (c.key === 'shipping_standard_time') result.shipping_standard_time = c.value;
        if (c.key === 'shipping_standard_price') result.shipping_standard_price = c.value;
        if (c.key === 'shipping_express_name') result.shipping_express_name = c.value;
        if (c.key === 'shipping_express_time') result.shipping_express_time = c.value;
        if (c.key === 'shipping_express_price') result.shipping_express_price = c.value;
        if (c.key === 'discount_pix_percent') result.discount_pix_percent = c.value;
        if (c.key === 'checkout_theme_config') result.checkout_theme_config = c.value;
        if (c.key === 'checkout_page_title') result.checkout_page_title = c.value;
        if (c.key === 'checkout_wa_store_name') result.checkout_wa_store_name = c.value;
        if (c.key === 'checkout_wa_msg_confirmed_v2') result.checkout_wa_msg_confirmed_v2 = c.value;
        if (c.key === 'checkout_wa_msg_shipped_v2') result.checkout_wa_msg_shipped_v2 = c.value;
        if (c.key === 'checkout_wa_msg_pix_v2') result.checkout_wa_msg_pix_v2 = c.value;
        if (c.key === 'checkout_wa_msg_card_v2') result.checkout_wa_msg_card_v2 = c.value;
        if (c.key === 'active_gateway') result.active_gateway = c.value;
        
        if (isAuthenticated) {
          if (c.key === 'admin_username') result.admin_username = c.value;
          if (c.key === 'admin_password') result.admin_password = c.value;
          if (c.key === 'paguex_public_key') result.paguex_public_key = c.value;
          if (c.key === 'paguex_secret_key') result.paguex_secret_key = c.value;
          if (c.key === 'hypercash_public_key') result.hypercash_public_key = c.value;
          if (c.key === 'hypercash_secret_key') result.hypercash_secret_key = c.value;
          if (c.key === 'payshark_public_key') result.payshark_public_key = c.value;
          if (c.key === 'payshark_secret_key') result.payshark_secret_key = c.value;
          if (c.key === 'payshark_v2_api_key') result.payshark_v2_api_key = c.value;
          if (c.key === 'payshark_v2_webhook_secret') result.payshark_v2_webhook_secret = c.value;
          if (c.key === 'pagueflex_api_key') result.pagueflex_api_key = c.value;
          if (c.key === 'pagueflex_transfer_key') result.pagueflex_transfer_key = c.value;
          if (c.key === 'pagueflex_webhook_secret') result.pagueflex_webhook_secret = c.value;
        }
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
      const { 
        facebook_pixel_id, 
        facebook_pixel_token, 
        facebook_pixels,
        ads_expense, 
        admin_username, 
        admin_password,
        shipping_standard_name,
        shipping_standard_time,
        shipping_standard_price,
        shipping_express_name,
        shipping_express_time,
        shipping_express_price,
        discount_pix_percent,
        checkout_theme_config,
        checkout_page_title,
        checkout_wa_store_name,
        checkout_wa_msg_confirmed_v2,
        checkout_wa_msg_shipped_v2,
        checkout_wa_msg_pix_v2,
        checkout_wa_msg_card_v2,
        active_gateway,
        paguex_public_key,
        paguex_secret_key,
        hypercash_public_key,
        hypercash_secret_key,
        payshark_public_key,
        payshark_secret_key,
        payshark_v2_api_key,
        payshark_v2_webhook_secret,
        pagueflex_api_key,
        pagueflex_transfer_key,
        pagueflex_webhook_secret
      } = data;
 
      const payloads = [];
      if (facebook_pixel_id !== undefined) payloads.push({ key: 'facebook_pixel_id', value: (facebook_pixel_id || '').trim() });
      if (facebook_pixel_token !== undefined) payloads.push({ key: 'facebook_pixel_token', value: (facebook_pixel_token || '').trim() });
      if (facebook_pixels !== undefined) payloads.push({ key: 'facebook_pixels', value: (facebook_pixels || '').trim() });
      if (ads_expense !== undefined) payloads.push({ key: 'ads_expense', value: (ads_expense || '0.00').trim() });
      if (admin_username !== undefined) payloads.push({ key: 'admin_username', value: (admin_username || 'admin').trim() });
      if (admin_password !== undefined) payloads.push({ key: 'admin_password', value: (admin_password || '123456789').trim() });
      
      if (shipping_standard_name !== undefined) payloads.push({ key: 'shipping_standard_name', value: (shipping_standard_name || 'Frete PAC').trim() });
      if (shipping_standard_time !== undefined) payloads.push({ key: 'shipping_standard_time', value: (shipping_standard_time || '3 dias para entrega').trim() });
      if (shipping_standard_price !== undefined) payloads.push({ key: 'shipping_standard_price', value: (shipping_standard_price || '15.00').trim() });
      
      if (shipping_express_name !== undefined) payloads.push({ key: 'shipping_express_name', value: (shipping_express_name || 'Frete Expresso').trim() });
      if (shipping_express_time !== undefined) payloads.push({ key: 'shipping_express_time', value: (shipping_express_time || 'de 3 a 5 dias').trim() });
      if (shipping_express_price !== undefined) payloads.push({ key: 'shipping_express_price', value: (shipping_express_price || '25.00').trim() });
      if (discount_pix_percent !== undefined) payloads.push({ key: 'discount_pix_percent', value: (discount_pix_percent || '10').trim() });
      if (checkout_theme_config !== undefined) payloads.push({ key: 'checkout_theme_config', value: (checkout_theme_config || '').trim() });
      if (checkout_page_title !== undefined) payloads.push({ key: 'checkout_page_title', value: (checkout_page_title || '').trim() });
      if (checkout_wa_store_name !== undefined) payloads.push({ key: 'checkout_wa_store_name', value: (checkout_wa_store_name || '').trim() });
      if (checkout_wa_msg_confirmed_v2 !== undefined) payloads.push({ key: 'checkout_wa_msg_confirmed_v2', value: (checkout_wa_msg_confirmed_v2 || '').trim() });
      if (checkout_wa_msg_shipped_v2 !== undefined) payloads.push({ key: 'checkout_wa_msg_shipped_v2', value: (checkout_wa_msg_shipped_v2 || '').trim() });
      if (checkout_wa_msg_pix_v2 !== undefined) payloads.push({ key: 'checkout_wa_msg_pix_v2', value: (checkout_wa_msg_pix_v2 || '').trim() });
      if (checkout_wa_msg_card_v2 !== undefined) payloads.push({ key: 'checkout_wa_msg_card_v2', value: (checkout_wa_msg_card_v2 || '').trim() });
      if (active_gateway !== undefined) payloads.push({ key: 'active_gateway', value: (active_gateway || 'paguex').trim() });
      if (paguex_public_key !== undefined) payloads.push({ key: 'paguex_public_key', value: (paguex_public_key || '').trim() });
      if (paguex_secret_key !== undefined) payloads.push({ key: 'paguex_secret_key', value: (paguex_secret_key || '').trim() });
      if (hypercash_public_key !== undefined) payloads.push({ key: 'hypercash_public_key', value: (hypercash_public_key || '').trim() });
      if (hypercash_secret_key !== undefined) payloads.push({ key: 'hypercash_secret_key', value: (hypercash_secret_key || '').trim() });
      if (payshark_public_key !== undefined) payloads.push({ key: 'payshark_public_key', value: (payshark_public_key || '').trim() });
      if (payshark_secret_key !== undefined) payloads.push({ key: 'payshark_secret_key', value: (payshark_secret_key || '').trim() });
      if (payshark_v2_api_key !== undefined) payloads.push({ key: 'payshark_v2_api_key', value: (payshark_v2_api_key || '').trim() });
      if (payshark_v2_webhook_secret !== undefined) payloads.push({ key: 'payshark_v2_webhook_secret', value: (payshark_v2_webhook_secret || '').trim() });
      if (pagueflex_api_key !== undefined) payloads.push({ key: 'pagueflex_api_key', value: (pagueflex_api_key || '').trim() });
      if (pagueflex_transfer_key !== undefined) payloads.push({ key: 'pagueflex_transfer_key', value: (pagueflex_transfer_key || '').trim() });
      if (pagueflex_webhook_secret !== undefined) payloads.push({ key: 'pagueflex_webhook_secret', value: (pagueflex_webhook_secret || '').trim() });

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
