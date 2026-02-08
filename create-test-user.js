/**
 * Create Test User
 * Creates a test user account on the backend
 */

const BACKEND_URL = 'https://optionsengines.fly.dev';
const EMAIL = process.env.TEST_EMAIL || 'test@example.com';
const PASSWORD = process.env.TEST_PASSWORD || 'TestPassword123!';

async function createUser() {
  console.log('👤 Creating test user...');
  console.log(`   Email: ${EMAIL}`);
  console.log(`   Password: ${PASSWORD}\n`);
  
  try {
    const response = await fetch(`${BACKEND_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
        name: 'Test User',
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 409) {
        console.log('ℹ️  User already exists, trying to login instead...\n');
        return await loginUser();
      }
      throw new Error(`Registration failed: ${response.status} - ${data.error || data.message}`);
    }
    
    console.log('✅ User created successfully!');
    console.log(`   Token: ${data.token}\n`);
    
    console.log('💾 Save this token as BACKEND_TOKEN for E2E tests:\n');
    console.log(`export BACKEND_TOKEN="${data.token}"`);
    console.log(`# or on Windows:`);
    console.log(`$env:BACKEND_TOKEN="${data.token}"\n`);
    
    return data.token;
  } catch (error) {
    console.error('❌ Failed to create user:', error.message);
    throw error;
  }
}

async function loginUser() {
  console.log('🔐 Logging in...');
  
  try {
    const response = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
      }),
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(`Login failed: ${response.status} - ${data.error || data.message}`);
    }
    
    console.log('✅ Logged in successfully!');
    console.log(`   Token: ${data.token}\n`);
    
    console.log('💾 Save this token as BACKEND_TOKEN for E2E tests:\n');
    console.log(`export BACKEND_TOKEN="${data.token}"`);
    console.log(`# or on Windows:`);
    console.log(`$env:BACKEND_TOKEN="${data.token}"\n`);
    
    return data.token;
  } catch (error) {
    console.error('❌ Failed to login:', error.message);
    throw error;
  }
}

createUser().catch(() => process.exit(1));
