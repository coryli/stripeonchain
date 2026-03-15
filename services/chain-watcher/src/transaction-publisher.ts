import Redis from 'ioredis';
import {
  REDIS_STREAMS,
  SupportedChain,
  ChainTransactionMessage,
  TransferLog,
} from '@stripeonchain/shared';

export interface TransactionPublisher {
  publish(message: ChainTransactionMessage): Promise<boolean>;
  isPublished(chain: SupportedChain, txHash: string): Promise<boolean>;
  close(): Promise<void>;
}

const DEDUP_KEY_PREFIX = 'chain-tx:published';
const DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export class RedisTransactionPublisher implements TransactionPublisher {
  private redis: Redis;
  private streamKey: string;

  constructor(redis: Redis, streamKey: string = REDIS_STREAMS.CHAIN_TRANSACTIONS) {
    this.redis = redis;
    this.streamKey = streamKey;
  }

  async publish(message: ChainTransactionMessage): Promise<boolean> {
    const dedupKey = this.getDedupKey(message.chain, message.tx_hash);

    const alreadyPublished = await this.isPublished(message.chain, message.tx_hash);
    if (alreadyPublished) {
      return false;
    }

    const fields: string[] = [
      'chain',
      message.chain,
      'tx_hash',
      message.tx_hash,
      'block_number',
      message.block_number.toString(),
      'block_hash',
      message.block_hash,
      'amount',
      message.amount,
      'sender',
      message.sender,
      'receiver',
      message.receiver,
      'token_contract',
      message.token_contract,
      'detected_at',
      message.detected_at,
    ];

    await this.redis.xadd(this.streamKey, '*', ...fields);
    await this.redis.setex(dedupKey, DEDUP_TTL_SECONDS, '1');

    return true;
  }

  async isPublished(chain: SupportedChain, txHash: string): Promise<boolean> {
    const dedupKey = this.getDedupKey(chain, txHash);
    const exists = await this.redis.exists(dedupKey);
    return exists === 1;
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }

  private getDedupKey(chain: SupportedChain, txHash: string): string {
    return `${DEDUP_KEY_PREFIX}:${chain}:${txHash}`;
  }

  static fromTransferLog(
    log: TransferLog,
    chain: SupportedChain,
    tokenContract: string,
  ): ChainTransactionMessage {
    return {
      chain,
      tx_hash: log.transactionHash,
      block_number: log.blockNumber,
      block_hash: log.blockHash,
      amount: log.value,
      sender: log.from,
      receiver: log.to,
      token_contract: tokenContract,
      detected_at: new Date().toISOString(),
    };
  }
}
