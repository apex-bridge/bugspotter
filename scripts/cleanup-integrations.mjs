#!/usr/bin/env node
import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000';

async function cleanup() {
  try {
    // Get admin token
    const loginResp = await axios.post(`${API_BASE_URL}/api/v1/auth/login`, {
      email: 'admin@bugspotter.io',
      password: 'admin123',
    });

    const token = loginResp.data.data.access_token;
    console.log('✅ Got admin token\n');

    // Get all integrations
    const integrations = await axios.get(`${API_BASE_URL}/api/v1/admin/integrations`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const integrationList = integrations.data.data;
    console.log(`Found ${integrationList.length} integration(s)\n`);

    if (integrationList.length === 0) {
      console.log('✅ No integrations to clean up');
      return;
    }

    // Delete each one
    for (const integration of integrationList) {
      console.log(`Deleting ${integration.type} (${integration.name})...`);
      try {
        await axios.delete(`${API_BASE_URL}/api/v1/admin/integrations/${integration.type}/config`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        console.log(`  ✅ Deleted ${integration.type}`);
      } catch (e) {
        console.log(`  ⚠️  Failed: ${e.response?.data?.message || e.message}`);
      }
    }

    console.log('\n✅ Cleanup complete');
  } catch (error) {
    console.error('❌ Cleanup failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

cleanup();
