export const config = {
  port: Number(process.env.PORT ?? 3000),
  fabricChannelName: process.env.FABRIC_CHANNEL_NAME ?? "milk-channel",
  fabricChaincodeName: process.env.FABRIC_CHAINCODE_NAME ?? "fresh-milk"
};
