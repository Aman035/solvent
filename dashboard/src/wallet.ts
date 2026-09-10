import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, coinbaseWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { RPC_URL } from "./data";

const connectors = connectorsForWallets(
  // installed extensions (MetaMask, Rabby, ...) surface automatically via EIP-6963
  // and connect through the plain injected path - the SDK connectors can hang the popup
  [{ groupName: "Wallets", wallets: [injectedWallet, coinbaseWallet] }],
  // the projectId only matters for WalletConnect relays; injected wallets ignore it
  { appName: "Solvent", projectId: "solvent-demo" },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: [baseSepolia],
  transports: { [baseSepolia.id]: http(RPC_URL) },
});
