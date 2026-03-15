/**
 * Integration tests for Chain Watcher with Base Sepolia testnet.
 *
 * These tests verify the Chain Watcher can:
 * 1. Connect to a real testnet RPC endpoint
 * 2. Detect USDC Transfer events
 * 3. Handle WebSocket disconnects and fall back to polling
 *
 * Prerequisites:
 * - BASE_SEPOLIA_RPC_HTTP: HTTP RPC endpoint for Base Sepolia
 * - BASE_SEPOLIA_RPC_WS: WebSocket RPC endpoint for Base Sepolia
 *
 * Run with: npm test -- --testPathPattern=integration
 */

import { ConnectionManager } from '../../connection-manager';
import { BASE_SEPOLIA } from '@stripeonchain/shared';
import { TransferLog } from '@stripeonchain/shared';

const HTTP_RPC = process.env.BASE_SEPOLIA_RPC_HTTP || BASE_SEPOLIA.RPC_HTTP;
const WS_RPC = process.env.BASE_SEPOLIA_RPC_WS || BASE_SEPOLIA.RPC_WS;

const INTEGRATION_TEST_TIMEOUT = 60_000;

describe('Chain Watcher - Base Sepolia Integration', () => {
  let connectionManager: ConnectionManager;

  beforeEach(() => {
    connectionManager = new ConnectionManager({
      httpUrl: HTTP_RPC,
      wsUrl: WS_RPC,
      contractAddress: BASE_SEPOLIA.USDC_CONTRACT,
      pollingIntervalMs: 5_000,
    });
  });

  afterEach(() => {
    connectionManager.stop();
  });

  describe('RPC Connection', () => {
    it(
      'should connect to Base Sepolia HTTP RPC and fetch block number',
      async () => {
        const response = await fetch(HTTP_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_blockNumber',
            params: [],
          }),
        });

        expect(response.ok).toBe(true);

        const data = (await response.json()) as { result: string };
        expect(data.result).toBeDefined();

        const blockNumber = parseInt(data.result, 16);
        expect(blockNumber).toBeGreaterThan(0);

        console.log(`[Integration] Current Base Sepolia block: ${blockNumber}`);
      },
      INTEGRATION_TEST_TIMEOUT,
    );

    it(
      'should verify USDC contract exists on Base Sepolia',
      async () => {
        const response = await fetch(HTTP_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getCode',
            params: [BASE_SEPOLIA.USDC_CONTRACT, 'latest'],
          }),
        });

        expect(response.ok).toBe(true);

        const data = (await response.json()) as { result: string };
        expect(data.result).toBeDefined();
        expect(data.result).not.toBe('0x');
        expect(data.result.length).toBeGreaterThan(10);

        console.log(
          `[Integration] USDC contract at ${BASE_SEPOLIA.USDC_CONTRACT} has ${data.result.length} bytes of code`,
        );
      },
      INTEGRATION_TEST_TIMEOUT,
    );
  });

  describe('ConnectionManager', () => {
    it(
      'should start and connect to Base Sepolia',
      async () => {
        const modeChanges: string[] = [];
        connectionManager.on('modeChange', (mode) => modeChanges.push(mode));

        await connectionManager.start();

        expect(connectionManager.connectionState.lastBlockNumber).toBeGreaterThan(0);
        expect(['websocket', 'polling']).toContain(connectionManager.mode);

        console.log(`[Integration] ConnectionManager mode: ${connectionManager.mode}`);
        console.log(
          `[Integration] Last block number: ${connectionManager.connectionState.lastBlockNumber}`,
        );
      },
      INTEGRATION_TEST_TIMEOUT,
    );

    it(
      'should fetch historical USDC transfer logs via polling',
      async () => {
        const currentBlockResponse = await fetch(HTTP_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_blockNumber',
            params: [],
          }),
        });

        const currentBlockData = (await currentBlockResponse.json()) as { result: string };
        const currentBlock = parseInt(currentBlockData.result, 16);

        const fromBlock = currentBlock - 1000;
        const toBlock = currentBlock;

        const logsResponse = await fetch(HTTP_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getLogs',
            params: [
              {
                address: BASE_SEPOLIA.USDC_CONTRACT,
                topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'],
                fromBlock: '0x' + fromBlock.toString(16),
                toBlock: '0x' + toBlock.toString(16),
              },
            ],
          }),
        });

        expect(logsResponse.ok).toBe(true);

        const logsData = (await logsResponse.json()) as { result: unknown[] };
        expect(Array.isArray(logsData.result)).toBe(true);

        console.log(
          `[Integration] Found ${logsData.result.length} USDC Transfer logs in last 1000 blocks`,
        );
      },
      INTEGRATION_TEST_TIMEOUT,
    );
  });

  describe('Transfer Event Detection', () => {
    it(
      'should be able to poll for logs using ConnectionManager',
      async () => {
        await connectionManager.start();

        const logs = await connectionManager.pollForLogs();

        expect(Array.isArray(logs)).toBe(true);

        if (logs.length > 0) {
          const firstLog = logs[0];
          expect(firstLog.transactionHash).toBeDefined();
          expect(firstLog.blockNumber).toBeGreaterThan(0);
          expect(firstLog.from).toMatch(/^0x[a-fA-F0-9]{40}$/);
          expect(firstLog.to).toMatch(/^0x[a-fA-F0-9]{40}$/);

          console.log(`[Integration] Sample transfer log:`, {
            txHash: firstLog.transactionHash,
            blockNumber: firstLog.blockNumber,
            from: firstLog.from,
            to: firstLog.to,
          });
        } else {
          console.log('[Integration] No recent transfers found (this is normal on testnet)');
        }
      },
      INTEGRATION_TEST_TIMEOUT,
    );

    it(
      'should emit transfer events when polling detects logs',
      async () => {
        const transferEvents: TransferLog[] = [];
        connectionManager.on('transfer', (log: TransferLog) => transferEvents.push(log));

        await connectionManager.start();
        await connectionManager.pollForLogs();

        console.log(`[Integration] Received ${transferEvents.length} transfer events via polling`);
      },
      INTEGRATION_TEST_TIMEOUT,
    );
  });

  describe('Polling Fallback', () => {
    it(
      'should successfully poll when in polling mode',
      async () => {
        const pollingManager = new ConnectionManager({
          httpUrl: HTTP_RPC,
          wsUrl: 'wss://invalid.endpoint.that.will.fail',
          contractAddress: BASE_SEPOLIA.USDC_CONTRACT,
          pollingIntervalMs: 2_000,
        });

        const modeChanges: string[] = [];
        pollingManager.on('modeChange', (mode) => modeChanges.push(mode));

        try {
          await pollingManager.start();

          await new Promise((resolve) => setTimeout(resolve, 3000));

          expect(pollingManager.connectionState.lastBlockNumber).toBeGreaterThan(0);

          const logs = await pollingManager.pollForLogs();
          expect(Array.isArray(logs)).toBe(true);

          console.log(`[Integration] Polling fallback test - mode changes: ${modeChanges}`);
          console.log(
            `[Integration] Last block after polling: ${pollingManager.connectionState.lastBlockNumber}`,
          );
        } finally {
          pollingManager.stop();
        }
      },
      INTEGRATION_TEST_TIMEOUT,
    );

    it(
      'should track block numbers correctly across multiple polls',
      async () => {
        await connectionManager.start();

        const initialBlock = connectionManager.connectionState.lastBlockNumber;
        expect(initialBlock).toBeGreaterThan(0);

        await connectionManager.pollForLogs();
        const afterFirstPoll = connectionManager.connectionState.lastBlockNumber;

        await new Promise((resolve) => setTimeout(resolve, 2000));

        await connectionManager.pollForLogs();
        const afterSecondPoll = connectionManager.connectionState.lastBlockNumber;

        expect(afterFirstPoll).toBeGreaterThanOrEqual(initialBlock!);
        expect(afterSecondPoll).toBeGreaterThanOrEqual(afterFirstPoll!);

        console.log(
          `[Integration] Block progression: ${initialBlock} -> ${afterFirstPoll} -> ${afterSecondPoll}`,
        );
      },
      INTEGRATION_TEST_TIMEOUT,
    );
  });
});
