import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, coinbaseWallet, rabbyWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { RPC_URL } from "./data";

const connectors = connectorsForWallets(
  [{ groupName: "Wallets", wallets: [injectedWallet, metaMaskWallet, rabbyWallet, coinbaseWallet] }],
  // the projectId only matters for WalletConnect relays; injected wallets ignore it
  { appName: "Solvent", projectId: "solvent-demo" },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [baseSepolia],
  transports: { [baseSepolia.id]: http(RPC_URL) },
});
