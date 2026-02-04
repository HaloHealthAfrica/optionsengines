import bcrypt from 'bcrypt';

const password = process.argv[2] || 'admin123';
const saltRounds = 10;

bcrypt.hash(password, saltRounds, (err, hash) => {
  if (err) {
    console.error('Error generating hash:', err);
    process.exit(1);
  }
  
  console.log('Password:', password);
  console.log('Hash:', hash);
  console.log('\nUse this hash in your SQL migration:');
  console.log(`'${hash}'`);
});
