const https = require('https');

const SUPABASE_URL = 'https://lqwexpieqikhudcsnzdg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxxd2V4cGllcWlraHVkY3NuemRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxNDc0MzAsImV4cCI6MjA5NDcyMzQzMH0.FtUzSzya2vpgNRR3iHqAQBozDiunwbHF_6q0aGKXZH8';

const targetUrl = `${SUPABASE_URL}/rest/v1/checkout_configs?select=*`;

const options = {
    method: 'GET',
    headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
    }
};

https.get(targetUrl, options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        if (res.statusCode === 200) {
            const configs = JSON.parse(data);
            configs.forEach(c => {
                if (c.key === 'checkout_theme_config') {
                    const theme = JSON.parse(c.value);
                    console.log('Client ID:', theme.shopifyClientId);
                    console.log('Secret:', theme.shopifySecret);
                    console.log('Token:', theme.shopifyToken);
                    console.log('Domain:', theme.shopifyDomain);
                }
            });
        } else {

            console.log(`Error: ${data}`);
        }
    });
}).on('error', (e) => {
    console.error(e);
});
