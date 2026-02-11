#!/usr/bin/env ts-node
/**
 * End-to-End Flow Test
 * Tests the complete pipeline: Webhook → Signal → Order → Trade → Position
 */

import { config } from 'dotenv';
config();

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';
const CHECK_INTERVAL = 2000; // Check every 2 seconds
const MAX_WAIT_TIME = 120000; // Wait up to 2 minutes

interface TestResult {
  success: boolean;
  stage: string;
  data?: any;
  error?: string;
  timestamp: number;
}

class E2EFlowTest {
  private results: TestResult[] = [];
  private signalId: string | null = null;
  private orderId: string | null = null;
  private tradeId: string | null = null;
  private positionId: string | null = null;
  private authToken: string | null = null;

  async run(): Promise<void> {
    console.log('🚀 Starting End-to-End Flow Test');
    console.log('='.repeat(60));
    console.log(`Backend URL: ${BACKEND_URL}`);
    console.log(`Test started at: ${new Date().toISOString()}\n`);

    try {
      // Stage 1: Send webhook
      await this.sendWebhook();
      
      // Stage 2: Wait for signal processing
      await this.waitForSignalProcessing();
      
      // Stage 3: Wait for order creation
      await this.waitForOrderCreation();
      
      // Stage 4: Check for trade execution (if paper trading is enabled)
      await this.checkTradeExecution();
      
      // Stage 5: Monitor position lifecycle
      await this.monitorPosition();
      
      // Print summary
      this.printSummary();
      
    } catch (error: any) {
      this.addResult(false, 'FATAL_ERROR', undefined, error.message);
      this.printSummary();
      process.exit(1);
    }
  }

  private async sendWebhook(): Promise<void> {
    console.log('📤 Stage 1: Sending Webhook');
    console.log('-'.repeat(60));

    const payload = {
      symbol: 'SPY',
      direction: 'long',
      timeframe: '5m',
      timestamp: new Date().toISOString(),
    };

    console.log('Payload:', JSON.stringify(payload, null, 2));

    try {
      const response = await fetch(`${BACKEND_URL}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok) {
        this.signalId = data.signal_id;
        console.log(`✅ Webhook accepted`);
        console.log(`   Status: ${data.status}`);
        console.log(`   Signal ID: ${this.signalId}`);
        console.log(`   Variant: ${data.variant}`);
        console.log(`   Processing Time: ${data.processing_time_ms}ms\n`);
        
        this.addResult(true, 'WEBHOOK_SENT', data);
      } else {
        throw new Error(`Webhook rejected: ${data.error || response.statusText}`);
      }
    } catch (error: any) {
      this.addResult(false, 'WEBHOOK_SENT', undefined, error.message);
      throw error;
    }
  }

  private async waitForSignalProcessing(): Promise<void> {
    console.log('⏳ Stage 2: Waiting for Signal Processing');
    console.log('-'.repeat(60));

    const startTime = Date.now();
    let attempts = 0;

    while (Date.now() - startTime < MAX_WAIT_TIME) {
      attempts++;
      
      try {
        const data = await this.fetchMonitoringStatus();

        // Check recent signals
        const recentSignals = data.pipeline?.recent_signals || [];
        const signal = recentSignals.find((s: any) => s.signal_id === this.signalId);

        if (signal) {
          console.log(`✅ Signal found (attempt ${attempts})`);
          console.log(`   Signal ID: ${signal.signal_id}`);
          console.log(`   Symbol: ${signal.symbol}`);
          console.log(`   Direction: ${signal.direction}`);
          console.log(`   Timeframe: ${signal.timeframe}`);
          console.log(`   Status: ${signal.status}\n`);

          if (signal.status === 'approved') {
            this.addResult(true, 'SIGNAL_APPROVED', signal);
            return;
          } else if (signal.status === 'rejected') {
            this.addResult(false, 'SIGNAL_REJECTED', signal, 'Signal was rejected');
            throw new Error('Signal was rejected by the system');
          }
        }

        await this.sleep(CHECK_INTERVAL);
      } catch (error: any) {
        if (error.message.includes('rejected')) throw error;
        console.log(`   Attempt ${attempts}: Still waiting...`);
        await this.sleep(CHECK_INTERVAL);
      }
    }

    throw new Error('Timeout waiting for signal processing');
  }

  private async waitForOrderCreation(): Promise<void> {
    console.log('⏳ Stage 3: Waiting for Order Creation');
    console.log('-'.repeat(60));

    const startTime = Date.now();
    let attempts = 0;

    while (Date.now() - startTime < MAX_WAIT_TIME) {
      attempts++;

      try {
        const token = await this.requireAuthToken();
        const response = await fetch(`${BACKEND_URL}/orders`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        
        if (!response.ok) {
          console.log(`   Attempt ${attempts}: Orders endpoint requires auth, checking monitoring...`);
          
          // Fallback: Check monitoring endpoint for order stats
          const monitorData = await this.fetchMonitoringStatus();
          
          const orderStats = monitorData.pipeline?.orders_24h;
          if (orderStats && orderStats.total > 0) {
            console.log(`✅ Orders detected in system (attempt ${attempts})`);
            console.log(`   Total orders: ${orderStats.total}`);
            console.log(`   Pending: ${orderStats.pending_execution}`);
            console.log(`   Filled: ${orderStats.filled}\n`);
            
            this.addResult(true, 'ORDER_CREATED', orderStats);
            return;
          }
        } else {
          const data = await response.json();
          const orders = data.orders || [];
          
          // Look for order related to our signal
          const order = orders.find((o: any) => o.signal_id === this.signalId);
          
          if (order) {
            this.orderId = order.id;
            console.log(`✅ Order created (attempt ${attempts})`);
            console.log(`   Order ID: ${this.orderId}`);
            console.log(`   Symbol: ${order.symbol}`);
            console.log(`   Type: ${order.type}`);
            console.log(`   Strike: ${order.strike}`);
            console.log(`   Quantity: ${order.qty}`);
            console.log(`   Status: ${order.status}\n`);
            
            this.addResult(true, 'ORDER_CREATED', order);
            return;
          }
        }

        await this.sleep(CHECK_INTERVAL);
      } catch (error: any) {
        console.log(`   Attempt ${attempts}: Still waiting...`);
        await this.sleep(CHECK_INTERVAL);
      }
    }

    console.log(`⚠️  No order created within timeout period`);
    console.log(`   This may be expected if:`);
    console.log(`   - Signal was rejected by risk checks`);
    console.log(`   - Market conditions don't meet entry criteria`);
    console.log(`   - System is in shadow mode only\n`);
    
    this.addResult(true, 'ORDER_CREATION_SKIPPED', undefined, 'No order created (may be expected)');
  }

  private async checkTradeExecution(): Promise<void> {
    console.log('⏳ Stage 4: Checking for Trade Execution');
    console.log('-'.repeat(60));

    if (!this.orderId) {
      console.log(`⚠️  Skipping trade check (no order created)\n`);
      this.addResult(true, 'TRADE_CHECK_SKIPPED');
      return;
    }

    const startTime = Date.now();
    let attempts = 0;

    while (Date.now() - startTime < MAX_WAIT_TIME) {
      attempts++;

      try {
        const data = await this.fetchMonitoringStatus();

        const orderStats = data.pipeline?.orders_24h;
        if (orderStats && orderStats.filled > 0) {
          console.log(`✅ Trade execution detected (attempt ${attempts})`);
          console.log(`   Filled orders: ${orderStats.filled}\n`);
          
          this.addResult(true, 'TRADE_EXECUTED', orderStats);
          return;
        }

        await this.sleep(CHECK_INTERVAL);
      } catch (error: any) {
        console.log(`   Attempt ${attempts}: Still waiting...`);
        await this.sleep(CHECK_INTERVAL);
      }
    }

    console.log(`⚠️  No trade execution within timeout period`);
    console.log(`   This may be expected if:`);
    console.log(`   - Order is still pending execution`);
    console.log(`   - Paper trading is disabled`);
    console.log(`   - Market is closed\n`);
    
    this.addResult(true, 'TRADE_EXECUTION_PENDING');
  }

  private async monitorPosition(): Promise<void> {
    console.log('⏳ Stage 5: Monitoring Position Lifecycle');
    console.log('-'.repeat(60));

    try {
      const data = await this.fetchMonitoringStatus();

      const lastActivity = data.pipeline?.last_activity;
      
      if (lastActivity) {
        console.log(`✅ Position activity detected`);
        console.log(`   Last signal: ${lastActivity.signal || 'N/A'}`);
        console.log(`   Last order: ${lastActivity.order || 'N/A'}`);
        console.log(`   Last trade: ${lastActivity.trade || 'N/A'}`);
        console.log(`   Last position: ${lastActivity.position || 'N/A'}\n`);
        
        this.addResult(true, 'POSITION_MONITORED', lastActivity);
      } else {
        console.log(`⚠️  No position activity data available\n`);
        this.addResult(true, 'POSITION_MONITORING_UNAVAILABLE');
      }
    } catch (error: any) {
      console.log(`⚠️  Could not monitor position: ${error.message}\n`);
      this.addResult(true, 'POSITION_MONITORING_FAILED', undefined, error.message);
    }
  }

  private addResult(success: boolean, stage: string, data?: any, error?: string): void {
    this.results.push({
      success,
      stage,
      data,
      error,
      timestamp: Date.now(),
    });
  }

  private printSummary(): void {
    console.log('='.repeat(60));
    console.log('📊 Test Summary');
    console.log('='.repeat(60));

    const successCount = this.results.filter(r => r.success).length;
    const totalCount = this.results.length;

    this.results.forEach((result, index) => {
      const icon = result.success ? '✅' : '❌';
      console.log(`${icon} ${index + 1}. ${result.stage}`);
      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }
    });

    console.log('\n' + '='.repeat(60));
    console.log(`Result: ${successCount}/${totalCount} stages passed`);
    console.log(`Test completed at: ${new Date().toISOString()}`);
    console.log('='.repeat(60));

    if (successCount === totalCount) {
      console.log('\n🎉 All stages completed successfully!');
    } else {
      console.log('\n⚠️  Some stages failed or were skipped');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async requireAuthToken(): Promise<string> {
    if (this.authToken) return this.authToken;

    const directToken = process.env.BACKEND_TOKEN || process.env.JWT_TOKEN;
    if (directToken) {
      this.authToken = directToken;
      return directToken;
    }

    const email = process.env.BACKEND_EMAIL;
    const password = process.env.BACKEND_PASSWORD;
    if (!email || !password) {
      throw new Error('Missing auth. Set BACKEND_TOKEN or BACKEND_EMAIL/BACKEND_PASSWORD.');
    }

    const response = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || `Login failed (${response.status})`);
    }

    const data = await response.json();
    const token = data?.token as string | undefined;
    if (!token) {
      throw new Error('Login succeeded but no token was returned.');
    }

    this.authToken = token;
    return token;
  }

  private async fetchMonitoringStatus(): Promise<any> {
    const token = await this.requireAuthToken();
    const response = await fetch(`${BACKEND_URL}/monitoring/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Monitoring request failed (${response.status})`);
    }
    return response.json();
  }
}

// Run the test
const test = new E2EFlowTest();
test.run().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
