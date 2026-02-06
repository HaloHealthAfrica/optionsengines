// Script to create a test user
import https from 'https';

const BACKEND_URL = 'optionsengines.fly.dev';
const TEST_EMAIL = 'test@optionagents.ai';
const TEST_PASSWORD = 'TestPassword123!';

function makeRequest(path, method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    
    const options = {
      hostname: BACKEND_URL,
      port: 443,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };

    const req = https.request(options, (res) => {
      let responseBody = '';
      
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(responseBody);
          resolve({ status: res.statusCode, data: response });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseBody });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

async function createUser() {
  console.log('🔧 Creating test user...\n');
  console.log(`Email: ${TEST_EMAIL}`);
  console.log(`Password: ${TEST_PASSWORD}`);
  console.log('');

  try {
    const result = await makeRequest('/auth/register', 'POST', {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      role: 'admin',
    });

    if (result.status === 200 && result.data.success) {
      console.log('✅ User created successfully!');
      console.log('');
      console.log('User Details:');
      console.log(`  Email: ${result.data.user.email}`);
      console.log(`  Role: ${result.data.user.role}`);
      console.log(`  User ID: ${result.data.user.user_id}`);
      console.log('');
      console.log('🔑 Token:', result.data.token.substring(0, 30) + '...');
      console.log('');
      console.log('✨ You can now run the data source tests with:');
      console.log(`   TEST_EMAIL="${TEST_EMAIL}" TEST_PASSWORD="${TEST_PASSWORD}" node test-data-sources-auth.js`);
    } else {
      console.log('❌ Failed to create user');
      console.log('Response:', JSON.stringify(result.data, null, 2));
      
      if (result.data.error && result.data.error.includes('already exists')) {
        console.log('');
        console.log('💡 User already exists! You can use these credentials:');
        console.log(`   TEST_EMAIL="${TEST_EMAIL}" TEST_PASSWORD="${TEST_PASSWORD}" node test-data-sources-auth.js`);
      }
    }
  } catch (error) {
    console.log('❌ Error:', error.message);
  }
}

createUser();
