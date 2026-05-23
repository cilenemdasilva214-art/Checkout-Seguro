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
            admin_username: 'admin',
            admin_password: '123456789',
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
        admin_username: 'admin',
        admin_password: '123456789',
        shipping_standard_name: 'Frete PAC',
        shipping_standard_time: '3 dias para entrega',
        shipping_standard_price: '15.00',
        shipping_express_name: 'Frete Expresso',
        shipping_express_time: 'de 3 a 5 dias',
        shipping_express_price: '25.00',
        discount_pix_percent: '10',
        checkout_theme_config: '',
        checkout_wa_store_name: 'Nome da Loja',
        checkout_wa_msg_confirmed: '',
        checkout_wa_msg_shipped: '',
        checkout_wa_msg_pix: '',
        checkout_wa_msg_card: ''
      };

      configs.forEach(c => {
        if (c.key === 'facebook_pixel_id') result.facebook_pixel_id = c.value;
        if (c.key === 'facebook_pixel_token') result.facebook_pixel_token = c.value;
        if (c.key === 'facebook_pixels') result.facebook_pixels = c.value;
        if (c.key === 'ads_expense') result.ads_expense = c.value;
        if (c.key === 'admin_username') result.admin_username = c.value;
        if (c.key === 'admin_password') result.admin_password = c.value;
        if (c.key === 'shipping_standard_name') result.shipping_standard_name = c.value;
        if (c.key === 'shipping_standard_time') result.shipping_standard_time = c.value;
        if (c.key === 'shipping_standard_price') result.shipping_standard_price = c.value;
        if (c.key === 'shipping_express_name') result.shipping_express_name = c.value;
        if (c.key === 'shipping_express_time') result.shipping_express_time = c.value;
        if (c.key === 'shipping_express_price') result.shipping_express_price = c.value;
        if (c.key === 'discount_pix_percent') result.discount_pix_percent = c.value;
        if (c.key === 'checkout_theme_config') result.checkout_theme_config = c.value;
        if (c.key === 'checkout_wa_store_name') result.checkout_wa_store_name = c.value;
        if (c.key === 'checkout_wa_msg_confirmed') result.checkout_wa_msg_confirmed = c.value;
        if (c.key === 'checkout_wa_msg_shipped') result.checkout_wa_msg_shipped = c.value;
        if (c.key === 'checkout_wa_msg_pix') result.checkout_wa_msg_pix = c.value;
        if (c.key === 'checkout_wa_msg_card') result.checkout_wa_msg_card = c.value;
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
        checkout_wa_store_name,
        checkout_wa_msg_confirmed,
        checkout_wa_msg_shipped,
        checkout_wa_msg_pix,
        checkout_wa_msg_card
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
      if (checkout_wa_store_name !== undefined) payloads.push({ key: 'checkout_wa_store_name', value: (checkout_wa_store_name || '').trim() });
      if (checkout_wa_msg_confirmed !== undefined) payloads.push({ key: 'checkout_wa_msg_confirmed', value: (checkout_wa_msg_confirmed || '').trim() });
      if (checkout_wa_msg_shipped !== undefined) payloads.push({ key: 'checkout_wa_msg_shipped', value: (checkout_wa_msg_shipped || '').trim() });
      if (checkout_wa_msg_pix !== undefined) payloads.push({ key: 'checkout_wa_msg_pix', value: (checkout_wa_msg_pix || '').trim() });
      if (checkout_wa_msg_card !== undefined) payloads.push({ key: 'checkout_wa_msg_card', value: (checkout_wa_msg_card || '').trim() });

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
