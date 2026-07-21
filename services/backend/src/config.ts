export const config = {
  port: Number(process.env.PORT ?? 3000),
  fabricChannelName: process.env.FABRIC_CHANNEL_NAME ?? "milkchannel",
  stakeholderChaincodeName: process.env.STAKEHOLDER_CHAINCODE_NAME ?? "stakeholder",
  supplychainChaincodeName: process.env.SUPPLYCHAIN_CHAINCODE_NAME ?? "supplychain",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://freshmilk:freshmilk@localhost:5432/freshmilk"
};
