import axios from 'axios';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../web/.env.local') });

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

async function testAuth() {
  try {
    console.log('1. Attempting Firebase Auth Login...');
    const email = 'test_integration_' + Date.now() + '@example.com';
    const password = 'password123';
    
    // Create the test user
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    console.log('✅ Firebase user created:', user.uid);
    
    console.log('\n2. Generating Firebase ID Token...');
    const token = await user.getIdToken();
    console.log('✅ Token generated successfully');
    
    console.log('\n3. Calling Backend /api/v1/auth/me to verify token & auto-create PostgreSQL user...');
    const response = await axios.get('http://localhost:4000/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    console.log('✅ Backend Verification Successful!');
    console.log('User Record:', response.data.data);
    
    console.log('\n🚀 COMPLETE AUTHENTICATION FLOW TEST PASSED!');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Authentication flow failed!');
    console.error(error.response?.data || error.message);
    process.exit(1);
  }
}

testAuth();
