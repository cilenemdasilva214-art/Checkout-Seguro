const https = require('https');

const options = {
    hostname: 'checkoutt-seguro.netlify.app',
    port: 443,
    path: '/api/marketing?type=coupon',
    method: 'GET'
};

const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log(`Status: ${res.statusCode}`);
        console.log(`Response: ${data}`);
    });
});

req.on('error', (e) => {
    console.error(e);
});
req.end();
