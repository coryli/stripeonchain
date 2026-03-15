import { RedisTransactionPublisher } from '../transaction-publisher';
import { ChainTransactionMessage, TransferLog } from '@stripeonchain/shared';

const mockRedis = {
  xadd: jest.fn(),
  setex: jest.fn(),
  exists: jest.fn(),
  quit: jest.fn(),
};

describe('RedisTransactionPublisher', () => {
  let publisher: RedisTransactionPublisher;

  const sampleMessage: ChainTransactionMessage = {
    chain: 'base',
    tx_hash: '0xabc123def456',
    block_number: 12345678,
    block_hash: '0xblockhash123',
    amount: '0x0000000000000000000000000000000000000000000000000000000005f5e100',
    sender: '0x1234567890123456789012345678901234567890',
    receiver: '0x0987654321098765432109876543210987654321',
    token_contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    detected_at: '2026-03-15T12:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publisher = new RedisTransactionPublisher(mockRedis as any);
  });

  describe('publish', () => {
    it('should publish new transaction to Redis stream', async () => {
      mockRedis.exists.mockResolvedValueOnce(0);
      mockRedis.xadd.mockResolvedValueOnce('1234567890-0');
      mockRedis.setex.mockResolvedValueOnce('OK');

      const result = await publisher.publish(sampleMessage);

      expect(result).toBe(true);
      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'chain-transactions',
        '*',
        'chain',
        'base',
        'tx_hash',
        '0xabc123def456',
        'block_number',
        '12345678',
        'block_hash',
        '0xblockhash123',
        'amount',
        '0x0000000000000000000000000000000000000000000000000000000005f5e100',
        'sender',
        '0x1234567890123456789012345678901234567890',
        'receiver',
        '0x0987654321098765432109876543210987654321',
        'token_contract',
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        'detected_at',
        '2026-03-15T12:00:00.000Z',
      );
    });

    it('should set dedup key with TTL after publishing', async () => {
      mockRedis.exists.mockResolvedValueOnce(0);
      mockRedis.xadd.mockResolvedValueOnce('1234567890-0');
      mockRedis.setex.mockResolvedValueOnce('OK');

      await publisher.publish(sampleMessage);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'chain-tx:published:base:0xabc123def456',
        7 * 24 * 60 * 60,
        '1',
      );
    });

    it('should not publish duplicate transaction', async () => {
      mockRedis.exists.mockResolvedValueOnce(1);

      const result = await publisher.publish(sampleMessage);

      expect(result).toBe(false);
      expect(mockRedis.xadd).not.toHaveBeenCalled();
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });

    it('should use custom stream key when provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const customPublisher = new RedisTransactionPublisher(mockRedis as any, 'custom-stream');

      mockRedis.exists.mockResolvedValueOnce(0);
      mockRedis.xadd.mockResolvedValueOnce('1234567890-0');
      mockRedis.setex.mockResolvedValueOnce('OK');

      await customPublisher.publish(sampleMessage);

      expect(mockRedis.xadd).toHaveBeenCalledWith(
        'custom-stream',
        '*',
        'chain',
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('isPublished', () => {
    it('should return true when transaction already published', async () => {
      mockRedis.exists.mockResolvedValueOnce(1);

      const result = await publisher.isPublished('base', '0xabc123');

      expect(result).toBe(true);
      expect(mockRedis.exists).toHaveBeenCalledWith('chain-tx:published:base:0xabc123');
    });

    it('should return false when transaction not published', async () => {
      mockRedis.exists.mockResolvedValueOnce(0);

      const result = await publisher.isPublished('ethereum', '0xdef456');

      expect(result).toBe(false);
      expect(mockRedis.exists).toHaveBeenCalledWith('chain-tx:published:ethereum:0xdef456');
    });

    it('should use chain+txHash as dedup key', async () => {
      mockRedis.exists.mockResolvedValueOnce(0);

      await publisher.isPublished('polygon', '0x999');

      expect(mockRedis.exists).toHaveBeenCalledWith('chain-tx:published:polygon:0x999');
    });
  });

  describe('close', () => {
    it('should close Redis connection', async () => {
      mockRedis.quit.mockResolvedValueOnce('OK');

      await publisher.close();

      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });

  describe('fromTransferLog', () => {
    it('should convert TransferLog to ChainTransactionMessage', () => {
      const transferLog: TransferLog = {
        transactionHash: '0xtxhash123',
        blockNumber: 98765,
        blockHash: '0xblockhash456',
        logIndex: 5,
        from: '0xsender',
        to: '0xreceiver',
        value: '0x1234',
      };

      const message = RedisTransactionPublisher.fromTransferLog(
        transferLog,
        'base',
        '0xusdccontract',
      );

      expect(message.chain).toBe('base');
      expect(message.tx_hash).toBe('0xtxhash123');
      expect(message.block_number).toBe(98765);
      expect(message.block_hash).toBe('0xblockhash456');
      expect(message.amount).toBe('0x1234');
      expect(message.sender).toBe('0xsender');
      expect(message.receiver).toBe('0xreceiver');
      expect(message.token_contract).toBe('0xusdccontract');
      expect(message.detected_at).toBeDefined();
    });

    it('should set detected_at to current ISO timestamp', () => {
      const transferLog: TransferLog = {
        transactionHash: '0x123',
        blockNumber: 1,
        blockHash: '0xblock',
        logIndex: 0,
        from: '0xa',
        to: '0xb',
        value: '0x0',
      };

      const before = new Date().toISOString();
      const message = RedisTransactionPublisher.fromTransferLog(transferLog, 'ethereum', '0xusdc');
      const after = new Date().toISOString();

      expect(message.detected_at >= before).toBe(true);
      expect(message.detected_at <= after).toBe(true);
    });
  });

  describe('idempotency', () => {
    it('should ensure exactly-once publishing for same chain+txHash', async () => {
      mockRedis.exists.mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(1);
      mockRedis.xadd.mockResolvedValue('1234567890-0');
      mockRedis.setex.mockResolvedValue('OK');

      const result1 = await publisher.publish(sampleMessage);
      const result2 = await publisher.publish(sampleMessage);
      const result3 = await publisher.publish(sampleMessage);

      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
      expect(mockRedis.xadd).toHaveBeenCalledTimes(1);
    });

    it('should allow same txHash on different chains', async () => {
      mockRedis.exists.mockResolvedValue(0);
      mockRedis.xadd.mockResolvedValue('1234567890-0');
      mockRedis.setex.mockResolvedValue('OK');

      const baseMessage = { ...sampleMessage, chain: 'base' as const };
      const ethereumMessage = { ...sampleMessage, chain: 'ethereum' as const };

      const result1 = await publisher.publish(baseMessage);
      const result2 = await publisher.publish(ethereumMessage);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(mockRedis.xadd).toHaveBeenCalledTimes(2);
    });
  });
});
