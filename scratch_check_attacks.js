const fs = require('fs');
const env = fs.readFileSync('.env', 'utf-8');
const SUPABASE_URL = env.match(/SUPABASE_URL=(.+)/)[1].trim();
const SUPABASE_ANON_KEY = env.match(/SUPABASE_ANON_KEY=(.+)/)[1].trim();

async function check() {
  // Check recent transactions
  const txRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?select=*&order=created_at.desc&limit=10`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
  });
  const transactions = await txRes.json();
  
  console.log('--- RECENT TRANSACTIONS ---');
  transactions.forEach(t => {
    console.log(`ID: ${t.id} | Status: ${t.status} | Amount: ${t.amount} | Name: ${t.customer_name} | Created: ${t.created_at}`);
  });

  // Check logs
  const configRes = await fetch(`${SUPABASE_URL}/rest/v1/checkout_configs?select=value&key=eq.admin_logs`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
  });
  const configRow = await configRes.json();
  
  console.log('\n--- SECURITY LOGS ---');
  if (configRow && configRow.length > 0) {
    const logs = JSON.parse(configRow[0].value || '[]');
    logs.slice(0, 5).forEach(l => {
      console.log(`[${l.timestamp}] ${l.type.toUpperCase()}: ${l.message} (IP: ${l.ip})`);
    });
  }
}
check();
